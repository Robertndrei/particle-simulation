import * as THREE from 'three';

/**
 * Renders an energy graph overlay
 */
export class EnergyGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private energyHistory: number[] = [];
  private maxHistory = 200;
  private visible = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'energy-graph';
    this.canvas.width = 300;
    this.canvas.height = 100;
    this.canvas.style.cssText = `
      position: absolute;
      bottom: 50px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      border-radius: 4px;
      display: none;
    `;
    document.body.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * Updates the graph with new energy value
   */
  update(kineticEnergy: number, avgVelocity: number, maxVelocity: number): void {
    if (!this.visible) return;

    // Add to history
    this.energyHistory.push(kineticEnergy);
    if (this.energyHistory.length > this.maxHistory) {
      this.energyHistory.shift();
    }

    // Clear canvas
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw border
    this.ctx.strokeStyle = '#444';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0.5, 0.5, this.canvas.width - 1, this.canvas.height - 1);

    // Find max energy for scaling
    const maxEnergy = Math.max(...this.energyHistory, 1);

    // Draw energy line
    this.ctx.beginPath();
    this.ctx.strokeStyle = '#44ff66';
    this.ctx.lineWidth = 2;

    for (let i = 0; i < this.energyHistory.length; i++) {
      const x = (i / this.maxHistory) * this.canvas.width;
      const y = this.canvas.height - 25 - (this.energyHistory[i] / maxEnergy) * (this.canvas.height - 35);

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.stroke();

    // Draw labels
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '10px monospace';
    this.ctx.fillText(`Energy: ${kineticEnergy.toFixed(0)}`, 5, 12);
    this.ctx.fillText(`Avg V: ${avgVelocity.toFixed(2)}`, 100, 12);
    this.ctx.fillText(`Max V: ${maxVelocity.toFixed(2)}`, 200, 12);

    // Draw title
    this.ctx.fillStyle = '#888';
    this.ctx.fillText('Kinetic Energy', 5, this.canvas.height - 5);
  }

  /**
   * Shows or hides the graph
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.canvas.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this.energyHistory = [];
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.canvas.remove();
  }
}
