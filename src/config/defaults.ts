import { MouseMode, ColorMode, PresetName } from '../types';
import type { SimulationConfig, InteractionMatrix, SimulationPreset } from '../types';

/**
 * Predefined colors for each particle type (up to 10 types)
 */
export const DEFAULT_COLORS: readonly number[] = [
  0xff4466, // Red
  0x44ff66, // Green
  0x4466ff, // Blue
  0xffff44, // Yellow
  0xff44ff, // Magenta
  0x44ffff, // Cyan
  0xff8844, // Orange
  0x8844ff, // Purple
  0x88ff44, // Lime
  0xff4488  // Pink
] as const;

/**
 * Color names for the GUI
 */
export const COLOR_NAMES: readonly string[] = [
  'Red',
  'Green',
  'Blue',
  'Yellow',
  'Magenta',
  'Cyan',
  'Orange',
  'Purple',
  'Lime',
  'Pink'
] as const;

/**
 * Velocity color gradient (blue -> green -> yellow -> red)
 */
export const VELOCITY_COLORS: readonly number[] = [
  0x4466ff, // Low speed - Blue
  0x44ffff, // Cyan
  0x44ff66, // Green
  0xffff44, // Yellow
  0xff8844, // Orange
  0xff4466  // High speed - Red
] as const;

/**
 * Creates the default simulation configuration
 */
export function createDefaultConfig(): SimulationConfig {
  return {
    // Particles
    particlesPerType: 1000,
    particleTypes: 2,
    particleRadius: 4,
    particleSizeByVelocity: false,
    particleSizeMultiplier: 1.5,

    // Physics - Forces
    attraction: 0.03,
    repulsion: 0.03,
    interactionRadius: 200,

    // Physics - Collisions
    minDistance: 62,
    softness: 0.65,

    // Physics - Movement
    drag: 0.15,
    maxSpeed: 5,
    interFriction: 0.1,

    // Physics - Global forces
    gravityEnabled: false,
    gravityX: 0,
    gravityY: -0.1,

    // Optional effects
    noiseEnabled: false,
    noiseStrength: 0.1,
    trailsEnabled: false,
    trailLength: 0.9,
    radiationEnabled: false,
    radiationRate: 0.001,
    radiationSpeed: 20,
    windEnabled: false,
    windStrength: 0.05,
    windCount: 3,
    windChangeSpeed: 0.02,

    // Visual effects
    bloomEnabled: false,
    bloomStrength: 1.5,
    bloomRadius: 0.4,
    bloomThreshold: 0.6,
    connectionsEnabled: false,
    connectionDistance: 50,
    connectionOpacity: 0.3,
    colorMode: ColorMode.Type,
    velocityColorScale: 1.0,

    // Mouse
    mouseMode: MouseMode.Inspect,
    mouseRadius: 150,
    mouseStrength: 2,
    spawnType: 0,

    // World
    worldWidth: window.innerWidth,
    worldHeight: window.innerHeight,
    wrapEdges: false,

    // Camera
    zoom: 1,
    panX: 0,
    panY: 0,

    // Colors
    colors: [...DEFAULT_COLORS],

    // Attractors and obstacles
    attractors: [],
    obstacles: [],

    // Analysis
    showStats: false,
    showHeatmap: false,
    heatmapOpacity: 0.5,
    showEnergyGraph: false,
    detectClusters: false,

    // Audio
    audioEnabled: false,
    audioSensitivity: 1.0,
    audioSmoothing: 0.8,

    // Actions (will be assigned later)
    reset: () => {},
    randomizeForces: () => {},
    saveConfig: () => {},
    loadConfig: () => {},
    applyPreset: () => {},
    takeScreenshot: () => {},
    startRecording: () => {},
    stopRecording: () => {},
    exportData: () => {},
    clearAttractors: () => {},
    clearObstacles: () => {}
  };
}

/**
 * Creates the initial interaction matrix
 * By default: particles of the same type attract (1), different types don't interact (0)
 */
export function createInteractionMatrix(particleTypes: number): InteractionMatrix {
  const matrix: InteractionMatrix = [];
  for (let i = 0; i < particleTypes; i++) {
    matrix[i] = [];
    for (let j = 0; j < particleTypes; j++) {
      matrix[i][j] = i === j ? 1 : 0;
    }
  }
  return matrix;
}

/**
 * Generates a random interaction matrix
 */
export function randomizeInteractionMatrix(matrix: InteractionMatrix): void {
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      matrix[i][j] = Math.random() * 2 - 1;
    }
  }
}

/**
 * Simulation presets for interesting behaviors
 */
