import GUI from 'lil-gui';
import type { SimulationConfig, InteractionMatrix } from '../types';
import { MouseMode, ColorMode, PresetName } from '../types';
import { COLOR_NAMES, PRESETS } from '../config/defaults';

/**
 * Callbacks for GUI events
 */
export interface GUICallbacks {
  onConfigChange: () => void;
  onMatrixChange: () => void;
  onReset: () => void;
  onAttractorsChange?: () => void;
  onObstaclesChange?: () => void;
}

/**
 * GUI controller with all simulation options
 */
export class GUIController {
  private gui: GUI;
  private interactionControllers: GUI[] = [];
  private interactionsFolder: GUI;
  private callbacks: GUICallbacks;
  private recordingButton: any = null;

  constructor(
    config: SimulationConfig,
    interactionMatrix: InteractionMatrix,
    callbacks: GUICallbacks
  ) {
    this.callbacks = callbacks;
    this.gui = new GUI({ title: 'Particle Simulation' });

    // Setup all folders
    this.setupPresetsFolder(config);
    this.setupForcesFolder(config);
    this.setupPhysicsFolder(config);
    this.setupGravityFolder(config);
    this.setupParticlesFolder(config);
    this.setupWorldFolder(config);
    this.setupCameraFolder(config);
    this.setupMouseFolder(config);
    this.setupVisualEffectsFolder(config);
    this.setupPhysicsEffectsFolder(config);
    this.setupAnalysisFolder(config);
    this.setupAudioFolder(config);
    this.interactionsFolder = this.setupInteractionsFolder(config, interactionMatrix);
    this.setupActionsFolder(config);
    this.setupExportFolder(config);
  }

  private setupPresetsFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Presets');
    const presetNames = Object.values(PresetName);

    const presetObj = {
      preset: PresetName.Default,
      apply: () => config.applyPreset(presetObj.preset)
    };

