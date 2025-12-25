/**
 * Audio analyzer for reactive particle simulation
 */
export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private smoothedBass = 0;
  private smoothedMid = 0;
  private smoothedHigh = 0;
  private isActive = false;

  /**
   * Initializes audio input from microphone
   */
  async initialize(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;

      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyser);

      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.isActive = true;

      return true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      return false;
    }
  }

  /**
   * Updates the analysis and returns frequency band values
   */
  update(sensitivity: number, smoothing: number): {
    bass: number;
    mid: number;
    high: number;
    overall: number;
  } {
    if (!this.analyser || !this.dataArray || !this.isActive) {
      return { bass: 0, mid: 0, high: 0, overall: 0 };
    }

    this.analyser.getByteFrequencyData(this.dataArray);

    const bufferLength = this.dataArray.length;

    // Split into frequency bands
    const bassEnd = Math.floor(bufferLength * 0.1);    // 0-10%
    const midEnd = Math.floor(bufferLength * 0.5);     // 10-50%
    const highEnd = bufferLength;                       // 50-100%

    let bassSum = 0;
    let midSum = 0;
    let highSum = 0;

    for (let i = 0; i < bassEnd; i++) {
      bassSum += this.dataArray[i];
    }
    for (let i = bassEnd; i < midEnd; i++) {
      midSum += this.dataArray[i];
    }
    for (let i = midEnd; i < highEnd; i++) {
      highSum += this.dataArray[i];
    }

    // Normalize and apply sensitivity
    const bass = (bassSum / bassEnd / 255) * sensitivity;
    const mid = (midSum / (midEnd - bassEnd) / 255) * sensitivity;
    const high = (highSum / (highEnd - midEnd) / 255) * sensitivity;

    // Apply smoothing
    this.smoothedBass = this.smoothedBass * smoothing + bass * (1 - smoothing);
    this.smoothedMid = this.smoothedMid * smoothing + mid * (1 - smoothing);
    this.smoothedHigh = this.smoothedHigh * smoothing + high * (1 - smoothing);

    const overall = (this.smoothedBass + this.smoothedMid + this.smoothedHigh) / 3;

    return {
      bass: this.smoothedBass,
      mid: this.smoothedMid,
      high: this.smoothedHigh,
      overall
    };
  }

  /**
   * Checks if audio is currently active
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Stops and cleans up audio
   */
  dispose(): void {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.dataArray = null;
    this.isActive = false;
  }
}
