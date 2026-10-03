import './styles.css';
import type { SimulationConfig, InteractionMatrix } from '../types';
import { ColorMode, MouseMode, PresetName } from '../types';
import type { Control } from './components';
import {
  el, icon, group, slider, toggle, segmented, button, iconButton,
  directionPad, formatNumber
} from './components';
import { MatrixEditor, hexColor, speciesName } from './matrix-editor';
import { ForceDiagram } from './force-diagram';
import { PRESET_INFO, drawPresetThumbnail } from './preset-thumbnails';
import { Dock, TOOLS } from './dock';

/**
 * Callbacks for GUI events
 */
export interface GUICallbacks {
  onConfigChange: () => void;
  onMatrixChange: () => void;
  onReset: () => void;
  onAttractorsChange?: () => void;
  onObstaclesChange?: () => void;
  onFitView?: () => void;
  /** Zoom around the centre of the screen */
  onZoomBy?: (factor: number) => void;
  /** Colours or particle size changed (the CPU renderer must rebuild its meshes) */
  onAppearanceChange?: () => void;
}

/** Upper bound for the total particle slider (WebGPU backend). */
export const MAX_TOTAL_PARTICLES = 200000;
const WORKER_MAX_TOTAL = 7000;
const MAX_TYPES = 10;
const SYNC_INTERVAL_MS = 250;
const NARROW_SCREEN = '(max-width: 760px)';

type TabId = 'species' | 'physics' | 'world' | 'more';

const TABS: { id: TabId; label: string; icon: 'species' | 'physics' | 'world' | 'more' }[] = [
  { id: 'species', label: 'Especies', icon: 'species' },
  { id: 'physics', label: 'Física', icon: 'physics' },
  { id: 'world', label: 'Mundo', icon: 'world' },
  { id: 'more', label: 'Más', icon: 'more' }
];

/**
 * Control panel: tabs for species, physics, world and extras, plus the
 * floating tool dock. Everything is described in plain language; the
 * technical config names stay internal.
 */
export class GUIController {
  private config: SimulationConfig;
  private callbacks: GUICallbacks;
  private controls: Control[] = [];
  private panel: HTMLElement;
  private subtitle: HTMLElement;
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private pages = new Map<TabId, HTMLElement>();
  private matrix: InteractionMatrix;
  private matrixEditor: MatrixEditor;
  private diagram = new ForceDiagram();
  private dock: Dock;
  private presetCards = new Map<PresetName, { button: HTMLButtonElement; canvas: HTMLCanvasElement }>();
  private activePreset: PresetName | null = PresetName.Default;
  private speciesRow!: HTMLElement;
  private totalNumber!: HTMLElement;
  private typesOutput!: HTMLOutputElement;
  private totalSlider!: ReturnType<typeof slider>;
  private velocityScale!: Control;
  private recordButton!: HTMLButtonElement;
  private recording = false;
  private syncTimer: number;
  private renderedColorsKey = '';
  private listeners: [string, EventListener][] = [];

