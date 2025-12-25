import type { WorkerConfig, InteractionMatrix, MainToWorkerMessage, Attractor, Obstacle } from '../types';
import { WorkerMessageType } from '../types';
import { PhysicsEngine } from './forces';

/**
 * Worker state
 */
let particles: Float32Array | null = null;
let config: WorkerConfig | null = null;
let interactionMatrix: InteractionMatrix = [];
let mouseX = 0;
let mouseY = 0;
let sendStats = false;

const physicsEngine = new PhysicsEngine();

/**
 * Message handler from main thread
 */
self.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const message = e.data;

  switch (message.type) {
    case WorkerMessageType.Init:
      handleInit(message.data);
      break;

    case WorkerMessageType.Update:
      handleUpdate();
      break;

    case WorkerMessageType.UpdateConfig:
      handleUpdateConfig(message.data);
      break;

    case WorkerMessageType.UpdateMatrix:
      handleUpdateMatrix(message.data);
      break;

    case WorkerMessageType.UpdateMouse:
      handleUpdateMouse(message.data);
      break;

    case WorkerMessageType.AddParticles:
      handleAddParticles(message.data);
      break;

    case WorkerMessageType.UpdateAttractors:
      handleUpdateAttractors(message.data);
      break;

    case WorkerMessageType.UpdateObstacles:
      handleUpdateObstacles(message.data);
      break;
  }
};

function handleInit(data: {
  particles: ArrayBuffer;
  config: WorkerConfig;
  interactionMatrix: InteractionMatrix;
  attractors: Attractor[];
  obstacles: Obstacle[];
}): void {
  particles = new Float32Array(data.particles);
  config = data.config;
  interactionMatrix = data.interactionMatrix;
  physicsEngine.initializeWinds(config.windCount);
  physicsEngine.setAttractors(data.attractors || []);
  physicsEngine.setObstacles(data.obstacles || []);

  self.postMessage({ type: WorkerMessageType.Ready });
}

function handleUpdate(): void {
  if (!particles || !config) return;

  physicsEngine.update(particles, config, interactionMatrix, mouseX, mouseY);

  // Send a copy of the data
  const copy = new Float32Array(particles);
  self.postMessage(
    { type: WorkerMessageType.Positions, particles: copy.buffer },
    [copy.buffer]
  );

  // Send stats periodically (every 10 frames roughly)
  if (sendStats) {
    const stats = physicsEngine.getStats();
    self.postMessage({
      type: WorkerMessageType.Stats,
      stats: {
        kineticEnergy: stats.kineticEnergy,
        avgVelocity: stats.avgVelocity,
        maxVelocity: stats.maxVelocity,
        clusterCount: stats.clusterCount,
        densityMap: null
      }
    });
  }
  sendStats = !sendStats; // Toggle to send every other frame
}

function handleUpdateConfig(data: Partial<WorkerConfig>): void {
  if (config) {
    Object.assign(config, data);
  }
}

function handleUpdateMatrix(data: InteractionMatrix): void {
  interactionMatrix = data;
}

function handleUpdateMouse(data: { x: number; y: number }): void {
  mouseX = data.x;
  mouseY = data.y;
}

function handleAddParticles(data: ArrayBuffer): void {
  if (!particles) return;

  const newData = new Float32Array(data);
  const newParticles = new Float32Array(particles.length + newData.length);
  newParticles.set(particles);
  newParticles.set(newData, particles.length);
  particles = newParticles;
}

function handleUpdateAttractors(data: Attractor[]): void {
  physicsEngine.setAttractors(data);
}

function handleUpdateObstacles(data: Obstacle[]): void {
  physicsEngine.setObstacles(data);
}
