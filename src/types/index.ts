// Enums
export { MouseMode, WorkerMessageType } from './enums';

// Config types
export type { SimulationConfig, WorkerConfig } from './config';
export { getWorkerConfig } from './config';

// Particle types
export type { Particle, InteractionMatrix, MousePosition } from './particle';
export { PARTICLE_STRIDE, ParticleIndex } from './particle';

// Worker message types
export type {
  WorkerInitMessage,
  WorkerUpdateMessage,
  WorkerUpdateConfigMessage,
  WorkerUpdateMatrixMessage,
  WorkerUpdateMouseMessage,
  WorkerAddParticlesMessage,
  MainToWorkerMessage,
  WorkerReadyMessage,
  WorkerPositionsMessage,
  WorkerToMainMessage
} from './worker-messages';
