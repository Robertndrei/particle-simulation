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
  resizeInteractionMatrix,
  randomizeInteractionMatrix,
  getPreset,
  applyPresetToConfig
} from './config/defaults';
import { Renderer } from './renderer';
import { GUIController, MAX_TOTAL_PARTICLES } from './gui/controls';
import { speciesName, hexColor } from './gui/matrix-editor';
import { formatNumber } from './gui/components';
import { AudioAnalyzer } from './audio/analyzer';
import { Exporter } from './utils/exporter';
import { detectWebGPU, WebGPUComputeEngine, WebGPUParticleRenderer } from './gpu';
import type { WebGPUCapabilities } from './gpu';

type SimulationBackend = 'webgpu' | 'worker';

// The CPU worker cannot keep up beyond this; WebGPU handles 100k+
const WORKER_MAX_PARTICLES = 7000;
// Initial spacing between particles, in multiples of minDistance
const WORLD_SPACING = 1.5;
// Zoom is effectively unbounded; these only keep floats finite
const MIN_ZOOM = 1e-9;
const MAX_ZOOM = 1000;
// Must match CENTRAL_SOFTENING in gpu/shaders.ts and physics/forces.ts
const CENTRAL_SOFTENING = 30;
// Pointer travel (px) before a press becomes a pan instead of a click
const DRAG_THRESHOLD = 4;

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
  private gpuRenderer: WebGPUParticleRenderer | null = null;
  private gpuReadPending = false;
  // World point to pick once the next GPU readback lands (inspect mode)
  private pendingPick: { x: number; y: number } | null = null;

  // Camera panning
  private pointerClientX = 0;
  private pointerClientY = 0;
  private panPointer: { x: number; y: number; moved: boolean } | null = null;
  private suppressClick = false;

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

  // Particle inspector (click to follow a particle)
  private selectedParticleIndex: number | null = null;
  private inspectorElement: HTMLElement | null = null;
  private markerElement: HTMLElement | null = null;

  constructor() {
    // Configuration
    this.config = createDefaultConfig();
    this.setupConfigCallbacks();

    // Initialize interaction matrix BEFORE the GUI. Random by default so the
    // types form emergent structures instead of isolated same-type blobs
    this.interactionMatrix = createInteractionMatrix(this.config.particleTypes);
    randomizeInteractionMatrix(this.interactionMatrix);

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
      onObstaclesChange: () => this.sendObstaclesToWorker(),
      onFitView: () => this.fitView(),
      onZoomBy: (factor) => this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor),
      // WebGPU reads colours and size every frame; the CPU renderer bakes them into meshes
      onAppearanceChange: () => {
        if (this.backend === 'worker') this.renderer.initializeParticles(this.config);
      }
    });

    // DOM elements
    this.fpsElement = document.getElementById('fps')!;
    this.countElement = document.getElementById('count')!;
    this.workerStatusElement = document.getElementById('worker-status')!;
    this.createStatsElement();
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
      const device = this.webgpuCapabilities.device;
      this.backend = 'webgpu';
      this.gpuEngine = new WebGPUComputeEngine(device);
      this.gpuRenderer = new WebGPUParticleRenderer(device);
      document.body.insertBefore(this.gpuRenderer.getDomElement(), document.body.firstChild);
      this.renderer.setOverlayMode(true);
      console.log('Using WebGPU compute + render backend');
    } else {
      this.backend = 'worker';
      this.initWorker();
      console.log('Using Web Worker backend');
    }
    this.gui.setBackend(this.backend);

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
      } else {
        // Presets without fixed relationships start from fresh random ones
        this.interactionMatrix = createInteractionMatrix(this.config.particleTypes);
        randomizeInteractionMatrix(this.interactionMatrix);
      }
      // initParticles() resizes the matrix to the type count and uploads it
      this.gui.updateDisplay();
      this.initParticles();
    };
    this.config.takeScreenshot = () => this.takeScreenshot();
    // With WebGPU the particle canvas is recorded (overlays are not included)
    this.config.startRecording = () => this.exporter.startRecording(
      this.gpuRenderer ? this.gpuRenderer.getDomElement() : this.renderer.getDomElement()
    );
    this.config.stopRecording = () => this.exporter.stopRecording();
    this.config.exportData = async () => {
      if (this.gpuEngine) {
        // Fresh copy from the GPU (particleData is only kept current while
        // inspecting). The staging buffer allows one read at a time.
        while (this.gpuReadPending) await new Promise(r => setTimeout(r, 16));
        this.gpuReadPending = true;
        try {
          this.exporter.exportParticleData(await this.gpuEngine.readParticles());
        } finally {
          this.gpuReadPending = false;
        }
      } else if (this.particleData) {
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
      top: 60px;
      left: 12px;
      color: #fff;
      font-family: monospace;
      font-size: 12px;
      background: rgba(0,0,0,0.7);
      padding: 8px;
      border-radius: 4px;
      display: none;
      z-index: 25;
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
    this.inspectorElement.className = 'ui';
    this.inspectorElement.style.cssText = `
      position: absolute;
      pointer-events: none;
      line-height: 1.55;
      background: var(--ui-glass);
      backdrop-filter: blur(14px);
      border: 1px solid var(--ui-line);
      padding: 10px 12px;
      border-radius: 12px;
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
    const colorHex = hexColor(this.config.colors[typeIndex]);

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
    const fmt = (v: number) => (Math.abs(v) >= 0.001 ? formatNumber(v, 3) : '0');

    // Update the info box content
    if (this.inspectorElement) {
      this.inspectorElement.style.display = 'block';
      const row = (label: string, value: string, color = 'var(--ui-muted)') =>
        `<div style="display:flex;justify-content:space-between;gap:16px;">` +
        `<span style="color:${color}">${label}</span><span>${value}</span></div>`;
      this.inspectorElement.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;
            background:${colorHex};margin-right:6px;"></span>${speciesName(typeIndex)}
          <span style="color:var(--ui-muted);font-weight:400;">n.º ${this.selectedParticleIndex}</span>
        </div>
        ${row('Posición', `${formatNumber(x)}; ${formatNumber(y)}`)}
        ${row('Velocidad', formatNumber(speed, 2))}
        ${row('Vecinas cerca', String(f.neighbors))}
        ${row('Tocándola', String(f.contacts))}
        <hr style="border:none;border-top:1px solid var(--ui-line);margin:6px 0;">
        ${row('Le atraen', fmt(f.attractionMag), 'var(--ui-attract)')}
        ${row('Le repelen', fmt(f.repulsionMag), 'var(--ui-repel)')}
        ${row('Fuerza total', fmt(f.netMag), 'var(--ui-text)')}
        ${row('Presión', fmt(f.pressure))}
      `;

      // Offset the box from the particle, clamped to stay on screen
      const offset = 16;
      const boxWidth = this.inspectorElement.offsetWidth;
      const boxHeight = this.inspectorElement.offsetHeight;
      let bx = sx + offset;
      let by = sy + offset;
      if (bx + boxWidth > window.innerWidth) bx = sx - offset - boxWidth;
      // Keep clear of the tool dock at the bottom
      if (by + boxHeight > window.innerHeight - 120) by = sy - offset - boxHeight;
      this.inspectorElement.style.left = `${Math.max(0, bx)}px`;
      this.inspectorElement.style.top = `${Math.max(0, by)}px`;
    }
  }

  private setupWorkerHandlers(): void {
    const worker = this.worker!;
    worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
      const message = e.data;

      if (message.type === WorkerMessageType.Ready) {
        this.workerStatusElement.textContent = 'Worker: active';
        this.workerBusy = false;
      } else if (message.type === WorkerMessageType.Positions) {
        this.particleData = new Float32Array(message.particles);
        this.countElement.textContent = (this.particleData.length / PARTICLE_STRIDE).toLocaleString('es-ES');
        this.workerBusy = false;

        // Send pending updates
        if (this.pendingConfig) {
          worker.postMessage({
            type: WorkerMessageType.UpdateConfig,
            data: getWorkerConfig(this.config)
          });
          this.pendingConfig = false;
        }
        if (this.pendingMatrix) {
          worker.postMessage({
            type: WorkerMessageType.UpdateMatrix,
            data: this.interactionMatrix
          });
          this.pendingMatrix = false;
        }
        if (this.pendingAttractors) {
          worker.postMessage({
            type: WorkerMessageType.UpdateAttractors,
            data: this.config.attractors
          });
          this.pendingAttractors = false;
        }
        if (this.pendingObstacles) {
          worker.postMessage({
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

  /** Converts a client (CSS pixel) position to world coordinates. */
  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const zoom = this.config.zoom;
    return {
      x: (clientX - window.innerWidth / 2) / zoom + this.config.panX,
      y: -(clientY - window.innerHeight / 2) / zoom + this.config.panY
    };
  }

  /** Re-derives the mouse world position (it moves when the camera does). */
  private updateMouseWorld(): void {
    const world = this.screenToWorld(this.pointerClientX, this.pointerClientY);
    this.mouseX = world.x;
    this.mouseY = world.y;
  }

  /** Zooms by `factor` keeping the world point under (clientX, clientY) fixed. */
  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.screenToWorld(clientX, clientY);
    this.config.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.config.zoom * factor));
    const after = this.screenToWorld(clientX, clientY);
    this.config.panX += before.x - after.x;
    this.config.panY += before.y - after.y;
    this.updateMouseWorld();
    this.gpuRenderer?.clearTrails();
  }

  /** Frames the whole world in the part of the viewport the panel leaves free. */
  private fitView(): void {
    const inset = this.gui.getPanelInset();
    const zoom = 0.95 * Math.min(
      (window.innerWidth - inset) / this.config.worldWidth,
      window.innerHeight / this.config.worldHeight
    );
    this.config.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    // Shift the camera right so the world centres in the free area
    this.config.panX = inset / 2 / this.config.zoom;
    this.config.panY = 0;
    this.gpuRenderer?.clearTrails();
  }

  /**
   * Sizes the world from the particle count so density stays constant from a
   * few thousand up to 100k+ particles (zoom out to see all of it).
   */
  private updateWorldSize(totalParticles: number): void {
    const aspect = window.innerWidth / window.innerHeight;
    const side = Math.sqrt(totalParticles) * this.config.minDistance * WORLD_SPACING * this.config.worldScale;
    this.config.worldWidth = Math.max(window.innerWidth, side * Math.sqrt(aspect));
    this.config.worldHeight = Math.max(window.innerHeight, side / Math.sqrt(aspect));
  }

  /** Middle button always pans; left button pans in modes where it has no drag action. */
  private canPanWith(button: number): boolean {
    if (button === 1) return true;
    return button === 0 &&
      (this.config.mouseMode === MouseMode.None || this.config.mouseMode === MouseMode.Inspect);
  }

  private spawnParticles(x: number, y: number, type: number, count: number, jitterVelocity: boolean): void {
    const newData = new Float32Array(count * PARTICLE_STRIDE);
    for (let i = 0; i < count; i++) {
      const idx = i * PARTICLE_STRIDE;
      newData[idx + ParticleIndex.X] = x + (Math.random() - 0.5) * 30;
      newData[idx + ParticleIndex.Y] = y + (Math.random() - 0.5) * 30;
      newData[idx + ParticleIndex.VX] = jitterVelocity ? (Math.random() - 0.5) * 2 : 0;
      newData[idx + ParticleIndex.VY] = jitterVelocity ? (Math.random() - 0.5) * 2 : 0;
      newData[idx + ParticleIndex.Type] = type;
    }

    if (this.backend === 'webgpu' && this.gpuEngine) {
      this.gpuEngine.addParticles(newData);
      this.countElement.textContent = this.gpuEngine.getParticleCount().toLocaleString('es-ES');
    } else if (this.worker) {
      this.worker.postMessage(
        { type: WorkerMessageType.AddParticles, data: newData.buffer },
        [newData.buffer]
      );
    }
  }

  private setupEventListeners(): void {
    // Resize: only the viewport changes, the world keeps its size
    window.addEventListener('resize', () => {
      this.renderer.handleResize();
      this.gpuRenderer?.handleResize();
    });

    const canvas = this.renderer.getDomElement();

    // Mouse move
    canvas.addEventListener('mousemove', (e) => {
      // Camera panning
      if (this.panPointer) {
        const dx = e.clientX - this.panPointer.x;
        const dy = e.clientY - this.panPointer.y;
        if (!this.panPointer.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          this.panPointer.moved = true;
          canvas.style.cursor = 'grabbing';
        }
        if (this.panPointer.moved) {
          this.config.panX -= (e.clientX - this.pointerClientX) / this.config.zoom;
          this.config.panY += (e.clientY - this.pointerClientY) / this.config.zoom;
          this.gpuRenderer?.clearTrails();
        }
      }

      this.pointerClientX = e.clientX;
      this.pointerClientY = e.clientY;
      this.updateMouseWorld();

      // Update worker if using worker backend
      if (this.backend === 'worker' && this.worker) {
        this.worker.postMessage({
          type: WorkerMessageType.UpdateMouse,
          data: { x: this.mouseX, y: this.mouseY }
        });
      }
      // WebGPU receives mouse position in updateConfig() each frame
    });

    // Mouse down
    canvas.addEventListener('mousedown', (e) => {
      // Middle-button drags and releases outside the canvas never fire a
      // click, so a stale flag must not swallow this new interaction
      this.suppressClick = false;
      if (this.canPanWith(e.button)) {
        if (e.button === 1) e.preventDefault(); // no autoscroll
        this.panPointer = { x: e.clientX, y: e.clientY, moved: false };
        return;
      }
      if (this.config.mouseMode === MouseMode.Obstacle && e.button === 0) {
        this.isDrawingObstacle = true;
        const start = this.screenToWorld(e.clientX, e.clientY);
        this.obstacleStartX = start.x;
        this.obstacleStartY = start.y;
      }
    });

    // Mouse up (on window so a pan ends even if released outside the canvas)
    window.addEventListener('mouseup', (e) => {
      if (this.panPointer) {
        this.suppressClick = this.panPointer.moved && e.button === 0;
        this.panPointer = null;
        canvas.style.cursor = '';
        return;
      }
      if (this.isDrawingObstacle && this.config.mouseMode === MouseMode.Obstacle) {
        this.isDrawingObstacle = false;
        const end = this.screenToWorld(e.clientX, e.clientY);

        // Create obstacle
        const obstacle: Obstacle = {
          id: `obs_${Date.now()}`,
          x1: this.obstacleStartX,
          y1: this.obstacleStartY,
          x2: end.x,
          y2: end.y,
          thickness: 20
        };

        this.config.obstacles.push(obstacle);
        this.sendObstaclesToWorker();
      }
    });

    // Click
    canvas.addEventListener('click', (e) => {
      // A drag that panned the camera is not a click
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      if (this.config.mouseMode === MouseMode.Obstacle) return; // Handled by mouse up

      const { x, y } = this.screenToWorld(e.clientX, e.clientY);

      // Inspect mode: pick the nearest particle and follow it (works on any backend)
      if (this.config.mouseMode === MouseMode.Inspect) {
        if (this.backend === 'webgpu') {
          // GPU data lives on the GPU: pick once the next readback arrives
          this.pendingPick = { x, y };
          return;
        }
        if (!this.particleData) return;
        const picked = this.pickParticle(x, y);
        this.selectedParticleIndex = picked;
        if (picked === null) this.hideInspector();
        return;
      }

      if (this.config.mouseMode === MouseMode.Spawn) {
        // Spawn particles of selected type
        const type = Math.min(this.config.spawnType, this.config.particleTypes - 1);
        this.spawnParticles(x, y, type, 10, true);
      } else if (this.config.mouseMode === MouseMode.None) {
        // Default: add random type particles
        const type = Math.floor(Math.random() * this.config.particleTypes);
        this.spawnParticles(x, y, type, 5, false);
      }
    });

    // Right click to add attractor/repulsor
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Attractors only act on the worker backend; don't draw inert ones
      if (this.backend !== 'worker') return;
      const { x, y } = this.screenToWorld(e.clientX, e.clientY);

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

    // Wheel: unbounded zoom anchored at the cursor (trackpad pinch included)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
      this.zoomAt(e.clientX, e.clientY, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // typing in the GUI
      if (e.key === 's' && e.ctrlKey) {
        e.preventDefault();
        this.exporter.saveConfig(this.config, this.interactionMatrix);
        return;
      }
      // Leave browser shortcuts (Cmd+R, Ctrl+F, Ctrl+P...) alone
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r' || e.key === 'R') {
        this.initParticles();
      } else if (e.key === 'p' || e.key === 'P') {
        this.takeScreenshot();
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'Home') {
        this.fitView();
      } else if (e.key === 'Escape') {
        this.selectedParticleIndex = null;
        this.hideInspector();
      }
    });
  }

  /**
   * Screenshot. With WebGPU the particles are on their own canvas, so both
   * layers are composited (rendered in the same task so the GPU image is valid).
   */
  private takeScreenshot(): void {
    if (!this.gpuRenderer) {
      this.exporter.takeScreenshot(this.renderer.getDomElement());
      return;
    }
    this.renderGpuFrame();
    const gpuCanvas = this.gpuRenderer.getDomElement();
    const composite = document.createElement('canvas');
    composite.width = gpuCanvas.width;
    composite.height = gpuCanvas.height;
    const ctx = composite.getContext('2d')!;
    ctx.drawImage(gpuCanvas, 0, 0);
    ctx.drawImage(this.renderer.getDomElement(), 0, 0, composite.width, composite.height);
    this.exporter.takeScreenshot(composite);
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

    // Values may come from a shared URL or file: keep them in the supported range
    this.config.particleTypes = Math.min(10, Math.max(1, Math.round(Number(this.config.particleTypes) || 1)));
    const maxPerType = Math.floor(MAX_TOTAL_PARTICLES / this.config.particleTypes);
    this.config.particlesPerType = Math.min(maxPerType, Math.max(1, Math.round(Number(this.config.particlesPerType) || 1)));

    // Keep the current forces; only adapt the matrix if the type count changed
    this.interactionMatrix = resizeInteractionMatrix(this.interactionMatrix, this.config.particleTypes);

    if (this.backend === 'worker') {
      const maxPerType = Math.max(1, Math.floor(WORKER_MAX_PARTICLES / this.config.particleTypes));
      if (this.config.particlesPerType > maxPerType) {
        console.warn(`Worker backend: limiting to ${maxPerType} particles per type (WebGPU unavailable)`);
        this.config.particlesPerType = maxPerType;
      }
    }

    const totalParticles = this.config.particlesPerType * this.config.particleTypes;
    this.updateWorldSize(totalParticles);
    this.fitView();
    const initialData = new Float32Array(totalParticles * PARTICLE_STRIDE);
    this.particleData = initialData;

    this.seedParticles(initialData);

    // Initialize renderer
    this.renderer.initializeParticles(this.config);

    if (this.backend === 'webgpu' && this.gpuEngine) {
      // Initialize WebGPU compute engine, with headroom for spawned particles
      const capacity = totalParticles + Math.max(5000, Math.ceil(totalParticles * 0.1));
      this.particleData = null; // GPU owns the data; only read back on demand
      await this.gpuEngine.initialize(totalParticles, capacity, initialData);
      this.gpuEngine.updateInteractionMatrix(this.interactionMatrix, this.config.particleTypes);
      this.gpuRenderer?.clearTrails();
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

    this.countElement.textContent = totalParticles.toLocaleString('es-ES');
    this.gui.updateInteractionControls(this.config, this.interactionMatrix);
  }

  /**
   * Places particles for the configured initial layout. Disk and rings start
   * with the circular orbit speed for the central pull, so they rotate
   * instead of collapsing.
   */
  private seedParticles(data: Float32Array): void {
    const cfg = this.config;
    const types = cfg.particleTypes;
    const radius = 0.4 * Math.min(cfg.worldWidth, cfg.worldHeight);
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

    let index = 0;
    for (let type = 0; type < types; type++) {
      for (let i = 0; i < cfg.particlesPerType; i++) {
        const idx = index++ * PARTICLE_STRIDE;
        let x: number;
        let y: number;
        let direction = 1;

        if (cfg.initialLayout === 'disk') {
          const core = 0.12 * radius;
          if (Math.random() < 0.06) {
            // Central bulge (kept sparse: a packed core explodes on collisions)
            const r = core * Math.sqrt(Math.random());
            const a = Math.random() * Math.PI * 2;
            x = Math.cos(a) * r;
            y = Math.sin(a) * r;
          } else {
            // One trailing logarithmic spiral arm per species
            const r = core + (radius - core) * Math.sqrt(Math.random());
            const a = (type / types) * Math.PI * 2 - 2.4 * Math.log(r / core) + gauss() * 0.25;
            x = Math.cos(a) * r;
            y = Math.sin(a) * r;
          }
        } else if (cfg.initialLayout === 'rings') {
          // One ring per species, inner to outer, alternating direction
          const r = radius * (0.25 + 0.75 * (types > 1 ? type / (types - 1) : 0)) + gauss() * 0.03 * radius;
          const a = Math.random() * Math.PI * 2;
          x = Math.cos(a) * r;
          y = Math.sin(a) * r;
          direction = type % 2 === 0 ? 1 : -1;
        } else {
          x = (Math.random() - 0.5) * cfg.worldWidth * 0.9;
          y = (Math.random() - 0.5) * cfg.worldHeight * 0.9;
        }

        let vx = 0;
        let vy = 0;
        const r = Math.hypot(x, y);
        if (cfg.initialLayout !== 'random' && cfg.centralGravity > 0 && r > 1e-3) {
          // Circular orbit: v^2 / r = g / max(r, softening), tangential, counter-clockwise
          const speed = Math.sqrt(cfg.centralGravity * r / Math.max(r, CENTRAL_SOFTENING)) * direction;
          vx = (-y / r) * speed;
          vy = (x / r) * speed;
        }

        data[idx + ParticleIndex.X] = x;
        data[idx + ParticleIndex.Y] = y;
        data[idx + ParticleIndex.VX] = vx;
        data[idx + ParticleIndex.VY] = vy;
        data[idx + ParticleIndex.Type] = type;
      }
    }
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

  private renderGpuFrame(): void {
    if (!this.gpuRenderer || !this.gpuEngine) return;
    this.gpuRenderer.render(
      this.gpuEngine.getCurrentBuffer(),
      this.gpuEngine.getParticleCount(),
      this.config
    );
  }

  /**
   * Copies particles back to the CPU, but only while something needs them
   * (following a particle or a pending pick). One read in flight at a time;
   * the simulation keeps stepping meanwhile.
   */
  private requestGpuReadback(): void {
    if (!this.gpuEngine || this.gpuReadPending) return;
    if (this.selectedParticleIndex === null && !this.pendingPick) return;

    this.gpuReadPending = true;
    this.gpuEngine.readParticles().then((data) => {
      this.particleData = data;
      if (this.pendingPick) {
        this.selectedParticleIndex = this.pickParticle(this.pendingPick.x, this.pendingPick.y);
        this.pendingPick = null;
        if (this.selectedParticleIndex === null) this.hideInspector();
      }
    }).catch((err) => {
      console.error('GPU readback error:', err);
    }).finally(() => {
      this.gpuReadPending = false;
    });
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
    if (this.backend === 'webgpu' && this.gpuEngine) {
      if (!this.config.paused) {
        this.gpuEngine.updateConfig(getWorkerConfig(this.config), this.mouseX, this.mouseY);
        this.gpuEngine.step();
      }
      this.requestGpuReadback();
      this.renderGpuFrame();
      this.renderer.updateOverlays(this.config);
    } else if (this.worker) {
      // Request update from worker
      if (!this.workerBusy && this.particleData && !this.config.paused) {
        this.workerBusy = true;
        this.worker.postMessage({ type: WorkerMessageType.Update });
      }

      // Update meshes
      if (this.particleData) {
        this.renderer.updateParticles(this.particleData, this.config);
      }
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
