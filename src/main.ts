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
import { detectWebGPU, WebGPUComputeEngine } from './gpu';
import type { WebGPUCapabilities } from './gpu';

type SimulationBackend = 'webgpu' | 'worker';

/**
 * Main particle simulation application with all features
 */
class ParticleSimulation {
  private config: SimulationConfig;
  private interactionMatrix: InteractionMatrix = [];
  private renderer: Renderer;
  private gui: GUIController;
  private worker: Worker | null = null;
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

  // WebGPU support
  private backend: SimulationBackend = 'worker';
  private webgpuCapabilities: WebGPUCapabilities | null = null;
  private gpuEngine: WebGPUComputeEngine | null = null;
  private gpuReadPending = false;

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
  private backendElement: HTMLElement | null = null;

  // Particle inspector (click to follow a particle)
  private selectedParticleIndex: number | null = null;
  private inspectorElement: HTMLElement | null = null;
  private markerElement: HTMLElement | null = null;

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

    // GUI
    this.gui = new GUIController(this.config, this.interactionMatrix, {
      onConfigChange: () => this.sendConfigToBackend(),
      onMatrixChange: () => this.sendMatrixToBackend(),
      onReset: () => this.initParticles(),
      onAttractorsChange: () => this.sendAttractorsToWorker(),
      onObstaclesChange: () => this.sendObstaclesToWorker()
    });

    // DOM elements
    this.fpsElement = document.getElementById('fps')!;
    this.countElement = document.getElementById('count')!;
    this.workerStatusElement = document.getElementById('worker-status')!;
    this.createStatsElement();
    this.createBackendElement();
    this.createInspectorElements();

    // Events
    this.setupEventListeners();

    // Load config from URL if present
    this.loadConfigFromUrl();

