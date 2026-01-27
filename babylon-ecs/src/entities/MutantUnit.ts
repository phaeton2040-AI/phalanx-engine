import {Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3,} from '@babylonjs/core';
import {Entity} from './Entity';
import {
  AnimationComponent,
  AttackComponent,
  AttackLockComponent,
  ComponentType,
  HealthComponent,
  MovementComponent,
  RotationComponent,
  TeamComponent,
  UnitType,
  UnitTypeComponent,
} from '../components';
import {TeamTag} from '../enums/TeamTag';
import {AssetManager} from '../core/AssetManager';

/**
 * Animation names for the Mutant model
 */
const MutantAnimations = {
  idle: 'Mutant Idle 2_6',
  run: 'Mutant Run_5',
  death: 'Mutant Dying_3',
  attacks: ['Standing Melee Attack Backhand_2', 'Mutant Swiping_4'],
} as const;

export interface MutantUnitConfig {
  color?: Color3;
  team?: TeamTag;
  attackRange?: number;
  detectionRange?: number;
  attackCooldown?: number;
  attackDamage?: number;
  health?: number;
  moveSpeed?: number;
  debug?: boolean;
}

/**
 * MutantUnit entity - A thin ECS entity for a melee combat unit
 *
 * Following ECS architecture:
 * - Entity is a container for components and mesh references
 * - All animation/combat/rotation logic is handled by systems
 * - Components store the data, systems process it
 *
 * Components:
 * - TeamComponent: Team affiliation
 * - HealthComponent: Health points
 * - AttackComponent: Attack stats (range, damage, cooldown)
 * - MovementComponent: Movement speed and target
 * - UnitTypeComponent: Unit type identifier
 * - AnimationComponent: Animation state and model references
 * - RotationComponent: Rotation interpolation state
 * - AttackLockComponent: Deterministic attack lock timing
 */
export class MutantUnit extends Entity {
  private selectionIndicator: Mesh;
  private rangeIndicator: Mesh | null = null;
  private _isSelected: boolean = false;
  private _debug: boolean;
  private _color: Color3;
  private _team: TeamTag;

  // Placeholder mesh while model loads
  private placeholderMesh: Mesh;

  // Dispose function for the model instance
  private modelDisposeFunc: (() => void) | null = null;

  constructor(
    scene: Scene,
    config: MutantUnitConfig = {},
    position: Vector3 = new Vector3(0, 0, 0)
  ) {
    super(scene);

    this._debug = config.debug ?? false;
    this._color = config.color ?? new Color3(0.5, 0.3, 0.2);
    this._team = config.team ?? TeamTag.Team1;

    // Create placeholder mesh while model loads
    this.placeholderMesh = this.createPlaceholderMesh();
    this.mesh = this.placeholderMesh;
    this.mesh.position = position.clone();

    this.selectionIndicator = this.createSelectionIndicator();

    // Sync simulation position with mesh position
    this.syncSimulationPosition();

    // Calculate default rotation based on team
    const defaultRotationY =
      this._team === TeamTag.Team1 ? Math.PI / 2 : -Math.PI / 2;

    // Add components - melee unit with big detection, small attack range
    this.addComponent(new TeamComponent(this._team));
    this.addComponent(new HealthComponent(config.health ?? 50));
    this.addComponent(
      new AttackComponent({
        range: config.attackRange ?? 4, // Small melee attack range
        detectionRange: config.detectionRange ?? 30, // Large detection radius
        cooldown: config.attackCooldown ?? 1.2,
        damage: config.attackDamage ?? 12,
        projectileSpeed: 0, // Melee, no projectile
      })
    );
    this.addComponent(new MovementComponent(config.moveSpeed ?? 8));
    this.addComponent(new UnitTypeComponent(UnitType.Mutant));

    // Add animation-related components
    this.addComponent(new AnimationComponent(MutantAnimations, 0.15));
    this.addComponent(new RotationComponent(defaultRotationY, 8.0));
    this.addComponent(new AttackLockComponent(0.8));

    if (this._debug) {
      this.createRangeIndicator();
    }

    // Load the 3D model
    this.loadModel();
  }

