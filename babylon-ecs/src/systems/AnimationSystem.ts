import { Vector3 } from '@babylonjs/core';
import { Entity } from '../entities/Entity';
import { EntityManager } from '../core/EntityManager';
import {
  ComponentType,
  AnimationComponent,
  AnimationState,
  RotationComponent,
} from '../components';
import { BloodEffect } from '../effects/BloodEffect';
import type { Scene } from '@babylonjs/core';

/**
 * AnimationSystem - Handles all animation logic for entities
 *
 * Follows the ECS pattern: contains logic, entities store data in components
 *
 * Responsibilities:
 * - Play/transition animations (idle, run, attack, death)
 * - Handle animation blending/crossfade
 * - Update animation state based on entity state
 * - Trigger visual effects (blood on damage)
 */
export class AnimationSystem {
  private entityManager: EntityManager;
  private scene: Scene;

  constructor(entityManager: EntityManager, scene: Scene) {
    this.entityManager = entityManager;
    this.scene = scene;
  }

  /**
   * Update animations for all entities with AnimationComponent
   * Should be called in the render loop
   */
  public update(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Animation);

    for (const entity of entities) {
      const anim = entity.getComponent<AnimationComponent>(
        ComponentType.Animation
      );
      if (!anim || !anim.isModelLoaded) continue;

      this.updateEntityAnimation(anim);
    }
  }

  /**
   * Update animation state for a single entity
   */
  private updateEntityAnimation(anim: AnimationComponent): void {
    // Skip if dying or dead
    if (
      anim.isDying ||
      anim.currentState === AnimationState.Dying ||
      anim.currentState === AnimationState.Dead
    ) {
      return;
    }

    // Check if we need to force run animation (set by combat system when movement starts)
    if (anim.shouldForceRunAnimation) {
      anim.shouldForceRunAnimation = false;
      this.forcePlayRunAnimation(anim);
      return;
    }

    // Don't interrupt active attack animation
    if (anim.isAttacking) return;

    // Don't transition to idle while in combat - stay in attack state
    if (anim.isInCombat) return;

    // Default to running if not already
    if (anim.currentState !== AnimationState.Running) {
      this.playRunAnimation(anim);
    }
  }

  /**
   * Play idle animation with crossfade
   */
  public playIdleAnimation(anim: AnimationComponent): void {
    if (!anim.isModelLoaded) return;
    if (anim.isDying || anim.currentState === AnimationState.Dying) return;
    if (anim.currentState === AnimationState.Idle) return;

    const animation = anim.getAnimation(anim.animationNames.idle);
    if (animation) {
      this.crossFadeToAnimation(anim, animation, true, 1.0);
      anim.currentState = AnimationState.Idle;
    }
  }

  /**
   * Play run animation with crossfade
   */
  public playRunAnimation(anim: AnimationComponent): void {
    if (!anim.isModelLoaded) return;
    if (anim.isDying || anim.currentState === AnimationState.Dying) return;
    if (anim.currentState === AnimationState.Running) return;
    if (anim.isAttacking) return; // Don't interrupt attack animation

    const animation = anim.getAnimation(anim.animationNames.run);
    if (animation) {
      this.crossFadeToAnimation(anim, animation, true, 1.0);
      anim.currentState = AnimationState.Running;
    }
  }

  /**
   * Force play run animation - bypasses normal checks
   * Used when transitioning from combat to movement
   */
  private forcePlayRunAnimation(anim: AnimationComponent): void {
    if (!anim.isModelLoaded) return;
    if (anim.isDying || anim.currentState === AnimationState.Dying) return;
    if (anim.currentState === AnimationState.Running) return;

    // Clear combat state
    anim.isInCombat = false;
    anim.isAttacking = false;

    const animation = anim.getAnimation(anim.animationNames.run);
    if (animation) {
      this.crossFadeToAnimation(anim, animation, true, 1.0);
      anim.currentState = AnimationState.Running;
    }
  }

  /**
   * Play attack animation with crossfade
   * Chains attack animations when in combat (alternates between attacks)
   *
   * NOTE: This is purely VISUAL. Damage is applied deterministically in CombatSystem
   * during the simulation tick, not at the animation hit point.
   *
   * @param anim Animation component
   * @returns true if attack animation started
   */
  public playAttackAnimation(anim: AnimationComponent): boolean {
    if (!anim.isModelLoaded) return false;
    if (anim.isDying || anim.currentState === AnimationState.Dying)
      return false;
    if (anim.isAttacking) return false;

    // Alternate between attack animations for variety
    const attackAnims = anim.animationNames.attacks;
    if (attackAnims.length === 0) return false;

    const animIndex = (anim.lastAttackAnimIndex + 1) % attackAnims.length;
    anim.lastAttackAnimIndex = animIndex;
    const attackAnimName = attackAnims[animIndex];

    const animation = anim.getAnimation(attackAnimName);
    if (!animation) return false;

    // Mark as attacking and in combat
    anim.isAttacking = true;
    anim.isInCombat = true;
    anim.currentState = AnimationState.Attacking;

    // Use crossfade to smoothly transition to attack animation
    this.crossFadeToAnimation(anim, animation, false, 1.2);

    // On animation end, allow next attack or transition out
    animation.onAnimationGroupEndObservable.addOnce(() => {
      // Don't transition if dying
      if (anim.isDying || anim.currentState === AnimationState.Dying) {
        anim.isAttacking = false;
        anim.isInCombat = false;
        return;
      }

      // Clear attacking flag to allow next attack
      anim.isAttacking = false;
      // Combat system will trigger next attack or movement will resume
    });

    return true;
  }

  /**
   * Start death sequence
   * @param anim Animation component
   * @param onComplete Callback when death animation finishes
   */
  public startDeathSequence(
    anim: AnimationComponent,
    onComplete: () => void
  ): void {
    if (anim.isDying) return;

    anim.isDying = true;
    anim.onDeathComplete = onComplete;

    // Stop any current actions
    anim.isAttacking = false;
    anim.isInCombat = false;

    this.playDeathAnimation(anim);
  }

  /**
   * Play death animation
   */
  private playDeathAnimation(anim: AnimationComponent): void {
    if (!anim.isModelLoaded) {
      // If model not loaded, complete immediately
      anim.onDeathComplete?.();
      return;
    }

    if (
      anim.currentState === AnimationState.Dying ||
      anim.currentState === AnimationState.Dead
    ) {
      return;
    }

    this.stopAllAnimations(anim);
    const animation = anim.getAnimation(anim.animationNames.death);

    if (animation) {
      animation.start(false, 1.0);
      anim.currentState = AnimationState.Dying;

      animation.onAnimationGroupEndObservable.addOnce(() => {
        anim.currentState = AnimationState.Dead;
        anim.onDeathComplete?.();
      });
    } else {
      // No animation found, complete immediately
      anim.onDeathComplete?.();
    }
  }

  /**
   * Stop all animations immediately
   */
  private stopAllAnimations(anim: AnimationComponent): void {
    for (const animation of anim.animationGroups) {
      animation.stop();
    }
  }

  /**
   * Crossfade to a target animation for smooth transitions
   */
  private crossFadeToAnimation(
    anim: AnimationComponent,
    targetAnim: import('@babylonjs/core').AnimationGroup,
    loop: boolean,
    speed: number = 1.0
  ): void {
    // Start the target animation if not already playing
    if (!targetAnim.isPlaying) {
      targetAnim.start(loop, speed);
      targetAnim.setWeightForAllAnimatables(0);
    }

    const blendSpeed = anim.animationBlendSpeed;

    // Fade out other animations while fading in target
    const fadeIn = () => {
      let allFaded = true;

      for (const animation of anim.animationGroups) {
        if (animation === targetAnim) {
          // Fade in target animation
          const currentWeight = animation.animatables[0]?.weight ?? 0;
          const newWeight = Math.min(1, currentWeight + blendSpeed);
          animation.setWeightForAllAnimatables(newWeight);
          if (newWeight < 1) allFaded = false;
        } else if (animation.isPlaying) {
          // Fade out other animations
          const currentWeight = animation.animatables[0]?.weight ?? 1;
          const newWeight = Math.max(0, currentWeight - blendSpeed);
          animation.setWeightForAllAnimatables(newWeight);
          if (newWeight > 0) {
            allFaded = false;
          } else {
            animation.stop();
          }
        }
      }

      if (!allFaded && targetAnim.isPlaying) {
        requestAnimationFrame(fadeIn);
      }
    };

    requestAnimationFrame(fadeIn);
  }

  /**
   * End combat mode for an entity
   * Allows transition back to idle/run animations
   */
  public endCombat(anim: AnimationComponent): void {
    anim.isInCombat = false;
  }

  /**
   * Notify that movement has started - triggers run animation
   */
  public notifyMovementStarted(anim: AnimationComponent): void {
    anim.shouldForceRunAnimation = true;
  }

  /**
   * Show blood effect at entity position
   */
  public showBloodEffect(entity: Entity): void {
    const position = entity.position.clone();
    position.y += 1; // Blood at chest height
    new BloodEffect(this.scene, position);
  }

  /**
   * Orient entity to face a target position (sets rotation target)
   */
  public orientToTarget(entity: Entity, targetPosition: Vector3): void {
    const rotation = entity.getComponent<RotationComponent>(
      ComponentType.Rotation
    );
    if (!rotation || !rotation.transformNode) return;

    // Calculate direction from entity to target
    const direction = targetPosition.subtract(entity.position);
    direction.y = 0; // Ignore vertical difference

    if (direction.lengthSquared() < 0.001) return; // Too close, skip rotation

    // Calculate the angle to face the target
    const targetRotationY = Math.atan2(direction.x, direction.z);
    rotation.setTargetRotation(targetRotationY);
  }

  /**
   * Orient entity along its default movement direction and trigger run animation
   */
  public orientToMovementDirection(entity: Entity): void {
    const rotation = entity.getComponent<RotationComponent>(
      ComponentType.Rotation
    );
    const anim = entity.getComponent<AnimationComponent>(
      ComponentType.Animation
    );

    if (rotation) {
      rotation.setTargetRotation(rotation.defaultRotationY);
    }

    if (anim) {
      anim.shouldForceRunAnimation = true;
    }
  }

  public dispose(): void {
    // No cleanup needed currently
  }
}
