/**
 * Small DOM building blocks for the control panel. Every control reads and
 * writes the config through get/set closures and exposes `sync()` so the
 * panel can refresh it when the config changes from elsewhere (wheel zoom,
 * presets, audio modulation, loading a file).
 */

export interface Control {
  element: HTMLElement;
  sync: () => void;
}

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export const ICONS = {
  species: `<svg ${SVG_ATTRS}><circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="12" cy="17" r="3"/></svg>`,
  physics: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M6.5 6.5l1.8 1.8M15.7 15.7l1.8 1.8M6.5 17.5l1.8-1.8M15.7 8.3l1.8-1.8"/></svg>`,
  world: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>`,
  more: `<svg ${SVG_ATTRS}><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>`,
  explore: `<svg ${SVG_ATTRS}><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>`,
  attract: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="2.5"/><path d="M3 12h4M17 12h4M12 3v4M12 17v4"/><path d="M5.5 10.5L7 12l-1.5 1.5M18.5 10.5L17 12l1.5 1.5M10.5 5.5L12 7l1.5-1.5M10.5 18.5L12 17l1.5 1.5"/></svg>`,
  repel: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="2.5"/><path d="M4 12h4M16 12h4M12 4v4M12 16v4"/><path d="M5.5 10.5L4 12l1.5 1.5M18.5 10.5L20 12l-1.5 1.5M10.5 5.5L12 4l1.5 1.5M10.5 18.5L12 20l1.5-1.5"/></svg>`,
  vortex: `<svg ${SVG_ATTRS}><path d="M12 12a1.5 1.5 0 1 1 1.5 1.5A3 3 0 1 1 15 9a4.5 4.5 0 1 1-6.4 6.4A6 6 0 1 1 18 6.5"/></svg>`,
  spawn: `<svg ${SVG_ATTRS}><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/><circle cx="12" cy="12" r="1.5"/><circle cx="6" cy="6" r="1"/><circle cx="18" cy="18" r="1"/><circle cx="18" cy="6" r="1"/></svg>`,
  wall: `<svg ${SVG_ATTRS}><path d="M4 19L19 4"/><path d="M7 21l-3-3M20 7l-3-3"/></svg>`,
  pause: `<svg ${SVG_ATTRS}><path d="M9 5v14M15 5v14"/></svg>`,
  play: `<svg ${SVG_ATTRS}><path d="M8 5l11 7-11 7z"/></svg>`,
  reset: `<svg ${SVG_ATTRS}><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/></svg>`,
  fit: `<svg ${SVG_ATTRS}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  plus: `<svg ${SVG_ATTRS}><path d="M12 5v14M5 12h14"/></svg>`,
  minus: `<svg ${SVG_ATTRS}><path d="M5 12h14"/></svg>`,
  hide: `<svg ${SVG_ATTRS}><path d="M9 6l6 6-6 6"/></svg>`,
  sliders: `<svg ${SVG_ATTRS}><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>`,
  dice: `<svg ${SVG_ATTRS}><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/></svg>`,
  mirror: `<svg ${SVG_ATTRS}><path d="M12 3v18"/><path d="M8 7l-4 5 4 5M16 7l4 5-4 5"/></svg>`,
  chain: `<svg ${SVG_ATTRS}><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/></svg>`,
  self: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/></svg>`,
  clear: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg>`,
  camera: `<svg ${SVG_ATTRS}><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  record: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`,
  download: `<svg ${SVG_ATTRS}><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>`,
  upload: `<svg ${SVG_ATTRS}><path d="M12 20V9M7 14l5-5 5 5M5 4h14"/></svg>`,
  table: `<svg ${SVG_ATTRS}><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 10v9"/></svg>`
} as const;

export type IconName = keyof typeof ICONS;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function icon(name: IconName): string {
  return ICONS[name];
}

const numberFormats = new Map<number, Intl.NumberFormat>();

/** Spanish number formatting with a fixed number of decimals. */
export function formatNumber(value: number, decimals = 0): string {
  let format = numberFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true
    });
    numberFormats.set(decimals, format);
  }
  return format.format(value);
}

