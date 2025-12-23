import type { WorkerConfig, InteractionMatrix } from '../types';
import { PARTICLE_STRIDE, ParticleIndex, MouseMode } from '../types';
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

  constructor() {
    this.spatialHash = new SpatialHash();
    this.windSystem = new WindSystem();
  }

  initializeWinds(count: number): void {
    this.windSystem.initialize(count);
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
    }

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
    if (config.mouseMode !== MouseMode.None) {
      const mdx = px - mouseX;
      const mdy = py - mouseY;
      const mouseDist = Math.sqrt(mdx * mdx + mdy * mdy);
      if (mouseDist < config.mouseRadius && mouseDist > 1) {
        const force = config.mouseStrength * (1 - mouseDist / config.mouseRadius);
        const dir = config.mouseMode === MouseMode.Repel ? 1 : -1;
        vx += (mdx / mouseDist) * force * dir;
        vy += (mdy / mouseDist) * force * dir;
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
}
