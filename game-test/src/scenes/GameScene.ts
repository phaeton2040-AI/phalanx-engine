/**
 * Game Scene - Babylon.js rendering and game logic
 * Using simplified Phalanx Client API
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  MeshBuilder,
  Vector3,
  Color3,
  StandardMaterial,
  Mesh,
  PointerEventTypes,
  Color4,
  PointerInfo,
  AbstractMesh,
} from '@babylonjs/core';
import {
  PhalanxClient,
  type MatchFoundEvent,
  type CommandsBatch,
  type Unsubscribe,
} from 'phalanx-client';
import { GameSimulation } from '../game/GameSimulation';
import { GROUND_WIDTH, GROUND_DEPTH, UNIT_RADIUS } from '../game/constants';
import type { GameCommand } from '../game/types';

interface UnitMesh {
  playerId: string;
  mesh: Mesh;
  prevX: number;
  prevZ: number;
}

export class GameScene {
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;
  private client: PhalanxClient;
  private matchData: MatchFoundEvent;

  private simulation: GameSimulation;

  private unitMeshes: Map<string, UnitMesh> = new Map();
  private ground: Mesh | null = null;

  private notificationTimeout: number | null = null;
  private beforeUnloadHandler:
    | ((e: BeforeUnloadEvent) => string | undefined)
    | null = null;

  // Event unsubscribe functions
  private unsubscribers: Unsubscribe[] = [];

  // Callbacks
  private onExit: (() => void) | null = null;

  constructor(client: PhalanxClient, matchData: MatchFoundEvent) {
    this.client = client;
    this.matchData = matchData;

    this.canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    this.engine = new Engine(this.canvas, true);
    this.scene = this.createScene();

    this.simulation = new GameSimulation();

    this.setupNetworkHandlers();
    this.setupInput();
    this.createUnits();
    this.setupBeforeUnloadWarning();

    // Handle window resize
    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  /**
   * Create the Babylon.js scene
   */
  private createScene(): Scene {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color4(0.1, 0.1, 0.15, 1);

    // Camera - top-down isometric view
    const camera = new ArcRotateCamera(
      'camera',
      Math.PI / 4,
      Math.PI / 3,
      6,
      Vector3.Zero(),
      scene
    );
    camera.attachControl(this.canvas, true);
    camera.lowerRadiusLimit = 3;
    camera.upperRadiusLimit = 10;

    // Light
    const light = new HemisphericLight('light', new Vector3(0, 1, 0.5), scene);
    light.intensity = 0.9;

    // Ground (2m x 4m)
    this.ground = MeshBuilder.CreateGround(
      'ground',
      { width: GROUND_WIDTH, height: GROUND_DEPTH },
      scene
    );

    const groundMaterial = new StandardMaterial('groundMat', scene);
    groundMaterial.diffuseColor = new Color3(0.2, 0.3, 0.2);
    groundMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
    this.ground.material = groundMaterial;

    // Grid lines on ground
    this.createGridLines(scene);

    return scene;
  }

  /**
   * Create grid lines on the ground
   */
  private createGridLines(scene: Scene): void {
    const gridMaterial = new StandardMaterial('gridMat', scene);
    gridMaterial.diffuseColor = new Color3(0.3, 0.4, 0.3);
    gridMaterial.alpha = 0.5;

    // Vertical lines
    for (let x = -1; x <= 1; x += 0.5) {
      const line = MeshBuilder.CreateBox(
        `gridV${x}`,
        { width: 0.01, height: 0.001, depth: GROUND_DEPTH },
        scene
      );
      line.position.x = x;
      line.position.y = 0.001;
      line.material = gridMaterial;
    }

    // Horizontal lines
    for (let z = -2; z <= 2; z += 0.5) {
      const line = MeshBuilder.CreateBox(
        `gridH${z}`,
        { width: GROUND_WIDTH, height: 0.001, depth: 0.01 },
        scene
      );
      line.position.z = z;
      line.position.y = 0.001;
      line.material = gridMaterial;
    }
  }

  /**
   * Create units for all players
   */
  private createUnits(): void {
    // Collect all players and sort by playerId for deterministic ordering
    const allPlayers = [
      {
        playerId: this.matchData.playerId,
        username: 'You',
      },
      ...this.matchData.teammates,
      ...this.matchData.opponents,
    ].sort((a, b) => a.playerId.localeCompare(b.playerId));

    const startPositions = this.calculateStartPositions(allPlayers.length);

    allPlayers.forEach((player, index) => {
      const pos = startPositions[index];
      const color = this.generatePlayerColor(player.playerId);

      // Update player info UI for current player
      if (player.playerId === this.matchData.playerId) {
        this.updatePlayerInfoUI(player.username, color);
      }

      // Create simulation unit
      this.simulation.addUnit(player.playerId, pos.x, pos.z, color);

      // Create mesh
      this.createUnitMesh(player.playerId, pos.x, pos.z, color);
    });
  }

  /**
   * Calculate starting positions for players
   */
  private calculateStartPositions(
    playerCount: number
  ): { x: number; z: number }[] {
    const positions: { x: number; z: number }[] = [];
    const halfDepth = GROUND_DEPTH / 2 - 0.5;

    if (playerCount === 2) {
      positions.push({ x: 0, z: -halfDepth });
      positions.push({ x: 0, z: halfDepth });
    } else {
      // Distribute evenly
      for (let i = 0; i < playerCount; i++) {
        const angle = (i / playerCount) * Math.PI * 2;
        positions.push({
          x: Math.cos(angle) * 0.5,
          z: Math.sin(angle),
        });
      }
    }

    return positions;
  }

  /**
   * Generate a color for a player based on their ID
   */
  private generatePlayerColor(playerId: string): string {
    // Hash the player ID to get a consistent color
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
    }

    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  }

  /**
   * Update the player info UI with color and name
   */
  private updatePlayerInfoUI(username: string, color: string): void {
    const colorIndicator = document.getElementById('player-color-indicator');
    const playerName = document.getElementById('player-name');

    if (colorIndicator) {
      colorIndicator.style.backgroundColor = color;
    }

    if (playerName) {
      playerName.textContent = `You: ${username}`;
    }
  }

  /**
   * Create a mesh for a unit
   */
  private createUnitMesh(
    playerId: string,
    x: number,
    z: number,
    color: string
  ): void {
    const mesh = MeshBuilder.CreateSphere(
      `unit_${playerId}`,
      { diameter: UNIT_RADIUS * 2 },
      this.scene
    );

    mesh.position = new Vector3(x, UNIT_RADIUS, z);

    const material = new StandardMaterial(`unitMat_${playerId}`, this.scene);
    material.diffuseColor = Color3.FromHexString(this.hslToHex(color));
    material.specularColor = new Color3(0.3, 0.3, 0.3);
    mesh.material = material;

    this.unitMeshes.set(playerId, {
      playerId,
      mesh,
      prevX: x,
      prevZ: z,
    });
  }

  /**
   * Convert HSL string to hex
   */
  private hslToHex(hsl: string): string {
    const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) return '#ffffff';

    const h = parseInt(match[1]) / 360;
    const s = parseInt(match[2]) / 100;
    const l = parseInt(match[3]) / 100;

    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (x: number) => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  /**
   * Setup network event handlers using simplified API
   */
  private setupNetworkHandlers(): void {
    // Handle incoming ticks with commands from server
    const unsubTick = this.client.onTick(
      (tick: number, commandsBatch: CommandsBatch) => {
        this.handleTick(tick, commandsBatch);
      }
    );
    this.unsubscribers.push(unsubTick);

    // Handle render frames with interpolation
    // Client manages the render loop internally
    const unsubFrame = this.client.onFrame((alpha: number, _dt: number) => {
      this.updateMeshPositions(alpha);
      this.scene.render();
    });
    this.unsubscribers.push(unsubFrame);

    // Handle match end
    const unsubMatchEnd = this.client.on('matchEnd', (event) => {      this.removeBeforeUnloadWarning();

      if (
        event.reason === 'player-exit' ||
        event.reason === 'player-disconnected'
      ) {
        this.showNotification('Other player left the game', 'warning');
        // Return to lobby after delay
        setTimeout(() => {
          this.onExit?.();
        }, 2000);
      }
    });
    this.unsubscribers.push(unsubMatchEnd);
  }

  /**
   * Handle a simulation tick with commands
   */
  private handleTick(_tick: number, commandsBatch: CommandsBatch): void {
    // Store previous positions for interpolation
    for (const [playerId, unitMesh] of this.unitMeshes) {
      const unit = this.simulation.getUnit(playerId);
      if (unit) {
        unitMesh.prevX = unit.x;
        unitMesh.prevZ = unit.z;
      }
    }

    // Convert commands batch to flat array with player IDs
    const commands: GameCommand[] = [];
    for (const [playerId, playerCommands] of Object.entries(
      commandsBatch.commands
    )) {
      for (const cmd of playerCommands) {
        commands.push({
          ...cmd,
          playerId,
        } as GameCommand);
      }
    }

    // Queue commands and update simulation
    this.simulation.queueCommands(commands);
    this.simulation.update();
  }

  /**
   * Setup input handlers
   */
  private setupInput(): void {
    this.scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        if (pointerInfo.event.button === 0) {
          // Left click
          const pickResult = this.scene.pick(
            this.scene.pointerX,
            this.scene.pointerY,
            (mesh: AbstractMesh) => mesh === this.ground
          );

          if (pickResult?.hit && pickResult.pickedPoint) {
            const target = pickResult.pickedPoint;
            this.issueMove(target.x, target.z);
          }
        }
      }
    });
  }

  /**
   * Issue a move command using simplified API
   */
  private issueMove(targetX: number, targetZ: number): void {
    this.client.sendCommand('move', {
      targetX,
      targetZ,
    });
  }

  /**
   * Start the game
   */
  start(): void {
    this.setupExitButton();
    // Rendering is handled by onFrame callback - no need for Babylon's render loop
  }

  /**
   * Update mesh positions based on interpolation
   */
  private updateMeshPositions(alpha: number): void {
    for (const [playerId, unitMesh] of this.unitMeshes) {
      const unit = this.simulation.getUnit(playerId);
      if (unit) {
        const x = unitMesh.prevX + (unit.x - unitMesh.prevX) * alpha;
        const z = unitMesh.prevZ + (unit.z - unitMesh.prevZ) * alpha;
        unitMesh.mesh.position.x = x;
        unitMesh.mesh.position.z = z;
      }
    }
  }

  /**
   * Set callback for exit
   */
  setOnExit(callback: () => void): void {
    this.onExit = callback;
  }

  /**
   * Setup exit button handler
   */
  private setupExitButton(): void {
    const exitBtn = document.getElementById('exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        this.handleExit();
      });
    }
  }

  /**
   * Handle exit button click
   */
  private handleExit(): void {
    this.removeBeforeUnloadWarning();
    this.client.disconnect();
    this.onExit?.();
  }

  /**
   * Setup warning when user tries to reload/close the page during game
   */
  private setupBeforeUnloadWarning(): void {
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      const message = 'You will be kicked out of the game!';
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  /**
   * Remove beforeunload warning (when exiting properly)
   */
  private removeBeforeUnloadWarning(): void {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }

  /**
   * Show a notification message
   */
  private showNotification(
    message: string,
    type: 'info' | 'warning' = 'info'
  ): void {
    const notification = document.getElementById('notification');
    if (!notification) return;

    // Clear existing timeout
    if (this.notificationTimeout !== null) {
      clearTimeout(this.notificationTimeout);
    }

    notification.textContent = message;
    notification.className = `show ${type}`;

    // Auto-hide after 3 seconds
    this.notificationTimeout = window.setTimeout(() => {
      this.hideNotification();
    }, 3000);
  }

  /**
   * Hide the notification
   */
  private hideNotification(): void {
    const notification = document.getElementById('notification');
    if (notification) {
      notification.className = '';
    }
    this.notificationTimeout = null;
  }

  /**
   * Stop the game
   */
  stop(): void {
    this.removeBeforeUnloadWarning();

    // Unsubscribe from all client events
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    this.engine.dispose();
  }
}
