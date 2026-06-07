/**
 * Mouse interaction mode with particles
 */
export enum MouseMode {
  None = 'none',
  Repel = 'repel',
  Attract = 'attract',
  Vortex = 'vortex',
  Spawn = 'spawn',
  Obstacle = 'obstacle',
  Inspect = 'inspect'
}

/**
 * Message types sent to/from the Web Worker
 */
export enum WorkerMessageType {
  Init = 'init',
  Update = 'update',
  UpdateConfig = 'updateConfig',
  UpdateMatrix = 'updateMatrix',
  UpdateMouse = 'updateMouse',
  AddParticles = 'addParticles',
  UpdateAttractors = 'updateAttractors',
  UpdateObstacles = 'updateObstacles',
  Ready = 'ready',
  Positions = 'positions',
  Stats = 'stats'
}

/**
 * Visual effect modes
 */
export enum ColorMode {
  Type = 'type',
  Velocity = 'velocity',
  Cluster = 'cluster'
}

/**
 * Attractor type
 */
export enum AttractorType {
  Attractor = 'attractor',
  Repulsor = 'repulsor',
  Vortex = 'vortex'
}

/**
 * Preset names
 */
export enum PresetName {
  Default = 'default',
  Galaxy = 'galaxy',
  Life = 'life',
  Fluid = 'fluid',
  Swarm = 'swarm',
  Crystals = 'crystals',
  Chaos = 'chaos',
  Orbits = 'orbits'
}
