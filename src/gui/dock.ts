import type { SimulationConfig } from '../types';
import { MouseMode } from '../types';
import type { Control, IconName } from './components';
import { el, icon, iconButton, slider, formatNumber } from './components';
import { hexColor, speciesName } from './matrix-editor';

interface Tool {
  mode: MouseMode;
  label: string;
  icon: IconName;
  key: string;
  workerOnly?: boolean;
}

export const TOOLS: Tool[] = [
  { mode: MouseMode.Inspect, label: 'Explorar', icon: 'explore', key: '1' },
  { mode: MouseMode.Attract, label: 'Atraer', icon: 'attract', key: '2' },
  { mode: MouseMode.Repel, label: 'Repeler', icon: 'repel', key: '3' },
  { mode: MouseMode.Vortex, label: 'Remolino', icon: 'vortex', key: '4' },
  { mode: MouseMode.Spawn, label: 'Sembrar', icon: 'spawn', key: '5' },
  { mode: MouseMode.Obstacle, label: 'Muro', icon: 'wall', key: '6', workerOnly: true }
];

const PAN_HINT = 'Para mover la vista, arrastra con la rueda pulsada.';

export interface DockCallbacks {
  onConfigChange: () => void;
  onFitView: () => void;
  onZoomBy: (factor: number) => void;
}

/**
 * Floating HUD (top left), tool dock (bottom centre) with contextual tool
 * options, and zoom control (bottom left).
 */
export class Dock {
  private config: SimulationConfig;
  private callbacks: DockCallbacks;
  private toolButtons = new Map<MouseMode, HTMLButtonElement>();
  private options: HTMLElement;
  private pauseButton: HTMLButtonElement;
  private zoomOutput: HTMLOutputElement;
  private optionControls: Control[] = [];
  private renderedMode: MouseMode | null = null;
  private renderedSpawnTypes = 0;
  private backend: HTMLElement;
  private nodes: HTMLElement[];

  constructor(config: SimulationConfig, callbacks: DockCallbacks) {
    this.config = config;
    this.callbacks = callbacks;

    // HUD: keeps the ids main.ts writes to
    const hud = el('div', 'ui hud');
    hud.setAttribute('aria-live', 'off');
    const fps = el('span', 'hud-stat');
    fps.innerHTML = '<b id="fps">0</b> <span>fps</span>';
    const count = el('span', 'hud-stat');
    count.innerHTML = '<b id="count">0</b> <span>partículas</span>';
    this.backend = el('span', 'hud-backend', 'Iniciando…');
    const status = el('span', 'hud-hidden');
    status.id = 'worker-status';
    hud.append(fps, count, this.backend, status);

    // Dock
    const wrap = el('div', 'ui dock-wrap');
    this.options = el('div', 'tool-options');
    const dock = el('div', 'dock');
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'Herramientas del ratón');

    for (const tool of TOOLS) {
      const b = el('button', 'tool');
      b.type = 'button';
      b.innerHTML = icon(tool.icon);
      b.append(el('span', '', tool.label));
      b.title = `${tool.label} (${tool.key})`;
      if (tool.workerOnly) b.dataset.workerOnly = '';
      b.addEventListener('click', () => this.selectTool(tool.mode));
      dock.append(b);
      this.toolButtons.set(tool.mode, b);
    }

    dock.append(el('div', 'dock-sep'));
    this.pauseButton = el('button', 'tool');
    this.pauseButton.type = 'button';
    this.pauseButton.addEventListener('click', () => this.togglePause());
    const resetButton = el('button', 'tool');
    resetButton.type = 'button';
    resetButton.innerHTML = icon('reset');
    resetButton.append(el('span', '', 'Reiniciar'));
    resetButton.title = 'Reiniciar partículas (R)';
    resetButton.addEventListener('click', () => this.config.reset());
    dock.append(this.pauseButton, resetButton);
    wrap.append(this.options, dock);

    // Zoom
    const zoom = el('div', 'ui zoom');
    zoom.setAttribute('aria-label', 'Zoom');
    this.zoomOutput = el('output');
    zoom.append(
      iconButton('Alejar', 'minus', () => this.callbacks.onZoomBy(1 / 1.5)),
      this.zoomOutput,
      iconButton('Acercar', 'plus', () => this.callbacks.onZoomBy(1.5)),
      iconButton('Ver todo el mundo (F)', 'fit', () => this.callbacks.onFitView())
    );

