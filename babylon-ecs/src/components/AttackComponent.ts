import type { IComponent } from "./Component";
import { ComponentType } from "./Component";
import { Vector3 } from "@babylonjs/core";

export interface AttackConfig {
    range?: number;
    cooldown?: number;
    damage?: number;
    projectileSpeed?: number;
}

/**
 * AttackComponent - Manages entity attack capabilities
 */
export class AttackComponent implements IComponent {
    public readonly type = ComponentType.Attack;

    private _range: number;
    private _cooldown: number;
    private _damage: number;
    private _projectileSpeed: number;
    private _currentCooldown: number = 0;
    private _attackOriginOffset: Vector3;

    constructor(config: AttackConfig = {}) {
        this._range = config.range ?? 8;
        this._cooldown = config.cooldown ?? 1.0;
        this._damage = config.damage ?? 10;
        this._projectileSpeed = config.projectileSpeed ?? 40; // 15% faster than original 30
        this._attackOriginOffset = Vector3.Zero();
    }

    public get range(): number {
        return this._range;
    }

    public get cooldown(): number {
        return this._cooldown;
    }

    public get damage(): number {
        return this._damage;
    }

    public get projectileSpeed(): number {
        return this._projectileSpeed;
    }

    public get currentCooldown(): number {
        return this._currentCooldown;
    }

    public get attackOriginOffset(): Vector3 {
        return this._attackOriginOffset;
    }

    /**
     * Set the offset from entity position where projectiles spawn
     */
    public setAttackOriginOffset(offset: Vector3): void {
        this._attackOriginOffset = offset.clone();
    }

    /**
     * Check if attack is ready (cooldown complete)
     */
    public canAttack(): boolean {
        return this._currentCooldown <= 0;
    }

    /**
     * Called when attack is performed to reset cooldown
     */
    public onAttackPerformed(): void {
        this._currentCooldown = this._cooldown;
    }

    /**
     * Update cooldown timer
     */
    public updateCooldown(deltaTime: number): void {
        if (this._currentCooldown > 0) {
            this._currentCooldown = Math.max(0, this._currentCooldown - deltaTime);
        }
    }

    /**
     * Get attack origin position given entity world position
     */
    public getAttackOrigin(entityPosition: Vector3): Vector3 {
        return entityPosition.add(this._attackOriginOffset);
    }
}

