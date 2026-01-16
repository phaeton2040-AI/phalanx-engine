# Phalanx Test Game

A simple multiplayer game to test the Phalanx Engine using Babylon.js.

## Game Description

- **Lobby Scene**: Players enter their username and wait for matchmaking to find an opponent
- **Game Scene**: A 2m x 4m ground where players control spheres by clicking to issue move commands

## Features

- Fixed timestep game loop using accumulator algorithm
- Network synchronization via Phalanx Engine
- Smooth interpolation for rendering
- 1v1 matchmaking
- Exit button to leave the game
- Warning when trying to reload the page during a game
- Notifications when other player disconnects/leaves

## Setup

1. Build the Phalanx packages first:
   ```bash
   # From the root phalanx-engine folder
   npm install
   npm run build
   ```

2. Install game dependencies:
   ```bash
   cd game-test
   npm install
   ```

## Running

Start the server:
```bash
npm run server
```

In a separate terminal, start the client:
```bash
npm run dev
```

Open two browser windows at `http://localhost:3001` to test multiplayer.

## Controls

- **Left Click** on the ground to move your unit
- **Exit** button to leave the game and return to lobby

## Important Notes

- **Page Reload Warning**: If you try to reload or close the page during a game, you'll see a warning "You will be kicked out of the game!"
- **Other Player Notifications**: When another player leaves (by reload, closing the tab, or clicking Exit), you'll see a notification and be returned to the lobby

## Architecture

- `src/main.ts` - Client entry point
- `src/scenes/LobbyScene.ts` - Connection and matchmaking UI
- `src/scenes/GameScene.ts` - Babylon.js game rendering with notifications
- `src/game/GameLoop.ts` - Fixed timestep loop with accumulator
- `src/game/GameSimulation.ts` - Deterministic game logic
- `src/game/Unit.ts` - Unit movement logic
- `src/server/main.ts` - Phalanx server configuration
