/**
 * WGSL Shaders for particle physics simulation
 */

// Shared struct definitions
const PARTICLE_STRUCT = `
struct Particle {
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  ptype: f32
}
`;

const CONFIG_STRUCT = `
struct Config {
  particleCount: u32,
  particleTypes: u32,
  worldWidth: f32,
  worldHeight: f32,

  attraction: f32,
  repulsion: f32,
  interactionRadius: f32,
  minDistance: f32,

  softness: f32,
  drag: f32,
  maxSpeed: f32,
  interFriction: f32,

  gravityEnabled: u32,
  gravityX: f32,
  gravityY: f32,
  noiseEnabled: u32,

  noiseStrength: f32,
  wrapEdges: u32,
  mouseMode: u32,
  mouseX: f32,

  mouseY: f32,
  mouseRadius: f32,
  mouseStrength: f32,
  deltaTime: f32,

  randomSeed: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32
}
`;

const SPATIAL_STRUCT = `
struct SpatialCell {
  start: u32,
  count: u32
}
`;

/**
 * Compute shader for building spatial hash grid
 * This allows O(1) neighbor lookups instead of O(n^2)
 */
export const SPATIAL_HASH_SHADER = `
${PARTICLE_STRUCT}
${CONFIG_STRUCT}
${SPATIAL_STRUCT}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> config: Config;
@group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> particleIndices: array<u32>;

const CELL_SIZE: f32 = 50.0;

fn getCellIndex(x: f32, y: f32) -> u32 {
  let halfW = config.worldWidth / 2.0;
  let halfH = config.worldHeight / 2.0;
  let cellX = u32((x + halfW) / CELL_SIZE);
  let cellY = u32((y + halfH) / CELL_SIZE);
  let gridWidth = u32(config.worldWidth / CELL_SIZE) + 1u;
  return cellY * gridWidth + cellX;
}

@compute @workgroup_size(256)
fn countParticles(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= config.particleCount) { return; }

  let p = particles[i];
  let cellIdx = getCellIndex(p.x, p.y);
  atomicAdd(&cellCounts[cellIdx], 1u);
}

@compute @workgroup_size(256)
fn assignParticles(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= config.particleCount) { return; }

  let p = particles[i];
  let cellIdx = getCellIndex(p.x, p.y);
  let slot = atomicAdd(&cellCounts[cellIdx], 1u);
  particleIndices[slot] = i;
}
`;

/**
 * Main physics compute shader
 * Calculates forces between particles and updates velocities/positions
 */