function decimalsOf(step: number): number {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

/** Group with a title and an optional one-line explanation. */
export function group(title: string, intro?: string, workerOnly = false): HTMLElement {
  const section = el('section', 'group');
  if (workerOnly) section.dataset.workerOnly = '';
  section.append(el('h3', 'group-title', title));
  if (intro) section.append(el('p', 'group-intro', intro));
  return section;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (value: number) => void;
  /** Fires while dragging */
  onInput?: () => void;
  /** Fires on release (use for expensive changes such as a reset) */
  onCommit?: () => void;
  format?: (value: number) => string;
  /** Plain-language captions for both ends of the track */
  ends?: [string, string];
  hint?: string;
  tone?: 'attract' | 'repel';
}

export interface SliderControl extends Control {
  setRange: (min: number, max: number) => void;
}

export function slider(options: SliderOptions): SliderControl {
  const root = el('div', 'ctl');
  const id = `ctl-${Math.random().toString(36).slice(2, 9)}`;
  const head = el('div', 'ctl-head');
  const label = el('label', 'ctl-label', options.label);
  label.htmlFor = id;
  const value = el('output', 'ctl-value');
  head.append(label, value);
  root.append(head);

  if (options.hint) {
    const hint = el('div', 'ctl-hint');
    hint.append(el('span', '', options.hint));
    root.append(hint);
  }

  const input = el('input', 'range');
  input.type = 'range';
  input.id = id;
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  if (options.tone) input.dataset.tone = options.tone;
  root.append(input);

  if (options.ends) {
    const ends = el('div', 'ctl-ends');
    ends.append(el('span', '', options.ends[0]), el('span', '', options.ends[1]));
    root.append(ends);
  }

  const decimals = decimalsOf(options.step);
  const format = options.format ?? ((v: number) => formatNumber(v, decimals));
  let dragging = false;

  const paint = (v: number) => {
    const min = Number(input.min);
    const max = Number(input.max);
    const pct = max > min ? ((Math.min(Math.max(v, min), max) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--pct', `${pct}%`);
    value.textContent = format(v);
  };

  input.addEventListener('pointerdown', () => {
    dragging = true;
    window.addEventListener('pointerup', () => { dragging = false; }, { once: true });
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    options.set(v);
    paint(v);
    options.onInput?.();
  });
  input.addEventListener('change', () => {
    options.onCommit?.();
  });

  const sync = () => {
    if (dragging) return;
    const v = options.get();
    input.value = String(v);
    paint(v);
  };
  sync();

  return {
    element: root,
    sync,
    setRange(min: number, max: number) {
      input.min = String(min);
      input.max = String(max);
      sync();
    }
  };
}

export interface ToggleOptions {
  label: string;
  get: () => boolean;
  set: (value: boolean) => void;
  onChange?: () => void;
  hint?: string;
  /** Controls revealed only while the toggle is on */
  children?: Control[];
}

export function toggle(options: ToggleOptions): Control {
  const root = el('div', 'ctl');
  const button = el('button', 'switch-row');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.append(el('span', 'ctl-label', options.label), el('span', 'switch'));
  root.append(button);

  if (options.hint) {
    const hint = el('div', 'ctl-hint');
    hint.append(el('span', '', options.hint));
    root.append(hint);
  }

  const childBox = el('div', 'toggle-children');
  const children = options.children ?? [];
  if (children.length) {
    childBox.append(...children.map(c => c.element));
    root.append(childBox);
  }

  const sync = () => {
    const on = options.get();
    button.setAttribute('aria-checked', String(on));
    childBox.hidden = !on;
    children.forEach(c => c.sync());
  };

  button.addEventListener('click', () => {
    options.set(!options.get());
    sync();
    options.onChange?.();
  });

  sync();
  return { element: root, sync };
}

export interface SegmentedOptions<T extends string | boolean> {
  label?: string;
  choices: { value: T; label: string }[];
  get: () => T;
  set: (value: T) => void;
  onChange?: () => void;
  hint?: string;
}

export function segmented<T extends string | boolean>(options: SegmentedOptions<T>): Control {
  const root = el('div', 'ctl');
  if (options.label) {
    const head = el('div', 'ctl-head');
    head.append(el('span', 'ctl-label', options.label));
    root.append(head);
  }
  if (options.hint) {
    const hint = el('div', 'ctl-hint');
    hint.append(el('span', '', options.hint));
    root.append(hint);
  }
  const bar = el('div', 'segmented');
  bar.setAttribute('role', 'radiogroup');
  if (options.label) bar.setAttribute('aria-label', options.label);

  const buttons = options.choices.map(choice => {
    const b = el('button', '', choice.label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      options.set(choice.value);
      sync();
      options.onChange?.();
    });
    bar.append(b);
    return { b, value: choice.value };
  });
  root.append(bar);

  const sync = () => {
    const current = options.get();
    for (const { b, value } of buttons) b.setAttribute('aria-checked', String(value === current));
  };
  sync();
  return { element: root, sync };
}

export function button(
  label: string,
  iconName: IconName | null,
  onClick: () => void,
  className = 'btn'
): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.innerHTML = iconName ? icon(iconName) : '';
  b.append(el('span', '', label));
  b.addEventListener('click', onClick);
  return b;
}

export function iconButton(label: string, iconName: IconName, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'icon-button');
  b.type = 'button';
  b.innerHTML = icon(iconName);
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

/** Wraps any element as a control that never needs syncing. */
export function staticControl(element: HTMLElement): Control {
  return { element, sync: () => {} };
}

export interface PadOptions {
  /** Maximum magnitude on each axis at the pad's edge */
  range: number;
  get: () => { x: number; y: number };
  set: (x: number, y: number) => void;
  isEnabled: () => boolean;
  onChange?: () => void;
}

const DIRECTIONS = ['derecha', 'arriba a la derecha', 'arriba', 'arriba a la izquierda',
  'izquierda', 'abajo a la izquierda', 'abajo', 'abajo a la derecha'];

/**
 * 2D direction pad (gravity). Drag the knob; double-click centres it.
 * Screen up is world +Y.
 */
export function directionPad(options: PadOptions): Control {
  const root = el('div', 'pad-wrap');
  const pad = el('div', 'pad');
  pad.tabIndex = 0;
  pad.setAttribute('role', 'slider');
  pad.setAttribute('aria-label', 'Dirección y fuerza de la gravedad');
  const knob = el('div', 'pad-knob');
  pad.append(knob);
  const text = el('div', 'pad-text');
  root.append(pad, text);

  const paint = () => {
    const { x, y } = options.get();
    const r = options.range;
    knob.style.left = `${50 + (x / r) * 50}%`;
    knob.style.top = `${50 - (y / r) * 50}%`;
    pad.classList.toggle('is-off', !options.isEnabled());
    const strength = Math.hypot(x, y);
    if (strength < 0.005) {
      text.innerHTML = '<b>Sin dirección</b>Arrastra el punto para elegir hacia dónde caen.';
    } else {
      const angle = Math.atan2(y, x);
      const index = Math.round(((angle + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8;
      text.innerHTML = `<b>Hacia ${DIRECTIONS[index]}</b>Fuerza ${formatNumber(strength, 2)}. Doble clic para centrar.`;
    }
    pad.setAttribute('aria-valuetext', text.textContent ?? '');
  };

  const setFromPointer = (e: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    let nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    let ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const len = Math.hypot(nx, ny);
    if (len > 1) { nx /= len; ny /= len; }
    const round = (v: number) => Math.round(v * options.range * 100) / 100;
    options.set(round(nx), round(ny));
    paint();
    options.onChange?.();
  };

  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    setFromPointer(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (pad.hasPointerCapture(e.pointerId)) setFromPointer(e);
  });
  pad.addEventListener('dblclick', () => {
    options.set(0, 0);
    paint();
    options.onChange?.();
  });
  pad.addEventListener('keydown', (e) => {
    const step = options.range / 10;
    const { x, y } = options.get();
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step]
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    const clamp = (v: number) => Math.max(-options.range, Math.min(options.range, Math.round(v * 100) / 100));
    options.set(clamp(x + move[0]), clamp(y + move[1]));
    paint();
    options.onChange?.();
  });

  paint();
  return { element: root, sync: paint };
}
