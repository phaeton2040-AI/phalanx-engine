import { Vector3 } from '@babylonjs/core';
import type { PhalanxClient, PlayerCommand, CommandsBatch } from 'phalanx-client';
import type { EventBus } from './EventBus';
import type { MovementSystem } from '../systems/MovementSystem';
import type { PhysicsSystem } from '../systems/PhysicsSystem';
import type { CombatSystem } from '../systems/CombatSystem';
import type { ProjectileSystem } from '../systems/ProjectileSystem';
import type { TerritorySystem } from '../systems/TerritorySystem';
import type { ResourceSystem } from '../systems/ResourceSystem';
import type { FormationGridSystem } from '../systems/FormationGridSystem';
import type { WaveSystem } from '../systems/WaveSystem';
import { TeamTag } from '../enums/TeamTag';
import { networkConfig } from '../config/constants';
import { GameEvents, createEvent } from '../events';
import type {
  NetworkCommand,
  NetworkMoveCommand,
  NetworkPlaceUnitCommand,
  NetworkMoveGridUnitCommand,
} from './NetworkCommands';

/**
 * Callbacks for LockstepManager to interact with the game
 */
export interface LockstepCallbacks {
  /** Called when cleanup is needed after simulation tick */
  onCleanupNeeded: () => void;
  /** Called to show a notification to the user */
  onNotification: (message: string, type: 'info' | 'warning') => void;
  /** Called to update the commit button UI */
  onCommitButtonUpdate: () => void;
  /** Get the local player's team */
  getLocalTeam: () => TeamTag;
  /** Get the local player's ID */
  getLocalPlayerId: () => string;
}

/**
 * Systems required by LockstepManager
 */
export interface LockstepSystems {
  movementSystem: MovementSystem;
  physicsSystem: PhysicsSystem;
  combatSystem: CombatSystem;
  projectileSystem: ProjectileSystem;
  territorySystem: TerritorySystem;
  resourceSystem: ResourceSystem;
  formationGridSystem: FormationGridSystem;
  waveSystem: WaveSystem;
  eventBus: EventBus;
}

/**
 * LockstepManager - Handles deterministic command execution and simulation
 *
 * Responsible for:
 * - Executing commands received from the network
 * - Running deterministic simulation ticks
 * - Sending local commands to the server
 *
 * Network synchronization and timing are delegated to PhalanxClient.
 */
export class LockstepManager {
  private systems: LockstepSystems;
  private callbacks: LockstepCallbacks;
  private client: PhalanxClient;

  constructor(
    client: PhalanxClient,
    systems: LockstepSystems,
    callbacks: LockstepCallbacks
  ) {
    this.client = client;
    this.systems = systems;
    this.callbacks = callbacks;
  }

  /**
   * Process a tick with commands from all players
   * This is called by PhalanxClient's onTick handler
   */
  public processTick(tick: number, commandsBatch: CommandsBatch): void {
    // Flatten commands from all players
    const allCommands: PlayerCommand[] = [];
    for (const playerId in commandsBatch.commands) {
      allCommands.push(...commandsBatch.commands[playerId]);
    }

    // Execute all commands for this tick
    this.executeTickCommands(allCommands);

    // Run one tick of deterministic simulation
    this.simulateTick();

    // Process resources deterministically based on tick
    this.systems.resourceSystem.processTick(tick);

    // Process wave system (handles wave timing and auto-deployment)
    this.systems.waveSystem.processTick(tick);

    // Cleanup destroyed entities
    this.callbacks.onCleanupNeeded();
  }

  /**
   * Queue a command to be sent to the server
   * Commands are automatically flushed by PhalanxClient each frame
   */
  public queueCommand(command: NetworkCommand): void {
    this.client.sendCommand(command.type, command.data);
  }

