/**
 * Data structure for an individual particle
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: number;
}

/**
 * Number of elements in the Float32Array per particle
 * [x, y, vx, vy, type]
 */
export const PARTICLE_STRIDE = 5;

/**
 * Indices for each field in the particle array
 */
export enum ParticleIndex {
  X = 0,
  Y = 1,
  VX = 2,
  VY = 3,
  Type = 4
}

/**
 * Interaction matrix between particle types
 * interactionMatrix[i][j] = force of j on i
 * Positive = attraction, Negative = repulsion
 */
export type InteractionMatrix = number[][];

/**
 * Mouse position in world coordinates
 */
export interface MousePosition {
  x: number;
  y: number;
}
