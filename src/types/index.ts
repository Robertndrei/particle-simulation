// Enums
export { MouseMode, WorkerMessageType, ColorMode, AttractorType, PresetName } from './enums';

// Config types
export type { SimulationConfig, WorkerConfig } from './config';
export { getWorkerConfig } from './config';

// Particle types
export type {
  Particle,
  InteractionMatrix,
  MousePosition,
  Attractor,
  Obstacle,
  SimulationStats,
  SimulationPreset
} from './particle';
export { PARTICLE_STRIDE, ParticleIndex } from './particle';

// Worker message types
export type {
  WorkerInitMessage,
  WorkerUpdateMessage,
  WorkerUpdateConfigMessage,
  WorkerUpdateMatrixMessage,
  WorkerUpdateMouseMessage,
  WorkerAddParticlesMessage,
  WorkerUpdateAttractorsMessage,
  WorkerUpdateObstaclesMessage,
  MainToWorkerMessage,
  WorkerReadyMessage,
  WorkerPositionsMessage,
  WorkerStatsMessage,
  WorkerToMainMessage
} from './worker-messages';