export const PHYSICS_SHADER = `
${PARTICLE_STRUCT}
${CONFIG_STRUCT}

@group(0) @binding(0) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(1) var<storage, read_write> particlesOut: array<Particle>;
@group(0) @binding(2) var<uniform> config: Config;
@group(0) @binding(3) var<storage, read> interactionMatrix: array<f32>;

// Simple hash for pseudo-random
fn hash(n: u32) -> f32 {
  var x = n;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return f32(x) / f32(0xffffffffu);
}

fn random(seed: u32, offset: u32) -> f32 {
  return hash(seed + offset * 1000u) * 2.0 - 1.0;
}

fn getInteraction(typeA: u32, typeB: u32) -> f32 {
  return interactionMatrix[typeA * config.particleTypes + typeB];
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= config.particleCount) { return; }

  var p = particlesIn[i];
  let pType = u32(p.ptype);

  var ax: f32 = 0.0;
  var ay: f32 = 0.0;
  var frictionVx: f32 = 0.0;
  var frictionVy: f32 = 0.0;
  var frictionCount: f32 = 0.0;

  let halfW = config.worldWidth / 2.0;
  let halfH = config.worldHeight / 2.0;

  // Calculate forces from all other particles
  // TODO: Use spatial hash for better performance
  for (var j = 0u; j < config.particleCount; j++) {
    if (i == j) { continue; }

    let other = particlesIn[j];
    var dx = other.x - p.x;
    var dy = other.y - p.y;
    let oType = u32(other.ptype);

    // Wrap-around distance
    if (config.wrapEdges != 0u) {
      if (dx > halfW) { dx -= config.worldWidth; }
      if (dx < -halfW) { dx += config.worldWidth; }
      if (dy > halfH) { dy -= config.worldHeight; }
      if (dy < -halfH) { dy += config.worldHeight; }
    }

    let distSq = dx * dx + dy * dy;
    let dist = sqrt(distSq);

    if (dist < 1.0) { continue; }
    if (dist > config.interactionRadius) { continue; }

    let nx = dx / dist;
    let ny = dy / dist;

    let interaction = getInteraction(pType, oType);

    // Physical collision
    if (dist < config.minDistance) {
      let ratio = config.minDistance / dist;
      let pushForce = config.softness * (ratio - 1.0);
      ax -= nx * pushForce;
      ay -= ny * pushForce;

      // Friction
      let proximity = 1.0 - dist / config.minDistance;
      frictionVx += (other.vx - p.vx) * proximity;
      frictionVy += (other.vy - p.vy) * proximity;
      frictionCount += 1.0;
    }

    // Distance-based forces
    if (dist >= config.minDistance) {
      var forceStrength: f32 = 0.0;
      let normalizedDist = (dist - config.minDistance) / (config.interactionRadius - config.minDistance);

      if (interaction > 0.0) {
        forceStrength = config.attraction * interaction * (1.0 - normalizedDist);
      } else if (interaction < 0.0) {
        forceStrength = config.repulsion * interaction * (1.0 - normalizedDist);
      }

      ax += nx * forceStrength;
      ay += ny * forceStrength;
    }
  }

  // Apply inter-particle friction
  if (frictionCount > 0.0 && config.interFriction > 0.0) {
    p.vx += (frictionVx / frictionCount) * config.interFriction;
    p.vy += (frictionVy / frictionCount) * config.interFriction;
  }

  // Apply acceleration
  p.vx += ax;
  p.vy += ay;

  // Apply global gravity
  if (config.gravityEnabled != 0u) {
    p.vx += config.gravityX;
    p.vy += config.gravityY;
  }

  // Noise/turbulence
  if (config.noiseEnabled != 0u) {
    let seed = u32(config.randomSeed * 1000.0) + i;
    p.vx += random(seed, 0u) * config.noiseStrength;
    p.vy += random(seed, 1u) * config.noiseStrength;
  }

  // Mouse interaction
  if (config.mouseMode != 0u) {
    let mdx = p.x - config.mouseX;
    let mdy = p.y - config.mouseY;
    let mouseDist = sqrt(mdx * mdx + mdy * mdy);

    if (mouseDist < config.mouseRadius && mouseDist > 1.0) {
      let force = config.mouseStrength * (1.0 - mouseDist / config.mouseRadius);
      let mnx = mdx / mouseDist;
      let mny = mdy / mouseDist;

      if (config.mouseMode == 1u) { // Repel
        p.vx += mnx * force;
        p.vy += mny * force;
      } else if (config.mouseMode == 2u) { // Attract
        p.vx -= mnx * force;
        p.vy -= mny * force;
      } else if (config.mouseMode == 3u) { // Vortex
        p.vx += -mny * force;
        p.vy += mnx * force;
      }
    }
  }

  // Apply drag
  p.vx *= (1.0 - config.drag);
  p.vy *= (1.0 - config.drag);

  // Limit speed
  let speed = sqrt(p.vx * p.vx + p.vy * p.vy);
  if (speed > config.maxSpeed) {
    p.vx = (p.vx / speed) * config.maxSpeed;
    p.vy = (p.vy / speed) * config.maxSpeed;
  }

  // Update position
  p.x += p.vx;
  p.y += p.vy;

  // Handle edges
  if (config.wrapEdges != 0u) {
    if (p.x > halfW) { p.x -= config.worldWidth; }
    if (p.x < -halfW) { p.x += config.worldWidth; }
    if (p.y > halfH) { p.y -= config.worldHeight; }
    if (p.y < -halfH) { p.y += config.worldHeight; }
  } else {
    // Bounce off walls
    let wallMargin = config.minDistance * 2.0;
    let wallForce = config.softness * 2.0;

    if (p.x > halfW - wallMargin) {
      let d = halfW - p.x;
      if (d > 0.0) {
        p.vx -= wallForce * (1.0 - d / wallMargin);
      } else {
        p.x = halfW - 1.0;
        p.vx = -abs(p.vx) * 0.5;
      }
    }
    if (p.x < -halfW + wallMargin) {
      let d = p.x + halfW;
      if (d > 0.0) {
        p.vx += wallForce * (1.0 - d / wallMargin);
      } else {
        p.x = -halfW + 1.0;
        p.vx = abs(p.vx) * 0.5;
      }
    }
    if (p.y > halfH - wallMargin) {
      let d = halfH - p.y;
      if (d > 0.0) {
        p.vy -= wallForce * (1.0 - d / wallMargin);
      } else {
        p.y = halfH - 1.0;
        p.vy = -abs(p.vy) * 0.5;
      }
    }
    if (p.y < -halfH + wallMargin) {
      let d = p.y + halfH;
      if (d > 0.0) {
        p.vy += wallForce * (1.0 - d / wallMargin);
      } else {
        p.y = -halfH + 1.0;
        p.vy = abs(p.vy) * 0.5;
      }
    }
  }

  particlesOut[i] = p;
}
`;

