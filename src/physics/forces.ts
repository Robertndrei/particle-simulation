import type { WorkerConfig, InteractionMatrix, Attractor, Obstacle, SimulationStats } from '../types';
import { PARTICLE_STRIDE, ParticleIndex, MouseMode, AttractorType } from '../types';
import { SpatialHash } from './spatial-hash';

/**
 * Dynamic wind system
 */
export class WindSystem {
  private winds: number[] = [];

  initialize(count: number): void {
    this.winds = [];
    for (let i = 0; i < count; i++) {
      this.winds.push(Math.random() * Math.PI * 2);
    }
  }

  update(config: WorkerConfig): void {
    while (this.winds.length < config.windCount) {
      this.winds.push(Math.random() * Math.PI * 2);
    }
    while (this.winds.length > config.windCount) {
      this.winds.pop();
    }

    for (let i = 0; i < this.winds.length; i++) {
      this.winds[i] += (Math.random() - 0.5) * config.windChangeSpeed;
    }
  }

  getWindForce(strength: number): { wx: number; wy: number } {
    let wx = 0;
    let wy = 0;
    for (const angle of this.winds) {
      wx += Math.cos(angle) * strength;
      wy += Math.sin(angle) * strength;
    }
    return { wx, wy };
  }
}

/**
 * Physics engine with double buffer for correct simulation
 */
export class PhysicsEngine {
  private spatialHash: SpatialHash;
  private windSystem: WindSystem;
  private nextState: Float32Array | null = null;

  // Fixed attractors and obstacles
  private attractors: Attractor[] = [];
  private obstacles: Obstacle[] = [];

  // Statistics
  private stats: SimulationStats = {
    kineticEnergy: 0,
    avgVelocity: 0,
    maxVelocity: 0,
    clusterCount: 0,
    densityMap: null
  };

  constructor() {
    this.spatialHash = new SpatialHash();
    this.windSystem = new WindSystem();
  }

  initializeWinds(count: number): void {
    this.windSystem.initialize(count);
  }

  setAttractors(attractors: Attractor[]): void {
    this.attractors = attractors;
  }

  setObstacles(obstacles: Obstacle[]): void {
    this.obstacles = obstacles;
  }

  getStats(): SimulationStats {
    return this.stats;
  }

  /**
   * Updates all particles using double buffer
   * Phase 1: Calculate new state based on current state
   * Phase 2: Copy new state to main buffer
   */
  update(
    particles: Float32Array,
    config: WorkerConfig,
    interactionMatrix: InteractionMatrix,
    mouseX: number,
    mouseY: number
  ): void {
    const count = particles.length / PARTICLE_STRIDE;

    // Create or resize buffer if necessary
    if (!this.nextState || this.nextState.length !== particles.length) {
      this.nextState = new Float32Array(particles.length);
    }

    // Build spatial hash with CURRENT state
    this.spatialHash.build(particles);

    if (config.windEnabled) {
      this.windSystem.update(config);
    }

    const halfW = config.worldWidth / 2;
    const halfH = config.worldHeight / 2;
    const windForce = config.windEnabled
      ? this.windSystem.getWindForce(config.windStrength)
      : { wx: 0, wy: 0 };

    // Reset stats
    let totalKE = 0;
    let totalSpeed = 0;
    let maxSpeed = 0;

    // PHASE 1: Calculate new state for ALL particles
    // Read from 'particles' (current state), write to 'nextState'
    for (let i = 0; i < count; i++) {
      this.computeNextState(
        particles,      // Current state (read only)
        this.nextState, // New state (write only)
        i,
        config,
        interactionMatrix,
        mouseX,
        mouseY,
        halfW,
        halfH,
        windForce
      );

      // Calculate stats
      const idx = i * PARTICLE_STRIDE;
      const vx = this.nextState[idx + ParticleIndex.VX];
      const vy = this.nextState[idx + ParticleIndex.VY];
      const speed = Math.sqrt(vx * vx + vy * vy);
      totalKE += 0.5 * speed * speed;
      totalSpeed += speed;
      if (speed > maxSpeed) maxSpeed = speed;
    }

    // Update stats
    this.stats.kineticEnergy = totalKE;
    this.stats.avgVelocity = count > 0 ? totalSpeed / count : 0;
    this.stats.maxVelocity = maxSpeed;

    // PHASE 2: Copy new state to main buffer
    particles.set(this.nextState);
  }

