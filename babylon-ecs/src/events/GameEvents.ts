/**
 * Event type constants for the game
 * Using constants ensures type safety and prevents typos
 */
export const GameEvents = {
    // Combat events
    ATTACK_REQUESTED: 'combat:attackRequested',
    PROJECTILE_SPAWNED: 'combat:projectileSpawned',
    PROJECTILE_HIT: 'combat:projectileHit',

    // Health events
    DAMAGE_REQUESTED: 'health:damageRequested',
    DAMAGE_APPLIED: 'health:damageApplied',
    HEAL_REQUESTED: 'health:healRequested',
    ENTITY_DESTROYED: 'health:entityDestroyed',

    // Movement events
    MOVE_REQUESTED: 'movement:moveRequested',
    MOVE_STARTED: 'movement:moveStarted',
    MOVE_COMPLETED: 'movement:moveCompleted',
    STOP_REQUESTED: 'movement:stopRequested',

    // Selection events
    SELECT_ENTITY_REQUESTED: 'selection:selectRequested',
    DESELECT_ENTITY_REQUESTED: 'selection:deselectRequested',
    DESELECT_ALL_REQUESTED: 'selection:deselectAllRequested',
    ENTITY_SELECTED: 'selection:entitySelected',
    ENTITY_DESELECTED: 'selection:entityDeselected',
    SELECTION_CLEARED: 'selection:selectionCleared',

    // Input events
    LEFT_CLICK: 'input:leftClick',
    RIGHT_CLICK: 'input:rightClick',
    GROUND_CLICKED: 'input:groundClicked',

    // Entity lifecycle events
    ENTITY_CREATED: 'entity:created',
    ENTITY_DISPOSED: 'entity:disposed',

    // UI events
    SHOW_DESTINATION_MARKER: 'ui:showDestinationMarker',
    HIDE_DESTINATION_MARKER: 'ui:hideDestinationMarker',
} as const;

export type GameEventType = typeof GameEvents[keyof typeof GameEvents];

