/**
 * WGSL shaders for the GPU particle simulation.
 *
 * One simulation step runs these compute passes in order:
 *   1. COUNT   - bin each particle into a hashed grid cell (atomic counters)
 *   2. SCAN    - exclusive prefix sum over the cell counters -> cell start offsets
 *   3. SCATTER - write each particle index into its cell's slot range
 *   4. FORCES  - integrate each particle visiting only the 3x3 neighbouring cells
 *
 * Cells are `interactionRadius` wide, so every interacting pair is found while
 * the cost stays O(n * neighbours) instead of O(n^2). Cell coordinates are
 * hashed into a fixed-size table, so the grid works for any world size.
 */

/** Number of buckets in the spatial hash table (power of two). */
export const GRID_TABLE_SIZE = 1 << 17;
/** Threads in the single-workgroup prefix sum; each scans a contiguous chunk. */
const SCAN_THREADS = 256;
const SCAN_CHUNK = GRID_TABLE_SIZE / SCAN_THREADS;

export const WORKGROUP_SIZE = 256;

/** Byte size of the `Params` uniform below (must stay a multiple of 16). */
export const PARAMS_SIZE_BYTES = 32 * 4;

const COMMON = /* wgsl */ `
struct Particle {
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  ptype: f32,
}

struct Params {
  count: u32,
  numTypes: u32,
  edgeMode: u32,        // 0 = bouncing walls, 1 = wrap around
  mouseMode: u32,       // 0 = none, 1 = repel, 2 = attract, 3 = vortex
  gridW: u32,           // wrap mode only: cells across the world
  gridH: u32,
  gravityEnabled: u32,
  noiseEnabled: u32,

  worldW: f32,
  worldH: f32,
  cellSize: f32,
  cellW: f32,           // wrap mode only: worldW / gridW
  cellH: f32,
  attraction: f32,
  repulsion: f32,
  interactionRadius: f32,

  minDistance: f32,
  softness: f32,
  drag: f32,
  maxSpeed: f32,
  interFriction: f32,
  gravityX: f32,
  gravityY: f32,
  noiseStrength: f32,

  mouseX: f32,
  mouseY: f32,
  mouseRadius: f32,
  mouseStrength: f32,
  seed: u32,
  centralGravity: f32,  // pull toward the origin, g / max(r, CENTRAL_SOFTENING)
  _pad1: u32,
  _pad2: u32,
}

const TABLE_SIZE: u32 = ${GRID_TABLE_SIZE}u;

fn cellCoord(x: f32, y: f32) -> vec2i {
  if (params.edgeMode == 1u) {
    let cx = i32(floor((x + params.worldW * 0.5) / params.cellW));
    let cy = i32(floor((y + params.worldH * 0.5) / params.cellH));
    return vec2i(clamp(cx, 0, i32(params.gridW) - 1), clamp(cy, 0, i32(params.gridH) - 1));
  }
  let limit = 1.0e9;
  return vec2i(
    i32(clamp(floor(x / params.cellSize), -limit, limit)),
    i32(clamp(floor(y / params.cellSize), -limit, limit))
  );
}

fn hashCell(c: vec2i) -> u32 {
  let h = (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u);
  return h & (TABLE_SIZE - 1u);
}
`;

export const COUNT_SHADER = /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> particleCell: array<u32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }
  let p = particles[i];
  let h = hashCell(cellCoord(p.x, p.y));
  particleCell[i] = h;
  atomicAdd(&cellCounts[h], 1u);
}
`;

export const SCAN_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(1) var<storage, read_write> cellStart: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellCursor: array<u32>;

const CHUNK: u32 = ${SCAN_CHUNK}u;
var<workgroup> sums: array<u32, ${SCAN_THREADS}>;

@compute @workgroup_size(${SCAN_THREADS})
fn main(@builtin(local_invocation_index) t: u32) {
  let base = t * CHUNK;
  var total = 0u;
  for (var k = 0u; k < CHUNK; k++) {
    total += cellCounts[base + k];
  }
  sums[t] = total;
  workgroupBarrier();

  // Hillis-Steele inclusive scan of the per-thread totals
  for (var offset = 1u; offset < ${SCAN_THREADS}u; offset = offset * 2u) {
    var v = 0u;
    if (t >= offset) { v = sums[t - offset]; }
    workgroupBarrier();
    sums[t] += v;
    workgroupBarrier();
  }

  var running = sums[t] - total;
  for (var k = 0u; k < CHUNK; k++) {
    let c = cellCounts[base + k];
    cellStart[base + k] = running;
    cellCursor[base + k] = running;
    running += c;
  }
}
`;

