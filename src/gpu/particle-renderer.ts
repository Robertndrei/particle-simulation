/**
 * WebGPU particle renderer. Draws instanced quads straight from the compute
 * engine's storage buffer, so 100k+ particles never touch the CPU.
 */

import type { SimulationConfig } from '../types';
import { ColorMode } from '../types';
import { VELOCITY_COLORS } from '../config/defaults';
import { PARTICLE_RENDER_SHADER, FULLSCREEN_SHADER, VIEW_SIZE_BYTES } from './shaders';

const BACKGROUND = { r: 0x11 / 255, g: 0x11 / 255, b: 0x11 / 255, a: 1 };
const MIN_RADIUS_PX = 1.25;
const MAX_PIXEL_RATIO = 2;
// Float trails: with 8 bits a slow fade (alpha 0.02) rounds back to the same
// value near the background and leaves a permanent grey haze
const TRAIL_FORMAT: GPUTextureFormat = 'rgba16float';

export class WebGPUParticleRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;

  private particlePipeline: GPURenderPipeline;
  private trailParticlePipeline: GPURenderPipeline;
  private particleLayout: GPUBindGroupLayout;
  private fadePipeline: GPURenderPipeline;
  private blitPipeline: GPURenderPipeline;
  private viewBuffer: GPUBuffer;
  private fadeBuffer: GPUBuffer;
  private sampler: GPUSampler;
  private viewData = new ArrayBuffer(VIEW_SIZE_BYTES);
  private viewU32 = new Uint32Array(this.viewData);
  private viewF32 = new Float32Array(this.viewData);

  private particleGroups = new WeakMap<GPUBuffer, GPUBindGroup>();
  private fadeGroup: GPUBindGroup;

  // Persistent texture that accumulates trails between frames
  private trailTexture: GPUTexture | null = null;
  private trailBlitGroup: GPUBindGroup | null = null;
  private trailNeedsClear = true;

  constructor(device: GPUDevice) {
    this.device = device;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'gpu-canvas';
    this.canvas.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 0;
    `;

    const context = this.canvas.getContext('webgpu');
    if (!context) throw new Error('Unable to create WebGPU canvas context');
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });

    const particleModule = device.createShaderModule({ label: 'particles', code: PARTICLE_RENDER_SHADER });
    const fullscreenModule = device.createShaderModule({ label: 'fullscreen', code: FULLSCREEN_SHADER });

    // Shared layout so one bind group works for both target formats
    this.particleLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
      ]
    });
    const particleLayout = device.createPipelineLayout({ bindGroupLayouts: [this.particleLayout] });
    const particlePipeline = (format: GPUTextureFormat) => device.createRenderPipeline({
      label: `particles-${format}`,
      layout: particleLayout,
      vertex: { module: particleModule, entryPoint: 'vs' },
      fragment: {
        module: particleModule,
        entryPoint: 'fs',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' }
    });
    this.particlePipeline = particlePipeline(this.format);
    this.trailParticlePipeline = particlePipeline(TRAIL_FORMAT);

    this.fadePipeline = device.createRenderPipeline({
      label: 'trail-fade',
      layout: 'auto',
      vertex: { module: fullscreenModule, entryPoint: 'vs' },
      fragment: {
        module: fullscreenModule,
        entryPoint: 'fade',
        targets: [{
          format: TRAIL_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
          }
        }]
      }
    });

    this.blitPipeline = device.createRenderPipeline({
      label: 'trail-blit',
      layout: 'auto',
      vertex: { module: fullscreenModule, entryPoint: 'vs' },
      fragment: { module: fullscreenModule, entryPoint: 'blit', targets: [{ format: this.format }] }
    });

    this.viewBuffer = device.createBuffer({
      size: VIEW_SIZE_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.fadeBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.fadeGroup = device.createBindGroup({
      layout: this.fadePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.fadeBuffer } }]
    });
    this.sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

    this.handleResize();
  }

  getDomElement(): HTMLCanvasElement {
    return this.canvas;
  }

  handleResize(): void {
    const ratio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    this.canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
    this.canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
    this.trailTexture?.destroy();
    this.trailTexture = null;
    this.trailBlitGroup = null;
  }

  /** Clears accumulated trails (e.g. after a reset or a camera jump). */
  clearTrails(): void {
    this.trailNeedsClear = true;
  }

  private ensureTrailTexture(): GPUTexture {
    if (!this.trailTexture) {
      this.trailTexture = this.device.createTexture({
        size: [this.canvas.width, this.canvas.height],
        format: TRAIL_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
      });
      this.trailBlitGroup = this.device.createBindGroup({
        layout: this.blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: this.trailTexture.createView() },
          { binding: 2, resource: this.sampler }
        ]
      });
      this.trailNeedsClear = true;
    }
    return this.trailTexture;
  }

  private particleGroup(buffer: GPUBuffer): GPUBindGroup {
    let group = this.particleGroups.get(buffer);
    if (!group) {
      group = this.device.createBindGroup({
        layout: this.particleLayout,
        entries: [
          { binding: 0, resource: { buffer } },
          { binding: 1, resource: { buffer: this.viewBuffer } }
        ]
      });
      this.particleGroups.set(buffer, group);
    }
    return group;
  }

  private writeView(config: SimulationConfig): void {
    const f = this.viewF32;
    const u = this.viewU32;
    f[0] = config.panX;
    f[1] = config.panY;
    f[2] = window.innerWidth;
    f[3] = window.innerHeight;
    f[4] = config.zoom;
    f[5] = config.particleRadius;
    f[6] = MIN_RADIUS_PX;
    u[7] = config.colorMode === ColorMode.Velocity ? 1 : 0;
    f[8] = config.maxSpeed;
    f[9] = config.velocityColorScale;
    u[10] = config.particleSizeByVelocity ? 1 : 0;
    f[11] = config.particleSizeMultiplier;

    const writeColor = (offset: number, hex: number) => {
      f[offset] = ((hex >> 16) & 0xff) / 255;
      f[offset + 1] = ((hex >> 8) & 0xff) / 255;
      f[offset + 2] = (hex & 0xff) / 255;
      f[offset + 3] = 1;
    };
    for (let i = 0; i < 10; i++) writeColor(12 + i * 4, config.colors[i] ?? 0xffffff);
    for (let i = 0; i < 6; i++) writeColor(52 + i * 4, VELOCITY_COLORS[i]);

    this.device.queue.writeBuffer(this.viewBuffer, 0, this.viewData);
  }

  /**
   * Renders the current particle buffer to the canvas.
   */
  render(particles: GPUBuffer | null, count: number, config: SimulationConfig): void {
    this.writeView(config);
    const encoder = this.device.createCommandEncoder();
    const canvasView = this.context.getCurrentTexture().createView();

    const drawParticles = (pass: GPURenderPassEncoder, pipeline: GPURenderPipeline) => {
      if (!particles || count === 0) return;
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.particleGroup(particles));
      pass.draw(6, count);
    };

    if (config.trailsEnabled) {
      const trailView = this.ensureTrailTexture().createView();
      const clear = this.trailNeedsClear;
      this.trailNeedsClear = false;

      const fade = 1 - config.trailLength;
      this.device.queue.writeBuffer(
        this.fadeBuffer, 0, new Float32Array([BACKGROUND.r, BACKGROUND.g, BACKGROUND.b, fade])
      );

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: trailView,
          clearValue: BACKGROUND,
          loadOp: clear ? 'clear' : 'load',
          storeOp: 'store'
        }]
      });
      pass.setPipeline(this.fadePipeline);
      pass.setBindGroup(0, this.fadeGroup);
      pass.draw(3);
      drawParticles(pass, this.trailParticlePipeline);
      pass.end();

      const blit = encoder.beginRenderPass({
        colorAttachments: [{ view: canvasView, loadOp: 'clear', clearValue: BACKGROUND, storeOp: 'store' }]
      });
      blit.setPipeline(this.blitPipeline);
      blit.setBindGroup(0, this.trailBlitGroup!);
      blit.draw(3);
      blit.end();
    } else {
      this.trailNeedsClear = true;
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: canvasView, loadOp: 'clear', clearValue: BACKGROUND, storeOp: 'store' }]
      });
      drawParticles(pass, this.particlePipeline);
      pass.end();
    }

    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.trailTexture?.destroy();
    this.viewBuffer.destroy();
    this.fadeBuffer.destroy();
    this.canvas.remove();
  }
}
