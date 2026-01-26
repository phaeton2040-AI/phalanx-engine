# Phalanx Client

Client library for [Phalanx Engine](../README.md) - a game-agnostic deterministic lockstep multiplayer engine.

## Installation

```bash
npm install phalanx-client
```

## Quick Start

```typescript
import { PhalanxClient } from 'phalanx-client';

// Create client instance
const client = new PhalanxClient({
  serverUrl: 'http://localhost:3000',
  playerId: 'player-123',
  username: 'MyPlayer',
});

// Connect to server
await client.connect();

// Join matchmaking queue
const queueStatus = await client.joinQueue();
console.log(`Queue position: ${queueStatus.position}`);

// Wait for match
const match = await client.waitForMatch();
console.log(`Match found: ${match.matchId}`);
console.log(`Your team: ${match.teamId}`);
console.log(`Teammates: ${match.teammates.map((t) => t.username).join(', ')}`);
console.log(`Opponents: ${match.opponents.map((o) => o.username).join(', ')}`);

// Wait for countdown
await client.waitForCountdown((countdown) => {
  console.log(`Starting in ${countdown.seconds}...`);
});

// Wait for game start
await client.waitForGameStart();
console.log('Game started!');

// Listen for tick updates
client.on('tick', (data) => {
  console.log(`Tick ${data.tick}`);
});

// Submit commands
const ack = await client.submitCommands(client.getCurrentTick() + 1, [
  { type: 'move', data: { x: 10, y: 20 } },
]);

if (ack.accepted) {
  console.log('Commands accepted');
}

// Disconnect when done
client.disconnect();
```

## API Reference

### Configuration

```typescript
interface PhalanxClientConfig {
  serverUrl: string; // Server URL (e.g., 'http://localhost:3000')
  playerId: string; // Unique player identifier
  username: string; // Display name
  autoReconnect?: boolean; // Auto-reconnect on disconnect (default: true)
  maxReconnectAttempts?: number; // Max reconnection attempts (default: 5)
  reconnectDelayMs?: number; // Delay between attempts (default: 1000)
  connectionTimeoutMs?: number; // Connection timeout (default: 10000)
}
```

### Connection

```typescript
// Connect to server
await client.connect();

// Disconnect
client.disconnect();

// Check connection status
const connected = client.isConnected();

// Get connection state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
const state = client.getConnectionState();
```

### Matchmaking

```typescript
// Join queue
const status = await client.joinQueue();

// Leave queue
client.leaveQueue();

// Wait for match
const match = await client.waitForMatch();

// Or combine both:
const match = await client.joinQueueAndWaitForMatch();
```

### Game Lifecycle

```typescript
// Wait for countdown
await client.waitForCountdown((event) => {
  console.log(`${event.seconds} seconds remaining`);
});

// Wait for game start
const gameStart = await client.waitForGameStart();
```

### Commands

```typescript
// Submit commands with acknowledgment
const ack = await client.submitCommands(tick, [
  { type: 'move', data: { x: 10, y: 20 } },
  { type: 'attack', data: { targetId: 'enemy1' } },
]);

// Submit commands without waiting for ack (fire and forget)
client.submitCommandsAsync(tick, commands);
```

### Reconnection

```typescript
// Manual reconnection to a match
const state = await client.reconnectToMatch(matchId);

// Automatic reconnection with retries
await client.attemptReconnection();
```

### State Getters

```typescript
const tick = client.getCurrentTick();
const matchId = client.getMatchId();
const playerId = client.getPlayerId();
const username = client.getUsername();
const clientState = client.getClientState();
```

### Events

```typescript
// Connection events
client.on('connected', () => {});
client.on('disconnected', () => {});
client.on('reconnecting', (attempt) => {});
client.on('reconnectFailed', () => {});
client.on('error', (error) => {});

// Queue events
client.on('queueJoined', (status) => {});
client.on('queueLeft', () => {});
client.on('queueError', (error) => {});

// Match events
client.on('matchFound', (event) => {});
client.on('countdown', (event) => {});
client.on('gameStart', (event) => {});
client.on('matchEnd', (event) => {});

// Tick events
client.on('tick', (event) => {});
client.on('commands', (event) => {});

// Player events
client.on('playerDisconnected', (event) => {});
client.on('playerReconnected', (event) => {});

// Reconnection events
client.on('reconnectState', (event) => {});
client.on('reconnectStatus', (event) => {});

// Unsubscribe
const unsubscribe = client.on('tick', handler);
unsubscribe();

// Or manual
client.off('tick', handler);

// Remove all listeners
client.removeAllListeners();
```

## Client States

The client tracks its lifecycle state:

| State          | Description                        |
| -------------- | ---------------------------------- |
| `idle`         | Not in queue or match              |
| `in-queue`     | Waiting in matchmaking queue       |
| `match-found`  | Match found, waiting for countdown |
| `countdown`    | Countdown in progress              |
| `playing`      | Game is active                     |
| `reconnecting` | Attempting to reconnect to match   |
| `finished`     | Match has ended                    |