export const SCATTER_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> particleCell: array<u32>;
@group(0) @binding(1) var<storage, read_write> cellCursor: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> sortedIndices: array<u32>;
@group(0) @binding(3) var<uniform> count: vec4u;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= count.x) { return; }
  let slot = atomicAdd(&cellCursor[particleCell[i]], 1u);
  sortedIndices[slot] = i;
}
`;

/**
 * Force + integration pass. Same physical model as physics/forces.ts and the
 * previous brute-force shader, but neighbours come from the spatial grid.
 */
export const FORCES_SHADER = /* wgsl */ `
${COMMON}
@group(0) @binding(0) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(1) var<storage, read_write> particlesOut: array<Particle>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> interactionMatrix: array<f32>;
@group(0) @binding(4) var<storage, read> cellCounts: array<u32>;
@group(0) @binding(5) var<storage, read> cellStart: array<u32>;
@group(0) @binding(6) var<storage, read> sortedIndices: array<u32>;

fn hash(n: u32) -> f32 {
  var x = n;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return f32(x) / f32(0xffffffffu);
}

fn random(seed: u32, offset: u32) -> f32 {
  return hash(seed + offset * 0x9e3779b9u) * 2.0 - 1.0;
}

const CENTRAL_SOFTENING: f32 = 30.0;

