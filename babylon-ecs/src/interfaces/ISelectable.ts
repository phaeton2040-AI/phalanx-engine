import { Mesh } from "@babylonjs/core";

/**
 * Interface for selectable game entities
 * Follows Interface Segregation Principle
 */
export interface ISelectable {
    readonly isSelected: boolean;
    select(): void;
    deselect(): void;
    getMesh(): Mesh;
}