/**
 * Optimized physics shader using spatial hashing for neighbor lookup
 * Reduces complexity from O(n^2) to O(n*k) where k is average neighbors per cell
 */
export const PHYSICS_SHADER_SPATIAL = `
${PARTICLE_STRUCT}
${CONFIG_STRUCT}
${SPATIAL_STRUCT}

@group(0) @binding(0) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(1) var<storage, read_write> particlesOut: array<Particle>;
@group(0) @binding(2) var<uniform> config: Config;
@group(0) @binding(3) var<storage, read> interactionMatrix: array<f32>;
@group(0) @binding(4) var<storage, read> cells: array<SpatialCell>;
@group(0) @binding(5) var<storage, read> particleIndices: array<u32>;

const CELL_SIZE: f32 = 50.0;

fn hash(n: u32) -> f32 {
  var x = n;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return f32(x) / f32(0xffffffffu);
}

fn random(seed: u32, offset: u32) -> f32 {
  return hash(seed + offset * 1000u) * 2.0 - 1.0;
}

fn getInteraction(typeA: u32, typeB: u32) -> f32 {
  return interactionMatrix[typeA * config.particleTypes + typeB];
}

fn getCellCoord(x: f32, y: f32) -> vec2i {
  let halfW = config.worldWidth / 2.0;
  let halfH = config.worldHeight / 2.0;
  return vec2i(
    i32((x + halfW) / CELL_SIZE),
    i32((y + halfH) / CELL_SIZE)
  );
}

fn getCellIndex(cx: i32, cy: i32, gridWidth: i32, gridHeight: i32) -> i32 {
  if (cx < 0 || cx >= gridWidth || cy < 0 || cy >= gridHeight) {
    return -1;
  }
  return cy * gridWidth + cx;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= config.particleCount) { return; }

  var p = particlesIn[i];
  let pType = u32(p.ptype);

  var ax: f32 = 0.0;
  var ay: f32 = 0.0;
  var frictionVx: f32 = 0.0;
  var frictionVy: f32 = 0.0;
  var frictionCount: f32 = 0.0;

  let halfW = config.worldWidth / 2.0;
  let halfH = config.worldHeight / 2.0;
  let gridWidth = i32(config.worldWidth / CELL_SIZE) + 1;
  let gridHeight = i32(config.worldHeight / CELL_SIZE) + 1;

  let cellCoord = getCellCoord(p.x, p.y);

  // Check neighboring cells (3x3 grid around current cell)
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let cellIdx = getCellIndex(cellCoord.x + dx, cellCoord.y + dy, gridWidth, gridHeight);
      if (cellIdx < 0) { continue; }

      let cell = cells[u32(cellIdx)];

      for (var k = 0u; k < cell.count; k++) {
        let j = particleIndices[cell.start + k];
        if (i == j) { continue; }

        let other = particlesIn[j];
        var odx = other.x - p.x;
        var ody = other.y - p.y;
        let oType = u32(other.ptype);

        if (config.wrapEdges != 0u) {
          if (odx > halfW) { odx -= config.worldWidth; }
          if (odx < -halfW) { odx += config.worldWidth; }
          if (ody > halfH) { ody -= config.worldHeight; }
          if (ody < -halfH) { ody += config.worldHeight; }
        }

        let distSq = odx * odx + ody * ody;
        let dist = sqrt(distSq);

        if (dist < 1.0 || dist > config.interactionRadius) { continue; }

        let nx = odx / dist;
        let ny = ody / dist;
        let interaction = getInteraction(pType, oType);

        if (dist < config.minDistance) {
          let ratio = config.minDistance / dist;
          let pushForce = config.softness * (ratio - 1.0);
          ax -= nx * pushForce;
          ay -= ny * pushForce;

          let proximity = 1.0 - dist / config.minDistance;
          frictionVx += (other.vx - p.vx) * proximity;
          frictionVy += (other.vy - p.vy) * proximity;
          frictionCount += 1.0;
        }

        if (dist >= config.minDistance) {
          var forceStrength: f32 = 0.0;
          let normalizedDist = (dist - config.minDistance) / (config.interactionRadius - config.minDistance);

          if (interaction > 0.0) {
            forceStrength = config.attraction * interaction * (1.0 - normalizedDist);
          } else if (interaction < 0.0) {
            forceStrength = config.repulsion * interaction * (1.0 - normalizedDist);
          }

          ax += nx * forceStrength;
          ay += ny * forceStrength;
        }
      }
    }
  }

  if (frictionCount > 0.0 && config.interFriction > 0.0) {
    p.vx += (frictionVx / frictionCount) * config.interFriction;
    p.vy += (frictionVy / frictionCount) * config.interFriction;
  }

  p.vx += ax;
  p.vy += ay;

  if (config.gravityEnabled != 0u) {
    p.vx += config.gravityX;
    p.vy += config.gravityY;
  }

  if (config.noiseEnabled != 0u) {
    let seed = u32(config.randomSeed * 1000.0) + i;
    p.vx += random(seed, 0u) * config.noiseStrength;
    p.vy += random(seed, 1u) * config.noiseStrength;
  }

  if (config.mouseMode != 0u) {
    let mdx = p.x - config.mouseX;
    let mdy = p.y - config.mouseY;
    let mouseDist = sqrt(mdx * mdx + mdy * mdy);

    if (mouseDist < config.mouseRadius && mouseDist > 1.0) {
      let force = config.mouseStrength * (1.0 - mouseDist / config.mouseRadius);
      let mnx = mdx / mouseDist;
      let mny = mdy / mouseDist;

      if (config.mouseMode == 1u) {
        p.vx += mnx * force;
        p.vy += mny * force;
      } else if (config.mouseMode == 2u) {
        p.vx -= mnx * force;
        p.vy -= mny * force;
      } else if (config.mouseMode == 3u) {
        p.vx += -mny * force;
        p.vy += mnx * force;
      }
    }
  }

  p.vx *= (1.0 - config.drag);
  p.vy *= (1.0 - config.drag);

  let speed = sqrt(p.vx * p.vx + p.vy * p.vy);
  if (speed > config.maxSpeed) {
    p.vx = (p.vx / speed) * config.maxSpeed;
    p.vy = (p.vy / speed) * config.maxSpeed;
  }

  p.x += p.vx;
  p.y += p.vy;

  if (config.wrapEdges != 0u) {
    if (p.x > halfW) { p.x -= config.worldWidth; }
    if (p.x < -halfW) { p.x += config.worldWidth; }
    if (p.y > halfH) { p.y -= config.worldHeight; }
    if (p.y < -halfH) { p.y += config.worldHeight; }
  } else {
    let wallMargin = config.minDistance * 2.0;
    let wallForce = config.softness * 2.0;

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
