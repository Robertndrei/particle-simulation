/**
 * Mouse interaction mode with particles
 */
export enum MouseMode {
  None = 'none',
  Repel = 'repel',
  Attract = 'attract'
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
  Ready = 'ready',
  Positions = 'positions'
}
