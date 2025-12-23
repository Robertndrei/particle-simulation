# Particle Simulation - Emergent Behavior

An interactive particle simulation demonstrating emergent behavior patterns. Built with Three.js and Web Workers for high-performance real-time physics.

**[Live Demo](https://divine-salad-7899.robert-966.workers.dev)**

> This project was generated with [Claude Opus 4.5](https://www.anthropic.com/claude) by Anthropic.

## Features

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
- **lil-gui** - Lightweight GUI controls
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

### GUI Controls

- **Forces**: Adjust attraction, repulsion, and interaction radius
- **Physics**: Configure equilibrium distance, hardness, drag, max speed, and inter-particle friction
- **Particles**: Set particles per type, number of types, and visual radius
- **World**: Toggle edge wrapping
- **Mouse**: Select interaction mode (None, Repel, Attract) and configure radius/strength
- **Effects**: Enable/disable trails, radiation, winds, and noise/turbulence
- **Interactions**: Fine-tune how each particle type interacts with others
- **Actions**: Reset simulation or randomize forces

### Controls

- **Click** on the canvas to add particles at that location
- Use the **GUI panel** on the right to adjust all simulation parameters in real-time

## Project Structure

```
particle-simulation/
├── index.html              # Entry point
├── src/
│   ├── main.ts             # Application initialization
│   ├── config/
│   │   └── defaults.ts     # Default configuration
│   ├── gui/
│   │   └── controls.ts     # GUI controller
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
- GUI powered by [lil-gui](https://lil-gui.georgealways.com/)
- Generated with [Claude Opus 4.5](https://www.anthropic.com/claude) by Anthropic
