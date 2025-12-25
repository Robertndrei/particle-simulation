import { AttractorType } from './enums';

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

/**
 * Fixed attractor/repulsor/vortex in the world
 */
export interface Attractor {
  id: string;
  x: number;
  y: number;
  type: AttractorType;
  strength: number;
  radius: number;
}

/**
 * Obstacle (wall/barrier) in the world
 */
export interface Obstacle {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
}

/**
 * Simulation statistics for analysis
 */
export interface SimulationStats {
  kineticEnergy: number;
  avgVelocity: number;
  maxVelocity: number;
  clusterCount: number;
  densityMap: Float32Array | null;
}

/**
 * Preset configuration
 */
export interface SimulationPreset {
  name: string;
  description: string;
  config: Partial<import('./config').SimulationConfig>;
  matrix?: InteractionMatrix;
}
