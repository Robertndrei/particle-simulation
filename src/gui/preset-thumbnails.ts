import { PresetName } from '../types';

export interface PresetInfo {
  name: string;
  description: string;
}

/** Spanish names and one-line descriptions for the preset cards. */
export const PRESET_INFO: Record<PresetName, PresetInfo> = {
  [PresetName.Default]: { name: 'Ecosistema', description: 'Siete especies con relaciones mezcladas' },
  [PresetName.Galaxy]: { name: 'Galaxia', description: 'Un disco que gira y enrolla sus brazos' },
  [PresetName.Life]: { name: 'Vida', description: 'Grupos que se persiguen sin parar' },
  [PresetName.Fluid]: { name: 'Fluido', description: 'Un líquido que cae y salpica' },
  [PresetName.Swarm]: { name: 'Enjambre', description: 'Bandadas que vuelan juntas' },
  [PresetName.Crystals]: { name: 'Cristales', description: 'Redes ordenadas y rígidas' },
  [PresetName.Chaos]: { name: 'Caos', description: 'Mucha energía, nada se queda quieto' },
  [PresetName.Orbits]: { name: 'Órbitas', description: 'Anillos que giran en sentidos opuestos' }
};

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws a small illustration of what each preset tends to look like,
 * using the current species colours.
 */
export function drawPresetThumbnail(canvas: HTMLCanvasElement, preset: PresetName, colors: number[]): void {
  const ratio = Math.min(window.devicePixelRatio, 2);
  const w = 112;
  const h = 70;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#0d121d';
  ctx.fillRect(0, 0, w, h);

  const random = rng(preset.length * 7919 + preset.charCodeAt(0));
  const color = (i: number) => `#${(colors[i % colors.length] ?? 0xffffff).toString(16).padStart(6, '0')}`;
  const dot = (x: number, y: number, c: string, r = 1.3) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const blob = (cx: number, cy: number, radius: number, count: number, c: string) => {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * radius;
      dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, c);
    }
  };

  switch (preset) {
    case PresetName.Galaxy:
      for (let arm = 0; arm < 4; arm++) {
        for (let i = 0; i < 46; i++) {
          const t = i / 46;
          const a = arm * (Math.PI / 2) + t * 4.2;
          const r = 4 + t * 30;
          dot(w / 2 + Math.cos(a) * r * 1.4 + (random() - 0.5) * 4,
            h / 2 + Math.sin(a) * r * 0.8 + (random() - 0.5) * 4, color(arm), 1.1 + (1 - t));
        }
      }
      break;
    case PresetName.Life:
      for (let i = 0; i < 7; i++) {
        const cx = 12 + random() * (w - 24);
        const cy = 12 + random() * (h - 24);
        blob(cx, cy, 7, 18, color(i % 6));
        blob(cx + 5, cy + 2, 4, 8, color((i + 2) % 6));
      }
      break;
    case PresetName.Fluid:
      for (let i = 0; i < 260; i++) {
        const x = random() * w;
        const surface = h * 0.55 + Math.sin(x / 9) * 4;
        const y = surface + random() * (h - surface);
        const speed = 1 - (y - surface) / (h - surface);
        dot(x, y, speed > 0.7 ? '#ffff44' : speed > 0.35 ? '#44ffff' : '#4466ff', 1.2);
      }
      break;
    case PresetName.Swarm:
      for (let f = 0; f < 3; f++) {
        const cx = 20 + f * 34;
        const cy = 18 + random() * 34;
        for (let i = 0; i < 26; i++) {
          const x = cx + (random() - 0.5) * 26;
          const y = cy + (random() - 0.5) * 12 + (x - cx) * 0.3;
          ctx.strokeStyle = color(f) + '66';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - 5, y - 1.5);
          ctx.lineTo(x, y);
          ctx.stroke();
          dot(x, y, color(f), 1.2);
        }
      }
      break;
    case PresetName.Crystals:
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 13; col++) {
          const x = 8 + col * 8 + (row % 2) * 4;
          const y = 7 + row * 8;
          dot(x, y, color((row + col) % 3), 1.5);
        }
      }
      break;
    case PresetName.Chaos:
      for (let i = 0; i < 220; i++) dot(random() * w, random() * h, color(Math.floor(random() * 5)), 0.6 + random() * 1.2);
      break;
    case PresetName.Orbits:
      for (let ring = 0; ring < 4; ring++) {
        const r = 6 + ring * 7.5;
        for (let i = 0; i < 18 + ring * 10; i++) {
          const a = random() * Math.PI * 2;
          dot(w / 2 + Math.cos(a) * r * 1.5, h / 2 + Math.sin(a) * r, color(ring), 1.2);
        }
      }
      break;
    default:
      for (let i = 0; i < 16; i++) {
        blob(8 + random() * (w - 16), 8 + random() * (h - 16), 5 + random() * 4, 14, color(i % 7));
      }
  }
}
