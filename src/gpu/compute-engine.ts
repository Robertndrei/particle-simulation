/**
 * WebGPU Compute Engine for particle physics simulation
 * Runs entire physics simulation on GPU for massive parallelism
 */

import type { WorkerConfig, InteractionMatrix } from '../types';
import { MouseMode } from '../types';
import { PHYSICS_SHADER } from './shaders';

// Particle data layout: x, y, vx, vy, type (5 floats per particle)
const FLOATS_PER_PARTICLE = 5;
const BYTES_PER_PARTICLE = FLOATS_PER_PARTICLE * 4;

// Config uniform layout (must match WGSL struct exactly)
const CONFIG_SIZE_BYTES = 32 * 4; // 32 floats for uniform alignment

interface GPUBuffers {
  particlesA: GPUBuffer;
  particlesB: GPUBuffer;
  config: GPUBuffer;
  interactionMatrix: GPUBuffer;
  staging: GPUBuffer;
}

interface ComputePipeline {
  pipeline: GPUComputePipeline;
  bindGroupA: GPUBindGroup;
  bindGroupB: GPUBindGroup;
}

export class WebGPUComputeEngine {
  private device: GPUDevice;
  private buffers: GPUBuffers | null = null;
  private pipeline: ComputePipeline | null = null;
  private particleCount: number = 0;
  private useBufferA: boolean = true;
  private workgroupSize: number = 256;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /**
   * Initialize buffers and pipeline for given particle count
   */
  async initialize(
    particleCount: number,
    particleTypes: number,
    initialData: Float32Array
  ): Promise<void> {
    this.particleCount = particleCount;

    // Create particle buffers (double buffered)
    const particleBufferSize = particleCount * BYTES_PER_PARTICLE;

    const particlesA = this.device.createBuffer({
      size: particleBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    });
    new Float32Array(particlesA.getMappedRange()).set(initialData);
    particlesA.unmap();

    const particlesB = this.device.createBuffer({
      size: particleBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    // Config uniform buffer
    const config = this.device.createBuffer({
      size: CONFIG_SIZE_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // Interaction matrix buffer
    const matrixSize = particleTypes * particleTypes * 4;
    const interactionMatrix = this.device.createBuffer({
      size: matrixSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // Staging buffer for reading back results
    const staging = this.device.createBuffer({
      size: particleBufferSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    this.buffers = { particlesA, particlesB, config, interactionMatrix, staging };

    // Create compute pipeline
    await this.createPipeline();
  }

  private async createPipeline(): Promise<void> {
    if (!this.buffers) return;

    const shaderModule = this.device.createShaderModule({
      code: PHYSICS_SHADER
    });

    // Check for shader compilation errors
    const compilationInfo = await shaderModule.getCompilationInfo();
    for (const message of compilationInfo.messages) {
      const msgType = message.type;
      const logFn = msgType === 'error' ? console.error : console.warn;
      logFn(`WGSL ${msgType}: ${message.message}`);
      if (message.lineNum) {
        logFn(`  at line ${message.lineNum}:${message.linePos}`);
      }
    }
    if (compilationInfo.messages.some(m => m.type === 'error')) {
      console.error('Shader compilation failed!');
      return;
    }

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });

    const pipeline = await this.device.createComputePipelineAsync({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Create bind groups for ping-pong buffering
    const bindGroupA = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.buffers.particlesA } },
        { binding: 1, resource: { buffer: this.buffers.particlesB } },
        { binding: 2, resource: { buffer: this.buffers.config } },
        { binding: 3, resource: { buffer: this.buffers.interactionMatrix } }
      ]
    });

    const bindGroupB = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.buffers.particlesB } },
        { binding: 1, resource: { buffer: this.buffers.particlesA } },
        { binding: 2, resource: { buffer: this.buffers.config } },
        { binding: 3, resource: { buffer: this.buffers.interactionMatrix } }
      ]
    });

    this.pipeline = { pipeline, bindGroupA, bindGroupB };
  }

  /**
   * Update interaction matrix on GPU
   */
  updateInteractionMatrix(matrix: InteractionMatrix, particleTypes: number): void {
    if (!this.buffers) return;

    const data = new Float32Array(particleTypes * particleTypes);
    for (let i = 0; i < particleTypes; i++) {
      for (let j = 0; j < particleTypes; j++) {
        data[i * particleTypes + j] = matrix[i]?.[j] ?? 0;
      }
    }

    this.device.queue.writeBuffer(this.buffers.interactionMatrix, 0, data);
  }

  /**
   * Update configuration on GPU
   */
  updateConfig(config: WorkerConfig, mouseX: number, mouseY: number): void {
    if (!this.buffers) return;

    // Map MouseMode to numeric values for shader
    let mouseModeValue = 0;
    switch (config.mouseMode) {
      case MouseMode.Repel: mouseModeValue = 1; break;
      case MouseMode.Attract: mouseModeValue = 2; break;
      case MouseMode.Vortex: mouseModeValue = 3; break;
    }

    // Create config data matching WGSL struct layout
    const data = new Float32Array(32);
    data[0] = this.particleCount;                     // particleCount (as f32, will be cast)
    data[1] = config.particleTypes;                   // particleTypes
    data[2] = config.worldWidth;                      // worldWidth
    data[3] = config.worldHeight;                     // worldHeight
    data[4] = config.attraction;                      // attraction
    data[5] = config.repulsion;                       // repulsion
    data[6] = config.interactionRadius;               // interactionRadius
    data[7] = config.minDistance;                     // minDistance
    data[8] = config.softness;                        // softness
    data[9] = config.drag;                            // drag
    data[10] = config.maxSpeed;                       // maxSpeed
    data[11] = config.interFriction;                  // interFriction
    data[12] = config.gravityEnabled ? 1 : 0;         // gravityEnabled
    data[13] = config.gravityX;                       // gravityX
    data[14] = config.gravityY;                       // gravityY
    data[15] = config.noiseEnabled ? 1 : 0;           // noiseEnabled
    data[16] = config.noiseStrength;                  // noiseStrength
    data[17] = config.wrapEdges ? 1 : 0;              // wrapEdges
    data[18] = mouseModeValue;                        // mouseMode
    data[19] = mouseX;                                // mouseX
    data[20] = mouseY;                                // mouseY
    data[21] = config.mouseRadius;                    // mouseRadius
    data[22] = config.mouseStrength;                  // mouseStrength
    data[23] = 1.0;                                   // deltaTime
    data[24] = Math.random();                         // randomSeed
    // Padding to align to 128 bytes (32 floats)

    this.device.queue.writeBuffer(this.buffers.config, 0, data);
  }

  /**
   * Run one physics simulation step on GPU
   */
  step(): void {
    if (!this.buffers || !this.pipeline) return;

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();

    passEncoder.setPipeline(this.pipeline.pipeline);
    passEncoder.setBindGroup(0, this.useBufferA ? this.pipeline.bindGroupA : this.pipeline.bindGroupB);

    // Dispatch compute shader
    const workgroupCount = Math.ceil(this.particleCount / this.workgroupSize);
    passEncoder.dispatchWorkgroups(workgroupCount);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);

    // Swap buffers
    this.useBufferA = !this.useBufferA;
  }

  /**
   * Read particle data back from GPU (async)
   */
  async readParticles(): Promise<Float32Array> {
    if (!this.buffers) return new Float32Array(0);

    const sourceBuffer = this.useBufferA ? this.buffers.particlesA : this.buffers.particlesB;

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
      sourceBuffer, 0,
      this.buffers.staging, 0,
      this.particleCount * BYTES_PER_PARTICLE
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await this.buffers.staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(this.buffers.staging.getMappedRange().slice(0));
    this.buffers.staging.unmap();

    return data;
  }

  /**
   * Update particles on GPU from CPU data
   */
  updateParticles(data: Float32Array): void {
    if (!this.buffers) return;

    const targetBuffer = this.useBufferA ? this.buffers.particlesA : this.buffers.particlesB;
    this.device.queue.writeBuffer(targetBuffer, 0, data);
  }

  /**
   * Get current particle buffer for direct rendering
   */
  getCurrentBuffer(): GPUBuffer | null {
    if (!this.buffers) return null;
    return this.useBufferA ? this.buffers.particlesA : this.buffers.particlesB;
  }

  /**
   * Cleanup GPU resources
   */
  destroy(): void {
    if (this.buffers) {
      this.buffers.particlesA.destroy();
      this.buffers.particlesB.destroy();
      this.buffers.config.destroy();
      this.buffers.interactionMatrix.destroy();
      this.buffers.staging.destroy();
      this.buffers = null;
    }
    this.pipeline = null;
  }
}
