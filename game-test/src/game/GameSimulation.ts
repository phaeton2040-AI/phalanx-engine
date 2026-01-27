/**
 * GameSimulation - handles deterministic game logic
 */

import { Unit } from './Unit';
import { FIXED_TIMESTEP } from './constants';
import type { GameCommand } from './types';

export class GameSimulation {
  private units: Map<string, Unit> = new Map();
  private pendingCommands: GameCommand[] = [];

  /**
   * Add a new unit for a player
   */
  addUnit(playerId: string, x: number, z: number, color: string): Unit {
    const unit = new Unit(playerId, x, z, color);
    this.units.set(playerId, unit);
    return unit;
  }

  /**
   * Remove a unit
   */
  removeUnit(playerId: string): void {
    this.units.delete(playerId);
  }

  /**
   * Get a unit by player ID
   */
  getUnit(playerId: string): Unit | undefined {
    return this.units.get(playerId);
  }

  /**
   * Get all units
   */
  getAllUnits(): Map<string, Unit> {
    return this.units;
  }

  /**
   * Queue commands to be processed
   */
  queueCommands(commands: GameCommand[]): void {
    this.pendingCommands.push(...commands);
  }

  /**
   * Process a single command
   */
  private processCommand(command: GameCommand): void {
    if (command.type === 'move') {
      const moveCmd = command;
      const playerId = moveCmd.playerId;
      if (playerId) {
        const unit = this.units.get(playerId);
        if (unit) {
          // Support both direct properties and nested data object
          const data =
            moveCmd.data ??
            (moveCmd as unknown as { targetX?: number; targetZ?: number });
          const targetX = data.targetX ?? 0;
          const targetZ = data.targetZ ?? 0;
          unit.setTarget(targetX, targetZ);
        }
      }
    }
  }

  /**
   * Run a fixed timestep update
   */
  update(): void {
    // Process all pending commands first
    for (const command of this.pendingCommands) {
      this.processCommand(command);
    }
    this.pendingCommands = [];

    // Update all units
    for (const unit of this.units.values()) {
      unit.update(FIXED_TIMESTEP);
    }
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.units.clear();
    this.pendingCommands = [];
  }
}
