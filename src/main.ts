import {
  PARTICLE_STRIDE,
  ParticleIndex,
  WorkerMessageType,
  getWorkerConfig,
  MouseMode,
  AttractorType,
  PresetName
} from './types';
import type {
  SimulationConfig,
  InteractionMatrix,
  WorkerToMainMessage,
  SimulationStats,
  Attractor,
  Obstacle
} from './types';
import {
  createDefaultConfig,
  createInteractionMatrix,
  randomizeInteractionMatrix,
  getPreset,
  applyPresetToConfig
} from './config/defaults';
import { Renderer } from './renderer';
import { GUIController } from './gui/controls';
import { AudioAnalyzer } from './audio/analyzer';
import { Exporter } from './utils/exporter';

/**
 * Main particle simulation application with all features
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
  private pendingAttractors = false;
  private pendingObstacles = false;
  private mouseX = 0;
  private mouseY = 0;
  private lastTime = performance.now();
  private frameCount = 0;

  // New systems
  private audioAnalyzer: AudioAnalyzer;
  private exporter: Exporter;
  private stats: SimulationStats = {
    kineticEnergy: 0,
    avgVelocity: 0,
    maxVelocity: 0,
    clusterCount: 0,
    densityMap: null
  };

  // Obstacle drawing state
  private isDrawingObstacle = false;
  private obstacleStartX = 0;
  private obstacleStartY = 0;

  // DOM elements
  private fpsElement: HTMLElement;
  private countElement: HTMLElement;
  private workerStatusElement: HTMLElement;
  private statsElement: HTMLElement | null = null;

  constructor() {
    // Configuration
    this.config = createDefaultConfig();
    this.setupConfigCallbacks();

    // Initialize interaction matrix BEFORE the GUI
    this.interactionMatrix = createInteractionMatrix(this.config.particleTypes);

    // Initialize subsystems
    this.audioAnalyzer = new AudioAnalyzer();
    this.exporter = new Exporter();

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
      onReset: () => this.initParticles(),
      onAttractorsChange: () => this.sendAttractorsToWorker(),
      onObstaclesChange: () => this.sendObstaclesToWorker()
    });

    // DOM elements
    this.fpsElement = document.getElementById('fps')!;
    this.countElement = document.getElementById('count')!;
    this.workerStatusElement = document.getElementById('worker-status')!;
    this.createStatsElement();

    // Events
    this.setupEventListeners();

    // Load config from URL if present
    this.loadConfigFromUrl();

    // Start
    this.initParticles();
    this.animate();
  }

  private setupConfigCallbacks(): void {
    this.config.reset = () => this.initParticles();
    this.config.randomizeForces = () => this.randomizeInteractions();
    this.config.saveConfig = () => this.exporter.saveConfig(this.config, this.interactionMatrix);
    this.config.loadConfig = () => this.exporter.loadConfig((cfg, matrix) => {
      Object.assign(this.config, cfg);
      if (matrix) {
        this.interactionMatrix = matrix;
        this.sendMatrixToWorker();
      }
      this.gui.updateDisplay();
      this.sendConfigToWorker();
      this.initParticles();
    });
    this.config.applyPreset = (presetName: PresetName) => {
      const preset = getPreset(presetName);
      applyPresetToConfig(this.config, preset);
      if (preset.matrix) {
        this.interactionMatrix = preset.matrix.map(row => [...row]);
        while (this.interactionMatrix.length < this.config.particleTypes) {
          const row: number[] = [];
          for (let j = 0; j < this.config.particleTypes; j++) {
            row.push(this.interactionMatrix.length === j ? 1 : 0);
          }
          this.interactionMatrix.push(row);
        }
        this.sendMatrixToWorker();
      }
      this.gui.updateDisplay();
      this.initParticles();
    };
    this.config.takeScreenshot = () => this.exporter.takeScreenshot(this.renderer.getDomElement());
    this.config.startRecording = () => this.exporter.startRecording(this.renderer.getDomElement());
    this.config.stopRecording = () => this.exporter.stopRecording();
    this.config.exportData = () => {
      if (this.particleData) {
        this.exporter.exportParticleData(this.particleData);
      }
    };
    this.config.clearAttractors = () => {
      this.config.attractors = [];
      this.sendAttractorsToWorker();
    };
    this.config.clearObstacles = () => {
      this.config.obstacles = [];
      this.sendObstaclesToWorker();
    };
  }

  private createStatsElement(): void {
    this.statsElement = document.createElement('div');
    this.statsElement.id = 'stats';
    this.statsElement.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      color: #fff;
      font-family: monospace;
      font-size: 12px;
      background: rgba(0,0,0,0.7);
      padding: 8px;
      border-radius: 4px;
      display: none;
    `;
    document.body.appendChild(this.statsElement);
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
        if (this.pendingAttractors) {
          this.worker.postMessage({
            type: WorkerMessageType.UpdateAttractors,
            data: this.config.attractors
          });
          this.pendingAttractors = false;
        }
        if (this.pendingObstacles) {
          this.worker.postMessage({
            type: WorkerMessageType.UpdateObstacles,
            data: this.config.obstacles
          });
          this.pendingObstacles = false;
        }
      } else if (message.type === WorkerMessageType.Stats) {
        this.stats = message.stats;
        this.updateStatsDisplay();
      }
    };
  }

  private updateStatsDisplay(): void {
    if (!this.statsElement) return;

    if (this.config.showStats) {
      this.statsElement.style.display = 'block';
      this.statsElement.innerHTML = `
        Energy: ${this.stats.kineticEnergy.toFixed(0)}<br>
        Avg Velocity: ${this.stats.avgVelocity.toFixed(2)}<br>
        Max Velocity: ${this.stats.maxVelocity.toFixed(2)}<br>
        Clusters: ${this.stats.clusterCount}
      `;
    } else {
      this.statsElement.style.display = 'none';
    }
  }

  private setupEventListeners(): void {
    // Resize
    window.addEventListener('resize', () => {
      this.config.worldWidth = window.innerWidth;
      this.config.worldHeight = window.innerHeight;
      this.renderer.handleResize();
      this.sendConfigToWorker();
    });

    const canvas = this.renderer.getDomElement();

    // Mouse move
    canvas.addEventListener('mousemove', (e) => {
      const zoom = this.config.zoom;
      this.mouseX = (e.clientX - window.innerWidth / 2) / zoom + this.config.panX;
      this.mouseY = -(e.clientY - window.innerHeight / 2) / zoom + this.config.panY;
      this.worker.postMessage({
        type: WorkerMessageType.UpdateMouse,
        data: { x: this.mouseX, y: this.mouseY }
      });

      // Drawing obstacle
      if (this.isDrawingObstacle && this.config.mouseMode === MouseMode.Obstacle) {
        // Preview handled in render
      }
    });

    // Mouse down
    canvas.addEventListener('mousedown', (e) => {
      if (this.config.mouseMode === MouseMode.Obstacle) {
        this.isDrawingObstacle = true;
        const zoom = this.config.zoom;
        this.obstacleStartX = (e.clientX - window.innerWidth / 2) / zoom + this.config.panX;
        this.obstacleStartY = -(e.clientY - window.innerHeight / 2) / zoom + this.config.panY;
      }
    });

    // Mouse up
    canvas.addEventListener('mouseup', (e) => {
      if (this.isDrawingObstacle && this.config.mouseMode === MouseMode.Obstacle) {
        this.isDrawingObstacle = false;
        const zoom = this.config.zoom;
        const endX = (e.clientX - window.innerWidth / 2) / zoom + this.config.panX;
        const endY = -(e.clientY - window.innerHeight / 2) / zoom + this.config.panY;

        // Create obstacle
        const obstacle: Obstacle = {
          id: `obs_${Date.now()}`,
          x1: this.obstacleStartX,
          y1: this.obstacleStartY,
          x2: endX,
          y2: endY,
          thickness: 20
        };

        this.config.obstacles.push(obstacle);
        this.sendObstaclesToWorker();
      }
    });

    // Click
    canvas.addEventListener('click', (e) => {
      if (!this.particleData) return;
      if (this.config.mouseMode === MouseMode.Obstacle) return; // Handled by mouse up

      const zoom = this.config.zoom;
      const x = (e.clientX - window.innerWidth / 2) / zoom + this.config.panX;
      const y = -(e.clientY - window.innerHeight / 2) / zoom + this.config.panY;

      if (this.config.mouseMode === MouseMode.Spawn) {
        // Spawn particles of selected type
        const type = Math.min(this.config.spawnType, this.config.particleTypes - 1);
        const newCount = 10;
        const newData = new Float32Array(newCount * PARTICLE_STRIDE);

        for (let i = 0; i < newCount; i++) {
          const idx = i * PARTICLE_STRIDE;
          newData[idx + ParticleIndex.X] = x + (Math.random() - 0.5) * 30;
          newData[idx + ParticleIndex.Y] = y + (Math.random() - 0.5) * 30;
          newData[idx + ParticleIndex.VX] = (Math.random() - 0.5) * 2;
          newData[idx + ParticleIndex.VY] = (Math.random() - 0.5) * 2;
          newData[idx + ParticleIndex.Type] = type;
        }

        this.worker.postMessage(
          { type: WorkerMessageType.AddParticles, data: newData.buffer },
          [newData.buffer]
        );
      } else if (this.config.mouseMode === MouseMode.None) {
        // Default: add random type particles
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
      }
    });

    // Right click to add attractor/repulsor
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const zoom = this.config.zoom;
      const x = (e.clientX - window.innerWidth / 2) / zoom + this.config.panX;
      const y = -(e.clientY - window.innerHeight / 2) / zoom + this.config.panY;

      // Determine type based on shift/ctrl
      let attractorType = AttractorType.Attractor;
      if (e.shiftKey) attractorType = AttractorType.Repulsor;
      if (e.ctrlKey) attractorType = AttractorType.Vortex;

      const attractor: Attractor = {
        id: `attr_${Date.now()}`,
        x,
        y,
        type: attractorType,
        strength: this.config.mouseStrength,
        radius: this.config.mouseRadius
      };

      this.config.attractors.push(attractor);
      this.sendAttractorsToWorker();
    });

    // Wheel for zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      this.config.zoom = Math.max(0.1, Math.min(5, this.config.zoom * zoomDelta));
      this.gui.updateDisplay();
    }, { passive: false });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        this.initParticles();
      } else if (e.key === 's' && e.ctrlKey) {
        e.preventDefault();
        this.exporter.saveConfig(this.config, this.interactionMatrix);
      } else if (e.key === 'p' || e.key === 'P') {
        this.exporter.takeScreenshot(canvas);
      }
    });
  }

  private loadConfigFromUrl(): void {
    const urlConfig = this.exporter.loadFromUrl();
    if (urlConfig) {
      Object.assign(this.config, urlConfig.config);
      if (urlConfig.matrix) {
        this.interactionMatrix = urlConfig.matrix;
      }
      this.gui.updateDisplay();
    }
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
          interactionMatrix: this.interactionMatrix,
          attractors: this.config.attractors,
          obstacles: this.config.obstacles
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

  private sendAttractorsToWorker(): void {
    if (this.workerBusy) {
      this.pendingAttractors = true;
    } else {
      this.worker.postMessage({
        type: WorkerMessageType.UpdateAttractors,
        data: this.config.attractors
      });
    }
  }

  private sendObstaclesToWorker(): void {
    if (this.workerBusy) {
      this.pendingObstacles = true;
    } else {
      this.worker.postMessage({
        type: WorkerMessageType.UpdateObstacles,
        data: this.config.obstacles
      });
    }
  }

  private updateAudio(): void {
    if (!this.config.audioEnabled) return;

    // Initialize audio on first use
    if (!this.audioAnalyzer.getIsActive()) {
      this.audioAnalyzer.initialize();
      return;
    }

    const audio = this.audioAnalyzer.update(
      this.config.audioSensitivity,
      this.config.audioSmoothing
    );

    // Modulate simulation parameters based on audio
    // Bass affects attraction
    // Mid affects noise
    // High affects radiation
    if (audio.bass > 0.1) {
      this.config.attraction = 0.03 + audio.bass * 0.05;
      this.config.mouseStrength = 2 + audio.bass * 5;
    }
    if (audio.mid > 0.1) {
      this.config.noiseStrength = audio.mid * 0.3;
      this.config.noiseEnabled = audio.mid > 0.2;
    }
    if (audio.high > 0.2) {
      this.config.radiationRate = audio.high * 0.005;
      this.config.radiationEnabled = audio.high > 0.3;
    }

    this.sendConfigToWorker();
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

    // Audio reactive
    if (this.config.audioEnabled) {
      this.updateAudio();
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

    // Update stats display
    this.renderer.updateStats(this.stats, this.config);

    // Render
    this.renderer.render(this.config);
  };
}

// Start application
new ParticleSimulation();
