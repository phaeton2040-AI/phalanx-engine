# Babylon RTS Demo

A real-time strategy (RTS) game demo built with [Babylon.js](https://www.babylonjs.com/) and TypeScript, showcasing Entity-Component-System (ECS) architecture principles.

## Features

- **3D RTS Gameplay**: Move units, attack enemies, and defend with towers
- **Two Teams**: Player team (Blue/Team1) vs Enemy team (Red/Team2)
- **Combat System**: Units and towers automatically attack enemies in range
- **Projectile System**: Visual projectiles with hit detection
- **Selection System**: Click to select units, right-click to move
- **Health System**: Entities take damage and can be destroyed

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [pnpm](https://pnpm.io/) package manager

### Installation

```bash
# Clone the repository (if applicable)
git clone <repository-url>
cd babylon-ecs

# Install dependencies
pnpm install
```

### Development

Start the development server with hot reload:

```bash
pnpm dev
```

The game will be available at `http://localhost:5173` (default Vite port).

### Environment Configuration

The game server URL is configured via environment variables:

- **`.env`** - Default configuration (committed to git, points to production Heroku server)
- **`.env.local`** - Local overrides (not committed to git)

To use a local development server, create a `.env.local` file:

```bash
# .env.local
VITE_SERVER_URL=http://localhost:3000
```

Available environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_SERVER_URL` | Phalanx game server URL | `http://localhost:3000` |

### Build for Production

```bash
pnpm build
```

This compiles TypeScript and builds optimized assets into the `dist/` folder.

### Preview Production Build

```bash
pnpm preview
```

## Controls

| Action | Input |
|--------|-------|
| Select Unit | Left-click on unit |
| Move Selected Units | Right-click on ground |
| Deselect | Left-click on empty ground |

## Tech Stack

- **[Babylon.js](https://www.babylonjs.com/)** (v8.45) - 3D rendering engine
- **[TypeScript](https://www.typescriptlang.org/)** (v5.9) - Type-safe JavaScript
- **[Vite](https://vitejs.dev/)** (v7.2) - Fast build tool and dev server

## Project Structure

```
src/
├── main.ts              # Application entry point
├── core/                # Core game infrastructure
│   ├── Game.ts          # Main game class, orchestrates systems
│   ├── EntityManager.ts # Central entity registry with component queries
│   ├── EventBus.ts      # Decoupled event communication
│   └── SceneManager.ts  # Babylon.js scene setup and management
├── entities/            # Game entities (Units, Towers, Projectiles)
├── components/          # ECS components (Health, Attack, Movement, Team)
├── systems/             # ECS systems (Combat, Movement, Health, Selection)
├── events/              # Event types and constants
├── effects/             # Visual effects (Explosions)
├── enums/               # Enumerations (TeamTag)
└── interfaces/          # TypeScript interfaces
```

## Architecture

This project follows an **Entity-Component-System (ECS)** architecture pattern:

- **Entities** are containers that hold components (Unit, Tower)
- **Components** are pure data containers (HealthComponent, AttackComponent)
- **Systems** contain logic and operate on entities with specific components

For detailed architecture documentation and development guidelines, see [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md).

## License

This project is private and intended for demonstration purposes.

