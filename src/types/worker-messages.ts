import { WorkerMessageType } from './enums';
import type { WorkerConfig } from './config';
import type { InteractionMatrix, MousePosition, Attractor, Obstacle, SimulationStats } from './particle';

/**
 * Worker initialization message
 */
export interface WorkerInitMessage {
  type: WorkerMessageType.Init;
  data: {
    particles: ArrayBuffer;
    config: WorkerConfig;
    interactionMatrix: InteractionMatrix;
    attractors: Attractor[];
    obstacles: Obstacle[];
  };
}

/**
 * Message to request physics update
 */
export interface WorkerUpdateMessage {
  type: WorkerMessageType.Update;
}

/**
 * Message to update configuration
 */
export interface WorkerUpdateConfigMessage {
  type: WorkerMessageType.UpdateConfig;
  data: Partial<WorkerConfig>;
}

/**
 * Message to update interaction matrix
 */
export interface WorkerUpdateMatrixMessage {
  type: WorkerMessageType.UpdateMatrix;
  data: InteractionMatrix;
}

/**
 * Message to update mouse position
 */
export interface WorkerUpdateMouseMessage {
  type: WorkerMessageType.UpdateMouse;
  data: MousePosition;
}

/**
 * Message to add particles
 */
export interface WorkerAddParticlesMessage {
  type: WorkerMessageType.AddParticles;
  data: ArrayBuffer;
}

/**
 * Message to update attractors
 */
export interface WorkerUpdateAttractorsMessage {
  type: WorkerMessageType.UpdateAttractors;
  data: Attractor[];
}

/**
 * Message to update obstacles
 */
export interface WorkerUpdateObstaclesMessage {
  type: WorkerMessageType.UpdateObstacles;
  data: Obstacle[];
}

/**
 * Union of all messages sent from main thread to worker
 */
export type MainToWorkerMessage =
  | WorkerInitMessage
  | WorkerUpdateMessage
  | WorkerUpdateConfigMessage
  | WorkerUpdateMatrixMessage
  | WorkerUpdateMouseMessage
  | WorkerAddParticlesMessage
  | WorkerUpdateAttractorsMessage
  | WorkerUpdateObstaclesMessage;

/**
 * Worker ready message
 */
export interface WorkerReadyMessage {
  type: WorkerMessageType.Ready;
}

/**
 * Message with updated positions
 */
export interface WorkerPositionsMessage {
  type: WorkerMessageType.Positions;
  particles: ArrayBuffer;
}

/**
 * Message with simulation statistics
 */
export interface WorkerStatsMessage {
  type: WorkerMessageType.Stats;
  stats: SimulationStats;
}

/**
 * Union of all messages sent from worker to main thread
 */
export type WorkerToMainMessage = WorkerReadyMessage | WorkerPositionsMessage | WorkerStatsMessage;