fn wrapCell(v: i32, n: i32) -> i32 {
  return ((v % n) + n) % n;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= params.count) { return; }

  var p = particlesIn[i];
  let pType = u32(p.ptype);
  let wrap = params.edgeMode == 1u;
  let halfW = params.worldW * 0.5;
  let halfH = params.worldH * 0.5;
  let radiusSq = params.interactionRadius * params.interactionRadius;

  var ax = 0.0;
  var ay = 0.0;
  var frictionVx = 0.0;
  var frictionVy = 0.0;
  var frictionCount = 0.0;

  // Neighbour cell range. With a wrapped grid narrower than 3 cells the
  // -1..1 offsets would visit the same cell twice, so cover it exactly once.
  var spanX = 3;
  var spanY = 3;
  var startX = -1;
  var startY = -1;
  if (wrap) {
    if (params.gridW < 3u) { spanX = i32(params.gridW); startX = 0; }
    if (params.gridH < 3u) { spanY = i32(params.gridH); startY = 0; }
  }

  let home = cellCoord(p.x, p.y);
  var visited: array<u32, 9>;
  var visitedCount = 0u;

  for (var oy = 0; oy < spanY; oy++) {
    for (var ox = 0; ox < spanX; ox++) {
      var c = home + vec2i(startX + ox, startY + oy);
      if (wrap) {
        c = vec2i(wrapCell(c.x, i32(params.gridW)), wrapCell(c.y, i32(params.gridH)));
      }
      let h = hashCell(c);

      // Two neighbour cells can hash to the same bucket: visit it once
      var seen = false;
      for (var v = 0u; v < visitedCount; v++) {
        if (visited[v] == h) { seen = true; }
      }
      if (seen) { continue; }
      visited[visitedCount] = h;
      visitedCount++;

      let start = cellStart[h];
      let end = start + cellCounts[h];
      for (var k = start; k < end; k++) {
        let j = sortedIndices[k];
        if (j == i) { continue; }

        let other = particlesIn[j];
        var dx = other.x - p.x;
        var dy = other.y - p.y;
        if (wrap) {
          if (dx > halfW) { dx -= params.worldW; }
          if (dx < -halfW) { dx += params.worldW; }
          if (dy > halfH) { dy -= params.worldH; }
          if (dy < -halfH) { dy += params.worldH; }
        }

        let distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) { continue; }
        let dist = sqrt(distSq);
        if (dist < 1.0) { continue; }

        let nx = dx / dist;
        let ny = dy / dist;

        // Physical collision
        if (dist < params.minDistance) {
          let pushForce = params.softness * (params.minDistance / dist - 1.0);
          ax -= nx * pushForce;
          ay -= ny * pushForce;

          let proximity = 1.0 - dist / params.minDistance;
          frictionVx += (other.vx - p.vx) * proximity;
          frictionVy += (other.vy - p.vy) * proximity;
          frictionCount += 1.0;
        } else {
          // Distance-based attraction / repulsion from the interaction matrix
          let interaction = interactionMatrix[pType * params.numTypes + u32(other.ptype)];
          let falloff = 1.0 - (dist - params.minDistance) / (params.interactionRadius - params.minDistance);
          var forceStrength = 0.0;
          if (interaction > 0.0) {
            forceStrength = params.attraction * interaction * falloff;
          } else if (interaction < 0.0) {
            forceStrength = params.repulsion * interaction * falloff;
          }
          ax += nx * forceStrength;
          ay += ny * forceStrength;
        }
      }
    }
  }

  if (frictionCount > 0.0 && params.interFriction > 0.0) {
    p.vx += (frictionVx / frictionCount) * params.interFriction;
    p.vy += (frictionVy / frictionCount) * params.interFriction;
  }

  p.vx += ax;
  p.vy += ay;

  if (params.gravityEnabled != 0u) {
    p.vx += params.gravityX;
    p.vy += params.gravityY;
  }

  if (params.centralGravity > 0.0) {
    let r = sqrt(p.x * p.x + p.y * p.y);
    if (r > 1.0e-3) {
      let pull = params.centralGravity / max(r, CENTRAL_SOFTENING) / r;
      p.vx -= p.x * pull;
      p.vy -= p.y * pull;
    }
  }

  if (params.noiseEnabled != 0u) {
    let seed = params.seed ^ (i * 0x27d4eb2du);
    p.vx += random(seed, 0u) * params.noiseStrength;
    p.vy += random(seed, 1u) * params.noiseStrength;
  }

  if (params.mouseMode != 0u) {
    let mdx = p.x - params.mouseX;
    let mdy = p.y - params.mouseY;
    let mouseDist = sqrt(mdx * mdx + mdy * mdy);
    if (mouseDist < params.mouseRadius && mouseDist > 1.0) {
      let force = params.mouseStrength * (1.0 - mouseDist / params.mouseRadius);
      let mnx = mdx / mouseDist;
      let mny = mdy / mouseDist;
      if (params.mouseMode == 1u) {
        p.vx += mnx * force;
        p.vy += mny * force;
      } else if (params.mouseMode == 2u) {
        p.vx -= mnx * force;
        p.vy -= mny * force;
      } else if (params.mouseMode == 3u) {
        p.vx += -mny * force;
        p.vy += mnx * force;
      }
    }
  }

  p.vx *= (1.0 - params.drag);
  p.vy *= (1.0 - params.drag);

  let speed = sqrt(p.vx * p.vx + p.vy * p.vy);
  if (speed > params.maxSpeed) {
    p.vx = (p.vx / speed) * params.maxSpeed;
    p.vy = (p.vy / speed) * params.maxSpeed;
  }

  p.x += p.vx;
  p.y += p.vy;

  if (wrap) {
    if (p.x > halfW) { p.x -= params.worldW; }
    if (p.x < -halfW) { p.x += params.worldW; }
    if (p.y > halfH) { p.y -= params.worldH; }
    if (p.y < -halfH) { p.y += params.worldH; }
  } else {
    let wallMargin = params.minDistance * 2.0;
    let wallForce = params.softness * 2.0;

    if (p.x > halfW - wallMargin) {
      let d = halfW - p.x;
      if (d > 0.0) { p.vx -= wallForce * (1.0 - d / wallMargin); }
      else { p.x = halfW - 1.0; p.vx = -abs(p.vx) * 0.5; }
    }
    if (p.x < -halfW + wallMargin) {
      let d = p.x + halfW;
      if (d > 0.0) { p.vx += wallForce * (1.0 - d / wallMargin); }
      else { p.x = -halfW + 1.0; p.vx = abs(p.vx) * 0.5; }
    }
    if (p.y > halfH - wallMargin) {
      let d = halfH - p.y;
      if (d > 0.0) { p.vy -= wallForce * (1.0 - d / wallMargin); }
      else { p.y = halfH - 1.0; p.vy = -abs(p.vy) * 0.5; }
    }
    if (p.y < -halfH + wallMargin) {
      let d = p.y + halfH;
      if (d > 0.0) { p.vy += wallForce * (1.0 - d / wallMargin); }
      else { p.y = -halfH + 1.0; p.vy = abs(p.vy) * 0.5; }
    }
  }

  particlesOut[i] = p;
}
`;

/** Byte size of the `View` uniform used by the particle render shader. */
export const VIEW_SIZE_BYTES = 304;

/**
 * Instanced particle rendering straight from the simulation storage buffer.
 * Each instance is a screen-aligned quad; the fragment shader cuts a circle.
 * The on-screen radius never drops below `minRadiusPx`, so the swarm stays
 * visible no matter how far the camera zooms out.
 */
export const PARTICLE_RENDER_SHADER = /* wgsl */ `
struct Particle {
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  ptype: f32,
}

