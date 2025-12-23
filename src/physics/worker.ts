import type { WorkerConfig, InteractionMatrix, MainToWorkerMessage } from '../types';
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
  }
};

function handleInit(data: {
  particles: ArrayBuffer;
  config: WorkerConfig;
  interactionMatrix: InteractionMatrix;
}): void {
  particles = new Float32Array(data.particles);
  config = data.config;
  interactionMatrix = data.interactionMatrix;
  physicsEngine.initializeWinds(config.windCount);

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