    folder.add(presetObj, 'preset', presetNames).name('Select Preset');
    folder.add(presetObj, 'apply').name('Apply Preset');
    folder.open();
  }

  private setupForcesFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Forces');
    folder
      .add(config, 'attraction', 0, 0.1, 0.001)
      .name('Attraction')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'repulsion', 0, 0.1, 0.001)
      .name('Repulsion')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'interactionRadius', 50, 1000, 5)
      .name('Interaction Radius')
      .onChange(this.callbacks.onConfigChange);
    folder.open();
  }

  private setupPhysicsFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Physics');
    folder
      .add(config, 'minDistance', 5, 500, 1)
      .name('Equilibrium Dist.')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'softness', 0.05, 1, 0.05)
      .name('Hardness')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'drag', 0, 0.5, 0.01)
      .name('Drag')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'maxSpeed', 1, 15, 0.5)
      .name('Max Speed')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'interFriction', 0, 1, 0.05)
      .name('Inter-Friction')
      .onChange(this.callbacks.onConfigChange);
  }

  private setupGravityFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Gravity');
    folder
      .add(config, 'gravityEnabled')
      .name('Enabled')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'gravityX', -0.5, 0.5, 0.01)
      .name('X Direction')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'gravityY', -0.5, 0.5, 0.01)
      .name('Y Direction')
      .onChange(this.callbacks.onConfigChange);
  }

  private setupParticlesFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Particles');
    folder
      .add(config, 'particlesPerType', 10, 10000, 10)
      .name('Per Type')
      .onChange(this.callbacks.onReset);
    folder
      .add(config, 'particleTypes', 1, 10, 1)
      .name('Types')
      .onChange(this.callbacks.onReset);
    folder
      .add(config, 'particleRadius', 1, 10, 0.5)
      .name('Visual Radius')
      .onChange(this.callbacks.onReset);
    folder
      .add(config, 'particleSizeByVelocity')
      .name('Size by Velocity');
    folder
      .add(config, 'particleSizeMultiplier', 1, 3, 0.1)
      .name('Size Multiplier');
  }

  private setupWorldFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('World');
    folder
      .add(config, 'wrapEdges')
      .name('Wrap Edges')
      .onChange(this.callbacks.onConfigChange);
    folder.add(config, 'clearAttractors').name('Clear Attractors');
    folder.add(config, 'clearObstacles').name('Clear Obstacles');
  }

  private setupCameraFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Camera');
    folder.add(config, 'zoom', 0.1, 5, 0.1).name('Zoom');
    folder.add(config, 'panX', -1000, 1000, 10).name('Pan X');
    folder.add(config, 'panY', -1000, 1000, 10).name('Pan Y');

    const resetCamera = { reset: () => {
      config.zoom = 1;
      config.panX = 0;
      config.panY = 0;
      this.gui.controllersRecursive().forEach(c => c.updateDisplay());
    }};
    folder.add(resetCamera, 'reset').name('Reset Camera');
  }

  private setupMouseFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Mouse');
    folder
      .add(config, 'mouseMode', Object.values(MouseMode))
      .name('Mode')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'mouseRadius', 50, 400, 10)
      .name('Radius')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'mouseStrength', 0.5, 10, 0.5)
      .name('Strength')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'spawnType', 0, 9, 1)
      .name('Spawn Type')
      .onChange(this.callbacks.onConfigChange);
  }

  private setupVisualEffectsFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Visual Effects');

    // Color mode
    folder
      .add(config, 'colorMode', Object.values(ColorMode))
      .name('Color Mode');
    folder
      .add(config, 'velocityColorScale', 0.1, 3, 0.1)
      .name('Velocity Scale');

    // Bloom
    folder.add(config, 'bloomEnabled').name('Bloom');
    folder.add(config, 'bloomStrength', 0.5, 5, 0.1).name('Bloom Strength');
    folder.add(config, 'bloomRadius', 0.1, 1, 0.1).name('Bloom Radius');
    folder.add(config, 'bloomThreshold', 0, 1, 0.1).name('Bloom Threshold');

    // Connections
    folder.add(config, 'connectionsEnabled').name('Connections');
    folder.add(config, 'connectionDistance', 10, 200, 5).name('Connection Dist');
    folder.add(config, 'connectionOpacity', 0.1, 1, 0.1).name('Connection Opacity');

    // Trails
    folder.add(config, 'trailsEnabled').name('Trails');
    folder.add(config, 'trailLength', 0.5, 0.99, 0.01).name('Trail Length');
  }

  private setupPhysicsEffectsFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Physics Effects');

    // Noise
    folder
      .add(config, 'noiseEnabled')
      .name('Noise/Turbulence')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'noiseStrength', 0, 0.5, 0.01)
      .name('Noise Strength')
      .onChange(this.callbacks.onConfigChange);

    // Radiation
    folder
      .add(config, 'radiationEnabled')
      .name('Radiation')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'radiationRate', 0.00001, 0.01, 0.00001)
      .name('Radiation Rate')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'radiationSpeed', 5, 500, 1)
      .name('Radiation Speed')
      .onChange(this.callbacks.onConfigChange);

    // Wind
    folder
      .add(config, 'windEnabled')
      .name('Winds')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'windCount', 1, 10, 1)
      .name('Wind Count')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'windStrength', 0.01, 0.5, 0.01)
      .name('Wind Strength')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'windChangeSpeed', 0.01, 0.2, 0.01)
      .name('Wind Change')
      .onChange(this.callbacks.onConfigChange);
  }

  private setupAnalysisFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Analysis');
    folder.add(config, 'showStats').name('Show Stats');
    folder.add(config, 'showEnergyGraph').name('Energy Graph');
    folder.add(config, 'showHeatmap').name('Density Heatmap');
    folder.add(config, 'heatmapOpacity', 0.1, 1, 0.1).name('Heatmap Opacity');
    folder.add(config, 'detectClusters').name('Detect Clusters')
      .onChange(this.callbacks.onConfigChange);
  }

  private setupAudioFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Audio Reactive');
    folder.add(config, 'audioEnabled').name('Enable Audio');
    folder.add(config, 'audioSensitivity', 0.1, 3, 0.1).name('Sensitivity');
    folder.add(config, 'audioSmoothing', 0.1, 0.99, 0.01).name('Smoothing');
  }

  private setupInteractionsFolder(
    config: SimulationConfig,
    interactionMatrix: InteractionMatrix
  ): GUI {
    const folder = this.gui.addFolder('Interactions');
    this.interactionsFolder = folder;
    this.updateInteractionControls(config, interactionMatrix);
    return folder;
  }

  private setupActionsFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Actions');
    folder.add(config, 'reset').name('Reset Particles');
    folder.add(config, 'randomizeForces').name('Randomize Forces');
    folder.open();
  }

  private setupExportFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Export / Import');
    folder.add(config, 'saveConfig').name('Save Config');
    folder.add(config, 'loadConfig').name('Load Config');
    folder.add(config, 'takeScreenshot').name('Screenshot');

    const recordingState = { label: 'Start Recording' };
    this.recordingButton = folder.add(recordingState, 'label').name('Recording');
    this.recordingButton.disable();

    folder.add(config, 'startRecording').name('Start Recording');
    folder.add(config, 'stopRecording').name('Stop Recording');
    folder.add(config, 'exportData').name('Export CSV');
  }

  /**
   * Updates the interaction controls when the number of types changes
   */
  updateInteractionControls(
    config: SimulationConfig,
    interactionMatrix: InteractionMatrix
  ): void {
    // Clear previous controls
    for (const controller of this.interactionControllers) {
      controller.destroy();
    }
    this.interactionControllers = [];

    // Create new controls
    for (let i = 0; i < config.particleTypes; i++) {
      for (let j = 0; j < config.particleTypes; j++) {
        const ii = i;
        const jj = j;
        const obj = { value: interactionMatrix[i][j] };
        const ctrl = this.interactionsFolder
          .add(obj, 'value', -1, 1, 0.1)
          .name(`${COLOR_NAMES[i][0]}→${COLOR_NAMES[j][0]}`)
          .onChange((v: number) => {
            interactionMatrix[ii][jj] = v;
            this.callbacks.onMatrixChange();
          });
        this.interactionControllers.push(ctrl as unknown as GUI);
      }
    }
  }

  /**
   * Updates all GUI controls to reflect current config values
   */
  updateDisplay(): void {
    this.gui.controllersRecursive().forEach(c => c.updateDisplay());
  }

  /**
   * Cleans up GUI resources
   */
  dispose(): void {
    this.gui.destroy();
  }
}