## TickSimulation

The `TickSimulation` class provides a higher-level abstraction for managing deterministic lockstep simulation. It handles:

- Receiving and buffering commands from the server
- Tracking simulation progress (ticks)
- Providing interpolation alpha for smooth visuals
- Managing outgoing command queue

### Basic Usage

```typescript
import { PhalanxClient, TickSimulation } from 'phalanx-client';

const client = new PhalanxClient({ ... });
await client.connect();
// ... matchmaking and game start ...

// Create tick simulation manager
const simulation = new TickSimulation(client, { tickRate: 20 });

// Register simulation callback - called for each tick
simulation.onSimulationTick((tick, commands) => {
  // Execute commands from all players
  for (const cmd of commands) {
    if (cmd.type === 'move') {
      moveEntity(cmd.data.entityId, cmd.data.target);
    }
  }

  // Run deterministic simulation
  physics.update();
  combat.update();
});

// In your render loop:
function renderLoop() {
  // Get interpolation alpha for smooth visuals (0 to 1)
  const alpha = simulation.getInterpolationAlpha();
  interpolationSystem.interpolate(alpha);

  // Flush any pending commands
  simulation.flushCommands();

  renderer.render();
  requestAnimationFrame(renderLoop);
}

// Queue commands based on player input
simulation.queueCommand({ type: 'move', data: { entityId: 1, x: 100, z: 200 } });
```

### Interpolation for Smooth Visuals

The `TickSimulation` provides interpolation timing to smooth out visual movement between network ticks:

```typescript
// Register callbacks for position snapshotting
simulation.onBeforeTick(() => {
  // Snapshot current positions before simulation advances
  interpolationSystem.snapshotPositions();
});

simulation.onAfterTick(() => {
  // Capture new positions after simulation
  interpolationSystem.captureCurrentPositions();
});

// In render loop - interpolate between tick positions
const alpha = simulation.getInterpolationAlpha();
// alpha = 0: show position from previous tick
// alpha = 0.5: show position halfway between ticks
// alpha = 1: show position from current tick
interpolationSystem.interpolate(alpha);
```

### TickSimulation API

```typescript
interface TickSimulationConfig {
  tickRate?: number; // Ticks per second (default: 20)
  debug?: boolean; // Enable debug logging (default: false)
}

// Create simulation manager
const simulation = new TickSimulation(client, config);

// Register callbacks
simulation.onSimulationTick((tick, commands) => {});
simulation.onBeforeTick(() => {});
simulation.onAfterTick(() => {});

// Command management
simulation.queueCommand(command); // Queue command to send
simulation.flushCommands(); // Send queued commands
simulation.clearPendingCommands(); // Clear without sending

// Interpolation
const alpha = simulation.getInterpolationAlpha(); // 0 to 1
const tickDuration = simulation.getTickDurationMs();

// State
const lastTick = simulation.getLastSimulatedTick();
const pendingCount = simulation.getPendingTickCount();
const isBehind = simulation.isSimulationBehind();

// Lifecycle
simulation.reset(); // Reset for new match
simulation.dispose(); // Cleanup
```

## Example: Complete Game Loop

```typescript
import { PhalanxClient, TickSyncEvent, PlayerCommand } from 'phalanx-client';

class GameClient {
  private client: PhalanxClient;
  private pendingCommands: PlayerCommand[] = [];

  constructor(serverUrl: string, playerId: string, username: string) {
    this.client = new PhalanxClient({
      serverUrl,
      playerId,
      username,
      autoReconnect: true,
    });
  }

  async start(): Promise<void> {
    // Connect and find match
    await this.client.connect();
    await this.client.joinQueueAndWaitForMatch();
    await this.client.waitForGameStart();

    // Setup event handlers
    this.client.on('tick', this.handleTick.bind(this));
    this.client.on('commands', this.handleCommands.bind(this));
    this.client.on('playerDisconnected', ({ playerId }) => {
      console.log(`Player ${playerId} disconnected`);
    });
    this.client.on('matchEnd', ({ reason }) => {
      console.log(`Match ended: ${reason}`);
    });
  }

  private handleTick(event: TickSyncEvent): void {
    // Submit any pending commands for next tick
    if (this.pendingCommands.length > 0) {
      this.client.submitCommandsAsync(event.tick + 1, this.pendingCommands);
      this.pendingCommands = [];
    }
  }

  private handleCommands(event: {
    tick: number;
    commands: PlayerCommand[];
  }): void {
    // Process commands from all players for deterministic simulation
    for (const command of event.commands) {
      this.processCommand(command);
    }
  }

  private processCommand(command: PlayerCommand): void {
    // Implement your game logic here
    console.log('Processing command:', command);
  }

  addCommand(type: string, data: unknown): void {
    this.pendingCommands.push({ type, data });
  }

  stop(): void {
    this.client.disconnect();
  }
}

// Usage
const game = new GameClient('http://localhost:3000', 'player1', 'Alice');
await game.start();

// Add commands based on player input
game.addCommand('move', { x: 100, y: 200 });
```

## License

MIT
