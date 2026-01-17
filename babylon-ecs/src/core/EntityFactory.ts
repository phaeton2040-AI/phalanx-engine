import { Vector3, Color3 } from "@babylonjs/core";
import type { SceneManager } from "./SceneManager";
import type { EntityManager } from "./EntityManager";
import type { SelectionSystem } from "../systems/SelectionSystem";
import type { PhysicsSystem } from "../systems/PhysicsSystem";
import type { Unit, UnitConfig } from "../entities/Unit";
import type { PrismaUnit, PrismaUnitConfig } from "../entities/PrismaUnit";
import type { Tower, TowerConfig } from "../entities/Tower";
import type { Base, BaseConfig } from "../entities/Base";
import { TeamTag } from "../enums/TeamTag";
import { arenaParams, unitConfig } from "../config/constants";

/**
 * EntityFactory - Creates and registers game entities
 * 
 * Responsible for:
 * - Creating units, towers, and bases
 * - Registering entities with all necessary systems
 * - Tracking entity ownership
 */
export class EntityFactory {
    private sceneManager: SceneManager;
    private entityManager: EntityManager;
    private selectionSystem: SelectionSystem;
    private physicsSystem: PhysicsSystem;

    // Map entity IDs to player info
    private entityOwnership: Map<number, string> = new Map();

    constructor(
        sceneManager: SceneManager,
        entityManager: EntityManager,
        selectionSystem: SelectionSystem,
        physicsSystem: PhysicsSystem
    ) {
        this.sceneManager = sceneManager;
        this.entityManager = entityManager;
        this.selectionSystem = selectionSystem;
        this.physicsSystem = physicsSystem;
    }

    /**
     * Create a unit and register it with all necessary systems
     */
    public createUnit(config: UnitConfig, position: Vector3): Unit {
        const unit = this.sceneManager.createUnit(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(unit);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(unit);

        // Register with PhysicsSystem - units are dynamic bodies
        this.physicsSystem.registerBody(unit.id, {
            radius: 1.0,
            mass: 1.0,
            isStatic: false,
        });

        return unit;
    }

    /**
     * Create a PrismaUnit and register it with all necessary systems
     */
    public createPrismaUnit(config: PrismaUnitConfig, position: Vector3): PrismaUnit {
        const unit = this.sceneManager.createPrismaUnit(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(unit);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(unit);

        // Register with PhysicsSystem - prisma units are larger dynamic bodies
        this.physicsSystem.registerBody(unit.id, {
            radius: 1.8, // Larger radius for 2x2 unit
            mass: 2.0,   // Heavier unit
            isStatic: false,
        });

        return unit;
    }

    /**
     * Create a tower and register it with all necessary systems
     */
    public createTower(config: TowerConfig, position: Vector3): Tower {
        const tower = this.sceneManager.createTower(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(tower);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(tower);

        // Register with PhysicsSystem - towers are static bodies (can push but don't move)
        this.physicsSystem.registerBody(tower.id, {
            radius: 1.5,
            mass: 10.0,
            isStatic: true,
        });

        return tower;
    }

    /**
     * Create a base and register it with all necessary systems
     */
    public createBase(config: BaseConfig, position: Vector3): Base {
        const base = this.sceneManager.createBase(config, position);

        // Register with EntityManager
        this.entityManager.addEntity(base);

        // Register with SelectionSystem for mesh picking
        this.selectionSystem.registerSelectable(base);

        // Register with PhysicsSystem - bases are static bodies (can push but don't move)
        this.physicsSystem.registerBody(base.id, {
            radius: 3.0,
            mass: 100.0,
            isStatic: true,
        });

        return base;
    }

    /**
     * Create a unit for the formation system
     * Returns the unit info needed for move commands
     */
    public createUnitForFormation(
        unitType: 'sphere' | 'prisma',
        team: TeamTag,
        position: Vector3,
        localPlayerId: string,
        localTeam: TeamTag,
        getOpponentId: () => string
    ): { id: number; position: Vector3 } {
        const color = team === TeamTag.Team1
            ? new Color3(arenaParams.colors.teamA.r, arenaParams.colors.teamA.g, arenaParams.colors.teamA.b)
            : new Color3(arenaParams.colors.teamB.r, arenaParams.colors.teamB.g, arenaParams.colors.teamB.b);

        let unit: Unit | PrismaUnit;

        if (unitType === 'sphere') {
            unit = this.createUnit({
                color,
                team,
                health: unitConfig.sphere.health,
                attackDamage: unitConfig.sphere.attackDamage,
                attackRange: unitConfig.sphere.attackRange,
                attackCooldown: unitConfig.sphere.attackCooldown,
                moveSpeed: unitConfig.sphere.moveSpeed,
            }, position);
        } else {
            unit = this.createPrismaUnit({
                color,
                team,
                health: unitConfig.prisma.health,
                attackDamage: unitConfig.prisma.attackDamage,
                attackRange: unitConfig.prisma.attackRange,
                attackCooldown: unitConfig.prisma.attackCooldown,
                moveSpeed: unitConfig.prisma.moveSpeed,
            }, position);
        }

        // Track ownership
        const playerId = team === localTeam ? localPlayerId : getOpponentId();
        this.entityOwnership.set(unit.id, playerId);

        return { id: unit.id, position: unit.position.clone() };
    }

    /**
     * Set entity ownership
     */
    public setOwnership(entityId: number, playerId: string): void {
        this.entityOwnership.set(entityId, playerId);
    }

    /**
     * Get entity owner
     */
    public getOwner(entityId: number): string | undefined {
        return this.entityOwnership.get(entityId);
    }

    /**
     * Remove entity ownership
     */
    public removeOwnership(entityId: number): void {
        this.entityOwnership.delete(entityId);
    }

    /**
     * Check if entity is owned by player
     */
    public isOwnedBy(entityId: number, playerId: string): boolean {
        return this.entityOwnership.get(entityId) === playerId;
    }

    /**
     * Get all entity ownership entries
     */
    public getOwnershipMap(): Map<number, string> {
        return this.entityOwnership;
    }

    /**
     * Clear all ownership data
     */
    public clear(): void {
        this.entityOwnership.clear();
    }
}
