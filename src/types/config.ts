import { MouseMode } from './enums';

/**
 * Complete simulation configuration
 */
export interface SimulationConfig {
  // Particles
  particlesPerType: number;
  particleTypes: number;
  particleRadius: number;

  // Physics - Forces
  attraction: number;
  repulsion: number;
  interactionRadius: number;

  // Physics - Collisions
  minDistance: number;
  softness: number;

  // Physics - Movement
  drag: number;
  maxSpeed: number;
  interFriction: number;

  // Effects
  noiseEnabled: boolean;
  noiseStrength: number;
  trailsEnabled: boolean;
  trailLength: number;
  radiationEnabled: boolean;
  radiationRate: number;
  radiationSpeed: number;
  windEnabled: boolean;
  windStrength: number;
  windCount: number;
  windChangeSpeed: number;

  // Mouse
  mouseMode: MouseMode;
  mouseRadius: number;
  mouseStrength: number;

  // World
  worldWidth: number;
  worldHeight: number;
  wrapEdges: boolean;

  // Colors (hex)
  colors: number[];

  // Actions (callbacks)
  reset: () => void;
  randomizeForces: () => void;
}

/**
 * Configuration sent to Worker (without functions or colors)
 */
export interface WorkerConfig {
  particlesPerType: number;
  particleTypes: number;
  particleRadius: number;
  attraction: number;
  repulsion: number;
  interactionRadius: number;
  minDistance: number;
  softness: number;
  drag: number;
  maxSpeed: number;
  interFriction: number;
  noiseEnabled: boolean;
  noiseStrength: number;
  trailsEnabled: boolean;
  trailLength: number;
  radiationEnabled: boolean;
  radiationRate: number;
  radiationSpeed: number;
  windEnabled: boolean;
  windStrength: number;
  windCount: number;
  windChangeSpeed: number;
  mouseMode: MouseMode;
  mouseRadius: number;
  mouseStrength: number;
  worldWidth: number;
  worldHeight: number;
  wrapEdges: boolean;
}

/**
 * Extracts serializable configuration for the worker
 */
export function getWorkerConfig(config: SimulationConfig): WorkerConfig {
  const { reset, randomizeForces, colors, ...workerConfig } = config;
  return workerConfig;
}
