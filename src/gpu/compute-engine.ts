/**
 * WebGPU Compute Engine for particle physics simulation.
 *
 * Particles live in GPU storage buffers for their whole lifetime: the
 * simulation steps entirely on the GPU and the renderer draws straight from
 * the same buffer, so nothing is copied back to the CPU unless explicitly
 * requested (inspector, CSV export).
 */

import type { WorkerConfig, InteractionMatrix } from '../types';
import { MouseMode } from '../types';
import {
  COUNT_SHADER,
  SCAN_SHADER,
  SCATTER_SHADER,
  FORCES_SHADER,
  GRID_TABLE_SIZE,
  PARAMS_SIZE_BYTES,
  WORKGROUP_SIZE
} from './shaders';

// Particle data layout: x, y, vx, vy, type (5 floats per particle)
const FLOATS_PER_PARTICLE = 5;
const BYTES_PER_PARTICLE = FLOATS_PER_PARTICLE * 4;

// Interaction matrix is allocated for the GUI maximum so type changes never reallocate
const MAX_TYPES = 10;

interface GPUBuffers {
  particles: [GPUBuffer, GPUBuffer];
  params: GPUBuffer;
  interactionMatrix: GPUBuffer;
  cellCounts: GPUBuffer;
  cellStart: GPUBuffer;
  cellCursor: GPUBuffer;
  particleCell: GPUBuffer;
  sortedIndices: GPUBuffer;
  staging: GPUBuffer;
}

interface Pipelines {
  count: GPUComputePipeline;
  scan: GPUComputePipeline;
  scatter: GPUComputePipeline;
  forces: GPUComputePipeline;
  // Index = which particle buffer is the input this step
  countGroups: [GPUBindGroup, GPUBindGroup];
  forcesGroups: [GPUBindGroup, GPUBindGroup];
  scanGroup: GPUBindGroup;
  scatterGroup: GPUBindGroup;
}

