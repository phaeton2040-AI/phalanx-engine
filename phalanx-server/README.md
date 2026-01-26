# Phalanx Server

Server component of [Phalanx Engine](../README.md) - a game-agnostic deterministic lockstep multiplayer engine with authentication, matchmaking, and command synchronization.

## Features

- **Deterministic Lockstep**: Synchronizes only player commands, game logic runs deterministically on each client
- **Matchmaking**: Built-in support for various game modes (1v1, 2v2, 3v3, 4v4, FFA)
- **Tick System**: Configurable tick rate with command batching
- **Reconnection Support**: Players can rejoin matches after disconnection
- **TypeScript**: Full TypeScript support with exported types

## Installation

```bash
npm install phalanx-server
```

## Quick Start

```typescript
import { Phalanx } from 'phalanx-server';

const app = new Phalanx({
  port: 3000,
  tickRate: 20,
  gameMode: '3v3',
});

app.start().then(() => {
  console.log('Phalanx server running on port 3000');
});
```

## Configuration

```typescript
import { Phalanx, PhalanxConfig } from 'phalanx-server';

const config: Partial<PhalanxConfig> = {
  // === Server ===
  port: 3000, // Server port (default: 3000)
  cors: { origin: '*' }, // CORS configuration

  // === Tick System ===
  tickRate: 20, // Ticks per second (default: 20)
  tickDeadlineMs: 50, // Max wait for commands per tick

  // === Matchmaking ===
  gameMode: '3v3', // Preset: '1v1' | '2v2' | '3v3' | '4v4' | 'FFA4'
  // OR custom:
  // gameMode: { playersPerMatch: 6, teamsCount: 2 },
  matchmakingIntervalMs: 1000,
  countdownSeconds: 5,

  // === Timeouts ===
  timeoutTicks: 40, // Ticks before "lagging" warning
  disconnectTicks: 100, // Ticks before disconnect
  reconnectGracePeriodMs: 30000,

  // === Command Validation ===
  maxTickBehind: 10,
  maxTickAhead: 5,
};

const app = new Phalanx(config);
```

## Event Hooks

```typescript
app.on('match-created', (match) => {
  console.log(`Match ${match.id} created with ${match.players.length} players`);
});

app.on('match-started', (match) => {
  console.log(`Match ${match.id} started!`);
});

app.on('player-command', (playerId, command) => {
  // Custom command validation
  return true; // or false to reject
});

app.on('player-timeout', (playerId, matchId) => {
  console.log(`Player ${playerId} timed out`);
});

app.on('player-disconnected', (playerId, matchId) => {
  console.log(`Player ${playerId} disconnected from match ${matchId}`);
});

app.on('player-reconnected', (playerId, matchId) => {
  console.log(`Player ${playerId} reconnected to match ${matchId}`);
});
```

## API

### Phalanx Class

```typescript
class Phalanx {
  constructor(config?: Partial<PhalanxConfig>);

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Events
  on(event: PhalanxEvent, handler: Function): this;
  off(event: PhalanxEvent, handler: Function): this;

  // Runtime info
  getActiveMatches(): MatchInfo[];
  getQueueSize(): number;
  getConfig(): PhalanxConfig;
}
```

### Client Events

| Event                 | Emit | Receive | Description                       |
| --------------------- | ---- | ------- | --------------------------------- |
| `queue-join`          | ✅   |         | Join matchmaking queue            |
| `queue-leave`         | ✅   |         | Leave matchmaking queue           |
| `queue-status`        |      | ✅      | Queue join/leave confirmation     |
| `match-found`         |      | ✅      | Match created, countdown starting |
| `game-start`          |      | ✅      | Match gameplay begins             |
| `match-end`           |      | ✅      | Match has ended                   |
| `submit-commands`     | ✅   |         | Send game commands                |
| `submit-commands-ack` |      | ✅      | Command acknowledgment            |
| `commands-batch`      |      | ✅      | All commands for a tick           |
| `tick-sync`           |      | ✅      | Periodic tick synchronization     |
| `countdown`           |      | ✅      | Countdown before game starts      |
| `reconnect-match`     | ✅   |         | Attempt to rejoin a match         |
| `reconnect-status`    |      | ✅      | Reconnection result               |
| `reconnect-state`     |      | ✅      | Game state for reconnection       |
| `player-disconnected` |      | ✅      | Another player disconnected       |
| `player-reconnected`  |      | ✅      | Another player reconnected        |

## Game Modes

```typescript
import { GAME_MODES } from 'phalanx-server';

// Available presets:
// '1v1'  - 2 players, 2 teams
// '2v2'  - 4 players, 2 teams
// '3v3'  - 6 players, 2 teams
// '4v4'  - 8 players, 2 teams
// 'FFA4' - 4 players, 4 teams (Free For All)
```

## Related Packages

- [phalanx-client](../phalanx-client) - Client library for connecting to Phalanx servers

## Requirements

- Node.js 18+

## License

MIT
