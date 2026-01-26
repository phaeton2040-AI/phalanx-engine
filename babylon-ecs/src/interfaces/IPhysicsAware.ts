/**
 * Interface for entities that can be ignored by the physics system.
 * Entities implementing this interface can signal when they should not
 * participate in physics calculations (e.g., dying units).
 */
export interface IPhysicsIgnorable {
  /**
   * Returns true if this entity should be ignored by the physics system.
   * Used for dying units, phasing units, etc.
   */
  shouldIgnorePhysics(): boolean;
}

/**
 * Interface for entities that have a dying state.
 * This is used by various systems to check if an entity is in
 * a death sequence and should be treated differently.
 */
export interface IDyingEntity {
  /**
   * Returns true if this entity is currently in its death sequence.
   */
  readonly isDying: boolean;
}

/**
 * Type guard to check if an entity implements IPhysicsIgnorable
 */
export function isPhysicsIgnorable(
  entity: unknown
): entity is IPhysicsIgnorable {
  return (
    entity !== null &&
    typeof entity === 'object' &&
    'shouldIgnorePhysics' in entity &&
    typeof (entity as IPhysicsIgnorable).shouldIgnorePhysics === 'function'
  );
}

/**
 * Type guard to check if an entity implements IDyingEntity
 */
export function isDyingEntity(entity: unknown): entity is IDyingEntity {
  return entity !== null && typeof entity === 'object' && 'isDying' in entity;
}