export class WebGPUComputeEngine {
  private device: GPUDevice;
  private buffers: GPUBuffers | null = null;
  private pipelines: Pipelines | null = null;
  private particleCount = 0;
  private capacity = 0;
  /** Index of the particle buffer holding the latest state. */
  private current = 0;
  /** Bumped on every initialize(); an older call that resumes late is discarded. */
  private generation = 0;
  private paramsData = new ArrayBuffer(PARAMS_SIZE_BYTES);
  private paramsU32 = new Uint32Array(this.paramsData);
  private paramsF32 = new Float32Array(this.paramsData);

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Initialize buffers and pipelines. `capacity` reserves room for particles
   * spawned at runtime.
   */
  async initialize(
    particleCount: number,
    capacity: number,
    initialData: Float32Array<ArrayBuffer>
  ): Promise<void> {
    const generation = ++this.generation;
    this.destroy();
    this.particleCount = particleCount;
    this.capacity = Math.max(capacity, particleCount, 1);
    this.current = 0;

    const storage = GPUBufferUsage.STORAGE;
    const particleBytes = this.capacity * BYTES_PER_PARTICLE;
    const makeParticles = () => this.device.createBuffer({
      size: particleBytes,
      usage: storage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    const particles: [GPUBuffer, GPUBuffer] = [makeParticles(), makeParticles()];
    this.device.queue.writeBuffer(particles[0], 0, initialData);

    const tableBytes = GRID_TABLE_SIZE * 4;
    const buffers: GPUBuffers = {
      particles,
      params: this.device.createBuffer({
        size: PARAMS_SIZE_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      }),
      interactionMatrix: this.device.createBuffer({
        size: MAX_TYPES * MAX_TYPES * 4,
        usage: storage | GPUBufferUsage.COPY_DST
      }),
      cellCounts: this.device.createBuffer({ size: tableBytes, usage: storage | GPUBufferUsage.COPY_DST }),
      cellStart: this.device.createBuffer({ size: tableBytes, usage: storage }),
      cellCursor: this.device.createBuffer({ size: tableBytes, usage: storage }),
      particleCell: this.device.createBuffer({ size: this.capacity * 4, usage: storage }),
      sortedIndices: this.device.createBuffer({ size: this.capacity * 4, usage: storage }),
      staging: this.device.createBuffer({
        size: particleBytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
      })
    };
    this.buffers = buffers;

    // Shader compilation is async: if another initialize() started meanwhile,
    // these buffers are already destroyed and its pipelines must win
    const pipelines = await this.createPipelines(buffers);
    if (generation === this.generation) this.pipelines = pipelines;
  }

  private async compile(label: string, code: string): Promise<GPUComputePipeline> {
    const module = this.device.createShaderModule({ label, code });
    const info = await module.getCompilationInfo();
    for (const message of info.messages) {
      const logFn = message.type === 'error' ? console.error : console.warn;
      logFn(`WGSL ${message.type} (${label}) at ${message.lineNum}:${message.linePos}: ${message.message}`);
    }
    return this.device.createComputePipelineAsync({
      label,
      layout: 'auto',
      compute: { module, entryPoint: 'main' }
    });
  }

  private async createPipelines(b: GPUBuffers): Promise<Pipelines> {
    const [count, scan, scatter, forces] = await Promise.all([
      this.compile('count', COUNT_SHADER),
      this.compile('scan', SCAN_SHADER),
      this.compile('scatter', SCATTER_SHADER),
      this.compile('forces', FORCES_SHADER)
    ]);

    const group = (pipeline: GPUComputePipeline, buffers: GPUBuffer[]) =>
      this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } }))
      });

    const countGroup = (input: GPUBuffer) =>
      group(count, [input, b.params, b.cellCounts, b.particleCell]);
    const forcesGroup = (input: GPUBuffer, output: GPUBuffer) =>
      group(forces, [
        input, output, b.params, b.interactionMatrix,
        b.cellCounts, b.cellStart, b.sortedIndices
      ]);

    return {
      count, scan, scatter, forces,
      countGroups: [countGroup(b.particles[0]), countGroup(b.particles[1])],
      forcesGroups: [
        forcesGroup(b.particles[0], b.particles[1]),
        forcesGroup(b.particles[1], b.particles[0])
      ],
      scanGroup: group(scan, [b.cellCounts, b.cellStart, b.cellCursor]),
      scatterGroup: group(scatter, [b.particleCell, b.cellCursor, b.sortedIndices, b.params])
    };
  }

  /**
   * Update interaction matrix on GPU
   */
  updateInteractionMatrix(matrix: InteractionMatrix, particleTypes: number): void {
    if (!this.buffers) return;

    const data = new Float32Array(MAX_TYPES * MAX_TYPES);
    for (let i = 0; i < particleTypes; i++) {
      for (let j = 0; j < particleTypes; j++) {
        data[i * particleTypes + j] = matrix[i]?.[j] ?? 0;
      }
    }
    this.device.queue.writeBuffer(this.buffers.interactionMatrix, 0, data);
  }

  /**
   * Update simulation parameters on GPU (layout must match `Params` in shaders.ts)
   */
  updateConfig(config: WorkerConfig, mouseX: number, mouseY: number): void {
    if (!this.buffers) return;

    let mouseModeValue = 0;
    switch (config.mouseMode) {
      case MouseMode.Repel: mouseModeValue = 1; break;
      case MouseMode.Attract: mouseModeValue = 2; break;
      case MouseMode.Vortex: mouseModeValue = 3; break;
    }

    const cellSize = Math.max(config.interactionRadius, 1);
    const gridW = Math.max(1, Math.floor(config.worldWidth / cellSize));
    const gridH = Math.max(1, Math.floor(config.worldHeight / cellSize));

    const u = this.paramsU32;
    const f = this.paramsF32;
    u[0] = this.particleCount;
    u[1] = config.particleTypes;
    u[2] = config.wrapEdges ? 1 : 0;
    u[3] = mouseModeValue;
    u[4] = gridW;
    u[5] = gridH;
    u[6] = config.gravityEnabled ? 1 : 0;
    u[7] = config.noiseEnabled ? 1 : 0;
    f[8] = config.worldWidth;
    f[9] = config.worldHeight;
    f[10] = cellSize;
    f[11] = config.worldWidth / gridW;
    f[12] = config.worldHeight / gridH;
    f[13] = config.attraction;
    f[14] = config.repulsion;
    f[15] = config.interactionRadius;
    f[16] = config.minDistance;
    f[17] = config.softness;
    f[18] = config.drag;
    f[19] = config.maxSpeed;
    f[20] = config.interFriction;
    f[21] = config.gravityX;
    f[22] = config.gravityY;
    f[23] = config.noiseStrength;
    f[24] = mouseX;
    f[25] = mouseY;
    f[26] = config.mouseRadius;
    f[27] = config.mouseStrength;
    u[28] = (Math.random() * 0xffffffff) >>> 0;

    this.device.queue.writeBuffer(this.buffers.params, 0, this.paramsData);
  }

  /**
   * Run one physics simulation step on GPU
   */
  step(): void {
    if (!this.buffers || !this.pipelines || this.particleCount === 0) return;
    const p = this.pipelines;
    const particleGroups = Math.ceil(this.particleCount / WORKGROUP_SIZE);

    const encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.buffers.cellCounts);

    const pass = encoder.beginComputePass();
    pass.setPipeline(p.count);
    pass.setBindGroup(0, p.countGroups[this.current]);
    pass.dispatchWorkgroups(particleGroups);

    pass.setPipeline(p.scan);
    pass.setBindGroup(0, p.scanGroup);
    pass.dispatchWorkgroups(1);

    pass.setPipeline(p.scatter);
    pass.setBindGroup(0, p.scatterGroup);
    pass.dispatchWorkgroups(particleGroups);

    pass.setPipeline(p.forces);
    pass.setBindGroup(0, p.forcesGroups[this.current]);
    pass.dispatchWorkgroups(particleGroups);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    this.current = 1 - this.current;
  }

  /**
   * Appends particles (spawned at runtime). Returns how many were added,
   * which can be fewer than requested when the reserved capacity is full.
   */
  addParticles(data: Float32Array<ArrayBuffer>): number {
    if (!this.buffers) return 0;
    const requested = data.length / FLOATS_PER_PARTICLE;
    const added = Math.min(requested, this.capacity - this.particleCount);
    if (added <= 0) return 0;

    this.device.queue.writeBuffer(
      this.buffers.particles[this.current],
      this.particleCount * BYTES_PER_PARTICLE,
      data,
      0,
      added * FLOATS_PER_PARTICLE
    );
    this.particleCount += added;
    return added;
  }

  /**
   * Read particle data back from GPU (async). Only one read may be in flight.
   */
  async readParticles(): Promise<Float32Array> {
    if (!this.buffers) return new Float32Array(0);

    const byteLength = this.particleCount * BYTES_PER_PARTICLE;
    const staging = this.buffers.staging;
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.particles[this.current], 0, staging, 0, byteLength);
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ, 0, byteLength);
    const data = new Float32Array(staging.getMappedRange(0, byteLength).slice(0));
    staging.unmap();
    return data;
  }

  /**
   * Current particle buffer (latest state) for direct rendering
   */
  getCurrentBuffer(): GPUBuffer | null {
    return this.buffers ? this.buffers.particles[this.current] : null;
  }

  getParticleCount(): number {
    return this.particleCount;
  }

  /**
   * Cleanup GPU resources
   */
  destroy(): void {
    if (this.buffers) {
      const b = this.buffers;
      for (const buffer of [
        ...b.particles, b.params, b.interactionMatrix, b.cellCounts,
        b.cellStart, b.cellCursor, b.particleCell, b.sortedIndices, b.staging
      ]) {
        buffer.destroy();
      }
      this.buffers = null;
    }
    this.pipelines = null;
  }
}