  /**
   * Execute all commands for a single tick
   * Commands from ALL players are executed - no skipping of "own" commands
   */
  public executeTickCommands(commands: PlayerCommand[]): void {
    const localTeam = this.callbacks.getLocalTeam();
    const localPlayerId = this.callbacks.getLocalPlayerId();

    for (const cmd of commands) {
      if (cmd.type === 'move') {
        const moveCmd = cmd as NetworkMoveCommand;
        const data = moveCmd.data;

        console.log(
          `[Lockstep] Executing move for entity ${data.entityId} to (${data.targetX}, ${data.targetY}, ${data.targetZ})`
        );

        // Execute move command for ANY entity (not just opponent's)
        this.systems.movementSystem.moveEntityTo(
          data.entityId,
          new Vector3(data.targetX, data.targetY, data.targetZ)
        );
      } else if (cmd.type === 'placeUnit') {
        const placeCmd = cmd as NetworkPlaceUnitCommand;
        const data = placeCmd.data;
        const commandPlayerId = (cmd as any).playerId as string | undefined;

        if (!commandPlayerId) {
          console.warn(
            `[Lockstep] placeUnit command missing playerId:`,
            JSON.stringify(cmd)
          );
          continue;
        }

        console.log(
          `[Lockstep] Executing placeUnit for player ${commandPlayerId}: ${data.unitType} at (${data.gridX}, ${data.gridZ})`
        );

        // Place unit on the player's grid
        if (
          this.systems.formationGridSystem.placeUnit(
            commandPlayerId,
            data.gridX,
            data.gridZ,
            data.unitType
          )
        ) {
          // Determine team based on player
          const team =
            commandPlayerId === localPlayerId
              ? localTeam
              : localTeam === TeamTag.Team1
                ? TeamTag.Team2
                : TeamTag.Team1;

          // Deduct resources
          this.systems.eventBus.emit(GameEvents.UNIT_PURCHASE_REQUESTED, {
            ...createEvent(),
            playerId: commandPlayerId,
            team: team,
            unitType: data.unitType,
            gridPosition: { x: data.gridX, z: data.gridZ },
          });
        }
      } else if (cmd.type === 'deployUnits') {
        const commandPlayerId = (cmd as any).playerId as string | undefined;

        if (!commandPlayerId) {
          console.warn(
            `[Lockstep] deployUnits command missing playerId:`,
            JSON.stringify(cmd)
          );
          continue;
        }

        console.log(
          `[Lockstep] Executing deployUnits for player ${commandPlayerId}`
        );

        // Commit the player's formation
        const unitCount =
          this.systems.formationGridSystem.commitFormation(commandPlayerId);

        // Show notification for local player
        if (commandPlayerId === localPlayerId) {
          if (unitCount > 0) {
            this.callbacks.onNotification(
              `Deployed ${unitCount} units!`,
              'info'
            );
          }
          this.callbacks.onCommitButtonUpdate();
        }
      } else if (cmd.type === 'moveGridUnit') {
        const moveGridCmd = cmd as NetworkMoveGridUnitCommand;
        const data = moveGridCmd.data;
        const commandPlayerId = (cmd as any).playerId as string | undefined;

        if (!commandPlayerId) {
          console.warn(
            `[Lockstep] moveGridUnit command missing playerId:`,
            JSON.stringify(cmd)
          );
          continue;
        }

        console.log(
          `[Lockstep] Executing moveGridUnit for player ${commandPlayerId}: from (${data.fromGridX}, ${data.fromGridZ}) to (${data.toGridX}, ${data.toGridZ})`
        );

        // Move unit on the player's grid
        this.systems.formationGridSystem.moveUnit(
          commandPlayerId,
          data.fromGridX,
          data.fromGridZ,
          data.toGridX,
          data.toGridZ
        );
      }
    }
  }

  /**
   * Run one tick of deterministic game simulation
   * All systems update based on the fixed tick timestep
   */
  public simulateTick(): void {
    // Update physics (runs multiple substeps internally for accuracy)
    this.systems.physicsSystem.simulateTick();

    // Update movement system (check for completed movements)
    this.systems.movementSystem.update();

    // Update combat (target selection, attack cooldowns)
    this.systems.combatSystem.simulateTick();

    // Update projectiles (movement, hit detection)
    this.systems.projectileSystem.simulateTick();

    // Update territory system (for visual feedback)
    this.systems.territorySystem.update(networkConfig.tickTimestep);

    // Cleanup destroyed entities
    this.callbacks.onCleanupNeeded();
  }
}
