import { MouseMode } from '../types';
import type { SimulationConfig, InteractionMatrix } from '../types';

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
 * Creates the default simulation configuration
 */
export function createDefaultConfig(): SimulationConfig {
  return {
    // Particles
    particlesPerType: 1000,
    particleTypes: 2,
    particleRadius: 4,

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

    // Mouse
    mouseMode: MouseMode.None,
    mouseRadius: 150,
    mouseStrength: 2,

    // World
    worldWidth: window.innerWidth,
    worldHeight: window.innerHeight,
    wrapEdges: false,

    // Colors
    colors: [...DEFAULT_COLORS],

    // Actions (will be assigned later)
    reset: () => {},
    randomizeForces: () => {}
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
