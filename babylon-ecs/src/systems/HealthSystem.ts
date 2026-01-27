import { EntityManager } from '../core/EntityManager';
import { EventBus } from '../core/EventBus';
import {
  ComponentType,
  HealthComponent,
  AnimationComponent,
  MovementComponent,
} from '../components';
import { Entity } from '../entities/Entity';
import { GameEvents, createEvent } from '../events';
import type {
  DamageRequestedEvent,
  DamageAppliedEvent,
  HealRequestedEvent,
  EntityDyingEvent,
  EntityDestroyedEvent,
} from '../events';
import type { AnimationSystem } from './AnimationSystem';

/**
 * HealthSystem - Manages entity health and destruction
 * Follows Single Responsibility: Only handles health-related logic
 * Uses EventBus for decoupled communication
 */
export class HealthSystem {
  private entityManager: EntityManager;
  private eventBus: EventBus;
  private unsubscribers: (() => void)[] = [];
  private animationSystem: AnimationSystem | null = null;

  constructor(entityManager: EntityManager, eventBus: EventBus) {
    this.entityManager = entityManager;
    this.eventBus = eventBus;

    this.setupEventListeners();
  }

  /**
   * Set the AnimationSystem reference for triggering death animations
   */
  public setAnimationSystem(animationSystem: AnimationSystem): void {
    this.animationSystem = animationSystem;
  }

  private setupEventListeners(): void {
    // Listen for damage requests from other systems
    this.unsubscribers.push(
      this.eventBus.on<DamageRequestedEvent>(
        GameEvents.DAMAGE_REQUESTED,
        (event) => {
          this.applyDamageById(event.entityId, event.amount, event.sourceId);
        }
      )
    );

    // Listen for heal requests
    this.unsubscribers.push(
      this.eventBus.on<HealRequestedEvent>(
        GameEvents.HEAL_REQUESTED,
        (event) => {
          const entity = this.entityManager.getEntity(event.entityId);
          if (entity) {
            this.heal(entity, event.amount);
          }
        }
      )
    );
  }

  /**
   * Apply damage to an entity
   * @returns true if entity was destroyed by this damage
   */
  public applyDamage(
    entity: Entity,
    amount: number,
    sourceId?: number
  ): boolean {
    const health = entity.getComponent<HealthComponent>(ComponentType.Health);
    if (!health) return false;

    const wasDestroyed = health.takeDamage(amount);

    // Show blood effect via AnimationSystem if available
    const animComp = entity.getComponent<AnimationComponent>(
      ComponentType.Animation
    );
    if (animComp && this.animationSystem) {
      this.animationSystem.showBloodEffect(entity);
    }

    // Emit damage applied event
    this.eventBus.emit<DamageAppliedEvent>(GameEvents.DAMAGE_APPLIED, {
      ...createEvent(),
      entityId: entity.id,
      amount,
      newHealth: health.health,
      maxHealth: health.maxHealth,
      sourceId,
    });

    if (wasDestroyed) {
      // Handle death differently for entities with AnimationComponent
      if (animComp && this.animationSystem) {
        // Stop any ongoing movement immediately
        const movement = entity.getComponent<MovementComponent>(
          ComponentType.Movement
        );
        if (movement) {
          movement.stop();
        }

        // Mark entity to be ignored by physics (dying units shouldn't move or collide)
        entity.ignorePhysics = true;

        // Emit entity dying event immediately (for health bar removal, etc.)
        this.eventBus.emit<EntityDyingEvent>(GameEvents.ENTITY_DYING, {
          ...createEvent(),
          entityId: entity.id,
        });

        // Start death sequence via AnimationSystem - unit will be destroyed when animation completes
        this.animationSystem.startDeathSequence(animComp, () => {
          // Emit entity destroyed event before destroying
          this.eventBus.emit<EntityDestroyedEvent>(
            GameEvents.ENTITY_DESTROYED,
            {
              ...createEvent(),
              entityId: entity.id,
              position: entity.position.clone(),
            }
          );

          entity.destroy();
        });
      } else {
        // For other entities, destroy immediately
        // Emit entity destroyed event before destroying
        this.eventBus.emit<EntityDestroyedEvent>(GameEvents.ENTITY_DESTROYED, {
          ...createEvent(),
          entityId: entity.id,
          position: entity.position.clone(),
        });

        entity.destroy();
      }
    }

    return wasDestroyed;
  }

  /**
   * Apply damage to an entity by ID
   * @returns true if entity was destroyed by this damage
   */
  public applyDamageById(
    entityId: number,
    amount: number,
    sourceId?: number
  ): boolean {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) return false;

    return this.applyDamage(entity, amount, sourceId);
  }

  /**
   * Heal an entity
   */
  public heal(entity: Entity, amount: number): void {
    const health = entity.getComponent<HealthComponent>(ComponentType.Health);
    health?.heal(amount);
  }

  /**
   * Get current health of an entity
   */
  public getHealth(entity: Entity): number | undefined {
    const health = entity.getComponent<HealthComponent>(ComponentType.Health);
    return health?.health;
  }

  /**
   * Get health percentage of an entity (0-1)
   */
  public getHealthPercent(entity: Entity): number | undefined {
    const health = entity.getComponent<HealthComponent>(ComponentType.Health);
    return health?.healthPercent;
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
