import * as THREE from 'three';
import { AttractorType } from '../types';
import type { Attractor, Obstacle } from '../types';

/**
 * Renders attractors, repulsors, vortices, and obstacles
 */
export class AttractorRenderer {
  private scene: THREE.Scene;
  private attractorMeshes: Map<string, THREE.Group> = new Map();
  private obstacleMeshes: Map<string, THREE.Mesh> = new Map();

  // Materials
  private attractorMaterial: THREE.MeshBasicMaterial;
  private repulsorMaterial: THREE.MeshBasicMaterial;
  private vortexMaterial: THREE.MeshBasicMaterial;
  private obstacleMaterial: THREE.MeshBasicMaterial;
  private ringMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create materials
    this.attractorMaterial = new THREE.MeshBasicMaterial({
      color: 0x44ff66,
      transparent: true,
      opacity: 0.8
    });
    this.repulsorMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4466,
      transparent: true,
      opacity: 0.8
    });
    this.vortexMaterial = new THREE.MeshBasicMaterial({
      color: 0x44ffff,
      transparent: true,
      opacity: 0.8
    });
    this.obstacleMaterial = new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.6
    });
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
  }

  /**
   * Updates the rendered attractors
   */
  updateAttractors(attractors: Attractor[]): void {
    // Track which attractors still exist
    const currentIds = new Set(attractors.map(a => a.id));

    // Remove deleted attractors
    for (const [id, mesh] of this.attractorMeshes) {
      if (!currentIds.has(id)) {
        this.scene.remove(mesh);
        mesh.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
          }
        });
        this.attractorMeshes.delete(id);
      }
    }

    // Add or update attractors
    for (const attractor of attractors) {
      let group = this.attractorMeshes.get(attractor.id);

      if (!group) {
        group = this.createAttractorMesh(attractor);
        this.attractorMeshes.set(attractor.id, group);
        this.scene.add(group);
      }

      // Update position
      group.position.set(attractor.x, attractor.y, 0);

      // Update radius ring
      const ring = group.children[1] as THREE.Mesh;
      if (ring) {
        const scale = attractor.radius / 50;
        ring.scale.set(scale, scale, 1);
      }
    }
  }

  /**
   * Creates a mesh for an attractor
   */
  private createAttractorMesh(attractor: Attractor): THREE.Group {
    const group = new THREE.Group();

    // Center indicator
    const centerGeometry = new THREE.CircleGeometry(8, 16);
    let material: THREE.MeshBasicMaterial;

    switch (attractor.type) {
      case AttractorType.Attractor:
        material = this.attractorMaterial;
        break;
      case AttractorType.Repulsor:
        material = this.repulsorMaterial;
        break;
      case AttractorType.Vortex:
        material = this.vortexMaterial;
        break;
      default:
        material = this.attractorMaterial;
    }

    const centerMesh = new THREE.Mesh(centerGeometry, material);
    group.add(centerMesh);

    // Radius indicator ring
    const ringGeometry = new THREE.RingGeometry(48, 50, 32);
    const ringMesh = new THREE.Mesh(ringGeometry, this.ringMaterial.clone());
    ringMesh.material.color.copy(material.color);
    group.add(ringMesh);

    // Add symbol for type
    if (attractor.type === AttractorType.Vortex) {
      // Add spiral indicator for vortex
      const spiralGeometry = this.createSpiralGeometry();
      const spiralMesh = new THREE.Line(
        spiralGeometry,
        new THREE.LineBasicMaterial({ color: material.color, transparent: true, opacity: 0.5 })
      );
      group.add(spiralMesh);
    }

    return group;
  }

  /**
   * Creates a spiral geometry for vortex indicator
   */
  private createSpiralGeometry(): THREE.BufferGeometry {
    const points: THREE.Vector3[] = [];
    const turns = 2;
    const segments = 50;

    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const angle = t * Math.PI * 2 * turns;
      const radius = 10 + t * 20;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        0
      ));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return geometry;
  }

  /**
   * Updates the rendered obstacles
   */
  updateObstacles(obstacles: Obstacle[]): void {
    // Track which obstacles still exist
    const currentIds = new Set(obstacles.map(o => o.id));

    // Remove deleted obstacles
    for (const [id, mesh] of this.obstacleMeshes) {
      if (!currentIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.obstacleMeshes.delete(id);
      }
    }

    // Add or update obstacles
    for (const obstacle of obstacles) {
      let mesh = this.obstacleMeshes.get(obstacle.id);

      if (!mesh) {
        mesh = this.createObstacleMesh(obstacle);
        this.obstacleMeshes.set(obstacle.id, mesh);
        this.scene.add(mesh);
      } else {
        // Update existing mesh
        this.updateObstacleMesh(mesh, obstacle);
      }
    }
  }

  /**
   * Creates a mesh for an obstacle
   */
  private createObstacleMesh(obstacle: Obstacle): THREE.Mesh {
    const dx = obstacle.x2 - obstacle.x1;
    const dy = obstacle.y2 - obstacle.y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    const geometry = new THREE.PlaneGeometry(length, obstacle.thickness);
    const mesh = new THREE.Mesh(geometry, this.obstacleMaterial);

    mesh.position.set(
      (obstacle.x1 + obstacle.x2) / 2,
      (obstacle.y1 + obstacle.y2) / 2,
      0
    );
    mesh.rotation.z = angle;

    return mesh;
  }

  /**
   * Updates an obstacle mesh
   */
  private updateObstacleMesh(mesh: THREE.Mesh, obstacle: Obstacle): void {
    const dx = obstacle.x2 - obstacle.x1;
    const dy = obstacle.y2 - obstacle.y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(length, obstacle.thickness);

    mesh.position.set(
      (obstacle.x1 + obstacle.x2) / 2,
      (obstacle.y1 + obstacle.y2) / 2,
      0
    );
    mesh.rotation.z = angle;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    for (const [, mesh] of this.attractorMeshes) {
      this.scene.remove(mesh);
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
    }
    this.attractorMeshes.clear();

    for (const [, mesh] of this.obstacleMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.obstacleMeshes.clear();

    this.attractorMaterial.dispose();
    this.repulsorMaterial.dispose();
    this.vortexMaterial.dispose();
    this.obstacleMaterial.dispose();
    this.ringMaterial.dispose();
  }
}