    this.nodes = [hud, wrap, zoom];
    document.body.append(...this.nodes);
    this.sync();
  }

  dispose(): void {
    this.nodes.forEach(node => node.remove());
  }

  setBackend(backend: 'webgpu' | 'worker'): void {
    this.backend.dataset.state = backend;
    this.backend.textContent = backend === 'webgpu' ? 'WebGPU' : 'CPU';
    this.backend.title = backend === 'webgpu'
      ? 'La física y el dibujo corren en la tarjeta gráfica'
      : 'Tu navegador no tiene WebGPU: la física corre en el procesador (máx. 7.000 partículas)';
    // Walls only act in the worker; fall back to exploring
    if (backend === 'webgpu' && this.config.mouseMode === MouseMode.Obstacle) {
      this.selectTool(MouseMode.Inspect);
    }
  }

  selectTool(mode: MouseMode): void {
    this.config.mouseMode = mode;
    this.callbacks.onConfigChange();
    this.sync();
  }

  /** Rebuilds the tool options (e.g. after species colours changed). */
  refreshOptions(): void {
    this.renderedMode = null;
    this.sync();
  }

  togglePause(): void {
    this.config.paused = !this.config.paused;
    this.sync();
  }

  private renderOptions(): void {
    const mode = this.config.mouseMode;
    this.options.replaceChildren();
    this.optionControls = [];
    this.renderedMode = mode;
    this.renderedSpawnTypes = this.config.particleTypes;
    this.options.hidden = false;

    if (mode === MouseMode.Attract || mode === MouseMode.Repel || mode === MouseMode.Vortex) {
      this.optionControls = [
        slider({
          label: 'Radio', min: 50, max: 400, step: 10,
          get: () => this.config.mouseRadius,
          set: v => { this.config.mouseRadius = v; },
          onInput: this.callbacks.onConfigChange
        }),
        slider({
          label: 'Fuerza', min: 0.5, max: 10, step: 0.5,
          get: () => this.config.mouseStrength,
          set: v => { this.config.mouseStrength = v; },
          onInput: this.callbacks.onConfigChange
        })
      ];
      this.options.append(...this.optionControls.map(c => c.element), el('span', '', PAN_HINT));
    } else if (mode === MouseMode.Spawn) {
      this.options.append(el('span', '', 'Haz clic para sembrar 10 partículas de'));
      for (let i = 0; i < this.config.particleTypes; i++) {
        const b = el('button', 'swatch');
        b.type = 'button';
        b.style.setProperty('--swatch', hexColor(this.config.colors[i] ?? 0xffffff));
        b.title = speciesName(i);
        b.setAttribute('aria-label', speciesName(i));
        b.addEventListener('click', () => {
          this.config.spawnType = i;
          this.callbacks.onConfigChange();
          this.syncSpawn();
        });
        this.options.append(b);
      }
      this.syncSpawn();
    } else if (mode === MouseMode.Inspect) {
      this.options.append(el('span', '',
        'Haz clic en una partícula para seguirla. Arrastra para moverte y usa la rueda para el zoom.'));
    } else if (mode === MouseMode.Obstacle) {
      this.options.append(el('span', '', 'Arrastra para dibujar un muro. ' + PAN_HINT));
    } else {
      this.options.hidden = true;
    }
  }

  private syncSpawn(): void {
    this.options.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b, i) => {
      b.setAttribute('aria-pressed', String(i === this.config.spawnType));
    });
  }

  sync(): void {
    const mode = this.config.mouseMode;
    for (const [m, b] of this.toolButtons) b.setAttribute('aria-pressed', String(m === mode));
    if (mode !== this.renderedMode || this.config.particleTypes !== this.renderedSpawnTypes) {
      this.renderOptions();
    } else {
      this.optionControls.forEach(c => c.sync());
    }

    const paused = this.config.paused;
    if (this.pauseButton.getAttribute('aria-pressed') !== String(paused)) this.paintPause(paused);

    this.zoomOutput.textContent = formatZoom(this.config.zoom);
  }

  private paintPause(paused: boolean): void {
    this.pauseButton.innerHTML = icon(paused ? 'play' : 'pause');
    this.pauseButton.append(el('span', '', paused ? 'Seguir' : 'Pausa'));
    this.pauseButton.title = `${paused ? 'Seguir' : 'Pausar'} (espacio)`;
    this.pauseButton.setAttribute('aria-pressed', String(paused));
  }
}

/** Zoom as a percentage with two significant digits (works down to 1e-9). */
function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  if (pct >= 10) return `${formatNumber(pct)} %`;
  const decimals = Math.min(12, Math.max(0, 1 - Math.floor(Math.log10(pct))));
  return `${formatNumber(pct, decimals)} %`;
}
