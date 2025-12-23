import * as THREE from 'three';
import type { SimulationConfig } from '../types';
import { ParticleRenderer } from './particles';
import { TrailEffect } from './effects';

/**
 * Main rendering system
 */
export class Renderer {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private particleRenderer: ParticleRenderer;
  private trailEffect: TrailEffect;
  private backgroundColor = 0x111111;

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
  }

  /**
   * Gets the canvas DOM element
   */
  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Initializes particles
   */
  initializeParticles(config: SimulationConfig): void {
    this.particleRenderer.initialize(config);
  }

  /**
   * Updates particle positions
   */
  updateParticles(particleData: Float32Array, config: SimulationConfig): void {
    this.particleRenderer.update(particleData, config);
  }

  /**
   * Renders a frame
   */
  render(config: SimulationConfig): void {
    if (config.trailsEnabled) {
      // Remove background so trails are not cleared
      this.scene.background = null;
      // Draw fade over previous frame
      this.trailEffect.render(this.renderer, config.trailLength);
      // Clear only depth buffer
      this.renderer.clearDepth();
      // Draw particles on top
      this.renderer.render(this.scene, this.camera);
    } else {
      // Restore background and clear everything
      this.scene.background = new THREE.Color(this.backgroundColor);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Handles window resize
   */
  handleResize(): void {
    this.camera.left = -window.innerWidth / 2;
    this.camera.right = window.innerWidth / 2;
    this.camera.top = window.innerHeight / 2;
    this.camera.bottom = -window.innerHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Cleans up resources
   */
  dispose(): void {
    this.particleRenderer.dispose();
    this.trailEffect.dispose();
    this.renderer.dispose();
  }
}

export { ParticleRenderer } from './particles';
export { TrailEffect } from './effects';
