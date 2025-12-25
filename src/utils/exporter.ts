import { PARTICLE_STRIDE, ParticleIndex } from '../types';
import type { SimulationConfig, InteractionMatrix } from '../types';
import { serializeConfig } from '../config/defaults';

/**
 * Export utilities for the simulation
 */
export class Exporter {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;

  /**
   * Takes a screenshot and downloads it
   */
  takeScreenshot(canvas: HTMLCanvasElement): void {
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `particle-simulation-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }

  /**
   * Starts recording the canvas as video
   */
  startRecording(canvas: HTMLCanvasElement): boolean {
    try {
      const stream = canvas.captureStream(30); // 30 FPS
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9'
      });

      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `particle-simulation-${Date.now()}.webm`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      return false;
    }
  }

  /**
   * Stops recording
   */
  stopRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }
  }

  /**
   * Returns whether recording is in progress
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Exports particle data as CSV
   */
  exportParticleData(particleData: Float32Array): void {
    const count = particleData.length / PARTICLE_STRIDE;
    let csv = 'x,y,vx,vy,type\n';

    for (let i = 0; i < count; i++) {
      const idx = i * PARTICLE_STRIDE;
      csv += `${particleData[idx + ParticleIndex.X]},`;
      csv += `${particleData[idx + ParticleIndex.Y]},`;
      csv += `${particleData[idx + ParticleIndex.VX]},`;
      csv += `${particleData[idx + ParticleIndex.VY]},`;
      csv += `${particleData[idx + ParticleIndex.Type]}\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `particle-data-${Date.now()}.csv`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Saves configuration as JSON file
   */
  saveConfig(config: SimulationConfig, matrix: InteractionMatrix): void {
    const data = {
      config: JSON.parse(serializeConfig(config)),
      matrix
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `particle-config-${Date.now()}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Loads configuration from file
   */
  loadConfig(callback: (config: Partial<SimulationConfig>, matrix?: InteractionMatrix) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          callback(data.config, data.matrix);
        } catch (error) {
          console.error('Failed to parse config file:', error);
        }
      };
      reader.readAsText(file);
    };

    input.click();
  }

  /**
   * Encodes configuration in URL
   */
  shareAsUrl(config: SimulationConfig, matrix: InteractionMatrix): string {
    const data = {
      c: this.compressConfig(config),
      m: matrix
    };

    const json = JSON.stringify(data);
    const encoded = btoa(json);
    const url = `${window.location.origin}${window.location.pathname}?config=${encoded}`;

    // Copy to clipboard
    navigator.clipboard.writeText(url).catch(() => {
      console.log('Could not copy to clipboard');
    });

    return url;
  }

  /**
   * Loads configuration from URL
   */
  loadFromUrl(): { config: Partial<SimulationConfig>; matrix?: InteractionMatrix } | null {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('config');

    if (!encoded) return null;

    try {
      const json = atob(encoded);
      const data = JSON.parse(json);
      return {
        config: this.decompressConfig(data.c),
        matrix: data.m
      };
    } catch (error) {
      console.error('Failed to load config from URL:', error);
      return null;
    }
  }

  /**
   * Compresses config for URL sharing (removes defaults)
   */
  private compressConfig(config: SimulationConfig): Record<string, unknown> {
    // Only include non-default values
    return {
      ppt: config.particlesPerType,
      pt: config.particleTypes,
      pr: config.particleRadius,
      a: config.attraction,
      r: config.repulsion,
      ir: config.interactionRadius,
      md: config.minDistance,
      s: config.softness,
      d: config.drag,
      ms: config.maxSpeed,
      ge: config.gravityEnabled,
      gx: config.gravityX,
      gy: config.gravityY,
      we: config.wrapEdges,
      be: config.bloomEnabled,
      bs: config.bloomStrength,
      ce: config.connectionsEnabled,
      cd: config.connectionDistance,
      cm: config.colorMode,
      te: config.trailsEnabled,
      tl: config.trailLength
    };
  }

  /**
   * Decompresses config from URL
   */
  private decompressConfig(compressed: Record<string, unknown>): Partial<SimulationConfig> {
    return {
      particlesPerType: compressed.ppt as number,
      particleTypes: compressed.pt as number,
      particleRadius: compressed.pr as number,
      attraction: compressed.a as number,
      repulsion: compressed.r as number,
      interactionRadius: compressed.ir as number,
      minDistance: compressed.md as number,
      softness: compressed.s as number,
      drag: compressed.d as number,
      maxSpeed: compressed.ms as number,
      gravityEnabled: compressed.ge as boolean,
      gravityX: compressed.gx as number,
      gravityY: compressed.gy as number,
      wrapEdges: compressed.we as boolean,
      bloomEnabled: compressed.be as boolean,
      bloomStrength: compressed.bs as number,
      connectionsEnabled: compressed.ce as boolean,
      connectionDistance: compressed.cd as number,
      colorMode: compressed.cm as any,
      trailsEnabled: compressed.te as boolean,
      trailLength: compressed.tl as number
    };
  }
}
