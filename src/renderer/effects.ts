import * as THREE from 'three';

/**
 * Trail effects system
 */
export class TrailEffect {
  private fadeScene: THREE.Scene;
  private fadeCamera: THREE.OrthographicCamera;
  private fadeMaterial: THREE.MeshBasicMaterial;

  constructor() {
    // Plane for trail effect (fade)
    const fadeGeometry = new THREE.PlaneGeometry(2, 2);
    this.fadeMaterial = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.1,
      depthTest: false,
      depthWrite: false
    });
    const fadePlane = new THREE.Mesh(fadeGeometry, this.fadeMaterial);
    fadePlane.renderOrder = -1;

    // Separate scene and camera for the fade
    this.fadeScene = new THREE.Scene();
    this.fadeScene.add(fadePlane);
    this.fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /**
   * Renders the trail effect
   */
  render(renderer: THREE.WebGLRenderer, trailLength: number): void {
    this.fadeMaterial.opacity = 1 - trailLength;
    renderer.render(this.fadeScene, this.fadeCamera);
  }

  /**
   * Cleans up resources
   */
  dispose(): void {
    this.fadeMaterial.dispose();
  }
}
