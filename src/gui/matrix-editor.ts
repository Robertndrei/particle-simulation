import type { InteractionMatrix } from '../types';
import { el, formatNumber } from './components';

/** Spanish names for the default palette, in the same order as DEFAULT_COLORS. */
export const SPECIES_NAMES: readonly string[] = [
  'Rojo', 'Verde', 'Azul', 'Amarillo', 'Magenta',
  'Cian', 'Naranja', 'Violeta', 'Lima', 'Rosa'
];

export function speciesName(index: number): string {
  return SPECIES_NAMES[index] ?? `Especie ${index + 1}`;
}

/**
 * CSS colour for a config colour. Colours can come from loaded files, so
 * anything that is not a number falls back to white instead of reaching HTML.
 */
export function hexColor(color: unknown): string {
  const value = typeof color === 'number' && Number.isFinite(color) ? color : 0xffffff;
  return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

const DRAG_PIXELS_PER_UNIT = 90;
/** Wheel travel (px) per 0.1 step, so trackpad inertia doesn't slam cells to ±1 */
const WHEEL_PIXELS_PER_STEP = 40;
const ATTRACT = '58, 211, 178';
const REPEL = '255, 123, 107';

const INTRO_HTML =
  '<span class="muted">Arrastra una casilla hacia arriba para que la especie de la fila ' +
  '<b class="verb-attract">persiga</b> a la de la columna, o hacia abajo para que ' +
  '<b class="verb-repel">huya</b>.</span>';

/**
 * Visual editor for the interaction matrix. Row = the species that moves,
 * column = the species it reacts to; matrix[row][col] > 0 pulls the row
 * species toward the column species (same convention as the force shader).
 */
export class MatrixEditor {
  readonly element: HTMLElement;
  private grid: HTMLElement;
  private readout: HTMLElement;
  private matrix: InteractionMatrix = [];
  private types = 0;
  private colors: number[] = [];
  private cells: HTMLButtonElement[][] = [];
  private active: { row: number; col: number } | null = null;
  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
    this.element = el('div');
    this.grid = el('div', 'matrix');
    this.grid.setAttribute('role', 'grid');
    this.grid.setAttribute('aria-label', 'Relaciones entre especies');
    this.readout = el('div', 'matrix-readout');
    this.readout.setAttribute('aria-live', 'polite');
    this.readout.innerHTML = INTRO_HTML;

    const legend = el('div', 'legend');
    const chase = el('span', '', 'Persigue');
    chase.style.setProperty('--tone', `rgb(${ATTRACT})`);
    const flee = el('span', '', 'Huye');
    flee.style.setProperty('--tone', `rgb(${REPEL})`);
    const size = el('span', '', 'Más grande, más fuerza');
    size.style.setProperty('--tone', 'var(--ui-muted)');
    legend.append(chase, flee, size);

    this.element.append(this.grid, this.readout, legend);
  }

  /** Rebinds to a (possibly new) matrix array and redraws the grid. */
  bind(matrix: InteractionMatrix, types: number, colors: number[]): void {
    this.matrix = matrix;
    this.types = types;
    this.colors = colors;
    this.build();
  }

  /** Repaints cells after the matrix values changed in place. */
  refresh(): void {
    for (let i = 0; i < this.types; i++) {
      for (let j = 0; j < this.types; j++) this.paintCell(i, j);
    }
    if (this.active) this.describe(this.active.row, this.active.col);
  }

  private build(): void {
    const n = this.types;
    this.grid.replaceChildren();
    this.grid.style.gridTemplateColumns = `18px repeat(${n}, 1fr)`;
    this.cells = [];
    this.active = null;
    this.readout.innerHTML = INTRO_HTML;

    // Header row: column species
    this.grid.append(el('div'));
    for (let j = 0; j < n; j++) this.grid.append(this.dot(j));

    for (let i = 0; i < n; i++) {
      this.grid.append(this.dot(i));
      const row: HTMLButtonElement[] = [];
      for (let j = 0; j < n; j++) {
        const cell = el('button', 'cell');
        cell.type = 'button';
        cell.setAttribute('role', 'gridcell');
        if (i === j) cell.classList.add('is-self');
        this.attachCellEvents(cell, i, j);
        this.grid.append(cell);
        row.push(cell);
      }
      this.cells.push(row);
    }
    this.refresh();
  }

  private dot(index: number): HTMLElement {
    const wrap = el('div', 'matrix-dot');
    wrap.title = speciesName(index);
    const dot = el('span');
    dot.style.setProperty('--dot', hexColor(this.colors[index] ?? 0xffffff));
    wrap.append(dot);
    return wrap;
  }

  private value(i: number, j: number): number {
    return this.matrix[i]?.[j] ?? 0;
  }

  private setValue(i: number, j: number, v: number): void {
    const clamped = Math.max(-1, Math.min(1, Math.round(v * 20) / 20));
    if (clamped === this.value(i, j)) return;
    this.matrix[i][j] = clamped;
    this.paintCell(i, j);
    this.describe(i, j);
    this.onChange();
  }

  private paintCell(i: number, j: number): void {
    const cell = this.cells[i]?.[j];
    if (!cell) return;
    const v = this.value(i, j);
    const magnitude = Math.abs(v);
    const tone = v >= 0 ? ATTRACT : REPEL;
    cell.style.setProperty('--tone', `rgb(${tone})`);
    cell.style.setProperty('--size', `${18 + magnitude * 70}%`);
    cell.style.setProperty('--alpha', magnitude < 0.025 ? '0.25' : String(0.45 + magnitude * 0.55));
    cell.style.background = magnitude < 0.025 ? '' : `rgba(${tone}, ${0.06 + magnitude * 0.14})`;
    cell.setAttribute('aria-label', this.sentenceText(i, j));
  }

  private verb(v: number, self: boolean): { text: string; tone: string } {
    if (v > 0.025) return { text: self ? 'busca a los suyos' : 'persigue a', tone: 'verb-attract' };
    if (v < -0.025) return { text: self ? 'evita a los suyos' : 'huye de', tone: 'verb-repel' };
    return { text: self ? 'ignora a los suyos' : 'ignora a', tone: 'muted' };
  }

  private sentenceText(i: number, j: number): string {
    const v = this.value(i, j);
    const verb = this.verb(v, i === j);
    const target = i === j ? '' : ` ${speciesName(j)}`;
    return `${speciesName(i)} ${verb.text}${target} (${formatNumber(v, 2)})`;
  }

  private describe(i: number, j: number): void {
    const v = this.value(i, j);
    const verb = this.verb(v, i === j);
    const species = (index: number) =>
      `<span class="dot" style="--dot:${hexColor(this.colors[index] ?? 0xffffff)}"></span>` +
      `<b>${speciesName(index)}</b>`;
    const strength = Math.abs(v) < 0.025 ? '' :
      ` <span class="muted">con fuerza ${formatNumber(Math.abs(v), 2)}</span>`;
    this.readout.innerHTML = i === j
      ? `${species(i)} <span class="${verb.tone}">${verb.text}</span>${strength}`
      : `${species(i)} <span class="${verb.tone}">${verb.text}</span> ${species(j)}${strength}`;
  }

  private setActive(i: number, j: number): void {
    if (this.active) this.cells[this.active.row]?.[this.active.col]?.classList.remove('is-active');
    this.active = { row: i, col: j };
    this.cells[i][j].classList.add('is-active');
    this.describe(i, j);
  }

  private attachCellEvents(cell: HTMLButtonElement, i: number, j: number): void {
    let drag: { y: number; start: number } | null = null;

    cell.addEventListener('pointerenter', () => {
      if (!this.active || !drag) this.describe(i, j);
    });
    cell.addEventListener('pointerleave', () => {
      if (!drag && this.active) this.describe(this.active.row, this.active.col);
    });
    cell.addEventListener('focus', () => this.setActive(i, j));

    cell.addEventListener('pointerdown', (e) => {
      cell.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, start: this.value(i, j) };
      this.setActive(i, j);
    });
    cell.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.setValue(i, j, drag.start + (drag.y - e.clientY) / DRAG_PIXELS_PER_UNIT);
    });
    const end = () => { drag = null; };
    cell.addEventListener('pointerup', end);
    cell.addEventListener('pointercancel', end);

    cell.addEventListener('dblclick', () => this.setValue(i, j, 0));
    let wheelTravel = 0;
    cell.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setActive(i, j);
      wheelTravel += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
      const steps = Math.trunc(wheelTravel / WHEEL_PIXELS_PER_STEP);
      if (steps === 0) return;
      wheelTravel -= steps * WHEEL_PIXELS_PER_STEP;
      this.setValue(i, j, this.value(i, j) - steps * 0.1);
    }, { passive: false });
    cell.addEventListener('keydown', (e) => {
      const n = this.types;
      const focus = (r: number, c: number) => this.cells[(r + n) % n][(c + n) % n].focus();
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          if (e.shiftKey) focus(i - 1, j); else this.setValue(i, j, this.value(i, j) + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (e.shiftKey) focus(i + 1, j); else this.setValue(i, j, this.value(i, j) - 0.1);
          break;
        case 'ArrowLeft': e.preventDefault(); focus(i, j - 1); break;
        case 'ArrowRight': e.preventDefault(); focus(i, j + 1); break;
        case '0': case 'Delete': case 'Backspace': this.setValue(i, j, 0); break;
      }
    });
  }
}
