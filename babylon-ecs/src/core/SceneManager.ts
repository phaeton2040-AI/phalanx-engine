import {
    Scene,
    Vector3,
    HemisphericLight,
    DirectionalLight,
    ShadowGenerator,
    MeshBuilder,
    FreeCamera,
    StandardMaterial,
    Color3,
    Mesh,
} from "@babylonjs/core";
import { Unit } from "../entities/Unit";
import type { UnitConfig } from "../entities/Unit";
import { Tower } from "../entities/Tower";
import type { TowerConfig } from "../entities/Tower";
import { EventBus } from "./EventBus";
import { GameEvents } from "../events";
import type { ShowDestinationMarkerEvent } from "../events";

/**
 * SceneManager - Handles scene setup and world object creation
 * Follows Single Responsibility: Only manages scene elements
 * Uses EventBus to react to destination marker events
 */
export class SceneManager {
    private scene: Scene;
    private eventBus: EventBus | null = null;
    private ground: Mesh | null = null;
    private camera: FreeCamera | null = null;
    private destinationMarker: Mesh | null = null;
    private shadowGenerator: ShadowGenerator | null = null;
    private unsubscribers: (() => void)[] = [];

    constructor(scene: Scene, eventBus?: EventBus) {
        this.scene = scene;
        if (eventBus) {
            this.eventBus = eventBus;
            this.setupEventListeners();
        }
    }

    private setupEventListeners(): void {
        if (!this.eventBus) return;

        // Listen for destination marker events
        this.unsubscribers.push(
            this.eventBus.on<ShowDestinationMarkerEvent>(GameEvents.SHOW_DESTINATION_MARKER, (event) => {
                this.showDestinationMarker(event.position);
            })
        );

        this.unsubscribers.push(
            this.eventBus.on(GameEvents.HIDE_DESTINATION_MARKER, () => {
                this.hideDestinationMarker();
            })
        );
    }
    public setupCamera(): FreeCamera {
        this.camera = new FreeCamera(
            "camera1",
            new Vector3(0, 40, -15),
            this.scene
        );
        this.camera.setTarget(Vector3.Zero());
        // Camera is fixed - no controls attached
        // Players view the game from a fixed top-down angle
        return this.camera;
    }
    public setupLighting(): void {
        // Ambient light for general illumination
        const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), this.scene);
        hemiLight.intensity = 0.3;
        // Directional light for shadows - positioned at an angle visible from camera
        const dirLight = new DirectionalLight(
            "dirLight",
            new Vector3(-1, -2, 1), // Angled to cast shadows visible from camera position
            this.scene
        );
        dirLight.position = new Vector3(10, 20, -10);
        dirLight.intensity = 0.8;
        // Setup shadow generator
        this.shadowGenerator = new ShadowGenerator(1024, dirLight);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 32;
    }
    public createGround(): Mesh {
        this.ground = MeshBuilder.CreateGround(
            "ground",
            { width: 50, height: 50 },
            this.scene
        );
        const groundMat = new StandardMaterial("groundMat", this.scene);
        groundMat.diffuseColor = new Color3(0.1, 0.2, 0.2);
        groundMat.specularColor = new Color3(0.1, 0.1, 0.1);
        groundMat.roughness = 0.9;
        this.ground.material = groundMat;
        this.ground.receiveShadows = true;
        this.createDestinationMarker();
        return this.ground;
    }
    private createDestinationMarker(): void {
        this.destinationMarker = MeshBuilder.CreateDisc(
            "destMarker",
            { radius: 0.8 },
            this.scene
        );
        this.destinationMarker.rotation.x = Math.PI / 2;
        this.destinationMarker.position.y = 0.02;
        this.destinationMarker.isVisible = false;
        const destMat = new StandardMaterial("destMat", this.scene);
        destMat.diffuseColor = new Color3(1, 0.5, 0);
        this.destinationMarker.material = destMat;
    }
    public createUnit(config: UnitConfig = {}, position?: Vector3): Unit {
        const unit = new Unit(this.scene, config, position);
        const unitMesh = unit.getMesh();
        if (this.shadowGenerator && unitMesh) {
            this.shadowGenerator.addShadowCaster(unitMesh);
        }
        return unit;
    }
    public createTower(config: TowerConfig, position?: Vector3): Tower {
        const tower = new Tower(this.scene, config, position);
        const towerMesh = tower.getMesh();
        if (this.shadowGenerator && towerMesh) {
            this.shadowGenerator.addShadowCaster(towerMesh);
        }
        return tower;
    }
    public getGround(): Mesh | null {
        return this.ground;
    }
    public getDestinationMarker(): Mesh | null {
        return this.destinationMarker;
    }
    public showDestinationMarker(position: Vector3): void {
        if (this.destinationMarker) {
            this.destinationMarker.position.x = position.x;
            this.destinationMarker.position.z = position.z;
            this.destinationMarker.isVisible = true;
        }
    }
    public hideDestinationMarker(): void {
        if (this.destinationMarker) {
            this.destinationMarker.isVisible = false;
        }
    }

    public dispose(): void {
        // Unsubscribe from all events
        for (const unsubscribe of this.unsubscribers) {
            unsubscribe();
        }
        this.unsubscribers = [];
    }
}
