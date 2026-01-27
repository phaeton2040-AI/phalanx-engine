import { Engine, Vector3 } from '@babylonjs/core';
import { EntityManager } from '../core/EntityManager';
import { EventBus } from '../core/EventBus';
import { ComponentType, MovementComponent } from '../components';
import { GameEvents, createEvent } from '../events';
import type {
  MoveStartedEvent,
  MoveCompletedEvent,
  StopRequestedEvent,
} from '../events';

/**
 * MovementSystem - Handles entity movement commands
 * Follows Single Responsibility: Only handles movement logic
 * Uses EventBus for decoupled communication
 *
 * Note: Actual physics movement is handled by PhysicsSystem.
 * This system manages movement intent (targets) and emits events.
 *
 * LOCKSTEP SYNCHRONIZATION:
 * Movement commands are executed via direct moveEntityTo() calls only.
 * The EventBus MOVE_REQUESTED event is used for network routing,
 * not for direct execution (to ensure lockstep synchronization).
 */
export class MovementSystem {
  // @ts-ignore
  private engine: Engine;
  private entityManager: EntityManager;
  private eventBus: EventBus;
  private unsubscribers: (() => void)[] = [];

  constructor(
    engine: Engine,
    entityManager: EntityManager,
    eventBus: EventBus
  ) {
    this.engine = engine;
    this.entityManager = entityManager;
    this.eventBus = eventBus;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // NOTE: We do NOT listen to MOVE_REQUESTED here for lockstep synchronization.
    // Move commands must go through the network and be executed via direct
    // moveEntityTo() calls from Game.ts executeTickCommands().

    // Listen for stop requests
    this.unsubscribers.push(
      this.eventBus.on<StopRequestedEvent>(
        GameEvents.STOP_REQUESTED,
        (event) => {
          this.stopEntity(event.entityId);
        }
      )
    );
  }

  /**
   * Update movement system - check for completed movements
   * Physics movement is handled by PhysicsSystem
   */
  public update(): void {
    // Query all entities with Movement component to check for completed movements
    const movableEntities = this.entityManager.queryEntities(
      ComponentType.Movement
    );

    for (const entity of movableEntities) {
      const movement = entity.getComponent<MovementComponent>(
        ComponentType.Movement
      );
      if (!movement) continue;

      // Check if movement just completed (isMoving became false but we haven't emitted event)
      // The PhysicsSystem sets isMoving to false when arrival threshold is reached
      if (movement.hasJustArrived()) {
        movement.acknowledgeArrival();

        // Emit move completed event
        this.eventBus.emit<MoveCompletedEvent>(GameEvents.MOVE_COMPLETED, {
          ...createEvent(),
          entityId: entity.id,
          position: entity.position.clone(),
        });
      }
    }
  }

  /**
   * Command an entity to move to a position
   */
  public moveEntityTo(entityId: number, target: Vector3): boolean {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) return false;

    // Don't allow entities ignored by physics to move (e.g., dying units)
    if (entity.ignorePhysics) return false;

    const movement = entity.getComponent<MovementComponent>(
      ComponentType.Movement
    );
    if (!movement) return false;

    // Maintain Y position
    const targetWithY = target.clone();
    targetWithY.y = entity.position.y;

    movement.moveTo(targetWithY);

    // Emit move started event
    this.eventBus.emit<MoveStartedEvent>(GameEvents.MOVE_STARTED, {
      ...createEvent(),
      entityId: entity.id,
      target: targetWithY.clone(),
    });

    return true;
  }

  /**
   * Stop an entity's movement
   */
  public stopEntity(entityId: number): void {
    const entity = this.entityManager.getEntity(entityId);
    const movement = entity?.getComponent<MovementComponent>(
      ComponentType.Movement
    );
    movement?.stop();
  }

  /**
   * Dispose and unsubscribe from all events
   */
  public dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }
}
