import { Engine, Vector3 } from "@babylonjs/core";
import { EntityManager } from "../core/EntityManager";
import { EventBus } from "../core/EventBus";
import { ComponentType, MovementComponent } from "../components";
import { GameEvents, createEvent } from "../events";
import type { MoveRequestedEvent, MoveStartedEvent, MoveCompletedEvent, StopRequestedEvent } from "../events";

/**
 * MovementSystem - Handles entity movement using component queries
 * Follows Single Responsibility: Only handles movement logic
 * Uses EventBus for decoupled communication
 */
export class MovementSystem {
    private engine: Engine;
    private entityManager: EntityManager;
    private eventBus: EventBus;
    private unsubscribers: (() => void)[] = [];

    constructor(engine: Engine, entityManager: EntityManager, eventBus: EventBus) {
        this.engine = engine;
        this.entityManager = entityManager;
        this.eventBus = eventBus;

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Listen for move requests
        this.unsubscribers.push(
            this.eventBus.on<MoveRequestedEvent>(GameEvents.MOVE_REQUESTED, (event) => {
                this.moveEntityTo(event.entityId, event.target);
            })
        );

        // Listen for stop requests
        this.unsubscribers.push(
            this.eventBus.on<StopRequestedEvent>(GameEvents.STOP_REQUESTED, (event) => {
                this.stopEntity(event.entityId);
            })
        );
    }

    /**
     * Update all movable entities - called every frame
     */
    public update(): void {
        const deltaTime = this.engine.getDeltaTime() / 1000;

        // Query all entities with Movement component
        const movableEntities = this.entityManager.queryEntities(ComponentType.Movement);

        for (const entity of movableEntities) {
            const movement = entity.getComponent<MovementComponent>(ComponentType.Movement);
            if (!movement || !movement.isMoving) continue;

            const newPosition = movement.calculateMovement(entity.position, deltaTime);

            if (newPosition) {
                // Maintain Y position (ground level)
                newPosition.y = entity.position.y;
                entity.position = newPosition;

                // Check if movement completed
                if (!movement.isMoving) {
                    // Emit move completed event
                    this.eventBus.emit<MoveCompletedEvent>(GameEvents.MOVE_COMPLETED, {
                        ...createEvent(),
                        entityId: entity.id,
                        position: entity.position.clone(),
                    });
                }
            }
        }
    }

    /**
     * Command an entity to move to a position
     */
    public moveEntityTo(entityId: number, target: Vector3): boolean {
        const entity = this.entityManager.getEntity(entityId);
        if (!entity) return false;

        const movement = entity.getComponent<MovementComponent>(ComponentType.Movement);
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
        const movement = entity?.getComponent<MovementComponent>(ComponentType.Movement);
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