  /**
   * Create a placeholder mesh while the model loads
   * Sized for a 2x2 grid unit with wider collision radius to prevent mesh intersection
   */
  private createPlaceholderMesh(): Mesh {
    const mesh = MeshBuilder.CreateCapsule(
      `mutant_placeholder_${this.id}`,
      { height: 4, radius: 8.0 },
      this.scene
    );

    const material = new StandardMaterial(
      `mutantPlaceholderMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = this._color;
    material.alpha = 0.5;
    mesh.material = material;

    return mesh;
  }

  /**
   * Load the GLB model from preloaded assets
   * Since assets are preloaded by AssetManager, this is synchronous
   */
  private loadModel(): void {
    const assetManager = AssetManager.getInstance();
    if (!assetManager) {
      console.error('[MutantUnit] AssetManager not initialized');
      return;
    }

    // Create an instance from the preloaded asset
    const instance = assetManager.createInstance('mutant', `mutant_${this.id}`);
    if (!instance) {
      console.error('[MutantUnit] Failed to create model instance');
      return;
    }

    // Store dispose function
    this.modelDisposeFunc = instance.dispose;

    // Parent the model root directly to the placeholder mesh
    instance.rootNode.parent = this.placeholderMesh;

    // Reset local position (relative to parent)
    instance.rootNode.position = Vector3.Zero();

    // Scale the model appropriately for 2x2 grid size
    instance.rootNode.scaling = new Vector3(0.06, 0.06, 0.06);

    // GLB files use rotationQuaternion which overrides rotation (Euler angles)
    // We need to clear it to use rotation.y
    instance.rootNode.rotationQuaternion = null;

    // Rotate the model root to face the correct direction based on team
    instance.rootNode.rotation.y = this._team === TeamTag.Team1 ? Math.PI / 2 : -Math.PI / 2;

    // Hide placeholder visual but keep it for physics/position tracking
    this.placeholderMesh.visibility = 0;

    // Make meshes pickable and store entity reference
    for (const m of instance.meshes) {
      m.isPickable = true;
      // Store reference to parent entity for selection
      (m as unknown as { entityRef: MutantUnit }).entityRef = this;
    }

    // Parent selection indicator to placeholder (which is the main mesh)
    this.selectionIndicator.parent = this.placeholderMesh;
    this.selectionIndicator.position.y = 0.1;

    // Update components with model data
    const animComponent = this.getComponent<AnimationComponent>(
      ComponentType.Animation
    );
    if (animComponent) {
      animComponent.setModelData(
        instance.rootNode,
        instance.meshes,
        instance.animationGroups
      );
    }

    const rotationComponent = this.getComponent<RotationComponent>(
      ComponentType.Rotation
    );
    if (rotationComponent) {
      rotationComponent.setTransformNode(instance.rootNode);
    }

    // Start idle animation via AnimationSystem (will be picked up on next update)
    // The AnimationSystem will handle this based on component state
  }

  private createRangeIndicator(): void {
    const attack = this.getComponent<AttackComponent>(ComponentType.Attack);
    if (!attack) return;

    this.rangeIndicator = MeshBuilder.CreateSphere(
      `mutantRange_${this.id}`,
      { diameter: attack.range * 2, segments: 32 },
      this.scene
    );
    this.rangeIndicator.parent = this.mesh;
    this.rangeIndicator.position.y = 0;
    this.rangeIndicator.isPickable = false;

    const material = new StandardMaterial(
      `mutantRangeMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = new Color3(1, 0.5, 0);
    material.alpha = 0.15;
    material.wireframe = true;
    this.rangeIndicator.material = material;
  }

  private createSelectionIndicator(): Mesh {
    const indicator = MeshBuilder.CreateTorus(
      `mutantSelCircle_${this.id}`,
      { diameter: 5, thickness: 0.25, tessellation: 32 },
      this.scene
    );
    indicator.scaling.y = 0.01;
    indicator.position.y = 0.1;
    indicator.parent = this.mesh;
    indicator.isVisible = false;
    indicator.isPickable = false;

    const material = new StandardMaterial(
      `mutantSelMat_${this.id}`,
      this.scene
    );
    material.diffuseColor = Color3.Green();
    material.emissiveColor = Color3.Green();
    indicator.material = material;

    return indicator;
  }

  // Selection methods
  public get isSelected(): boolean {
    return this._isSelected;
  }

  public select(): void {
    this._isSelected = true;
    this.selectionIndicator.isVisible = true;
  }

  public deselect(): void {
    this._isSelected = false;
    this.selectionIndicator.isVisible = false;
  }

  public canBeSelected(): boolean {
    return true;
  }

  // Debug methods
  public get debug(): boolean {
    return this._debug;
  }

  public setDebug(value: boolean): void {
    this._debug = value;
    if (value && !this.rangeIndicator) {
      this.createRangeIndicator();
    } else if (!value && this.rangeIndicator) {
      this.rangeIndicator.dispose();
      this.rangeIndicator = null;
    }
  }

  // Convenience getters that read from components
  // These provide backward compatibility and easy access to component data

  /**
   * Check if the unit is currently dying (from AnimationComponent)
   */
  public get isDying(): boolean {
    const anim = this.getComponent<AnimationComponent>(ComponentType.Animation);
    return anim?.isDying ?? false;
  }

  /**
   * Check if the unit is currently attack-locked (deterministic for simulation)
   * Reads from AttackLockComponent
   */
  public get isCurrentlyAttacking(): boolean {
    const attackLock = this.getComponent<AttackLockComponent>(ComponentType.AttackLock);
    return attackLock?.isLocked ?? false;
  }

  /**
   * Check if the unit is in combat mode (from AnimationComponent)
   */
  public get isInCombat(): boolean {
    const anim = this.getComponent<AnimationComponent>(ComponentType.Animation);
    return anim?.isInCombat ?? false;
  }

  public override dispose(): void {
    this.selectionIndicator.dispose();
    if (this.rangeIndicator) {
      this.rangeIndicator.dispose();
    }

    // Clear animation component data
    const animComponent = this.getComponent<AnimationComponent>(ComponentType.Animation);
    if (animComponent) {
      animComponent.clear();
    }

    // Dispose the model instance (handles animations and meshes)
    if (this.modelDisposeFunc) {
      this.modelDisposeFunc();
      this.modelDisposeFunc = null;
    }


    // Dispose placeholder
    this.placeholderMesh.dispose();

    super.dispose();
  }
}
