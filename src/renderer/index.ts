import * as THREE from 'three';
import type { SimulationConfig, SimulationStats } from '../types';
import { ParticleRenderer } from './particles';
import { TrailEffect } from './effects';
import { BloomEffect } from './bloom';
import { ConnectionRenderer } from './connections';
import { HeatmapRenderer } from './heatmap';
import { EnergyGraph } from './energy-graph';
import { AttractorRenderer } from './attractors';

/**
 * Main rendering system
 */
export class Renderer {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private particleRenderer: ParticleRenderer;
  private trailEffect: TrailEffect;
  private bloomEffect: BloomEffect;
  private connectionRenderer: ConnectionRenderer;
  private heatmapRenderer: HeatmapRenderer;
  private energyGraph: EnergyGraph;
  private attractorRenderer: AttractorRenderer;
  private backgroundColor = 0x111111;

  // For zoom and pan
  private baseZoom = 1;
  private currentZoom = 1;
  private panX = 0;
  private panY = 0;

  constructor() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.backgroundColor);

    // Orthographic camera
    this.camera = new THREE.OrthographicCamera(
      -window.innerWidth / 2,
      window.innerWidth / 2,
      window.innerHeight / 2,
      -window.innerHeight / 2,
      0.1,
      1000
    );
    this.camera.position.z = 100;

    // WebGL renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.autoClear = false;

    // Subsystems
    this.particleRenderer = new ParticleRenderer(this.scene);
    this.trailEffect = new TrailEffect();
    this.bloomEffect = new BloomEffect();
    this.connectionRenderer = new ConnectionRenderer(this.scene);
    this.heatmapRenderer = new HeatmapRenderer(this.scene);
    this.energyGraph = new EnergyGraph();
    this.attractorRenderer = new AttractorRenderer(this.scene);
  }

  /**
   * Gets the canvas DOM element
   */
  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Gets the WebGL renderer
   */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /**
   * Gets the scene
   */
  getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * Gets the camera
   */
  getCamera(): THREE.OrthographicCamera {
    return this.camera;
  }

  /**
   * Initializes particles
   */
  initializeParticles(config: SimulationConfig): void {
    this.particleRenderer.initialize(config);

    // Initialize bloom if enabled
    if (config.bloomEnabled) {
      this.bloomEffect.initialize(this.renderer, this.scene, this.camera);
      this.bloomEffect.updateParams(
        config.bloomStrength,
        config.bloomRadius,
        config.bloomThreshold
      );
    }
  }

  /**
   * Updates particle positions and related effects
   */
  updateParticles(particleData: Float32Array, config: SimulationConfig): void {
    this.particleRenderer.update(particleData, config);

    // Update connections
    if (config.connectionsEnabled) {
      this.connectionRenderer.setVisible(true);
      this.connectionRenderer.update(
        particleData,
        config.colors,
        config.connectionDistance,
        config.connectionOpacity
      );
    } else {
      this.connectionRenderer.setVisible(false);
    }

    // Update heatmap
    if (config.showHeatmap) {
      this.heatmapRenderer.setVisible(true);
      this.heatmapRenderer.update(
        particleData,
        config.worldWidth,
        config.worldHeight,
        config.heatmapOpacity
      );
    } else {
      this.heatmapRenderer.setVisible(false);
    }

    // Update attractors and obstacles
    this.attractorRenderer.updateAttractors(config.attractors);
    this.attractorRenderer.updateObstacles(config.obstacles);
  }

  /**
   * Updates simulation statistics display
   */
  updateStats(stats: SimulationStats, config: SimulationConfig): void {
    if (config.showEnergyGraph) {
      this.energyGraph.setVisible(true);
      this.energyGraph.update(stats.kineticEnergy, stats.avgVelocity, stats.maxVelocity);
    } else {
      this.energyGraph.setVisible(false);
    }
  }

  /**
   * Updates camera zoom and pan
   */
  updateCamera(config: SimulationConfig): void {
    if (this.currentZoom !== config.zoom || this.panX !== config.panX || this.panY !== config.panY) {
      this.currentZoom = config.zoom;
      this.panX = config.panX;
      this.panY = config.panY;

      const halfWidth = window.innerWidth / 2 / config.zoom;
      const halfHeight = window.innerHeight / 2 / config.zoom;

      this.camera.left = -halfWidth + config.panX;
      this.camera.right = halfWidth + config.panX;
      this.camera.top = halfHeight + config.panY;
      this.camera.bottom = -halfHeight + config.panY;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Renders a frame
   */
  render(config: SimulationConfig): void {
    // Update camera for zoom/pan
    this.updateCamera(config);

    // Update bloom parameters if enabled
    if (config.bloomEnabled) {
      if (!this.bloomEffect.isInitialized()) {
        this.bloomEffect.initialize(this.renderer, this.scene, this.camera);
      }
      this.bloomEffect.updateParams(
        config.bloomStrength,
        config.bloomRadius,
        config.bloomThreshold
      );
    }

    if (config.trailsEnabled) {
      // Remove background so trails are not cleared
      this.scene.background = null;
      // Draw fade over previous frame
      this.trailEffect.render(this.renderer, config.trailLength);
      // Clear only depth buffer
      this.renderer.clearDepth();

      if (config.bloomEnabled && this.bloomEffect.isInitialized()) {
        this.bloomEffect.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      // Restore background and clear everything
      this.scene.background = new THREE.Color(this.backgroundColor);
      this.renderer.clear(true, true, true);

      if (config.bloomEnabled && this.bloomEffect.isInitialized()) {
        this.bloomEffect.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  /**
   * Takes a screenshot
   */
  takeScreenshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * Handles window resize
   */
  handleResize(): void {
    const halfWidth = window.innerWidth / 2 / this.currentZoom;
    const halfHeight = window.innerHeight / 2 / this.currentZoom;

    this.camera.left = -halfWidth + this.panX;
    this.camera.right = halfWidth + this.panX;
    this.camera.top = halfHeight + this.panY;
    this.camera.bottom = -halfHeight + this.panY;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.bloomEffect.handleResize(window.innerWidth, window.innerHeight);
  }

  /**
   * Cleans up resources
   */
  dispose(): void {
    this.particleRenderer.dispose();
    this.trailEffect.dispose();
    this.bloomEffect.dispose();
    this.connectionRenderer.dispose();
    this.heatmapRenderer.dispose();
    this.energyGraph.dispose();
    this.attractorRenderer.dispose();
    this.renderer.dispose();
  }
}

export { ParticleRenderer } from './particles';
export { TrailEffect } from './effects';
export { BloomEffect } from './bloom';
export { ConnectionRenderer } from './connections';
export { HeatmapRenderer } from './heatmap';
export { EnergyGraph } from './energy-graph';
export { AttractorRenderer } from './attractors';