  private computeNextState(
    current: Float32Array,
    next: Float32Array,
    i: number,
    config: WorkerConfig,
    interactionMatrix: InteractionMatrix,
    mouseX: number,
    mouseY: number,
    halfW: number,
    halfH: number,
    windForce: { wx: number; wy: number }
  ): void {
    const idx = i * PARTICLE_STRIDE;

    // Read current state
    let px = current[idx + ParticleIndex.X];
    let py = current[idx + ParticleIndex.Y];
    let vx = current[idx + ParticleIndex.VX];
    let vy = current[idx + ParticleIndex.VY];
    const pType = current[idx + ParticleIndex.Type];

    let ax = 0;
    let ay = 0;
    let frictionVx = 0;
    let frictionVy = 0;
    let frictionCount = 0;

    const neighbors = this.spatialHash.getNeighbors(px, py, config.interactionRadius);

    for (const j of neighbors) {
      if (i === j) continue;

      const jdx = j * PARTICLE_STRIDE;

      // Read from CURRENT state (not the new one)
      let dx = current[jdx + ParticleIndex.X] - px;
      let dy = current[jdx + ParticleIndex.Y] - py;
      const oType = current[jdx + ParticleIndex.Type];
      const ovx = current[jdx + ParticleIndex.VX];
      const ovy = current[jdx + ParticleIndex.VY];

      // Wrap-around
      if (config.wrapEdges) {
        if (dx > halfW) dx -= config.worldWidth;
        if (dx < -halfW) dx += config.worldWidth;
        if (dy > halfH) dy -= config.worldHeight;
        if (dy < -halfH) dy += config.worldHeight;
      }

      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      if (dist < 1) continue;

      const nx = dx / dist;
      const ny = dy / dist;

      const interaction = interactionMatrix[pType]?.[oType] ?? 0;

      // Physical collision
      if (dist < config.minDistance) {
        const ratio = config.minDistance / dist;
        const pushForce = config.softness * (ratio - 1);
        ax -= nx * pushForce;
        ay -= ny * pushForce;

        // Friction between nearby particles
        const proximity = 1 - dist / config.minDistance;
        frictionVx += (ovx - vx) * proximity;
        frictionVy += (ovy - vy) * proximity;
        frictionCount++;
      }

      // Distance forces
      if (dist < config.interactionRadius && dist >= config.minDistance) {
        let forceStrength = 0;

        if (interaction > 0) {
          const normalizedDist = (dist - config.minDistance) / (config.interactionRadius - config.minDistance);
          forceStrength = config.attraction * interaction * (1 - normalizedDist);
        } else if (interaction < 0) {
          const normalizedDist = (dist - config.minDistance) / (config.interactionRadius - config.minDistance);
          forceStrength = config.repulsion * interaction * (1 - normalizedDist);
        }

        ax += nx * forceStrength;
        ay += ny * forceStrength;
      }
    }

    // Apply inter-particle friction
    if (frictionCount > 0 && config.interFriction > 0) {
      vx += (frictionVx / frictionCount) * config.interFriction;
      vy += (frictionVy / frictionCount) * config.interFriction;
    }

    // Apply acceleration
    vx += ax;
    vy += ay;

    // Apply global gravity
    if (config.gravityEnabled) {
      vx += config.gravityX;
      vy += config.gravityY;
    }

    // Apply fixed attractors/repulsors/vortices
    for (const attractor of this.attractors) {
      const adx = attractor.x - px;
      const ady = attractor.y - py;
      const aDist = Math.sqrt(adx * adx + ady * ady);

      if (aDist < attractor.radius && aDist > 1) {
        const strength = attractor.strength * (1 - aDist / attractor.radius);

        switch (attractor.type) {
          case AttractorType.Attractor:
            vx += (adx / aDist) * strength;
            vy += (ady / aDist) * strength;
            break;
          case AttractorType.Repulsor:
            vx -= (adx / aDist) * strength;
            vy -= (ady / aDist) * strength;
            break;
          case AttractorType.Vortex:
            // Perpendicular force (tangent to circle)
            vx += (-ady / aDist) * strength;
            vy += (adx / aDist) * strength;
            break;
        }
      }
    }

    // Apply obstacle collisions
    for (const obstacle of this.obstacles) {
      const collision = this.checkObstacleCollision(
        px, py, vx, vy,
        obstacle.x1, obstacle.y1, obstacle.x2, obstacle.y2,
        obstacle.thickness
      );
      if (collision) {
        vx = collision.vx;
        vy = collision.vy;
        px = collision.px;
        py = collision.py;
      }
    }

    // Noise/turbulence
    if (config.noiseEnabled) {
      vx += (Math.random() - 0.5) * config.noiseStrength;
      vy += (Math.random() - 0.5) * config.noiseStrength;
    }

    // Drag
    vx *= 1 - config.drag;
    vy *= 1 - config.drag;

    // Limit speed
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > config.maxSpeed) {
      vx = (vx / speed) * config.maxSpeed;
      vy = (vy / speed) * config.maxSpeed;
    }

