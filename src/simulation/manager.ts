/**
 * Simulation Manager - Unified interface for WebGPU or Web Worker physics
 * Automatically selects the best available backend
 */

import type { SimulationConfig, WorkerConfig, InteractionMatrix, SimulationStats } from '../types';
import { getWorkerConfig, PARTICLE_STRIDE } from '../types';
import { detectWebGPU, WebGPUComputeEngine } from '../gpu';
import type { WebGPUCapabilities } from '../gpu';

export type SimulationBackend = 'webgpu' | 'worker';

export interface SimulationManagerOptions {
  preferWebGPU: boolean;
  onStatsUpdate?: (stats: SimulationStats) => void;
  onBackendChange?: (backend: SimulationBackend) => void;
}

export class SimulationManager {
  private backend: SimulationBackend = 'worker';
  private webgpuCapabilities: WebGPUCapabilities | null = null;
  private gpuEngine: WebGPUComputeEngine | null = null;
  private worker: Worker | null = null;

  private particles: Float32Array = new Float32Array(0);
  private config: SimulationConfig | null = null;
  private interactionMatrix: InteractionMatrix = [];
  private mouseX: number = 0;
  private mouseY: number = 0;
  private isPaused: boolean = false;

  private options: SimulationManagerOptions;
  private initialized: boolean = false;
  private pendingRead: Promise<Float32Array> | null = null;

  constructor(options: Partial<SimulationManagerOptions> = {}) {
    this.options = {
      preferWebGPU: true,
      ...options
    };
  }

  /**
   * Initialize the simulation backend
   */
  async initialize(): Promise<SimulationBackend> {
    if (this.options.preferWebGPU) {
      this.webgpuCapabilities = await detectWebGPU();

      if (this.webgpuCapabilities.supported && this.webgpuCapabilities.device) {
        this.gpuEngine = new WebGPUComputeEngine(this.webgpuCapabilities.device);
        this.backend = 'webgpu';
        console.log('Using WebGPU compute backend');
      } else {
        this.backend = 'worker';
        console.log('WebGPU not available, using Web Worker backend');
      }
    } else {
      this.backend = 'worker';
    }

    if (this.backend === 'worker') {
      this.initWorker();
    }

    this.initialized = true;
    this.options.onBackendChange?.(this.backend);
    return this.backend;
  }

  private initWorker(): void {
    this.worker = new Worker(
      new URL('../physics/worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'update') {
        this.particles = new Float32Array(msg.particles);
      } else if (msg.type === 'stats') {
        this.options.onStatsUpdate?.(msg.stats);
      }
    };
  }

  /**
   * Set up particles with given configuration
   */
  async setup(
    config: SimulationConfig,
    interactionMatrix: InteractionMatrix,
    initialParticles: Float32Array
  ): Promise<void> {
    this.config = config;
    this.interactionMatrix = interactionMatrix;
    this.particles = initialParticles;

    const particleCount = initialParticles.length / PARTICLE_STRIDE;

    if (this.backend === 'webgpu' && this.gpuEngine) {
      await this.gpuEngine.initialize(
        particleCount,
        config.particleTypes,
        initialParticles
      );
      this.gpuEngine.updateInteractionMatrix(interactionMatrix, config.particleTypes);
    } else if (this.worker) {
      this.worker.postMessage({
        type: 'init',
        particles: initialParticles.buffer,
        config: getWorkerConfig(config),
        interactionMatrix
      }, [initialParticles.buffer.slice(0)]);
    }
  }

  /**
   * Update simulation configuration
   */
  updateConfig(config: SimulationConfig): void {
    this.config = config;

    if (this.backend === 'worker' && this.worker) {
      this.worker.postMessage({
        type: 'config',
        config: getWorkerConfig(config)
      });
    }
    // WebGPU config is updated every step
  }

  /**
   * Update interaction matrix
   */
  updateInteractionMatrix(matrix: InteractionMatrix): void {
    this.interactionMatrix = matrix;

    if (this.backend === 'webgpu' && this.gpuEngine && this.config) {
      this.gpuEngine.updateInteractionMatrix(matrix, this.config.particleTypes);
    } else if (this.worker) {
      this.worker.postMessage({
        type: 'matrix',
        interactionMatrix: matrix
      });
    }
  }

  /**
   * Update mouse position
   */
  updateMouse(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;

    if (this.backend === 'worker' && this.worker) {
      this.worker.postMessage({
        type: 'mouse',
        x,
        y
      });
    }
  }

  /**
   * Run one simulation step
   */
  async step(): Promise<Float32Array> {
    if (this.isPaused) return this.particles;

    if (this.backend === 'webgpu' && this.gpuEngine && this.config) {
      // Update config and run GPU compute
      this.gpuEngine.updateConfig(
        getWorkerConfig(this.config),
        this.mouseX,
        this.mouseY
      );
      this.gpuEngine.step();

      // Read back results (async)
      if (!this.pendingRead) {
        this.pendingRead = this.gpuEngine.readParticles().then((data) => {
          this.particles = data;
          this.pendingRead = null;
          return data;
        });
      }

      return this.particles;
    } else if (this.worker) {
      // Worker handles its own timing
      this.worker.postMessage({ type: 'step' });
      return this.particles;
    }

    return this.particles;
  }

  /**
   * Get current particle data
   */
  getParticles(): Float32Array {
    return this.particles;
  }

  /**
   * Pause/resume simulation
   */
  setPaused(paused: boolean): void {
    this.isPaused = paused;

    if (this.worker) {
      this.worker.postMessage({ type: paused ? 'pause' : 'resume' });
    }
  }

  /**
   * Get current backend type
   */
  getBackend(): SimulationBackend {
    return this.backend;
  }

  /**
   * Check if WebGPU is available
   */
  isWebGPUAvailable(): boolean {
    return this.webgpuCapabilities?.supported ?? false;
  }

  /**
   * Get WebGPU capabilities
   */
  getWebGPUCapabilities(): WebGPUCapabilities | null {
    return this.webgpuCapabilities;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.gpuEngine) {
      this.gpuEngine.destroy();
      this.gpuEngine = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.initialized = false;
  }
}
