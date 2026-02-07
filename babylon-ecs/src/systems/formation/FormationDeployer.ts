import { Vector3 } from '@babylonjs/core';
import { EventBus } from '../../core/EventBus';
import {GameEvents, createEvent, type FormationUnitType} from '../../events';
import { arenaParams } from '../../config/constants';
import { FormationGridData } from './FormationGridData';
import type { CreateUnitCallback, MoveUnitCallback } from './FormationTypes';
import type { FormationCommittedEvent } from '../../events';
import type {TeamTag} from "../../enums/TeamTag.ts";

/**
 * Information about a unit pending deployment
 * Matches WaveSystem.PendingUnitInfo interface
 */
export interface DeploymentUnitInfo {
  unitType: FormationUnitType;
  gridX: number;
  gridZ: number;
  team: TeamTag;
}

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

    // Sort units by grid position for deterministic order across clients
    // Sort by gridZ first (front to back), then by gridX (left to right)
    const sortedUnits = [...grid.placedUnits].sort((a, b) => {
      if (a.gridZ !== b.gridZ) return a.gridZ - b.gridZ;
      return a.gridX - b.gridX;
    });

    // Deploy ALL units on the grid
    for (const placed of sortedUnits) {
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
   * Get pending units for staggered deployment
   * Returns array of unit info without deploying them
   * Units are sorted by grid position for deterministic order across clients
   */
  public getPendingUnitsForDeployment(playerId: string): DeploymentUnitInfo[] {
    const grid = this.gridData.getGrid(playerId);
    if (!grid) return [];

    // Map and sort by grid position for deterministic order
    // Sort by gridZ first (front to back), then by gridX (left to right)
    return grid.placedUnits
      .map((placed) => ({
        unitType: placed.unitType,
        gridX: placed.gridX,
        gridZ: placed.gridZ,
        team: grid.team,
      }))
      .sort((a, b) => {
        if (a.gridZ !== b.gridZ) return a.gridZ - b.gridZ;
        return a.gridX - b.gridX;
      });
  }

  /**
   * Deploy a single unit during staggered deployment
   */
  public deploySingleUnit(playerId: string, unitInfo: DeploymentUnitInfo): void {
    const grid = this.gridData.getGrid(playerId);
    if (!grid) return;

    if (!this.createUnitCallback) {
      console.error('[FormationDeployer] No createUnitCallback set!');
      return;
    }

    // Get spawn area and enemy base position
    const teamConfig =
      unitInfo.team === 1 ? arenaParams.teamA : arenaParams.teamB;
    const enemyTeamConfig =
      unitInfo.team === 1 ? arenaParams.teamB : arenaParams.teamA;

    const spawnBaseX = teamConfig.spawnArea.x;
    const enemyBaseX = enemyTeamConfig.base.x;

    // Determine direction towards enemy (Team1 goes right +X, Team2 goes left -X)
    const direction = unitInfo.team === 1 ? 1 : -1;

    // Calculate grid dimensions for relative positioning
    const halfGridWidth = (grid.gridWidth * grid.cellSize) / 2;
    const halfGridHeight = (grid.gridHeight * grid.cellSize) / 2;

    // For Team2, mirror the X coordinate
    let effectiveGridX = unitInfo.gridX;
    const effectiveGridZ = unitInfo.gridZ;

    if (unitInfo.team === 2) {
      effectiveGridX = grid.gridWidth - 1 - unitInfo.gridX;
    }

    // Calculate relative X offset from grid center
    const relativeX = (effectiveGridX + 0.5) * grid.cellSize - halfGridWidth;

    // Calculate relative Z from grid center
    let relativeZ = (effectiveGridZ + 0.5) * grid.cellSize - halfGridHeight;

    // Offset for prisma (center of 2x2)
    if (unitInfo.unitType === 'prisma') {
      relativeZ += grid.cellSize / 2;
    }

    // Spawn position
    const spawnX = spawnBaseX + relativeX * direction;
    const spawnPos = new Vector3(spawnX, 1, relativeZ);

    // Create the unit
    const createdUnit = this.createUnitCallback(
      unitInfo.unitType,
      unitInfo.team,
      spawnPos
    );

    // Issue move command immediately
    const targetPos = new Vector3(enemyBaseX, 1, spawnPos.z);

    if (this.moveUnitCallback) {
      this.moveUnitCallback(createdUnit.id, targetPos);
    } else {
      this.eventBus.emit(GameEvents.MOVE_REQUESTED, {
        ...createEvent(),
        entityId: createdUnit.id,
        target: targetPos,
      });
    }
  }

  /**
   * Finalize deployment for a player - clear pending units and emit event
   */
  public finalizeDeployment(playerId: string, unitCount: number): void {
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
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    this.createUnitCallback = null;
    this.moveUnitCallback = null;
  }
}