export const PRESETS: Record<PresetName, SimulationPreset> = {
  [PresetName.Default]: {
    name: 'Default',
    description: 'Basic particle simulation',
    config: {
      particlesPerType: 1000,
      particleTypes: 2,
      attraction: 0.03,
      repulsion: 0.03,
      interactionRadius: 200,
      minDistance: 62,
      softness: 0.65,
      drag: 0.15,
      maxSpeed: 5
    }
  },
  [PresetName.Galaxy]: {
    name: 'Galaxy',
    description: 'Spiral galaxy formation',
    config: {
      particlesPerType: 500,
      particleTypes: 4,
      attraction: 0.05,
      repulsion: 0.01,
      interactionRadius: 300,
      minDistance: 20,
      softness: 0.3,
      drag: 0.02,
      maxSpeed: 8,
      gravityEnabled: false,
      noiseEnabled: true,
      noiseStrength: 0.05,
      trailsEnabled: true,
      trailLength: 0.95,
      bloomEnabled: true,
      bloomStrength: 2.0
    },
    matrix: [
      [1, 0.5, 0.3, 0.1],
      [0.5, 1, 0.5, 0.3],
      [0.3, 0.5, 1, 0.5],
      [0.1, 0.3, 0.5, 1]
    ]
  },
  [PresetName.Life]: {
    name: 'Life',
    description: 'Emergent life-like behavior',
    config: {
      particlesPerType: 400,
      particleTypes: 6,
      attraction: 0.02,
      repulsion: 0.04,
      interactionRadius: 150,
      minDistance: 30,
      softness: 0.5,
      drag: 0.1,
      maxSpeed: 4,
      wrapEdges: true
    },
    matrix: [
      [1, 0.3, -0.5, 0.2, -0.3, 0.1],
      [-0.3, 1, 0.4, -0.2, 0.3, -0.4],
      [0.5, -0.4, 1, 0.3, -0.2, 0.4],
      [-0.2, 0.2, -0.3, 1, 0.5, -0.3],
      [0.3, -0.3, 0.2, -0.5, 1, 0.2],
      [-0.1, 0.4, -0.4, 0.3, -0.2, 1]
    ]
  },
  [PresetName.Fluid]: {
    name: 'Fluid',
    description: 'Liquid-like behavior',
    config: {
      particlesPerType: 2000,
      particleTypes: 1,
      attraction: 0.02,
      repulsion: 0.05,
      interactionRadius: 80,
      minDistance: 25,
      softness: 0.8,
      drag: 0.05,
      maxSpeed: 6,
      interFriction: 0.3,
      gravityEnabled: true,
      gravityX: 0,
      gravityY: -0.15,
      colorMode: ColorMode.Velocity,
      velocityColorScale: 0.5
    }
  },
  [PresetName.Swarm]: {
    name: 'Swarm',
    description: 'Swarming behavior like birds or fish',
    config: {
      particlesPerType: 800,
      particleTypes: 3,
      attraction: 0.04,
      repulsion: 0.02,
      interactionRadius: 120,
      minDistance: 40,
      softness: 0.4,
      drag: 0.08,
      maxSpeed: 7,
      noiseEnabled: true,
      noiseStrength: 0.15,
      windEnabled: true,
      windCount: 2,
      windStrength: 0.03,
      trailsEnabled: true,
      trailLength: 0.85
    },
    matrix: [
      [0.8, 0.3, -0.2],
      [0.3, 0.8, 0.3],
      [-0.2, 0.3, 0.8]
    ]
  },
  [PresetName.Crystals]: {
    name: 'Crystals',
    description: 'Crystalline structures',
    config: {
      particlesPerType: 600,
      particleTypes: 3,
      attraction: 0.06,
      repulsion: 0.02,
      interactionRadius: 100,
      minDistance: 50,
      softness: 0.9,
      drag: 0.2,
      maxSpeed: 3,
      interFriction: 0.5
    },
    matrix: [
      [1, -0.5, 0.5],
      [-0.5, 1, -0.5],
      [0.5, -0.5, 1]
    ]
  },
  [PresetName.Chaos]: {
    name: 'Chaos',
    description: 'Chaotic particle behavior',
    config: {
      particlesPerType: 500,
      particleTypes: 5,
      attraction: 0.05,
      repulsion: 0.05,
      interactionRadius: 250,
      minDistance: 40,
      softness: 0.3,
      drag: 0.05,
      maxSpeed: 10,
      noiseEnabled: true,
      noiseStrength: 0.2,
      radiationEnabled: true,
      radiationRate: 0.002,
      radiationSpeed: 15,
      bloomEnabled: true,
      bloomStrength: 1.5,
      colorMode: ColorMode.Velocity
    }
  },
  [PresetName.Orbits]: {
    name: 'Orbits',
    description: 'Orbital mechanics',
    config: {
      particlesPerType: 300,
      particleTypes: 4,
      attraction: 0.08,
      repulsion: 0.01,
      interactionRadius: 400,
      minDistance: 15,
      softness: 0.2,
      drag: 0.01,
      maxSpeed: 12,
      trailsEnabled: true,
      trailLength: 0.98,
      bloomEnabled: true,
      bloomStrength: 2.5,
      particleRadius: 3
    },
    matrix: [
      [0.2, 1, 0.8, 0.6],
      [-0.3, 0.2, 1, 0.8],
      [-0.5, -0.3, 0.2, 1],
      [-0.7, -0.5, -0.3, 0.2]
    ]
  }
};

/**
 * Gets a preset by name
 */
export function getPreset(name: PresetName): SimulationPreset {
  return PRESETS[name];
}

/**
 * Applies a preset to the current configuration
 */
export function applyPresetToConfig(
  config: SimulationConfig,
  preset: SimulationPreset
): void {
  Object.assign(config, preset.config);
}

/**
 * Serializes configuration for saving (excludes functions)
 */
export function serializeConfig(config: SimulationConfig): string {
  const {
    reset, randomizeForces, saveConfig, loadConfig, applyPreset,
    takeScreenshot, startRecording, stopRecording, exportData,
    clearAttractors, clearObstacles,
    ...serializableConfig
  } = config;
  return JSON.stringify(serializableConfig, null, 2);
}

/**
 * Deserializes configuration from saved data
 */
export function deserializeConfig(json: string): Partial<SimulationConfig> {
  try {
    return JSON.parse(json);
  } catch {
    console.error('Failed to parse config JSON');
    return {};
  }
}
