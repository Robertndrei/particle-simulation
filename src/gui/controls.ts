import GUI from 'lil-gui';
import type { SimulationConfig, InteractionMatrix } from '../types';
import { MouseMode } from '../types';
import { COLOR_NAMES } from '../config/defaults';

/**
 * Callbacks for GUI events
 */
export interface GUICallbacks {
  onConfigChange: () => void;
  onMatrixChange: () => void;
  onReset: () => void;
}

/**
 * GUI controller
 */
export class GUIController {
  private gui: GUI;
  private interactionControllers: GUI[] = [];
  private interactionsFolder: GUI;
  private callbacks: GUICallbacks;

  constructor(
    config: SimulationConfig,
    interactionMatrix: InteractionMatrix,
    callbacks: GUICallbacks
  ) {
    this.callbacks = callbacks;
    this.gui = new GUI({ title: 'Configuration' });

    this.setupForcesFolder(config);
    this.setupPhysicsFolder(config);
    this.setupParticlesFolder(config);
    this.setupWorldFolder(config);
    this.setupMouseFolder(config);
    this.setupEffectsFolder(config);
    this.interactionsFolder = this.setupInteractionsFolder(config, interactionMatrix);
    this.setupActionsFolder(config);
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
    folder.open();
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
  }

  private setupWorldFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('World');
    folder
      .add(config, 'wrapEdges')
      .name('Wrap Edges')
      .onChange(this.callbacks.onConfigChange);
  }

  private setupMouseFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Mouse');
    folder
      .add(config, 'mouseMode', [MouseMode.None, MouseMode.Repel, MouseMode.Attract])
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
  }

  private setupEffectsFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Effects');
    folder
      .add(config, 'noiseEnabled')
      .name('Noise/Turbulence')
      .onChange(this.callbacks.onConfigChange);
    folder
      .add(config, 'noiseStrength', 0, 0.5, 0.01)
      .name('Noise Strength')
      .onChange(this.callbacks.onConfigChange);
    folder.add(config, 'trailsEnabled').name('Trails');
    folder.add(config, 'trailLength', 0.5, 0.99, 0.01).name('Trail Length');
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

  private setupInteractionsFolder(
    config: SimulationConfig,
    interactionMatrix: InteractionMatrix
  ): GUI {
    const folder = this.gui.addFolder('Interactions (↑attract ↓repel)');
    this.interactionsFolder = folder;
    this.updateInteractionControls(config, interactionMatrix);
    return folder;
  }

  private setupActionsFolder(config: SimulationConfig): void {
    const folder = this.gui.addFolder('Actions');
    folder.add(config, 'reset').name('Reset');
    folder.add(config, 'randomizeForces').name('Randomize');
    folder.open();
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
   * Cleans up GUI resources
   */
  dispose(): void {
    this.gui.destroy();
  }
}
