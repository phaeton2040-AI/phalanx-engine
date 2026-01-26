import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
} from '@babylonjs/core';
import type { IDamageable } from '../interfaces/IDamageable';
import { TeamTag } from '../enums/TeamTag';

export interface ProjectileConfig {
  damage: number;
  speed?: number;
  lifetime?: number;
  team: TeamTag;
  sourceId: number; // ID of the entity that fired the projectile
}

/**
 * Projectile entity - Represents a laser beam projectile
 * Follows Single Responsibility: Only handles projectile behavior
 */
export class Projectile {
  private scene: Scene;
  private mesh: Mesh;
  private _direction: Vector3;
  private _speed: number;
  private _damage: number;
  private _lifetime: number;
  private _currentLifetime: number;
  private _team: TeamTag;
  private _sourceId: number;
  private _isDestroyed: boolean = false;

  constructor(
    scene: Scene,
    origin: Vector3,
    direction: Vector3,
    config: ProjectileConfig,
    _target: IDamageable | null = null // Reserved for future homing projectiles
  ) {
    this.scene = scene;
    this._direction = direction.normalize();
    this._speed = config.speed ?? 55;
    this._damage = config.damage;
    this._lifetime = config.lifetime ?? 3;
    this._currentLifetime = this._lifetime;
    this._team = config.team;
    this._sourceId = config.sourceId;

    this.mesh = this.createMesh();
    this.mesh.position = origin.clone();
    this.orientToDirection();
  }

  private createMesh(): Mesh {
    // Create a small cylinder to represent a laser beam
    const mesh = MeshBuilder.CreateCylinder(
      'projectile',
      {
        height: 1.5,
        diameter: 0.15,
        tessellation: 8,
      },
      this.scene
    );

    const material = new StandardMaterial('projectileMat', this.scene);
    // Color based on team
    if (this._team === TeamTag.Team1) {
      material.diffuseColor = new Color3(0, 0.8, 1); // Cyan for player
      material.emissiveColor = new Color3(0, 0.4, 0.5);
    } else {
      material.diffuseColor = new Color3(1, 0.2, 0); // Orange/red for enemy
      material.emissiveColor = new Color3(0.5, 0.1, 0);
    }
    mesh.material = material;

    return mesh;
  }

  private orientToDirection(): void {
    // Orient the cylinder along the direction vector
    // Cylinders are created along Y-axis, so we need to rotate to match direction
    const up = new Vector3(0, 1, 0);
    const axis = Vector3.Cross(up, this._direction);

    if (axis.length() > 0.001) {
      this.mesh.rotationQuaternion = null;
      this.mesh.rotation = Vector3.Zero();

      // Use lookAt for proper orientation
      const targetPos = this.mesh.position.add(this._direction);
      this.mesh.lookAt(targetPos);
      this.mesh.rotation.x += Math.PI / 2; // Adjust for cylinder orientation
    }
  }

  /**
   * Update projectile position and check for collisions
   * @returns true if projectile should be destroyed
   */
  public update(deltaTime: number, targets: IDamageable[]): boolean {
    if (this._isDestroyed) return true;

    // Update lifetime
    this._currentLifetime -= deltaTime;
    if (this._currentLifetime <= 0) {
      this._isDestroyed = true;
      return true;
    }

    // Move projectile
    const movement = this._direction.scale(this._speed * deltaTime);
    this.mesh.position.addInPlace(movement);

    // Check for collision with targets
    for (const target of targets) {
      if (target.isDestroyed()) continue;

      const distance = Vector3.Distance(this.mesh.position, target.position);
      const hitRadius = 1.5; // Collision radius

      if (distance < hitRadius) {
        // Hit target
        target.takeDamage(this._damage);
        this._isDestroyed = true;
        return true;
      }
    }

    return false;
  }

  public get position(): Vector3 {
    return this.mesh.position;
  }

  public get team(): TeamTag {
    return this._team;
  }

  public get sourceId(): number {
    return this._sourceId;
  }

  public get damage(): number {
    return this._damage;
  }

  public get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  public getMesh(): Mesh {
    return this.mesh;
  }

  public destroy(): void {
    this._isDestroyed = true;
  }

  public dispose(): void {
    this.mesh.dispose();
  }
}
