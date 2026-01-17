# Development Guide

This guide explains the architectural approach used in the Babylon RTS Demo and provides instructions for adding new features.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Concepts](#core-concepts)
  - [Entities](#entities)
  - [Components](#components)
  - [Systems](#systems)
  - [EventBus](#eventbus)
  - [EntityManager](#entitymanager)
- [Adding New Features](#adding-new-features)
  - [Adding a New Component](#adding-a-new-component)
  - [Adding a New Entity](#adding-a-new-entity)
  - [Adding a New System](#adding-a-new-system)
  - [Adding New Events](#adding-new-events)
- [Best Practices](#best-practices)

---

## Architecture Overview

This project uses a **component-based Entity-Component-System (ECS)** architecture with an **event-driven communication pattern**.

```
┌─────────────────────────────────────────────────────────────┐
│                          Game.ts                             │
│              (Orchestrates initialization & game loop)       │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌───────────────────┐
│ EntityManager │   │    EventBus     │   │   SceneManager    │
│  (Registry)   │   │ (Communication) │   │ (Babylon.js Scene)│
└───────────────┘   └─────────────────┘   └───────────────────┘
        │                     │
        │           ┌─────────┴─────────┐
        │           │                   │
        ▼           ▼                   ▼
┌───────────────────────────────────────────────────────────────┐
│                          Systems                               │
│  CombatSystem │ MovementSystem │ HealthSystem │ SelectionSystem│
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│                          Entities                              │
│               Unit        │        Tower        │   Projectile │
│    ┌────────────────────────────────────────────────────────┐ │
│    │                    Components                           │ │
│    │  TeamComponent │ HealthComponent │ AttackComponent │... │ │
│    └────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Composition over Inheritance**: Entities are composed of components rather than using deep inheritance hierarchies
2. **Decoupled Systems**: Systems communicate via EventBus, not direct references
3. **Single Responsibility**: Each system handles one aspect of game logic
4. **Data-Driven**: Components are primarily data containers; logic lives in systems

---

## Core Concepts

### Entities

Entities are containers for components. They have:
- A unique `id`
- A reference to the Babylon.js `Scene`
- A visual `Mesh`
- A `Map` of components

**Base Entity Class** (`src/entities/Entity.ts`):

```typescript
export abstract class Entity {
    public readonly id: number;
    protected scene: Scene;
    protected mesh: Mesh | null = null;
    protected components: Map<symbol, IComponent> = new Map();
    
    // Component management
    addComponent<T extends IComponent>(component: T): T
    getComponent<T extends IComponent>(type: symbol): T | undefined
    hasComponent(type: symbol): boolean
    hasComponents(...types: symbol[]): boolean
    removeComponent(type: symbol): boolean
}
```

**Existing Entities**:
- `Unit` - Movable combat unit with health, attack, movement, and team
- `Tower` - Stationary defense structure with health, attack, and team
- `Projectile` - Temporary entity for visual attack effects

---

### Components

Components are pure data containers that implement `IComponent`. Each component has a unique `type` symbol for identification.

**Component Interface** (`src/components/Component.ts`):

```typescript
export interface IComponent {
    readonly type: symbol;
}

export const ComponentType = {
    Team: Symbol('Team'),
    Health: Symbol('Health'),
    Attack: Symbol('Attack'),
    Movement: Symbol('Movement'),
    Selectable: Symbol('Selectable'),
    Renderable: Symbol('Renderable'),
} as const;
```

**Existing Components**:

| Component | Purpose | Key Properties |
|-----------|---------|----------------|
| `TeamComponent` | Team affiliation | `team: TeamTag`, `isHostileTo()` |
| `HealthComponent` | Health management | `health`, `maxHealth`, `takeDamage()` |
| `AttackComponent` | Attack capabilities | `range`, `damage`, `cooldown`, `canAttack()` |
| `MovementComponent` | Movement capabilities | `speed`, `targetPosition`, `moveTo()` |

---

### Systems

Systems contain game logic and operate on entities with specific component combinations. They:
- Query entities through `EntityManager`
- Communicate through `EventBus`
- Have an `update()` method called each frame

**Existing Systems**:

| System | Responsibility | Required Components |
|--------|---------------|---------------------|
| `CombatSystem` | Target detection, attack logic | Attack, Team, Health |
| `MovementSystem` | Entity movement | Movement |
| `HealthSystem` | Damage processing, entity destruction | Health |
| `ProjectileSystem` | Projectile movement and collision | - |
| `SelectionSystem` | Entity selection management | - |
| `InputManager` | User input handling | - |

---

### EventBus

The `EventBus` enables decoupled communication between systems using a publish-subscribe pattern.

**Usage**:

```typescript
// Subscribe to an event
const unsubscribe = eventBus.on<MoveRequestedEvent>(
    GameEvents.MOVE_REQUESTED, 
    (event) => {
        console.log(`Move to: ${event.target}`);
    }
);

// Emit an event
eventBus.emit<MoveRequestedEvent>(GameEvents.MOVE_REQUESTED, {
    ...createEvent(),
    entityId: 1,
    target: new Vector3(10, 0, 5),
});

// Unsubscribe when done
unsubscribe();
```

**Event Categories** (defined in `src/events/GameEvents.ts`):
- **Combat**: `ATTACK_REQUESTED`, `PROJECTILE_SPAWNED`, `PROJECTILE_HIT`
- **Health**: `DAMAGE_REQUESTED`, `DAMAGE_APPLIED`, `ENTITY_DESTROYED`
- **Movement**: `MOVE_REQUESTED`, `MOVE_STARTED`, `MOVE_COMPLETED`
- **Selection**: `SELECT_ENTITY_REQUESTED`, `ENTITY_SELECTED`, etc.
- **Input**: `LEFT_CLICK`, `RIGHT_CLICK`, `GROUND_CLICKED`
- **Lifecycle**: `ENTITY_CREATED`, `ENTITY_DISPOSED`

---

### EntityManager

The `EntityManager` is a central registry that provides efficient component-based queries.

**Key Methods**:

```typescript
// Register/remove entities
entityManager.addEntity(entity);
entityManager.removeEntity(entity);

// Query entities by components
const combatants = entityManager.queryEntities(
    ComponentType.Attack,
    ComponentType.Health
);

// Get all entities
const all = entityManager.getAllEntities();

// Get specific entity
const entity = entityManager.getEntity(id);
```

---

## Adding New Features

### Adding a New Component

1. **Create the component file** in `src/components/`:

```typescript
// src/components/ArmorComponent.ts
import type { IComponent } from "./Component";
import { ComponentType } from "./Component";

export class ArmorComponent implements IComponent {
    public readonly type = ComponentType.Armor;
    
    private _armor: number;
    
    constructor(armor: number = 10) {
        this._armor = armor;
    }
    
    public get armor(): number {
        return this._armor;
    }
    
    public reducesDamage(incomingDamage: number): number {
        return Math.max(0, incomingDamage - this._armor);
    }
}
```

2. **Register the component type** in `src/components/Component.ts`:

```typescript
export const ComponentType = {
    // ...existing types
    Armor: Symbol('Armor'),  // Add new type
} as const;
```

3. **Export from index** in `src/components/index.ts`:

```typescript
export * from "./ArmorComponent";
```

4. **Add to entities** that need it:

```typescript
// In Unit.ts or Tower.ts constructor
this.addComponent(new ArmorComponent(5));
```

---

### Adding a New Entity

1. **Create the entity file** in `src/entities/`:

```typescript
// src/entities/Building.ts
import { Scene, Vector3, Mesh, MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import { Entity } from "./Entity";
import { ComponentType, TeamComponent, HealthComponent } from "../components";
import { TeamTag } from "../enums/TeamTag";

export interface BuildingConfig {
    team: TeamTag;
    health?: number;
    color?: Color3;
}

export class Building extends Entity {
    constructor(scene: Scene, config: BuildingConfig, position: Vector3) {
        super(scene);
        
        // Create visual mesh
        this.mesh = this.createMesh(config.color ?? new Color3(0.5, 0.5, 0.5));
        this.mesh.position = position;
        
        // Add components
        this.addComponent(new TeamComponent(config.team));
        this.addComponent(new HealthComponent(config.health ?? 200));
    }
    
    private createMesh(color: Color3): Mesh {
        const mesh = MeshBuilder.CreateBox(`building_${this.id}`, { size: 3 }, this.scene);
        const material = new StandardMaterial(`buildingMat_${this.id}`, this.scene);
        material.diffuseColor = color;
        mesh.material = material;
        return mesh;
    }
    
    public dispose(): void {
        this.mesh?.dispose();
        super.dispose();
    }
}
```

2. **Add creation method** to `SceneManager.ts`:

```typescript
public createBuilding(config: BuildingConfig, position: Vector3): Building {
    return new Building(this.scene, config, position);
}
```

3. **Register in `Game.ts`**:

```typescript
private createBuilding(config: BuildingConfig, position: Vector3): Building {
    const building = this.sceneManager.createBuilding(config, position);
    this.entityManager.addEntity(building);
    return building;
}
```

---

### Adding a New System

1. **Create the system file** in `src/systems/`:

```typescript
// src/systems/ResourceSystem.ts
import { Engine } from "@babylonjs/core";
import { EntityManager } from "../core/EntityManager";
import { EventBus } from "../core/EventBus";
import { ComponentType } from "../components";
import { GameEvents, createEvent } from "../events";

export class ResourceSystem {
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
        // Subscribe to relevant events
        this.unsubscribers.push(
            this.eventBus.on(GameEvents.ENTITY_DESTROYED, (event) => {
                // Handle resource drops, etc.
            })
        );
    }
    
    public update(): void {
        const deltaTime = this.engine.getDeltaTime() / 1000;
        
        // Query entities with Resource component
        const resourceEntities = this.entityManager.queryEntities(
            ComponentType.Resource
        );
        
        for (const entity of resourceEntities) {
            // Process resource logic
        }
    }
    
    public dispose(): void {
        this.unsubscribers.forEach(unsub => unsub());
    }
}
```

2. **Initialize in `Game.ts`**:

```typescript
// In constructor
this.resourceSystem = new ResourceSystem(this.engine, this.entityManager, this.eventBus);

// In game loop (start method)
this.resourceSystem.update();
```

---

### Adding New Events

1. **Define the event type** in `src/events/EventTypes.ts`:

```typescript
export interface ResourceCollectedEvent extends GameEvent {
    entityId: number;
    resourceType: string;
    amount: number;
}
```

2. **Add event constant** in `src/events/GameEvents.ts`:

```typescript
export const GameEvents = {
    // ...existing events
    RESOURCE_COLLECTED: 'resource:collected',
} as const;
```

3. **Export from index** in `src/events/index.ts`:

```typescript
export type { ResourceCollectedEvent } from "./EventTypes";
```

4. **Use in systems**:

```typescript
// Emit
this.eventBus.emit<ResourceCollectedEvent>(GameEvents.RESOURCE_COLLECTED, {
    ...createEvent(),
    entityId: entity.id,
    resourceType: 'gold',
    amount: 50,
});

// Subscribe
this.eventBus.on<ResourceCollectedEvent>(GameEvents.RESOURCE_COLLECTED, (event) => {
    console.log(`Collected ${event.amount} ${event.resourceType}`);
});
```

---

## Best Practices

### Component Design

- ✅ Keep components as **pure data containers**
- ✅ Include helper methods for common calculations
- ✅ Use private fields with getters for read-only access
- ❌ Avoid putting complex game logic in components
- ❌ Avoid component-to-component dependencies

### System Design

- ✅ Each system should have a **single responsibility**
- ✅ Use `EntityManager.queryEntities()` to find relevant entities
- ✅ Communicate with other systems via **EventBus only**
- ✅ Clean up event subscriptions in `dispose()`
- ❌ Avoid direct references between systems
- ❌ Avoid storing entity references (query fresh each frame)

### Event Design

- ✅ Use **past tense** for completed actions: `ENTITY_DESTROYED`
- ✅ Use **requested suffix** for requests: `MOVE_REQUESTED`
- ✅ Include all necessary data in the event payload
- ✅ Use `createEvent()` to include timestamps
- ❌ Avoid circular event chains

### Entity Design

- ✅ Use composition to build entity capabilities
- ✅ Call `dispose()` to clean up Babylon.js resources
- ✅ Register with `EntityManager` after creation
- ❌ Avoid deep inheritance hierarchies

### Performance Tips

- Use `queryEntities()` efficiently - it uses indexed lookups
- Avoid creating new `Vector3` objects in update loops
- Use `deltaTime` for frame-independent movement
- Dispose meshes and materials when entities are destroyed

---

## File Structure Reference

```
src/
├── main.ts                  # Entry point - bootstraps Game
├── style.css                # Global styles
│
├── core/
│   ├── Game.ts              # Main game orchestrator
│   ├── EntityManager.ts     # Entity registry + queries
│   ├── EventBus.ts          # Pub/sub event system
│   └── SceneManager.ts      # Babylon.js scene setup
│
├── entities/
│   ├── Entity.ts            # Base entity class
│   ├── Unit.ts              # Movable combat unit
│   ├── Tower.ts             # Stationary defense
│   └── Projectile.ts        # Attack projectile
│
├── components/
│   ├── Component.ts         # IComponent interface + types
│   ├── TeamComponent.ts     # Team affiliation
│   ├── HealthComponent.ts   # Health management
│   ├── AttackComponent.ts   # Attack capabilities
│   ├── MovementComponent.ts # Movement capabilities
│   └── index.ts             # Re-exports
│
├── systems/
│   ├── CombatSystem.ts      # Attack logic
│   ├── MovementSystem.ts    # Movement logic
│   ├── HealthSystem.ts      # Damage processing
│   ├── ProjectileSystem.ts  # Projectile management
│   ├── SelectionSystem.ts   # Selection management
│   └── InputManager.ts      # User input handling
│
├── events/
│   ├── GameEvents.ts        # Event type constants
│   ├── EventTypes.ts        # Event interfaces
│   └── index.ts             # Re-exports
│
├── effects/
│   └── ExplosionEffect.ts   # Visual explosion effect
│
├── enums/
│   └── TeamTag.ts           # Team enumeration
│
└── interfaces/
    ├── IAttacker.ts
    ├── IDamageable.ts
    ├── IMovable.ts
    ├── ISelectable.ts
    └── ITeamMember.ts
```

