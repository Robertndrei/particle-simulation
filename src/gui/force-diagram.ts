import type { SimulationConfig } from '../types';
import { formatNumber } from './components';

const ATTRACT = '#3ad3b2';
const REPEL = '#ff7b6b';
const LINE = '#2e3b56';
const MUTED = '#95a2ba';
const TEXT = '#e9eef7';
const FONT = "11px 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif";

/**
 * Draws how the force on a particle changes with distance to a neighbour:
 * a collision zone up to the personal space, then a linear falloff of the
 * chase (up) or flee (down) force until the reach. Mirrors the shader model.
 */
export class ForceDiagram {
  readonly element: HTMLCanvasElement;
  private lastKey = '';

  constructor() {
    this.element = document.createElement('canvas');
    this.element.className = 'diagram';
    this.element.setAttribute('role', 'img');
  }

  draw(config: SimulationConfig): void {
    const key = [
      config.minDistance, config.interactionRadius, config.attraction,
      config.repulsion, config.softness, this.element.clientWidth
    ].join('|');
    if (key === this.lastKey || this.element.clientWidth === 0) return;
    this.lastKey = key;

    const canvas = this.element;
    const ratio = Math.min(window.devicePixelRatio, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const personal = config.minDistance;
    const reach = config.interactionRadius;
    const maxDist = Math.max(reach, personal) * 1.12;
    const left = 14;
    const right = width - 12;
    const mid = height / 2 + 4;
    const amp = height / 2 - 26;
    const x = (d: number) => left + (d / maxDist) * (right - left);

    // Shared scale for chase/flee so their heights compare honestly
    const forceScale = Math.max(config.attraction, config.repulsion, 0.02);
    const attractH = (config.attraction / forceScale) * amp;
    const repelH = (config.repulsion / forceScale) * amp;

    // Collision zone
    const px = x(Math.min(personal, maxDist));
    ctx.fillStyle = 'rgba(255, 123, 107, 0.10)';
    ctx.fillRect(left, 18, px - left, height - 30);
    ctx.strokeStyle = REPEL;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const d = Math.max(personal * (i / 40), personal * 0.05);
      const push = Math.min(config.softness * (personal / d - 1), 3) / 3;
      const yy = mid + push * amp * 1.0;
      if (i === 0) ctx.moveTo(x(d), yy); else ctx.lineTo(x(d), yy);
    }
    ctx.stroke();

    // Chase (up) and flee (down) falloff triangles
    if (reach > personal) {
      const fill = (h: number, color: string, alpha: string) => {
        ctx.beginPath();
        ctx.moveTo(x(personal), mid);
        ctx.lineTo(x(personal), mid + h);
        ctx.lineTo(x(reach), mid);
        ctx.closePath();
        ctx.fillStyle = color + alpha;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x(personal), mid + h);
        ctx.lineTo(x(reach), mid);
        ctx.stroke();
      };
      fill(-attractH, ATTRACT, '33');
      fill(repelH, REPEL, '26');
    }

    // Axis and markers
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, mid);
    ctx.lineTo(right, mid);
    ctx.stroke();

    ctx.font = FONT;
    ctx.textBaseline = 'top';
    const marker = (d: number, label: string, align: CanvasTextAlign) => {
      const mx = x(d);
      ctx.strokeStyle = MUTED;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, 16);
      ctx.lineTo(mx, height - 12);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = MUTED;
      ctx.textAlign = align;
      ctx.fillText(label, mx + (align === 'left' ? 4 : -4), 4);
    };
    const near = Math.abs(x(reach) - x(personal)) < 90;
    marker(personal, `Espacio ${formatNumber(personal)}`, near ? 'right' : 'left');
    marker(reach, `Alcance ${formatNumber(reach)}`, near ? 'left' : 'right');

    // The particle itself at distance 0
    ctx.fillStyle = TEXT;
    ctx.beginPath();
    ctx.arc(left, mid, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ATTRACT;
    ctx.fillText('persigue', right, mid - 6);
    ctx.fillStyle = REPEL;
    ctx.fillText('huye', right, mid + 15);

    this.element.setAttribute(
      'aria-label',
      `Choque hasta ${formatNumber(personal)} unidades; influencia hasta ${formatNumber(reach)} unidades.`
    );
  }
}