    // Initialize backend (async) and start
    this.initializeBackend();
  }

  /**
   * Initialize the simulation backend (WebGPU or Worker)
   */
  private async initializeBackend(): Promise<void> {
    // Try WebGPU first
    this.webgpuCapabilities = await detectWebGPU();

    if (this.webgpuCapabilities.supported && this.webgpuCapabilities.device) {
      this.backend = 'webgpu';
      this.gpuEngine = new WebGPUComputeEngine(this.webgpuCapabilities.device);
      this.updateBackendDisplay();
      console.log('Using WebGPU compute backend');
    } else {
      this.backend = 'worker';
      this.initWorker();
      this.updateBackendDisplay();
      console.log('Using Web Worker backend');
    }

    // Start simulation
    this.initParticles();
    this.animate();
  }

  private initWorker(): void {
    this.worker = new Worker(
      new URL('./physics/worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.setupWorkerHandlers();
  }

  private createBackendElement(): void {
    this.backendElement = document.createElement('div');
    this.backendElement.id = 'backend-status';
    this.backendElement.style.cssText = `
      position: absolute;
      top: 30px;
      right: 10px;
      color: #fff;
      font-family: monospace;
      font-size: 11px;
      background: rgba(0,0,0,0.7);
      padding: 4px 8px;
      border-radius: 4px;
    `;
    document.body.appendChild(this.backendElement);
  }

  private updateBackendDisplay(): void {
    if (!this.backendElement) return;

    if (this.backend === 'webgpu') {
      this.backendElement.innerHTML = `<span style="color:#4f4">&#9679;</span> WebGPU`;
      this.backendElement.title = 'Physics running on GPU';
    } else {
      this.backendElement.innerHTML = `<span style="color:#ff4">&#9679;</span> Worker`;
      this.backendElement.title = 'Physics running on CPU (Web Worker)';
    }
  }

  private setupConfigCallbacks(): void {
    this.config.reset = () => this.initParticles();
    this.config.randomizeForces = () => this.randomizeInteractions();
    this.config.saveConfig = () => this.exporter.saveConfig(this.config, this.interactionMatrix);
    this.config.loadConfig = () => this.exporter.loadConfig((cfg, matrix) => {
      Object.assign(this.config, cfg);
      if (matrix) {
        this.interactionMatrix = matrix;
        this.sendMatrixToBackend();
      }
      this.gui.updateDisplay();
      this.sendConfigToBackend();
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
        this.sendMatrixToBackend();
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

  /**
   * Creates the DOM overlays for the particle inspector: a ring marker drawn
   * over the selected particle and an info box that follows it.
   */
  private createInspectorElements(): void {
    // Ring that highlights the selected particle
    this.markerElement = document.createElement('div');
    this.markerElement.id = 'particle-marker';
    this.markerElement.style.cssText = `
      position: absolute;
      pointer-events: none;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(255,255,255,0.9);
      transform: translate(-50%, -50%);
      display: none;
      z-index: 10;
    `;
    document.body.appendChild(this.markerElement);

    // Info box with the live parameters
    this.inspectorElement = document.createElement('div');
    this.inspectorElement.id = 'particle-inspector';
    this.inspectorElement.style.cssText = `
      position: absolute;
      pointer-events: none;
      color: #fff;
      font-family: monospace;
      font-size: 11px;
      line-height: 1.5;
      background: rgba(0,0,0,0.8);
      border: 1px solid rgba(255,255,255,0.25);
      padding: 6px 8px;
      border-radius: 4px;
      white-space: nowrap;
      display: none;
      z-index: 11;
    `;
    document.body.appendChild(this.inspectorElement);
  }

  private hideInspector(): void {
    if (this.markerElement) this.markerElement.style.display = 'none';
    if (this.inspectorElement) this.inspectorElement.style.display = 'none';
  }

  /**
   * Finds the nearest particle to a world-space point, within a pick radius.
   * Returns the particle index (into particleData) or null if none is close.
   */
  private pickParticle(worldX: number, worldY: number): number | null {
    if (!this.particleData) return null;

    // Pick radius in world units: forgiving but scales with zoom
    const pickRadius = Math.max(this.config.particleRadius * 2, 12 / this.config.zoom);
    const pickRadiusSq = pickRadius * pickRadius;

    const total = this.particleData.length / PARTICLE_STRIDE;
    let best: number | null = null;
    let bestDistSq = pickRadiusSq;

    for (let i = 0; i < total; i++) {
      const idx = i * PARTICLE_STRIDE;
      const dx = this.particleData[idx + ParticleIndex.X] - worldX;
      const dy = this.particleData[idx + ParticleIndex.Y] - worldY;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = i;
      }
    }

    return best;
  }

  /**
   * Computes the inter-particle forces acting on a single particle, mirroring
   * the model in physics/forces.ts. Runs on the main thread for the selected
   * particle only (O(n)), so it works for both Worker and WebGPU backends.
   */
  private computeParticleForces(index: number): {
    neighbors: number;
    contacts: number;
    attractionMag: number;
    repulsionMag: number;
    netMag: number;
    pressure: number;
  } {
    const data = this.particleData!;
    const cfg = this.config;
    const idx = index * PARTICLE_STRIDE;
    const px = data[idx + ParticleIndex.X];
    const py = data[idx + ParticleIndex.Y];
    const pType = Math.round(data[idx + ParticleIndex.Type]);

    const halfW = cfg.worldWidth / 2;
    const halfH = cfg.worldHeight / 2;
    const total = data.length / PARTICLE_STRIDE;

    // Separate attraction / repulsion contributions to the acceleration
    let attractAx = 0, attractAy = 0;
    let repelAx = 0, repelAy = 0;
    let pressure = 0; // accumulated collision push magnitude (compression)
    let neighbors = 0;
    let contacts = 0;

    for (let j = 0; j < total; j++) {
      if (j === index) continue;
      const jdx = j * PARTICLE_STRIDE;

      let dx = data[jdx + ParticleIndex.X] - px;
      let dy = data[jdx + ParticleIndex.Y] - py;
      const oType = Math.round(data[jdx + ParticleIndex.Type]);

      if (cfg.wrapEdges) {
        if (dx > halfW) dx -= cfg.worldWidth;
        if (dx < -halfW) dx += cfg.worldWidth;
        if (dy > halfH) dy -= cfg.worldHeight;
        if (dy < -halfH) dy += cfg.worldHeight;
      }

      const distSq = dx * dx + dy * dy;
      if (distSq > cfg.interactionRadius * cfg.interactionRadius) continue;
      const dist = Math.sqrt(distSq);
      if (dist < 1) continue;

      neighbors++;
      const nx = dx / dist;
      const ny = dy / dist;
      const interaction = this.interactionMatrix[pType]?.[oType] ?? 0;

      // Physical collision (always repulsive) -> contributes to pressure
      if (dist < cfg.minDistance) {
        const ratio = cfg.minDistance / dist;
        const pushForce = cfg.softness * (ratio - 1);
        repelAx -= nx * pushForce;
        repelAy -= ny * pushForce;
        pressure += Math.abs(pushForce);
        contacts++;
      }

      // Distance-based attraction / repulsion from the interaction matrix
      if (dist < cfg.interactionRadius && dist >= cfg.minDistance) {
        const normalizedDist =
          (dist - cfg.minDistance) / (cfg.interactionRadius - cfg.minDistance);
        if (interaction > 0) {
          const f = cfg.attraction * interaction * (1 - normalizedDist);
          attractAx += nx * f;
          attractAy += ny * f;
        } else if (interaction < 0) {
          const f = cfg.repulsion * interaction * (1 - normalizedDist);
          repelAx += nx * f; // f is negative -> points away (repulsion)
          repelAy += ny * f;
        }
      }
    }

    const netAx = attractAx + repelAx;
    const netAy = attractAy + repelAy;

    return {
      neighbors,
      contacts,
      attractionMag: Math.hypot(attractAx, attractAy),
      repulsionMag: Math.hypot(repelAx, repelAy),
      netMag: Math.hypot(netAx, netAy),
      pressure
    };
  }

  /**
   * Positions the marker and info box over the currently selected particle and
   * refreshes its live parameters. Called every frame.
   */
  private updateInspector(): void {
    if (this.selectedParticleIndex === null || !this.particleData) {
      this.hideInspector();
      return;
    }

    const total = this.particleData.length / PARTICLE_STRIDE;
    if (this.selectedParticleIndex >= total) {
      // The followed particle no longer exists (e.g. after a reset)
      this.selectedParticleIndex = null;
      this.hideInspector();
      return;
    }

    const idx = this.selectedParticleIndex * PARTICLE_STRIDE;
    const x = this.particleData[idx + ParticleIndex.X];
    const y = this.particleData[idx + ParticleIndex.Y];
    const vx = this.particleData[idx + ParticleIndex.VX];
    const vy = this.particleData[idx + ParticleIndex.VY];
    const type = this.particleData[idx + ParticleIndex.Type];
    const speed = Math.sqrt(vx * vx + vy * vy);

    // World -> screen (CSS pixels). Inverse of the mousemove transform.
    const zoom = this.config.zoom;
    const sx = (x - this.config.panX) * zoom + window.innerWidth / 2;
    const sy = -(y - this.config.panY) * zoom + window.innerHeight / 2;

    const typeIndex = Math.min(Math.max(Math.round(type), 0), this.config.colors.length - 1);
    const colorHex = '#' + (this.config.colors[typeIndex] ?? 0xffffff)
      .toString(16)
      .padStart(6, '0');

    // Position and size the marker ring (a bit larger than the particle)
    if (this.markerElement) {
      const diameter = this.config.particleRadius * 2 * zoom + 10;
      this.markerElement.style.display = 'block';
      this.markerElement.style.left = `${sx}px`;
      this.markerElement.style.top = `${sy}px`;
      this.markerElement.style.width = `${diameter}px`;
      this.markerElement.style.height = `${diameter}px`;
      this.markerElement.style.borderColor = colorHex;
    }

    // Compute live inter-particle forces for the selected particle
    const f = this.computeParticleForces(this.selectedParticleIndex);
    const fmt = (v: number) => (Math.abs(v) >= 0.001 ? v.toFixed(3) : v.toExponential(1));

    // Update the info box content
    if (this.inspectorElement) {
      this.inspectorElement.style.display = 'block';
      this.inspectorElement.innerHTML = `
        <div style="font-weight:bold;margin-bottom:2px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
            background:${colorHex};margin-right:5px;"></span>Particle #${this.selectedParticleIndex} (type ${typeIndex})
        </div>
        <div>x: ${x.toFixed(1)}&nbsp;&nbsp;y: ${y.toFixed(1)}</div>
        <div>vx: ${vx.toFixed(2)}&nbsp;&nbsp;vy: ${vy.toFixed(2)}</div>
        <div>speed: ${speed.toFixed(2)}</div>
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0;">
        <div>neighbors: ${f.neighbors}&nbsp;&nbsp;contacts: ${f.contacts}</div>
        <div><span style="color:#6cf;">attraction:</span> ${fmt(f.attractionMag)}</div>
        <div><span style="color:#f88;">repulsion:</span> ${fmt(f.repulsionMag)}</div>
        <div><span style="color:#cfc;">net force:</span> ${fmt(f.netMag)}</div>
        <div><span style="color:#fc6;">pressure:</span> ${fmt(f.pressure)}</div>
      `;

      // Offset the box from the particle, clamped to stay on screen
      const offset = 16;
      const boxWidth = this.inspectorElement.offsetWidth;
      const boxHeight = this.inspectorElement.offsetHeight;
      let bx = sx + offset;
      let by = sy + offset;
      if (bx + boxWidth > window.innerWidth) bx = sx - offset - boxWidth;
      if (by + boxHeight > window.innerHeight) by = sy - offset - boxHeight;
      this.inspectorElement.style.left = `${Math.max(0, bx)}px`;
      this.inspectorElement.style.top = `${Math.max(0, by)}px`;
    }
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
      this.sendConfigToBackend();
    });

    const canvas = this.renderer.getDomElement();

    // Mouse move
    canvas.addEventListener('mousemove', (e) => {
      const zoom = this.config.zoom;
      this.mouseX = (e.clientX - window.innerWidth / 2) / zoom + this.config.panX;
      this.mouseY = -(e.clientY - window.innerHeight / 2) / zoom + this.config.panY;

      // Update worker if using worker backend
      if (this.backend === 'worker' && this.worker) {
        this.worker.postMessage({
          type: WorkerMessageType.UpdateMouse,
          data: { x: this.mouseX, y: this.mouseY }
        });
      }
      // WebGPU receives mouse position in updateConfig() each frame

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

      // Inspect mode: pick the nearest particle and follow it (works on any backend)
      if (this.config.mouseMode === MouseMode.Inspect) {
        const zoom = this.config.zoom;
        const wx = (e.clientX - window.innerWidth / 2) / zoom + this.config.panX;
        const wy = -(e.clientY - window.innerHeight / 2) / zoom + this.config.panY;
        const picked = this.pickParticle(wx, wy);
        this.selectedParticleIndex = picked;
        if (picked === null) this.hideInspector();
        return;
      }

      // Adding particles at runtime only supported in worker mode
      if (this.backend !== 'worker' || !this.worker) return;

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
      } else if (e.key === 'Escape') {
        this.selectedParticleIndex = null;
        this.hideInspector();
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

  private async initParticles(): Promise<void> {
    // A reset rebuilds the array, so any followed particle is no longer valid
    this.selectedParticleIndex = null;
    this.hideInspector();

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

    if (this.backend === 'webgpu' && this.gpuEngine) {
      // Initialize WebGPU compute engine
      await this.gpuEngine.initialize(
        totalParticles,
        this.config.particleTypes,
        this.particleData
      );
      this.gpuEngine.updateInteractionMatrix(this.interactionMatrix, this.config.particleTypes);
      this.workerStatusElement.textContent = 'GPU: active';
    } else if (this.worker) {
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
    }

    this.countElement.textContent = String(totalParticles);
    this.gui.updateInteractionControls(this.config, this.interactionMatrix);
  }

  private randomizeInteractions(): void {
    randomizeInteractionMatrix(this.interactionMatrix);
    this.sendMatrixToBackend();
    this.gui.updateInteractionControls(this.config, this.interactionMatrix);
  }

  /**
   * Send config to the active backend (WebGPU or Worker)
   */
  private sendConfigToBackend(): void {
    if (this.backend === 'webgpu') {
      // WebGPU config is updated every frame in animate()
      return;
    }

    if (this.worker) {
      if (this.workerBusy) {
        this.pendingConfig = true;
      } else {
        this.worker.postMessage({
          type: WorkerMessageType.UpdateConfig,
          data: getWorkerConfig(this.config)
        });
      }
    }
  }

  /**
   * Send interaction matrix to the active backend
   */
  private sendMatrixToBackend(): void {
    if (this.backend === 'webgpu' && this.gpuEngine) {
      this.gpuEngine.updateInteractionMatrix(this.interactionMatrix, this.config.particleTypes);
      return;
    }

    if (this.worker) {
      if (this.workerBusy) {
        this.pendingMatrix = true;
      } else {
        this.worker.postMessage({
          type: WorkerMessageType.UpdateMatrix,
          data: this.interactionMatrix
        });
      }
    }
  }

  private sendAttractorsToWorker(): void {
    // WebGPU doesn't support attractors yet, only worker
    if (!this.worker) return;

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
    // WebGPU doesn't support obstacles yet, only worker
    if (!this.worker) return;

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

    this.sendConfigToBackend();
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

    // Run physics on appropriate backend
    if (this.backend === 'webgpu' && this.gpuEngine && this.particleData) {
      // Only run step if we're not waiting for a readback
      // This prevents race conditions with the buffer
      if (!this.gpuReadPending) {
        // Update config and run GPU compute
        this.gpuEngine.updateConfig(
          getWorkerConfig(this.config),
          this.mouseX,
          this.mouseY
        );
        this.gpuEngine.step();

        // Start async read back for next frame
        this.gpuReadPending = true;
        this.gpuEngine.readParticles().then((data) => {
          this.particleData = data;
          this.gpuReadPending = false;
        }).catch((err) => {
          console.error('GPU readback error:', err);
          this.gpuReadPending = false;
        });
      }
    } else if (this.worker) {
      // Request update from worker
      if (!this.workerBusy && this.particleData) {
        this.workerBusy = true;
        this.worker.postMessage({ type: WorkerMessageType.Update });
      }
    }

    // Update meshes
    if (this.particleData) {
      this.renderer.updateParticles(this.particleData, this.config);
    }

    // Update the particle inspector overlay (marker + info box follow the particle)
    this.updateInspector();

    // Update stats display
    this.renderer.updateStats(this.stats, this.config);

    // Render
    this.renderer.render(this.config);
  };
}

// Start application
new ParticleSimulation();
