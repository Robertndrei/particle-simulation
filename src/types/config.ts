import { MouseMode, ColorMode, PresetName } from './enums';
import type { Attractor, Obstacle } from './particle';

/**
 * Complete simulation configuration
 */
export interface SimulationConfig {
  // Particles
  particlesPerType: number;
  particleTypes: number;
  particleRadius: number;
  particleSizeByVelocity: boolean;
  particleSizeMultiplier: number;

  // Physics - Forces
  attraction: number;
  repulsion: number;
  interactionRadius: number;

  // Physics - Collisions
  minDistance: number;
  softness: number;

  // Physics - Movement
  drag: number;
  maxSpeed: number;
  interFriction: number;

  // Physics - Global forces
  gravityEnabled: boolean;
  gravityX: number;
  gravityY: number;

  // Effects
  noiseEnabled: boolean;
  noiseStrength: number;
  trailsEnabled: boolean;
  trailLength: number;
  radiationEnabled: boolean;
  radiationRate: number;
  radiationSpeed: number;
  windEnabled: boolean;
  windStrength: number;
  windCount: number;
  windChangeSpeed: number;

  // Visual effects
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  connectionsEnabled: boolean;
  connectionDistance: number;
  connectionOpacity: number;
  colorMode: ColorMode;
  velocityColorScale: number;

  // Mouse
  mouseMode: MouseMode;
  mouseRadius: number;
  mouseStrength: number;
  spawnType: number;

  // World
  worldWidth: number;
  worldHeight: number;
  wrapEdges: boolean;

  // Camera
  zoom: number;
  panX: number;
  panY: number;

  // Colors (hex)
  colors: number[];

  // Attractors and obstacles
  attractors: Attractor[];
  obstacles: Obstacle[];

  // Analysis
  showStats: boolean;
  showHeatmap: boolean;
  heatmapOpacity: number;
  showEnergyGraph: boolean;
  detectClusters: boolean;

  // Audio
  audioEnabled: boolean;
  audioSensitivity: number;
  audioSmoothing: number;

  // Actions (callbacks)
  reset: () => void;
  randomizeForces: () => void;
  saveConfig: () => void;
  loadConfig: () => void;
  applyPreset: (preset: PresetName) => void;
  takeScreenshot: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  exportData: () => void;
  clearAttractors: () => void;
  clearObstacles: () => void;
}

/**
 * Configuration sent to Worker (without functions, colors, or UI-only properties)
 */
export interface WorkerConfig {
  particlesPerType: number;
  particleTypes: number;
  particleRadius: number;
  attraction: number;
  repulsion: number;
  interactionRadius: number;
  minDistance: number;
  softness: number;
  drag: number;
  maxSpeed: number;
  interFriction: number;
  gravityEnabled: boolean;
  gravityX: number;
  gravityY: number;
  noiseEnabled: boolean;
  noiseStrength: number;
  trailsEnabled: boolean;
  trailLength: number;
  radiationEnabled: boolean;
  radiationRate: number;
  radiationSpeed: number;
  windEnabled: boolean;
  windStrength: number;
  windCount: number;
  windChangeSpeed: number;
  mouseMode: MouseMode;
  mouseRadius: number;
  mouseStrength: number;
  spawnType: number;
  worldWidth: number;
  worldHeight: number;
  wrapEdges: boolean;
  detectClusters: boolean;
}

/**
 * Extracts serializable configuration for the worker
 */
export function getWorkerConfig(config: SimulationConfig): WorkerConfig {
  return {
    particlesPerType: config.particlesPerType,
    particleTypes: config.particleTypes,
    particleRadius: config.particleRadius,
    attraction: config.attraction,
    repulsion: config.repulsion,
    interactionRadius: config.interactionRadius,
    minDistance: config.minDistance,
    softness: config.softness,
    drag: config.drag,
    maxSpeed: config.maxSpeed,
    interFriction: config.interFriction,
    gravityEnabled: config.gravityEnabled,
    gravityX: config.gravityX,
    gravityY: config.gravityY,
    noiseEnabled: config.noiseEnabled,
    noiseStrength: config.noiseStrength,
    trailsEnabled: config.trailsEnabled,
    trailLength: config.trailLength,
    radiationEnabled: config.radiationEnabled,
    radiationRate: config.radiationRate,
    radiationSpeed: config.radiationSpeed,
    windEnabled: config.windEnabled,
    windStrength: config.windStrength,
    windCount: config.windCount,
    windChangeSpeed: config.windChangeSpeed,
    mouseMode: config.mouseMode,
    mouseRadius: config.mouseRadius,
    mouseStrength: config.mouseStrength,
    spawnType: config.spawnType,
    worldWidth: config.worldWidth,
    worldHeight: config.worldHeight,
    wrapEdges: config.wrapEdges,
    detectClusters: config.detectClusters
  };
}
