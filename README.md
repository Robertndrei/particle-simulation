# Particle Simulation - Emergent Behavior

An interactive particle simulation demonstrating emergent behavior patterns. Built with Three.js and Web Workers for high-performance real-time physics.

**[Live Demo](https://divine-salad-7899.robert-966.workers.dev)**

> This project was generated with [Claude Opus 4.5](https://www.anthropic.com/claude) by Anthropic.

## Features

- **WebGPU simulation and rendering for 100,000+ particles**: physics runs in compute shaders with a spatial grid built on the GPU, and particles are drawn straight from GPU memory (falls back to a Web Worker with up to 7,000 particles when WebGPU is unavailable)
- **Infinite canvas**: zoom out without limit (mouse wheel, anchored at the cursor) and drag to pan; particles stay visible at any scale
- **Orbits that hold**: an optional pull toward the centre (flat rotation curve) plus rotating start layouts (spiral disk, rings) power the *Galaxia* and *Órbitas* presets
- **7 particle types by default** with a random interaction matrix, so structures emerge right away
- **Real-time particle physics** with configurable attraction/repulsion forces
- **Multi-type particle system** with customizable interaction matrices
- **Web Worker-based physics** for smooth performance with thousands of particles
- **Visual effects**: trails, radiation, wind systems, and noise/turbulence
- **Interactive controls**: mouse attraction/repulsion modes
- **Wrap-around edges** for continuous world simulation
- **Fully configurable GUI** for real-time parameter adjustments

## Tech Stack

- **TypeScript** - Type-safe development
- **Three.js** - 3D rendering
- **Vite** - Fast build tooling
- **Bun** - JavaScript runtime and package manager
- **Web Workers** - Offloaded physics calculations

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/particle-simulation.git
cd particle-simulation

# Install dependencies
bun install

# Start development server
bun dev
```

The simulation will be available at `http://localhost:5173`

## Build

```bash
# Create production build
bun run build

# Preview production build
bun run preview
```

## Usage

### Control panel

The interface is in Spanish and describes behaviour in plain language instead of parameter names.

- **Especies**: preset cards with a drawn preview, population (total particles and number of species), species colours, and the **relationship grid**: each row is a species, each column the species it reacts to. Teal circles mean "chases", coral means "flees", and the circle size is the strength. Drag a cell up or down (or use the wheel or arrow keys) to change it. A sentence below the grid describes the cell you are editing.
- **Física**: a live diagram of the force against distance, with sliders for personal space, reach, chase and flee strength, collision hardness, viscosity, speed, friction, agitation, a direction pad for gravity and the pull toward the centre
- **Mundo**: world size, start layout (cloud, spiral disk, rings), edge behaviour, particle size, colour by species or speed, trails
- **Más**: photo, video, CSV export, saving and loading settings, microphone reaction, keyboard shortcuts

Controls the WebGPU backend does not support (bloom, connections, heatmap, stats, radiation, wind, walls, attractors) only appear when the simulation runs on the CPU worker.

### Controls

- **Tool dock** (bottom): Explore (1), Attract (2), Repel (3), Swirl (4), Sow particles (5), Wall (6, CPU only), Pause, Reset
- **Mouse wheel / trackpad pinch**: zoom in/out around the cursor (no zoom-out limit)
- **Drag** (left button when exploring, middle button with any tool): pan the camera
- **F** or **Home**: fit the whole world in view; **Space**: pause; **R**: reset; **H**: hide the panel; **P**: photo
- **Click** while exploring to follow a particle; with Sow, to add particles of the chosen species

## Project Structure

```
particle-simulation/
├── index.html              # Entry point
├── src/
│   ├── main.ts             # Application initialization
│   ├── config/
│   │   └── defaults.ts     # Default configuration
│   ├── gpu/
│   │   ├── compute-engine.ts    # WebGPU simulation step (grid + forces)
│   │   ├── particle-renderer.ts # WebGPU particle drawing and trails
│   │   ├── shaders.ts           # WGSL compute and render shaders
│   │   └── webgpu-detect.ts     # Adapter/device setup
│   ├── gui/
│   │   ├── controls.ts          # Control panel (tabs, species, physics, world)
│   │   ├── matrix-editor.ts     # Relationship grid
│   │   ├── force-diagram.ts     # Force vs distance diagram
│   │   ├── preset-thumbnails.ts # Preset cards
│   │   ├── dock.ts              # Tool dock, HUD and zoom control
│   │   ├── components.ts        # Sliders, switches, segmented controls
│   │   └── styles.css
│   ├── physics/
│   │   ├── worker.ts       # Web Worker for physics
│   │   ├── forces.ts       # Force calculations
│   │   └── spatial-hash.ts # Spatial hashing for neighbor detection
│   ├── renderer/
│   │   ├── index.ts        # Main renderer
│   │   ├── particles.ts    # Particle mesh management
│   │   └── effects.ts      # Visual effects (trails)
│   └── types/
│       ├── index.ts        # Type exports
│       ├── config.ts       # Configuration types
│       ├── enums.ts        # Enumerations
│       ├── particle.ts     # Particle structure
│       └── worker-messages.ts # Worker message types
├── package.json
├── tsconfig.json
├── vite.config.ts
└── LICENSE
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Three.js](https://threejs.org/)
- Generated with [Claude Opus 4.5](https://www.anthropic.com/claude) by Anthropic
