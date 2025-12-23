import { PARTICLE_STRIDE, ParticleIndex } from '../types';

/**
 * Spatial hash system to optimize neighbor detection
 */
export class SpatialHash {
  private cellSize: number;
  private grid: Map<string, number[]>;

  constructor(cellSize: number = 80) {
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  /**
   * Generates the grid key for a position
   */
  private getKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  /**
   * Clears the grid and rebuilds it with current particles
   */
  build(particles: Float32Array): void {
    this.grid.clear();
    const count = particles.length / PARTICLE_STRIDE;

    for (let i = 0; i < count; i++) {
      const idx = i * PARTICLE_STRIDE;
      const x = particles[idx + ParticleIndex.X];
      const y = particles[idx + ParticleIndex.Y];
      const key = this.getKey(x, y);

      if (!this.grid.has(key)) {
        this.grid.set(key, []);
      }
      this.grid.get(key)!.push(i);
    }
  }

  /**
   * Gets the indices of neighboring particles within a radius
   */
  getNeighbors(px: number, py: number, radius: number): number[] {
    const neighbors: number[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(px / this.cellSize);
    const cy = Math.floor(py / this.cellSize);

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = this.grid.get(key);
        if (cell) {
          for (const idx of cell) {
            neighbors.push(idx);
          }
        }
      }
    }

    return neighbors;
  }
}