  constructor(
    config: SimulationConfig,
    interactionMatrix: InteractionMatrix,
    callbacks: GUICallbacks
  ) {
    this.config = config;
    this.callbacks = callbacks;
    this.matrix = interactionMatrix;
    this.matrixEditor = new MatrixEditor(() => this.callbacks.onMatrixChange());

    const root = el('div', 'ui');
    this.panel = el('aside', 'panel');
    this.panel.setAttribute('aria-label', 'Controles de la simulación');

    // Header
    const header = el('header', 'panel-header');
    const title = el('h2', 'panel-title', 'Simulación');
    this.subtitle = el('small');
    title.append(this.subtitle);
    header.append(title, iconButton('Ocultar panel (H)', 'hide', () => this.setCollapsed(true)));

    // Tabs
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    const body = el('div', 'panel-body');
    for (const tab of TABS) {
      const b = el('button', 'tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.innerHTML = icon(tab.icon);
      b.append(el('span', '', tab.label));
      b.addEventListener('click', () => this.selectTab(tab.id));
      tabs.append(b);
      this.tabButtons.set(tab.id, b);

      const page = el('div', 'tab-page');
      page.setAttribute('role', 'tabpanel');
      this.pages.set(tab.id, page);
      body.append(page);
    }

    this.buildSpecies(this.pages.get('species')!);
    this.buildPhysics(this.pages.get('physics')!);
    this.buildWorld(this.pages.get('world')!);
    this.buildMore(this.pages.get('more')!);

    this.panel.append(header, tabs, body);

    const reopen = el('button', 'panel-open');
    reopen.type = 'button';
    reopen.innerHTML = icon('sliders');
    reopen.append(el('span', '', 'Controles'));
    reopen.title = 'Mostrar panel (H)';
    reopen.addEventListener('click', () => this.setCollapsed(false));

    root.append(this.panel, reopen);
    document.body.append(root);

    this.dock = new Dock(config, {
      onConfigChange: () => this.callbacks.onConfigChange(),
      onFitView: () => this.callbacks.onFitView?.(),
      onZoomBy: (factor) => this.callbacks.onZoomBy?.(factor)
    });

    this.selectTab('species');
    if (window.matchMedia(NARROW_SCREEN).matches) this.setCollapsed(true);
    this.setupShortcuts();
    this.updateInteractionControls(config, interactionMatrix);

    this.syncTimer = window.setInterval(() => {
      if (!document.hidden) this.updateDisplay();
    }, SYNC_INTERVAL_MS);
  }

  // ---------------------------------------------------------------- tabs

  private selectTab(id: TabId): void {
    for (const [tabId, b] of this.tabButtons) b.setAttribute('aria-selected', String(tabId === id));
    for (const [tabId, page] of this.pages) page.hidden = tabId !== id;
    if (id === 'physics') requestAnimationFrame(() => this.diagram.draw(this.config));
  }

  private setCollapsed(collapsed: boolean): void {
    this.panel.classList.toggle('is-collapsed', collapsed);
    // Hidden controls must not be reachable with Tab
    this.panel.inert = collapsed;
  }

  private add(parent: HTMLElement, ...controls: Control[]): void {
    for (const control of controls) {
      this.controls.push(control);
      parent.append(control.element);
    }
  }

  // ---------------------------------------------------------- species tab

  private buildSpecies(page: HTMLElement): void {
    const config = this.config;

    // Presets
    const start = group('Punto de partida', 'Elige una receta para empezar con un comportamiento conocido.');
    const presets = el('div', 'presets');
    for (const name of Object.values(PresetName)) {
      const info = PRESET_INFO[name];
      const card = el('button', 'preset');
      card.type = 'button';
      const canvas = el('canvas');
      card.append(canvas, el('span', 'preset-name', info.name), el('span', 'preset-desc', info.description));
      card.addEventListener('click', () => {
        this.activePreset = name;
        config.applyPreset(name);
        this.updateDisplay();
      });
      presets.append(card);
      this.presetCards.set(name, { button: card, canvas });
    }
    start.append(presets);

    // Population
    const population = group('Población');
    const row = el('div', 'population');
    this.totalNumber = el('div', 'big-number');
    const stepper = el('div', 'stepper');
    stepper.setAttribute('aria-label', 'Número de especies');
    this.typesOutput = el('output');
    stepper.append(
      iconButton('Quitar una especie', 'minus', () => this.changeTypes(-1)),
      this.typesOutput,
      iconButton('Añadir una especie', 'plus', () => this.changeTypes(1))
    );
    row.append(this.totalNumber, stepper);
    population.append(row);

    this.totalSlider = slider({
      label: 'Cantidad de partículas',
      min: 1000, max: MAX_TOTAL_PARTICLES, step: 1000,
      get: () => config.particlesPerType * config.particleTypes,
      set: v => { config.particlesPerType = Math.max(1, Math.round(v / config.particleTypes)); },
      onInput: () => this.syncPopulation(),
      onCommit: () => this.callbacks.onReset(),
      ends: ['Pocas', 'Muchísimas'],
      hint: 'Al soltar se reparten de nuevo. Con WebGPU, 100.000 se mueven con fluidez.'
    });
    this.add(population, this.totalSlider);

    this.speciesRow = el('div', 'species-row');
    population.append(this.speciesRow);

    // Relationships
    const relations = group(
      'Relaciones',
      'Quién persigue a quién. Cada fila es una especie y cada columna, la especie a la que reacciona.'
    );
    relations.append(this.matrixEditor.element);
    const actions = el('div', 'btn-row');
    actions.append(
      button('Al azar', 'dice', () => config.randomizeForces()),
      button('Simétricas', 'mirror', () => this.transformMatrix('symmetric')),
      button('En cadena', 'chain', () => this.transformMatrix('chain')),
      button('Solo los suyos', 'self', () => this.transformMatrix('self')),
      button('Neutras', 'clear', () => this.transformMatrix('clear'))
    );
    relations.append(actions);

    page.append(start, population, relations);
  }

  private changeTypes(delta: number): void {
    const types = Math.max(1, Math.min(MAX_TYPES, this.config.particleTypes + delta));
    if (types === this.config.particleTypes) return;
    const total = this.config.particlesPerType * this.config.particleTypes;
    this.config.particleTypes = types;
    this.config.particlesPerType = Math.max(1, Math.round(total / types));
    this.activePreset = null;
    this.callbacks.onReset();
  }

  private syncPopulation(): void {
    const total = this.config.particlesPerType * this.config.particleTypes;
    const types = this.config.particleTypes;
    this.totalNumber.innerHTML = `${formatNumber(total)}<small>partículas</small>`;
    this.typesOutput.textContent = `${types} ${types === 1 ? 'especie' : 'especies'}`;
    this.subtitle.textContent =
      `${types} ${types === 1 ? 'especie' : 'especies'}, ${formatNumber(total)} partículas`;
  }

  private renderSpecies(): void {
    this.speciesRow.replaceChildren();
    for (let i = 0; i < this.config.particleTypes; i++) {
      const swatch = el('label', 'swatch');
      swatch.style.setProperty('--swatch', hexColor(this.config.colors[i] ?? 0xffffff));
      swatch.title = `${speciesName(i)}: clic para cambiar el color`;
      const input = el('input');
      input.type = 'color';
      input.value = hexColor(this.config.colors[i] ?? 0xffffff);
      input.setAttribute('aria-label', `Color de ${speciesName(i)}`);
      input.addEventListener('input', () => {
        this.config.colors[i] = parseInt(input.value.slice(1), 16);
        swatch.style.setProperty('--swatch', input.value);
        this.matrixEditor.bind(this.matrix, this.config.particleTypes, this.config.colors);
        this.dock.refreshOptions();
        this.callbacks.onAppearanceChange?.();
      });
      swatch.append(input);
      this.speciesRow.append(swatch);
    }
  }

  private transformMatrix(kind: 'symmetric' | 'chain' | 'self' | 'clear'): void {
    const m = this.matrix;
    const n = this.config.particleTypes;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (kind === 'symmetric') {
          if (j > i) {
            const avg = Math.round(((m[i][j] + m[j][i]) / 2) * 20) / 20;
            m[i][j] = avg;
            m[j][i] = avg;
          }
        } else if (kind === 'chain') {
          // Each species chases the next one and keeps away from the previous
          m[i][j] = i === j ? 0.4 : j === (i + 1) % n ? 0.8 : j === (i - 1 + n) % n ? -0.4 : 0;
        } else if (kind === 'self') {
          m[i][j] = i === j ? 1 : 0;
        } else {
          m[i][j] = 0;
        }
      }
    }
    this.matrixEditor.refresh();
    this.callbacks.onMatrixChange();
  }

  // ---------------------------------------------------------- physics tab

  private buildPhysics(page: HTMLElement): void {
    const config = this.config;
    const change = () => {
      this.callbacks.onConfigChange();
      this.diagram.draw(config);
    };

    const forces = group(
      'Fuerzas',
      'Cómo empuja una partícula a otra según la distancia que las separa.'
    );
    forces.append(this.diagram.element);
    this.add(forces,
      slider({
        label: 'Espacio personal', min: 5, max: 500, step: 1,
        get: () => config.minDistance, set: v => { config.minDistance = v; }, onInput: change,
        ends: ['Pegadas', 'Separadas'],
        hint: 'Más cerca que esto chocan y se empujan, sea cual sea la relación.'
      }),
      slider({
        label: 'Alcance', min: 50, max: 1000, step: 5,
        get: () => config.interactionRadius, set: v => { config.interactionRadius = v; }, onInput: change,
        ends: ['Corto', 'Largo'],
        hint: 'Más lejos que esto no se notan. Un alcance grande forma estructuras más amplias.'
      }),
      slider({
        label: 'Ganas de perseguir', min: 0, max: 0.1, step: 0.001, tone: 'attract',
        get: () => config.attraction, set: v => { config.attraction = v; }, onInput: change,
        format: v => formatNumber(v * 100, 1),
        ends: ['Nada', 'Mucho']
      }),
      slider({
        label: 'Ganas de huir', min: 0, max: 0.1, step: 0.001, tone: 'repel',
        get: () => config.repulsion, set: v => { config.repulsion = v; }, onInput: change,
        format: v => formatNumber(v * 100, 1),
        ends: ['Nada', 'Mucho']
      }),
      slider({
        label: 'Dureza del choque', min: 0.05, max: 1, step: 0.05,
        get: () => config.softness, set: v => { config.softness = v; }, onInput: change,
        ends: ['Blando', 'Duro'],
        hint: 'Con choques blandos se apelotonan; con choques duros mantienen la distancia.'
      })
    );

    const movement = group('Movimiento');
    this.add(movement,
      slider({
        label: 'Viscosidad', min: 0, max: 0.5, step: 0.01,
        get: () => config.drag, set: v => { config.drag = v; }, onInput: change,
        ends: ['Como en hielo', 'Como en miel'],
        hint: 'Cuánto frena el medio. Con poca viscosidad siguen deslizándose mucho tiempo.'
      }),
      slider({
        label: 'Velocidad máxima', min: 1, max: 15, step: 0.5,
        get: () => config.maxSpeed, set: v => { config.maxSpeed = v; }, onInput: change,
        ends: ['Lenta', 'Rápida']
      }),
      slider({
        label: 'Roce al tocarse', min: 0, max: 1, step: 0.05,
        get: () => config.interFriction, set: v => { config.interFriction = v; }, onInput: change,
        ends: ['Resbalan', 'Se arrastran'],
        hint: 'Las partículas en contacto igualan su velocidad, como granos de arena.'
      }),
      toggle({
        label: 'Agitación',
        get: () => config.noiseEnabled, set: v => { config.noiseEnabled = v; }, onChange: change,
        hint: 'Empujones al azar, como el calor. Evita que todo se quede quieto.',
        children: [slider({
          label: 'Temperatura', min: 0, max: 0.5, step: 0.01,
          get: () => config.noiseStrength, set: v => { config.noiseStrength = v; }, onInput: change,
          ends: ['Templado', 'Hirviendo']
        })]
      })
    );

    const gravity = group('Gravedad');
    const pad = directionPad({
      range: 0.5,
      get: () => ({ x: config.gravityX, y: config.gravityY }),
      set: (x, y) => {
        config.gravityX = x;
        config.gravityY = y;
        config.gravityEnabled = true;
      },
      isEnabled: () => config.gravityEnabled,
      onChange: () => {
        this.updateDisplay();
        change();
      }
    });
    this.add(gravity,
      toggle({
        label: 'Activar gravedad',
        get: () => config.gravityEnabled, set: v => { config.gravityEnabled = v; }, onChange: () => {
          pad.sync();
          change();
        }
      }),
      pad
    );

    const extra = group('Efectos extra', 'Disponibles solo cuando la física corre en el procesador.', true);
    this.add(extra,
      toggle({
        label: 'Radiación',
        get: () => config.radiationEnabled, set: v => { config.radiationEnabled = v; }, onChange: change,
        hint: 'De vez en cuando una partícula sale disparada.',
        children: [
          slider({
            label: 'Frecuencia', min: 0.00001, max: 0.01, step: 0.00001,
            get: () => config.radiationRate, set: v => { config.radiationRate = v; }, onInput: change,
            format: v => `${formatNumber(v * 100, 3)} %`, ends: ['Rara', 'Frecuente']
          }),
          slider({
            label: 'Velocidad del disparo', min: 5, max: 500, step: 1,
            get: () => config.radiationSpeed, set: v => { config.radiationSpeed = v; }, onInput: change
          })
        ]
      }),
      toggle({
        label: 'Vientos',
        get: () => config.windEnabled, set: v => { config.windEnabled = v; }, onChange: change,
        hint: 'Corrientes que arrastran a las partículas y cambian con el tiempo.',
        children: [
          slider({
            label: 'Número de corrientes', min: 1, max: 10, step: 1,
            get: () => config.windCount, set: v => { config.windCount = v; }, onInput: change
          }),
          slider({
            label: 'Fuerza', min: 0.01, max: 0.5, step: 0.01,
            get: () => config.windStrength, set: v => { config.windStrength = v; }, onInput: change,
            ends: ['Brisa', 'Vendaval']
          }),
          slider({
            label: 'Rapidez de cambio', min: 0.01, max: 0.2, step: 0.01,
            get: () => config.windChangeSpeed, set: v => { config.windChangeSpeed = v; }, onInput: change,
            ends: ['Estable', 'Racheado']
          })
        ]
      })
    );

    page.append(forces, movement, gravity, extra);
  }

  // ------------------------------------------------------------ world tab

  private buildWorld(page: HTMLElement): void {
    const config = this.config;
    const change = () => this.callbacks.onConfigChange();
    const appearance = () => this.callbacks.onAppearanceChange?.();

    const space = group('Espacio');
    this.add(space,
      slider({
        label: 'Tamaño del mundo', min: 0.25, max: 4, step: 0.05,
        get: () => config.worldScale, set: v => { config.worldScale = v; },
        onCommit: () => this.callbacks.onReset(),
        format: v => `×${formatNumber(v, 2)}`,
        ends: ['Apretado', 'Holgado'],
        hint: 'Crece solo con el número de partículas. Al soltar se reinicia la simulación.'
      }),
      segmented<boolean>({
        label: 'Al llegar al borde',
        choices: [{ value: false, label: 'Rebotan' }, { value: true, label: 'Salen por el otro lado' }],
        get: () => config.wrapEdges, set: v => { config.wrapEdges = v; }, onChange: change
      })
    );

    const look = group('Aspecto');
    this.velocityScale = slider({
      label: 'Sensibilidad del color', min: 0.1, max: 3, step: 0.1,
      get: () => config.velocityColorScale, set: v => { config.velocityColorScale = v; },
      ends: ['Todo rojo', 'Todo azul'],
      hint: 'Azul es lento y rojo es rápido.'
    });
    this.add(look,
      slider({
        label: 'Tamaño de las partículas', min: 1, max: 10, step: 0.5,
        get: () => config.particleRadius, set: v => { config.particleRadius = v; },
        onCommit: appearance,
        ends: ['Polvo', 'Canicas'],
        hint: 'Solo cambia cómo se ven. Al alejarte nunca se hacen más pequeñas que un píxel.'
      }),
      segmented<ColorMode>({
        label: 'Colorear según',
        choices: [
          { value: ColorMode.Type, label: 'Especie' },
          { value: ColorMode.Velocity, label: 'Velocidad' }
        ],
        get: () => config.colorMode, set: v => { config.colorMode = v; }
      }),
      this.velocityScale,
      toggle({
        label: 'Crecen al acelerar',
        get: () => config.particleSizeByVelocity, set: v => { config.particleSizeByVelocity = v; },
        children: [slider({
          label: 'Tamaño a toda velocidad', min: 1, max: 3, step: 0.1,
          get: () => config.particleSizeMultiplier, set: v => { config.particleSizeMultiplier = v; },
          format: v => `×${formatNumber(v, 1)}`
        })]
      }),
      toggle({
        label: 'Estelas',
        get: () => config.trailsEnabled, set: v => { config.trailsEnabled = v; },
        hint: 'Cada partícula deja un rastro que se desvanece.',
        children: [slider({
          label: 'Longitud', min: 0.5, max: 0.99, step: 0.01,
          get: () => config.trailLength, set: v => { config.trailLength = v; },
          format: v => `${formatNumber(v * 100)} %`,
          ends: ['Cortas', 'Largas']
        })]
      })
    );

    const glow = group('Brillo y conexiones', 'Disponibles solo cuando la física corre en el procesador.', true);
    this.add(glow,
      toggle({
        label: 'Brillo',
        get: () => config.bloomEnabled, set: v => { config.bloomEnabled = v; },
        children: [
          slider({
            label: 'Intensidad', min: 0.5, max: 5, step: 0.1,
            get: () => config.bloomStrength, set: v => { config.bloomStrength = v; }
          }),
          slider({
            label: 'Difusión', min: 0.1, max: 1, step: 0.1,
            get: () => config.bloomRadius, set: v => { config.bloomRadius = v; }
          }),
          slider({
            label: 'Umbral', min: 0, max: 1, step: 0.1,
            get: () => config.bloomThreshold, set: v => { config.bloomThreshold = v; },
            ends: ['Todo brilla', 'Solo lo intenso']
          })
        ]
      }),
      toggle({
        label: 'Líneas entre vecinas',
        get: () => config.connectionsEnabled, set: v => { config.connectionsEnabled = v; },
        children: [
          slider({
            label: 'Distancia', min: 10, max: 200, step: 5,
            get: () => config.connectionDistance, set: v => { config.connectionDistance = v; }
          }),
          slider({
            label: 'Opacidad', min: 0.1, max: 1, step: 0.1,
            get: () => config.connectionOpacity, set: v => { config.connectionOpacity = v; },
            format: v => `${formatNumber(v * 100)} %`
          })
        ]
      })
    );

    page.append(space, look, glow);
  }

  // ------------------------------------------------------------- more tab

  private buildMore(page: HTMLElement): void {
    const config = this.config;

    const capture = group('Capturar');
    const captureRow = el('div', 'btn-row');
    this.recordButton = button('Grabar vídeo', 'record', () => this.toggleRecording());
    captureRow.append(
      button('Foto', 'camera', () => config.takeScreenshot()),
      this.recordButton,
      button('Datos (CSV)', 'table', () => config.exportData())
    );
    capture.append(captureRow);

    const files = group('Guardar ajustes', 'Guarda la configuración en un archivo para recuperarla otro día.');
    const filesRow = el('div', 'btn-row');
    filesRow.append(
      button('Guardar', 'download', () => config.saveConfig()),
      button('Abrir', 'upload', () => config.loadConfig())
    );
    files.append(filesRow);

    const music = group('Música');
    this.add(music, toggle({
      label: 'Reaccionar al micrófono',
      get: () => config.audioEnabled, set: v => { config.audioEnabled = v; },
      hint: 'Los graves aumentan las ganas de perseguir y los medios, la agitación. Pedirá permiso para el micrófono.',
      children: [
        slider({
          label: 'Sensibilidad', min: 0.1, max: 3, step: 0.1,
          get: () => config.audioSensitivity, set: v => { config.audioSensitivity = v; }
        }),
        slider({
          label: 'Suavidad', min: 0.1, max: 0.99, step: 0.01,
          get: () => config.audioSmoothing, set: v => { config.audioSmoothing = v; },
          ends: ['Nerviosa', 'Suave']
        })
      ]
    }));

    const analysis = group('Análisis', 'Disponibles solo cuando la física corre en el procesador.', true);
    this.add(analysis,
      toggle({ label: 'Estadísticas', get: () => config.showStats, set: v => { config.showStats = v; } }),
      toggle({ label: 'Gráfica de energía', get: () => config.showEnergyGraph, set: v => { config.showEnergyGraph = v; } }),
      toggle({
        label: 'Mapa de densidad',
        get: () => config.showHeatmap, set: v => { config.showHeatmap = v; },
        children: [slider({
          label: 'Opacidad', min: 0.1, max: 1, step: 0.1,
          get: () => config.heatmapOpacity, set: v => { config.heatmapOpacity = v; },
          format: v => `${formatNumber(v * 100)} %`
        })]
      }),
      toggle({
        label: 'Contar grupos',
        get: () => config.detectClusters, set: v => { config.detectClusters = v; },
        onChange: () => this.callbacks.onConfigChange()
      })
    );
    const clearRow = el('div', 'btn-row');
    clearRow.append(
      button('Quitar atractores', 'clear', () => config.clearAttractors()),
      button('Quitar muros', 'clear', () => config.clearObstacles())
    );
    analysis.append(clearRow);

    const keys = group('Atajos');
    const list = el('dl', 'keys');
    const shortcuts: [string, string, boolean?][] = [
      ['Rueda', 'Acercar o alejar'],
      ['Arrastrar', 'Mover la vista'],
      ['F', 'Ver todo el mundo'],
      ['Espacio', 'Pausar o seguir'],
      ['R', 'Reiniciar'],
      ['1 – 6', 'Elegir herramienta'],
      ['H', 'Ocultar o mostrar este panel'],
      ['P', 'Hacer una foto'],
      ['Esc', 'Dejar de seguir una partícula'],
      ['Clic derecho', 'Poner un atractor (Mayús: repulsor)', true]
    ];
    for (const [key, action, workerOnly] of shortcuts) {
      const dt = el('dt');
      dt.append(el('kbd', '', key));
      const dd = el('dd', '', action);
      if (workerOnly) {
        dt.dataset.workerOnly = '';
        dd.dataset.workerOnly = '';
      }
      list.append(dt, dd);
    }
    keys.append(list);

    page.append(capture, files, music, analysis, keys);
  }

  private toggleRecording(): void {
    this.recording = !this.recording;
    if (this.recording) this.config.startRecording(); else this.config.stopRecording();
    this.recordButton.classList.toggle('is-recording', this.recording);
    this.recordButton.querySelector('span')!.textContent = this.recording ? 'Detener grabación' : 'Grabar vídeo';
  }

  // ------------------------------------------------------------ shortcuts

  private setupShortcuts(): void {
    // Clicking the simulation hands the keyboard back to the shortcuts
    this.listen('pointerdown', (e) => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('.ui') && !(e.target as Element).closest('.ui')) {
        active.blur();
      }
    });

    this.listen('keydown', (event) => {
      const e = event as KeyboardEvent;
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const role = target.getAttribute('role');
      if (e.key === ' ') {
        // Let Space activate focused buttons and switches (grid cells do nothing on click)
        if ((target instanceof HTMLButtonElement && role !== 'gridcell') || role === 'slider') return;
        e.preventDefault();
        this.dock.togglePause();
      } else if (e.key === 'h' || e.key === 'H') {
        this.setCollapsed(!this.panel.classList.contains('is-collapsed'));
      } else {
        const tool = TOOLS.find(t => t.key === e.key);
        const available = tool && (!tool.workerOnly || document.body.dataset.backend === 'worker');
        if (tool && available) this.dock.selectTool(tool.mode);
      }
    });
  }

  private listen(type: string, listener: EventListener): void {
    window.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }

  // ---------------------------------------------------------- public API

  /** Screen width (px) the panel covers on the right, 0 when hidden or docked at the bottom. */
  getPanelInset(): number {
    if (this.panel.classList.contains('is-collapsed') || window.matchMedia(NARROW_SCREEN).matches) return 0;
    return window.innerWidth - this.panel.getBoundingClientRect().left;
  }

  /** Shows only the features the active physics backend supports. */
  setBackend(backend: 'webgpu' | 'worker'): void {
    document.body.dataset.backend = backend;
    this.totalSlider.setRange(1000, backend === 'worker' ? WORKER_MAX_TOTAL : MAX_TOTAL_PARTICLES);
    this.dock.setBackend(backend);
  }

  /**
   * Updates the species-dependent parts (matrix grid, swatches) after the
   * matrix array or the number of types changed.
   */
  updateInteractionControls(
    config: SimulationConfig,
    interactionMatrix: InteractionMatrix
  ): void {
    this.config = config;
    this.matrix = interactionMatrix;
    this.matrixEditor.bind(interactionMatrix, config.particleTypes, config.colors);
    this.renderSpecies();
    this.updateDisplay();
  }

  /**
   * Updates all controls to reflect current config values
   */
  updateDisplay(): void {
    for (const control of this.controls) control.sync();
    this.velocityScale.element.hidden = this.config.colorMode !== ColorMode.Velocity;
    this.syncPopulation();
    this.dock.sync();
    if (!this.pages.get('physics')!.hidden) this.diagram.draw(this.config);

    for (const [name, card] of this.presetCards) {
      card.button.setAttribute('aria-pressed', String(name === this.activePreset));
    }
    const colorsKey = this.config.colors.join(',');
    if (colorsKey !== this.renderedColorsKey) {
      this.renderedColorsKey = colorsKey;
      for (const [name, card] of this.presetCards) drawPresetThumbnail(card.canvas, name, this.config.colors);
      this.dock.refreshOptions();
    }

    // Keep the dock usable if a loaded config selected an unavailable tool
    const wallUnavailable = this.config.mouseMode === MouseMode.Obstacle && document.body.dataset.backend !== 'worker';
    if (this.config.mouseMode === MouseMode.None || wallUnavailable) this.dock.selectTool(MouseMode.Inspect);
  }

  /**
   * Cleans up GUI resources
   */
  dispose(): void {
    window.clearInterval(this.syncTimer);
    for (const [type, listener] of this.listeners) window.removeEventListener(type, listener);
    this.dock.dispose();
    this.panel.parentElement?.remove();
  }
}
