import * as THREE from 'three';
import type { SimulationConfig } from '../types';
import { PARTICLE_STRIDE, ParticleIndex, ColorMode } from '../types';
import { VELOCITY_COLORS } from '../config/defaults';

/**
 * Particle mesh manager using InstancedMesh with color and size variations
 */
export class ParticleRenderer {
  private scene: THREE.Scene;
  private instancedMeshes: THREE.InstancedMesh[] = [];
  private geometry: THREE.CircleGeometry | null = null;
  private baseRadius: number = 4;

  // For velocity-based coloring
  private velocityMesh: THREE.InstancedMesh | null = null;
  private velocityColors: THREE.InstancedBufferAttribute | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Initializes meshes for each particle type
   */
  initialize(config: SimulationConfig): void {
    // Clear previous meshes
    this.dispose();

    this.baseRadius = config.particleRadius;

    // Create shared geometry
    this.geometry = new THREE.CircleGeometry(config.particleRadius, 12);

    // Create one InstancedMesh per type for type-based coloring
    for (let type = 0; type < config.particleTypes; type++) {
      const material = new THREE.MeshBasicMaterial({ color: config.colors[type] });
      const mesh = new THREE.InstancedMesh(
        this.geometry,
        material,
        config.particlesPerType * 2 // Extra capacity for spawned particles
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.instancedMeshes.push(mesh);
      this.scene.add(mesh);
    }

    // Create velocity-based mesh for velocity coloring mode
    const totalParticles = config.particlesPerType * config.particleTypes;
    const velocityMaterial = new THREE.MeshBasicMaterial({
      vertexColors: false,
      color: 0xffffff
    });

    this.velocityMesh = new THREE.InstancedMesh(
      this.geometry,
      velocityMaterial,
      totalParticles * 2
    );
    this.velocityMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Create instance color buffer for velocity coloring
    const colors = new Float32Array(totalParticles * 2 * 3);
    this.velocityColors = new THREE.InstancedBufferAttribute(colors, 3);
    this.velocityMesh.instanceColor = this.velocityColors;

    this.velocityMesh.visible = false;
    this.scene.add(this.velocityMesh);
  }

  /**
   * Updates mesh positions based on particle data
   */
  update(particleData: Float32Array, config: SimulationConfig): void {
    if (!particleData || this.instancedMeshes.length === 0) return;

    const useVelocityColor = config.colorMode === ColorMode.Velocity;
    const useSizeByVelocity = config.particleSizeByVelocity;

    // Show/hide appropriate meshes
    for (const mesh of this.instancedMeshes) {
      mesh.visible = !useVelocityColor;
    }
    if (this.velocityMesh) {
      this.velocityMesh.visible = useVelocityColor;
    }

    if (useVelocityColor) {
      this.updateVelocityMode(particleData, config);
    } else {
      this.updateTypeMode(particleData, config, useSizeByVelocity);
    }
  }

  /**
   * Updates particles using type-based coloring
   */
  private updateTypeMode(
    particleData: Float32Array,
    config: SimulationConfig,
    useSizeByVelocity: boolean
  ): void {
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    const counts = new Array(config.particleTypes).fill(0);
    const totalParticles = particleData.length / PARTICLE_STRIDE;

    for (let i = 0; i < totalParticles; i++) {
      const idx = i * PARTICLE_STRIDE;
      const type = particleData[idx + ParticleIndex.Type];
      const instanceId = counts[type];

      if (type < this.instancedMeshes.length) {
        const x = particleData[idx + ParticleIndex.X];
        const y = particleData[idx + ParticleIndex.Y];

        pos.set(x, y, 0);

        if (useSizeByVelocity) {
          const vx = particleData[idx + ParticleIndex.VX];
          const vy = particleData[idx + ParticleIndex.VY];
          const speed = Math.sqrt(vx * vx + vy * vy);
          const sizeScale = 1 + (speed / config.maxSpeed) * (config.particleSizeMultiplier - 1);
          scale.set(sizeScale, sizeScale, 1);
        } else {
          scale.set(1, 1, 1);
        }

        matrix.compose(pos, quaternion, scale);
        this.instancedMeshes[type].setMatrixAt(instanceId, matrix);
        counts[type]++;
      }
    }

    // Update instance counts and matrices
    for (let type = 0; type < this.instancedMeshes.length; type++) {
      this.instancedMeshes[type].count = counts[type];
      this.instancedMeshes[type].instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Updates particles using velocity-based coloring
   */
  private updateVelocityMode(particleData: Float32Array, config: SimulationConfig): void {
    if (!this.velocityMesh || !this.velocityColors) return;

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();

    const totalParticles = particleData.length / PARTICLE_STRIDE;
    const useSizeByVelocity = config.particleSizeByVelocity;

    for (let i = 0; i < totalParticles; i++) {
      const idx = i * PARTICLE_STRIDE;
      const x = particleData[idx + ParticleIndex.X];
      const y = particleData[idx + ParticleIndex.Y];
      const vx = particleData[idx + ParticleIndex.VX];
      const vy = particleData[idx + ParticleIndex.VY];

      const speed = Math.sqrt(vx * vx + vy * vy);
      const normalizedSpeed = Math.min(speed / (config.maxSpeed * config.velocityColorScale), 1);

      pos.set(x, y, 0);

      if (useSizeByVelocity) {
        const sizeScale = 1 + normalizedSpeed * (config.particleSizeMultiplier - 1);
        scale.set(sizeScale, sizeScale, 1);
      } else {
        scale.set(1, 1, 1);
      }

      matrix.compose(pos, quaternion, scale);
      this.velocityMesh.setMatrixAt(i, matrix);

      // Calculate color based on speed
      this.getVelocityColor(normalizedSpeed, color);
      this.velocityColors.setXYZ(i, color.r, color.g, color.b);
    }

    this.velocityMesh.count = totalParticles;
    this.velocityMesh.instanceMatrix.needsUpdate = true;
    this.velocityColors.needsUpdate = true;
  }

  /**
   * Gets a color based on velocity (0-1)
   */
  private getVelocityColor(t: number, color: THREE.Color): void {
    const colors = VELOCITY_COLORS;
    const segments = colors.length - 1;
    const segment = Math.min(Math.floor(t * segments), segments - 1);
    const localT = (t * segments) - segment;

    const color1 = new THREE.Color(colors[segment]);
    const color2 = new THREE.Color(colors[segment + 1]);

    color.lerpColors(color1, color2, localT);
  }

  /**
   * Gets all meshes for bloom rendering
   */
  getMeshes(): THREE.InstancedMesh[] {
    const meshes = [...this.instancedMeshes];
    if (this.velocityMesh) {
      meshes.push(this.velocityMesh);
    }
    return meshes;
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

    if (this.velocityMesh) {
      this.scene.remove(this.velocityMesh);
      this.velocityMesh.geometry.dispose();
      if (this.velocityMesh.material instanceof THREE.Material) {
        this.velocityMesh.material.dispose();
      }
      this.velocityMesh = null;
    }

    this.velocityColors = null;

    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
  }
}
