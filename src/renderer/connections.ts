import * as THREE from 'three';
import { PARTICLE_STRIDE, ParticleIndex } from '../types';

/**
 * Renders connections between nearby particles
 */
export class ConnectionRenderer {
  private scene: THREE.Scene;
  private lineGeometry: THREE.BufferGeometry | null = null;
  private lineMaterial: THREE.LineBasicMaterial | null = null;
  private lineSegments: THREE.LineSegments | null = null;
  private maxConnections = 50000;
  private positionBuffer: Float32Array;
  private colorBuffer: Float32Array;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.positionBuffer = new Float32Array(this.maxConnections * 6); // 2 vertices * 3 coords
    this.colorBuffer = new Float32Array(this.maxConnections * 6);    // 2 vertices * 3 colors
    this.initialize();
  }

  /**
   * Initialize the line geometry
   */
  private initialize(): void {
    this.lineGeometry = new THREE.BufferGeometry();

    this.lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positionBuffer, 3)
    );
    this.lineGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.colorBuffer, 3)
    );

    this.lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending
    });

    this.lineSegments = new THREE.LineSegments(this.lineGeometry, this.lineMaterial);
    this.lineSegments.frustumCulled = false;
    this.scene.add(this.lineSegments);
  }

  /**
   * Updates connections based on particle positions
   */
  update(
    particleData: Float32Array,
    colors: number[],
    maxDistance: number,
    opacity: number
  ): void {
    if (!this.lineGeometry || !this.lineMaterial) return;

    const particleCount = particleData.length / PARTICLE_STRIDE;
    let connectionCount = 0;
    const maxDistSq = maxDistance * maxDistance;

    // Simple grid-based spatial optimization
    const cellSize = maxDistance;
    const grid = new Map<string, number[]>();

    // Build spatial grid
    for (let i = 0; i < particleCount; i++) {
      const idx = i * PARTICLE_STRIDE;
      const x = particleData[idx + ParticleIndex.X];
      const y = particleData[idx + ParticleIndex.Y];
      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      const key = `${cellX},${cellY}`;

      if (!grid.has(key)) {
        grid.set(key, []);
      }
      grid.get(key)!.push(i);
    }

    // Find connections
    for (let i = 0; i < particleCount && connectionCount < this.maxConnections; i++) {
      const idx1 = i * PARTICLE_STRIDE;
      const x1 = particleData[idx1 + ParticleIndex.X];
      const y1 = particleData[idx1 + ParticleIndex.Y];
      const type1 = particleData[idx1 + ParticleIndex.Type];

      const cellX = Math.floor(x1 / cellSize);
      const cellY = Math.floor(y1 / cellSize);

      // Check neighboring cells
      for (let dx = -1; dx <= 1 && connectionCount < this.maxConnections; dx++) {
        for (let dy = -1; dy <= 1 && connectionCount < this.maxConnections; dy++) {
          const key = `${cellX + dx},${cellY + dy}`;
          const cell = grid.get(key);
          if (!cell) continue;

          for (const j of cell) {
            if (j <= i) continue;
            if (connectionCount >= this.maxConnections) break;

            const idx2 = j * PARTICLE_STRIDE;
            const x2 = particleData[idx2 + ParticleIndex.X];
            const y2 = particleData[idx2 + ParticleIndex.Y];
            const type2 = particleData[idx2 + ParticleIndex.Type];

            const dx = x2 - x1;
            const dy = y2 - y1;
            const distSq = dx * dx + dy * dy;

            if (distSq < maxDistSq && distSq > 1) {
              const dist = Math.sqrt(distSq);
              const alpha = 1 - dist / maxDistance;

              // Get colors for both particles
              const color1 = new THREE.Color(colors[type1] || 0xffffff);
              const color2 = new THREE.Color(colors[type2] || 0xffffff);

              // Set line positions
              const bufIdx = connectionCount * 6;
              this.positionBuffer[bufIdx] = x1;
              this.positionBuffer[bufIdx + 1] = y1;
              this.positionBuffer[bufIdx + 2] = 0;
              this.positionBuffer[bufIdx + 3] = x2;
              this.positionBuffer[bufIdx + 4] = y2;
              this.positionBuffer[bufIdx + 5] = 0;

              // Set colors with distance-based alpha
              this.colorBuffer[bufIdx] = color1.r * alpha;
              this.colorBuffer[bufIdx + 1] = color1.g * alpha;
              this.colorBuffer[bufIdx + 2] = color1.b * alpha;
              this.colorBuffer[bufIdx + 3] = color2.r * alpha;
              this.colorBuffer[bufIdx + 4] = color2.g * alpha;
              this.colorBuffer[bufIdx + 5] = color2.b * alpha;

              connectionCount++;
            }
          }
        }
      }
    }

    // Update geometry
    this.lineGeometry.setDrawRange(0, connectionCount * 2);
    this.lineGeometry.attributes.position.needsUpdate = true;
    this.lineGeometry.attributes.color.needsUpdate = true;

    this.lineMaterial.opacity = opacity;
  }

  /**
   * Shows or hides the connections
   */
  setVisible(visible: boolean): void {
    if (this.lineSegments) {
      this.lineSegments.visible = visible;
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.lineSegments) {
      this.scene.remove(this.lineSegments);
    }
    if (this.lineGeometry) {
      this.lineGeometry.dispose();
    }
    if (this.lineMaterial) {
      this.lineMaterial.dispose();
    }
  }
}
