/**
 * WebGPU module exports
 */

export { detectWebGPU, canRunParticleCount } from './webgpu-detect';
export type { WebGPUCapabilities } from './webgpu-detect';
export { WebGPUComputeEngine } from './compute-engine';
export { PHYSICS_SHADER, PHYSICS_SHADER_SPATIAL, SPATIAL_HASH_SHADER } from './shaders';
