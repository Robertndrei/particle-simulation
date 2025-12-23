import * as THREE from 'three';
import type { SimulationConfig } from '../types';
import { PARTICLE_STRIDE, ParticleIndex } from '../types';

/**
 * Particle mesh manager using InstancedMesh
 */
export class ParticleRenderer {
  private scene: THREE.Scene;
  private instancedMeshes: THREE.InstancedMesh[] = [];
  private geometry: THREE.CircleGeometry | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Initializes meshes for each particle type
   */
  initialize(config: SimulationConfig): void {
    // Clear previous meshes
    this.dispose();

    // Create shared geometry
    this.geometry = new THREE.CircleGeometry(config.particleRadius, 12);

    // Create one InstancedMesh per type
    for (let type = 0; type < config.particleTypes; type++) {
      const material = new THREE.MeshBasicMaterial({ color: config.colors[type] });
      const mesh = new THREE.InstancedMesh(
        this.geometry,
        material,
        config.particlesPerType
      );
      this.instancedMeshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  /**
   * Updates mesh positions based on particle data
   */
  update(particleData: Float32Array, config: SimulationConfig): void {
    if (!particleData || this.instancedMeshes.length === 0) return;

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();

    const counts = new Array(config.particleTypes).fill(0);
    const totalParticles = particleData.length / PARTICLE_STRIDE;

    for (let i = 0; i < totalParticles; i++) {
      const idx = i * PARTICLE_STRIDE;
      const type = particleData[idx + ParticleIndex.Type];
      const instanceId = counts[type];

      if (type < this.instancedMeshes.length && instanceId < config.particlesPerType) {
        pos.set(
          particleData[idx + ParticleIndex.X],
          particleData[idx + ParticleIndex.Y],
          0
        );
        matrix.setPosition(pos);
        this.instancedMeshes[type].setMatrixAt(instanceId, matrix);
        counts[type]++;
      }
    }

    // Mark matrices as updated
    for (const mesh of this.instancedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Cleans up resources
   */
  dispose(): void {
    for (const mesh of this.instancedMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    }
    this.instancedMeshes = [];

    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
  }
}