    // Radiation
    if (config.radiationEnabled && Math.random() < config.radiationRate) {
      const angle = Math.random() * Math.PI * 2;
      vx = Math.cos(angle) * config.radiationSpeed;
      vy = Math.sin(angle) * config.radiationSpeed;
    }

    // Winds
    if (config.windEnabled) {
      vx += windForce.wx;
      vy += windForce.wy;
    }

    // Mouse effect
    if (config.mouseMode !== MouseMode.None && config.mouseMode !== MouseMode.Spawn && config.mouseMode !== MouseMode.Obstacle) {
      const mdx = px - mouseX;
      const mdy = py - mouseY;
      const mouseDist = Math.sqrt(mdx * mdx + mdy * mdy);
      if (mouseDist < config.mouseRadius && mouseDist > 1) {
        const force = config.mouseStrength * (1 - mouseDist / config.mouseRadius);

        if (config.mouseMode === MouseMode.Repel) {
          vx += (mdx / mouseDist) * force;
          vy += (mdy / mouseDist) * force;
        } else if (config.mouseMode === MouseMode.Attract) {
          vx -= (mdx / mouseDist) * force;
          vy -= (mdy / mouseDist) * force;
        } else if (config.mouseMode === MouseMode.Vortex) {
          // Perpendicular force
          vx += (-mdy / mouseDist) * force;
          vy += (mdx / mouseDist) * force;
        }
      }
    }

    // Update position
    px += vx;
    py += vy;

    // Edges
    if (config.wrapEdges) {
      if (px > halfW) px -= config.worldWidth;
      if (px < -halfW) px += config.worldWidth;
      if (py > halfH) py -= config.worldHeight;
      if (py < -halfH) py += config.worldHeight;
    } else {
      const wallMargin = config.minDistance * 2;
      const wallForce = config.softness * 2;

      if (px > halfW - wallMargin) {
        const d = halfW - px;
        if (d > 0) {
          vx -= wallForce * (1 - d / wallMargin);
        } else {
          px = halfW - 1;
          vx = -Math.abs(vx) * 0.5;
        }
      }
      if (px < -halfW + wallMargin) {
        const d = px + halfW;
        if (d > 0) {
          vx += wallForce * (1 - d / wallMargin);
        } else {
          px = -halfW + 1;
          vx = Math.abs(vx) * 0.5;
        }
      }
      if (py > halfH - wallMargin) {
        const d = halfH - py;
        if (d > 0) {
          vy -= wallForce * (1 - d / wallMargin);
        } else {
          py = halfH - 1;
          vy = -Math.abs(vy) * 0.5;
        }
      }
      if (py < -halfH + wallMargin) {
        const d = py + halfH;
        if (d > 0) {
          vy += wallForce * (1 - d / wallMargin);
        } else {
          py = -halfH + 1;
          vy = Math.abs(vy) * 0.5;
        }
      }
    }

    // Write to new state buffer
    next[idx + ParticleIndex.X] = px;
    next[idx + ParticleIndex.Y] = py;
    next[idx + ParticleIndex.VX] = vx;
    next[idx + ParticleIndex.VY] = vy;
    next[idx + ParticleIndex.Type] = pType;
  }

  /**
   * Checks collision with a line obstacle
   */
  private checkObstacleCollision(
    px: number, py: number,
    vx: number, vy: number,
    x1: number, y1: number,
    x2: number, y2: number,
    thickness: number
  ): { px: number; py: number; vx: number; vy: number } | null {
    // Line direction
    const ldx = x2 - x1;
    const ldy = y2 - y1;
    const lineLen = Math.sqrt(ldx * ldx + ldy * ldy);

    if (lineLen < 1) return null;

    // Line normal
    const nx = -ldy / lineLen;
    const ny = ldx / lineLen;

    // Vector from line start to particle
    const pdx = px - x1;
    const pdy = py - y1;

    // Project onto line direction (parametric t)
    const t = (pdx * ldx + pdy * ldy) / (lineLen * lineLen);

    // Check if within line segment
    if (t < 0 || t > 1) return null;

    // Distance to line
    const dist = pdx * nx + pdy * ny;

    if (Math.abs(dist) < thickness / 2) {
      // Collision! Push out and reflect velocity
      const sign = dist >= 0 ? 1 : -1;
      const pushDist = (thickness / 2 - Math.abs(dist) + 1) * sign;

      // Reflect velocity
      const dot = vx * nx + vy * ny;
      const reflectVx = vx - 2 * dot * nx;
      const reflectVy = vy - 2 * dot * ny;

      return {
        px: px + nx * pushDist,
        py: py + ny * pushDist,
        vx: reflectVx * 0.5,
        vy: reflectVy * 0.5
      };
    }

    return null;
  }
}
