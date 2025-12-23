import {
  PARTICLE_STRIDE,
  ParticleIndex,
  WorkerMessageType,
  getWorkerConfig
} from './types';
import type {
  SimulationConfig,
  InteractionMatrix,
  WorkerToMainMessage
} from './types';
import {
  createDefaultConfig,
  createInteractionMatrix,
  randomizeInteractionMatrix
} from './config/defaults';
import { Renderer } from './renderer';
import { GUIController } from './gui/controls';

/**
 * Main particle simulation application
 */
class ParticleSimulation {
  private config: SimulationConfig;
  private interactionMatrix: InteractionMatrix = [];
  private renderer: Renderer;
  private gui: GUIController;
  private worker: Worker;
  private particleData: Float32Array | null = null;
  private workerBusy = false;
  private pendingConfig = false;
  private pendingMatrix = false;
  private mouseX = 0;
  private mouseY = 0;
  private lastTime = performance.now();
  private frameCount = 0;

  // DOM elements
  private fpsElement: HTMLElement;
  private countElement: HTMLElement;
  private workerStatusElement: HTMLElement;

  constructor() {
    // Configuration
    this.config = createDefaultConfig();
    this.config.reset = () => this.initParticles();
    this.config.randomizeForces = () => this.randomizeInteractions();

    // Initialize interaction matrix BEFORE the GUI
    this.interactionMatrix = createInteractionMatrix(this.config.particleTypes);

    // Renderer
    this.renderer = new Renderer();
    document.body.appendChild(this.renderer.getDomElement());

    // Worker
    this.worker = new Worker(
      new URL('./physics/worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.setupWorkerHandlers();

    // GUI
    this.gui = new GUIController(this.config, this.interactionMatrix, {
      onConfigChange: () => this.sendConfigToWorker(),
      onMatrixChange: () => this.sendMatrixToWorker(),
      onReset: () => this.initParticles()
    });

    // DOM elements
    this.fpsElement = document.getElementById('fps')!;
    this.countElement = document.getElementById('count')!;
    this.workerStatusElement = document.getElementById('worker-status')!;

    // Events
    this.setupEventListeners();

    // Start
    this.initParticles();
    this.animate();
  }

  private setupWorkerHandlers(): void {
    this.worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
      const message = e.data;

      if (message.type === WorkerMessageType.Ready) {
        this.workerStatusElement.textContent = 'Worker: active';
        this.workerBusy = false;
      } else if (message.type === WorkerMessageType.Positions) {
        this.particleData = new Float32Array(message.particles);
        this.countElement.textContent = String(
          this.particleData.length / PARTICLE_STRIDE
        );
        this.workerBusy = false;

        // Send pending updates
        if (this.pendingConfig) {
          this.worker.postMessage({
            type: WorkerMessageType.UpdateConfig,
            data: getWorkerConfig(this.config)
          });
          this.pendingConfig = false;
        }
        if (this.pendingMatrix) {
          this.worker.postMessage({
            type: WorkerMessageType.UpdateMatrix,
            data: this.interactionMatrix
          });
          this.pendingMatrix = false;
        }
      }
    };
  }

  private setupEventListeners(): void {
    // Resize
    window.addEventListener('resize', () => {
      this.config.worldWidth = window.innerWidth;
      this.config.worldHeight = window.innerHeight;
      this.renderer.handleResize();
      this.sendConfigToWorker();
    });

    // Mouse move
    this.renderer.getDomElement().addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX - window.innerWidth / 2;
      this.mouseY = -(e.clientY - window.innerHeight / 2);
      this.worker.postMessage({
        type: WorkerMessageType.UpdateMouse,
        data: { x: this.mouseX, y: this.mouseY }
      });
    });

    // Click to add particles
    this.renderer.getDomElement().addEventListener('click', (e) => {
      if (!this.particleData) return;

      const x = e.clientX - window.innerWidth / 2;
      const y = -(e.clientY - window.innerHeight / 2);
      const type = Math.floor(Math.random() * this.config.particleTypes);

      const newCount = 5;
      const newData = new Float32Array(newCount * PARTICLE_STRIDE);

      for (let i = 0; i < newCount; i++) {
        const idx = i * PARTICLE_STRIDE;
        newData[idx + ParticleIndex.X] = x + (Math.random() - 0.5) * 30;
        newData[idx + ParticleIndex.Y] = y + (Math.random() - 0.5) * 30;
        newData[idx + ParticleIndex.VX] = 0;
        newData[idx + ParticleIndex.VY] = 0;
        newData[idx + ParticleIndex.Type] = type;
      }

      this.worker.postMessage(
        { type: WorkerMessageType.AddParticles, data: newData.buffer },
        [newData.buffer]
      );
    });
  }

  private initParticles(): void {
    this.interactionMatrix = createInteractionMatrix(this.config.particleTypes);

    const totalParticles = this.config.particlesPerType * this.config.particleTypes;
    this.particleData = new Float32Array(totalParticles * PARTICLE_STRIDE);

    let particleIndex = 0;
    for (let type = 0; type < this.config.particleTypes; type++) {
      for (let i = 0; i < this.config.particlesPerType; i++) {
        const idx = particleIndex * PARTICLE_STRIDE;
        this.particleData[idx + ParticleIndex.X] =
          (Math.random() - 0.5) * this.config.worldWidth * 0.9;
        this.particleData[idx + ParticleIndex.Y] =
          (Math.random() - 0.5) * this.config.worldHeight * 0.9;
        this.particleData[idx + ParticleIndex.VX] = 0;
        this.particleData[idx + ParticleIndex.VY] = 0;
        this.particleData[idx + ParticleIndex.Type] = type;
        particleIndex++;
      }
    }

    // Initialize renderer
    this.renderer.initializeParticles(this.config);

    // Send to worker
    const transferBuffer = this.particleData.buffer.slice(0);
    this.worker.postMessage(
      {
        type: WorkerMessageType.Init,
        data: {
          particles: transferBuffer,
          config: getWorkerConfig(this.config),
          interactionMatrix: this.interactionMatrix
        }
      },
      [transferBuffer]
    );

    this.countElement.textContent = String(totalParticles);
    this.gui.updateInteractionControls(this.config, this.interactionMatrix);
  }

  private randomizeInteractions(): void {
    randomizeInteractionMatrix(this.interactionMatrix);
    this.worker.postMessage({
      type: WorkerMessageType.UpdateMatrix,
      data: this.interactionMatrix
    });
    this.gui.updateInteractionControls(this.config, this.interactionMatrix);
  }

  private sendConfigToWorker(): void {
    if (this.workerBusy) {
      this.pendingConfig = true;
    } else {
      this.worker.postMessage({
        type: WorkerMessageType.UpdateConfig,
        data: getWorkerConfig(this.config)
      });
    }
  }

  private sendMatrixToWorker(): void {
    if (this.workerBusy) {
      this.pendingMatrix = true;
    } else {
      this.worker.postMessage({
        type: WorkerMessageType.UpdateMatrix,
        data: this.interactionMatrix
      });
    }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    // FPS counter
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastTime >= 1000) {
      this.fpsElement.textContent = String(this.frameCount);
      this.frameCount = 0;
      this.lastTime = now;
    }

    // Request update from worker
    if (!this.workerBusy && this.particleData) {
      this.workerBusy = true;
      this.worker.postMessage({ type: WorkerMessageType.Update });
    }

    // Update meshes
    if (this.particleData) {
      this.renderer.updateParticles(this.particleData, this.config);
    }

    // Render
    this.renderer.render(this.config);
  };
}

// Start application
new ParticleSimulation();
