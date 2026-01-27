import { Vector3 } from '@babylonjs/core';
import { EventBus } from '../../core/EventBus';
import { GameEvents, createEvent } from '../../events';
import { arenaParams } from '../../config/constants';
import { FormationGridData } from './FormationGridData';
import type { CreateUnitCallback, MoveUnitCallback } from './FormationTypes';
import type { FormationCommittedEvent } from '../../events';

/**
 * FormationDeployer - Handles deploying units from formation grid to battlefield
 * Responsible for committing formations and spawning units
 */
export class FormationDeployer {
  private eventBus: EventBus;
  private gridData: FormationGridData;

  private createUnitCallback: CreateUnitCallback | null = null;
  private moveUnitCallback: MoveUnitCallback | null = null;

  constructor(eventBus: EventBus, gridData: FormationGridData) {
    this.eventBus = eventBus;
    this.gridData = gridData;
  }

  /**
   * Set the callback for creating units
   */
  public setCreateUnitCallback(callback: CreateUnitCallback): void {
    this.createUnitCallback = callback;
  }

  /**
   * Set the callback for moving units (for lockstep simulation)
   */
  public setMoveUnitCallback(callback: MoveUnitCallback): void {
    this.moveUnitCallback = callback;
  }

  /**
   * Commit all pending units to the battlefield
   * Units spawn preserving their formation grid positions (both X and Z)
   * The grid's X-axis maps to battlefield depth (distance from base)
   * The grid's Z-axis maps to horizontal spread
   *
   * For Team2 (right side), the formation is rotated 180 degrees
   */
  public commitFormation(playerId: string): number {
    const grid = this.gridData.getGrid(playerId);
    if (!grid) return 0;

    let unitCount = 0;
    const spawnedUnits: {
      unitId: number;
      position: Vector3;
      targetX: number;
    }[] = [];

    // Get spawn area and enemy base position
    const teamConfig = grid.team === 1 ? arenaParams.teamA : arenaParams.teamB;
    const enemyTeamConfig =
      grid.team === 1 ? arenaParams.teamB : arenaParams.teamA;

    const spawnBaseX = teamConfig.spawnArea.x;
    const enemyBaseX = enemyTeamConfig.base.x;

    // Determine direction towards enemy (Team1 goes right +X, Team2 goes left -X)
    const direction = grid.team === 1 ? 1 : -1;

    // Calculate grid dimensions for relative positioning
    const halfGridWidth = (grid.gridWidth * grid.cellSize) / 2;
    const halfGridHeight = (grid.gridHeight * grid.cellSize) / 2;

    // Deploy ALL units on the grid
    for (const placed of grid.placedUnits) {
      // For Team2, mirror the X coordinate
      let effectiveGridX = placed.gridX;
      const effectiveGridZ = placed.gridZ;

      if (grid.team === 2) {
        effectiveGridX = grid.gridWidth - 1 - placed.gridX;
      }

      // Calculate relative X offset from grid center
      const relativeX = (effectiveGridX + 0.5) * grid.cellSize - halfGridWidth;

      // Calculate relative Z from grid center
      let relativeZ = (effectiveGridZ + 0.5) * grid.cellSize - halfGridHeight;

      // Offset for prisma (center of 2x2)
      if (placed.unitType === 'prisma') {
        relativeZ += grid.cellSize / 2;
      }

      // Spawn position
      const spawnX = spawnBaseX + relativeX * direction;
      const spawnPos = new Vector3(spawnX, 1, relativeZ);

      if (!this.createUnitCallback) {
        console.error('[FormationDeployer] No createUnitCallback set!');
        continue;
      }

      const unitInfo = this.createUnitCallback(
        placed.unitType,
        grid.team,
        spawnPos
      );
      spawnedUnits.push({
        unitId: unitInfo.id,
        position: unitInfo.position,
        targetX: enemyBaseX,
      });
      unitCount++;
    }

    // Clear pending units
    this.gridData.clearPendingUnits(playerId);

    // Emit formation committed event
    this.eventBus.emit<FormationCommittedEvent>(
      GameEvents.FORMATION_COMMITTED,
      {
        ...createEvent(),
        playerId,
        unitCount,
      }
    );

    // Issue move commands
    for (const { unitId, position, targetX } of spawnedUnits) {
      const targetPos = new Vector3(targetX, 1, position.z);

      if (this.moveUnitCallback) {
        this.moveUnitCallback(unitId, targetPos);
      } else {
        this.eventBus.emit(GameEvents.MOVE_REQUESTED, {
          ...createEvent(),
          entityId: unitId,
          target: targetPos,
        });
      }
    }

    return unitCount;
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    this.createUnitCallback = null;
    this.moveUnitCallback = null;
  }
}