struct View {
  center: vec2f,       // camera position in world units
  viewport: vec2f,     // viewport size in CSS pixels
  zoom: f32,           // CSS pixels per world unit
  radius: f32,         // particle radius in world units
  minRadiusPx: f32,
  colorMode: u32,      // 0 = type, 1 = velocity
  maxSpeed: f32,
  velocityScale: f32,
  sizeByVelocity: u32,
  sizeMultiplier: f32,
  palette: array<vec4f, 10>,
  velocityPalette: array<vec4f, 6>,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> view: View;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) radiusPx: f32,
}

fn velocityColor(t: f32) -> vec3f {
  let scaled = clamp(t, 0.0, 1.0) * 5.0;
  let seg = min(u32(floor(scaled)), 4u);
  return mix(view.velocityPalette[seg].rgb, view.velocityPalette[seg + 1u].rgb, scaled - f32(seg));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VertexOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let p = particles[ii];
  let corner = corners[vi];
  let speed = sqrt(p.vx * p.vx + p.vy * p.vy);
  let normSpeed = min(speed / (view.maxSpeed * view.velocityScale), 1.0);

  var size = 1.0;
  if (view.sizeByVelocity != 0u) {
    size = 1.0 + min(speed / view.maxSpeed, 1.0) * (view.sizeMultiplier - 1.0);
  }

  let trueRadiusPx = view.radius * size * view.zoom;
  let radiusPx = max(trueRadiusPx, view.minRadiusPx);

  let screen = (vec2f(p.x, p.y) - view.center) * view.zoom + corner * radiusPx;
  let clip = screen * 2.0 / view.viewport;

  var rgb: vec3f;
  if (view.colorMode == 1u) {
    rgb = velocityColor(normSpeed);
  } else {
    rgb = view.palette[min(u32(p.ptype), 9u)].rgb;
  }
  // Sub-pixel particles fade a little so dense regions read as density
  let alpha = clamp(trueRadiusPx / view.minRadiusPx, 0.35, 1.0);

  var out: VertexOut;
  out.position = vec4f(clip, 0.0, 1.0);
  out.local = corner;
  out.color = vec4f(rgb, alpha);
  out.radiusPx = radiusPx;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let d = length(in.local);
  // ~1 device pixel of antialiasing at the edge
  let edge = clamp((1.0 - d) * in.radiusPx * 2.0, 0.0, 1.0);
  if (edge <= 0.0) { discard; }
  return vec4f(in.color.rgb, in.color.a * edge);
}
`;

/** Fullscreen helpers: fade the trail texture and copy it to the canvas. */
export const FULLSCREEN_SHADER = /* wgsl */ `
@group(0) @binding(0) var<uniform> fadeColor: vec4f;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VertexOut;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = vec2f((pos[vi].x + 1.0) * 0.5, (1.0 - pos[vi].y) * 0.5);
  return out;
}

@fragment
fn fade() -> @location(0) vec4f {
  return fadeColor;
}

@fragment
fn blit(in: VertexOut) -> @location(0) vec4f {
  return textureSample(source, sourceSampler, in.uv);
}
`;
