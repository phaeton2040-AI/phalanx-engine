/**
 * Unit - represents a player's unit in the game
 */

import { UNIT_SPEED, GROUND_WIDTH, GROUND_DEPTH } from './constants';
import type { UnitState } from './types';

export class Unit {
  public playerId: string;
  public x: number;
  public z: number;
  public targetX: number;
  public targetZ: number;
  public color: string;

  constructor(playerId: string, x: number, z: number, color: string) {
    this.playerId = playerId;
    this.x = x;
    this.z = z;
    this.targetX = x;
    this.targetZ = z;
    this.color = color;
  }

  /**
   * Set move target
   */
  setTarget(targetX: number, targetZ: number): void {
    // Clamp to ground bounds
    const halfWidth = GROUND_WIDTH / 2;
    const halfDepth = GROUND_DEPTH / 2;

    this.targetX = Math.max(-halfWidth, Math.min(halfWidth, targetX));
    this.targetZ = Math.max(-halfDepth, Math.min(halfDepth, targetZ));
  }

  /**
   * Update unit position based on fixed timestep
   */
  update(deltaTime: number): void {
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance < 0.01) {
      // Close enough, snap to target
      this.x = this.targetX;
      this.z = this.targetZ;
      return;
    }

    // Move towards target
    const moveDistance = UNIT_SPEED * deltaTime;

    if (moveDistance >= distance) {
      // Would overshoot, just move to target
      this.x = this.targetX;
      this.z = this.targetZ;
    } else {
      // Move towards target
      const ratio = moveDistance / distance;
      this.x += dx * ratio;
      this.z += dz * ratio;
    }
  }

  /**
   * Get state snapshot
   */
  getState(): UnitState {
    return {
      playerId: this.playerId,
      x: this.x,
      z: this.z,
      targetX: this.targetX,
      targetZ: this.targetZ,
      color: this.color,
    };
  }

  /**
   * Apply state from snapshot
   */
  applyState(state: UnitState): void {
    this.x = state.x;
    this.z = state.z;
    this.targetX = state.targetX;
    this.targetZ = state.targetZ;
  }
}
