import { EntityManager } from '../core/EntityManager';
import { ComponentType, RotationComponent } from '../components';

/**
 * RotationSystem - Handles smooth rotation interpolation for entities
 *
 * Follows ECS pattern: contains logic, entities store data in components
 *
 * Responsibilities:
 * - Interpolate rotation towards target
 * - Handle shortest rotation path
 * - Clear target when reached
 */
export class RotationSystem {
  private entityManager: EntityManager;

  constructor(entityManager: EntityManager) {
    this.entityManager = entityManager;
  }

  /**
   * Update rotation for all entities with RotationComponent
   * Should be called in the render loop
   * @param deltaTime Time since last frame in seconds
   */
  public update(deltaTime: number): void {
    const entities = this.entityManager.queryEntities(ComponentType.Rotation);

    for (const entity of entities) {
      const rotation = entity.getComponent<RotationComponent>(
        ComponentType.Rotation
      );
      if (
        !rotation ||
        !rotation.transformNode ||
        rotation.targetRotationY === null
      ) {
        continue;
      }

      this.updateEntityRotation(rotation, deltaTime);
    }
  }

  /**
   * Update rotation interpolation for a single entity
   */
  private updateEntityRotation(
    rotation: RotationComponent,
    deltaTime: number
  ): void {
    const transformNode = rotation.transformNode;
    if (!transformNode || rotation.targetRotationY === null) return;

    // Clear quaternion if set (GLB models use quaternion by default)
    transformNode.rotationQuaternion = null;

    const currentRotation = transformNode.rotation.y;
    const targetRotation = rotation.targetRotationY;

    // Calculate the shortest rotation direction
    let diff = targetRotation - currentRotation;

    // Normalize to [-PI, PI] for shortest path
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // Check if we're close enough to snap
    const snapThreshold = 0.01;
    if (Math.abs(diff) < snapThreshold) {
      transformNode.rotation.y = targetRotation;
      rotation.clearTarget(); // Clear target, we've reached it
      return;
    }

    // Interpolate towards target rotation
    const maxRotation = rotation.rotationSpeed * deltaTime;
    const rotationStep =
      Math.sign(diff) * Math.min(Math.abs(diff), maxRotation);

    transformNode.rotation.y = currentRotation + rotationStep;
  }

  public dispose(): void {
    // No cleanup needed currently
  }
}
