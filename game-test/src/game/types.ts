/**
 * Game types for the test game
 */

export interface MoveCommand {
  type: 'move';
  data: {
    targetX: number;
    targetZ: number;
  };
}

export type GameCommand = MoveCommand;

export interface UnitState {
  playerId: string;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  color: string;
}

export interface GameState {
  units: Map<string, UnitState>;
}
