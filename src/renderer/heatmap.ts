import * as THREE from 'three';
import { PARTICLE_STRIDE, ParticleIndex } from '../types';

/**
 * Renders a heatmap overlay showing particle density
 */
export class HeatmapRenderer {
  private scene: THREE.Scene;
  private mesh: THREE.Mesh | null = null;
  private texture: THREE.DataTexture | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private resolution = 64;
  private densityData: Float32Array;
  private textureData: Uint8Array;

  // Heatmap colors (blue -> cyan -> green -> yellow -> red)
  private static readonly GRADIENT = [
    { pos: 0.0, color: [0, 0, 128] },
    { pos: 0.25, color: [0, 128, 255] },
    { pos: 0.5, color: [0, 255, 128] },
    { pos: 0.75, color: [255, 255, 0] },
    { pos: 1.0, color: [255, 0, 0] }
  ];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.densityData = new Float32Array(this.resolution * this.resolution);
    this.textureData = new Uint8Array(this.resolution * this.resolution * 4);
    this.initialize();
  }

  /**
   * Initialize the heatmap mesh
   */
  private initialize(): void {
    this.texture = new THREE.DataTexture(
      this.textureData,
      this.resolution,
      this.resolution,
      THREE.RGBAFormat
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        heatmap: { value: this.texture },
        opacity: { value: 0.5 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D heatmap;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(heatmap, vUv);
          gl_FragColor = vec4(color.rgb, color.a * opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /**
   * Updates the heatmap based on particle positions
   */
  update(
    particleData: Float32Array,
    worldWidth: number,
    worldHeight: number,
    opacity: number
  ): void {
    if (!this.texture || !this.material || !this.mesh) return;

    // Clear density data
    this.densityData.fill(0);

    const particleCount = particleData.length / PARTICLE_STRIDE;
    const halfWidth = worldWidth / 2;
    const halfHeight = worldHeight / 2;
    const cellWidth = worldWidth / this.resolution;
    const cellHeight = worldHeight / this.resolution;

    // Accumulate particle density
    for (let i = 0; i < particleCount; i++) {
      const idx = i * PARTICLE_STRIDE;
      const x = particleData[idx + ParticleIndex.X];
      const y = particleData[idx + ParticleIndex.Y];

      // Convert to grid coordinates
      const gridX = Math.floor((x + halfWidth) / cellWidth);
      const gridY = Math.floor((y + halfHeight) / cellHeight);

      if (gridX >= 0 && gridX < this.resolution && gridY >= 0 && gridY < this.resolution) {
        this.densityData[gridY * this.resolution + gridX] += 1;
      }
    }

    // Find max density for normalization
    let maxDensity = 0;
    for (let i = 0; i < this.densityData.length; i++) {
      if (this.densityData[i] > maxDensity) {
        maxDensity = this.densityData[i];
      }
    }

    // Convert density to colors
    for (let i = 0; i < this.densityData.length; i++) {
      const density = maxDensity > 0 ? this.densityData[i] / maxDensity : 0;
      const color = this.getGradientColor(density);
      const texIdx = i * 4;
      this.textureData[texIdx] = color[0];
      this.textureData[texIdx + 1] = color[1];
      this.textureData[texIdx + 2] = color[2];
      this.textureData[texIdx + 3] = density > 0.01 ? 255 : 0;
    }

    this.texture.needsUpdate = true;
    this.material.uniforms.opacity.value = opacity;

    // Scale mesh to cover the world
    this.mesh.scale.set(worldWidth, worldHeight, 1);
  }

  /**
   * Gets a color from the gradient based on position (0-1)
   */
  private getGradientColor(pos: number): number[] {
    const gradient = HeatmapRenderer.GRADIENT;

    for (let i = 0; i < gradient.length - 1; i++) {
      const curr = gradient[i];
      const next = gradient[i + 1];

      if (pos >= curr.pos && pos <= next.pos) {
        const t = (pos - curr.pos) / (next.pos - curr.pos);
        return [
          Math.round(curr.color[0] + t * (next.color[0] - curr.color[0])),
          Math.round(curr.color[1] + t * (next.color[1] - curr.color[1])),
          Math.round(curr.color[2] + t * (next.color[2] - curr.color[2]))
        ];
      }
    }

    return gradient[gradient.length - 1].color;
  }

  /**
   * Shows or hides the heatmap
   */
  setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.visible = visible;
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.texture) {
      this.texture.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
  }
}
