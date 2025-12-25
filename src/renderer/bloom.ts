import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Bloom effect manager
 */
export class BloomEffect {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;
  private outputPass: OutputPass | null = null;

  /**
   * Initializes the bloom effect
   */
  initialize(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera
  ): void {
    this.dispose();

    this.composer = new EffectComposer(renderer);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5,  // strength
      0.4,  // radius
      0.6   // threshold
    );
    this.composer.addPass(this.bloomPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  /**
   * Updates bloom parameters
   */
  updateParams(strength: number, radius: number, threshold: number): void {
    if (this.bloomPass) {
      this.bloomPass.strength = strength;
      this.bloomPass.radius = radius;
      this.bloomPass.threshold = threshold;
    }
  }

  /**
   * Handles window resize
   */
  handleResize(width: number, height: number): void {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  /**
   * Renders with bloom effect
   */
  render(): void {
    if (this.composer) {
      this.composer.render();
    }
  }

  /**
   * Returns whether bloom is initialized
   */
  isInitialized(): boolean {
    return this.composer !== null;
  }

  /**
   * Cleans up resources
   */
  dispose(): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.bloomPass = null;
    this.renderPass = null;
    this.outputPass = null;
  }
}
