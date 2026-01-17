import { EventBus } from "../core/EventBus";
import { GameEvents, createEvent } from "../events";
import { waveConfig, networkConfig } from "../config/constants";
import type { WaveStartedEvent, WaveCountdownEvent, WaveDeploymentEvent } from "../events";

/**
 * Callback type for deploying units for a player
 */
export type DeployUnitsCallback = (playerId: string) => number;

/**
 * WaveSystem - Manages wave-based unit deployment
 * 
 * Units are deployed in waves at regular intervals:
 * - Wave 0: Initial preparation time (no deployment)
 * - Wave 1+: All units on formation grid are deployed
 * 
 * The system is tick-based to ensure deterministic behavior
 * across all clients in lockstep simulation.
 */
export class WaveSystem {
    private eventBus: EventBus;
    private unsubscribers: (() => void)[] = [];

    // Wave state
    private currentWave: number = 0;
    private ticksPerWave: number;
    private ticksForInitialWave: number;
    private waveStartTick: number = 0;
    private isActive: boolean = false;

    // Player IDs (for deployment)
    private playerIds: string[] = [];

    // Deployment callback
    private deployUnitsCallback: DeployUnitsCallback | null = null;

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;

        // Calculate ticks per wave based on wave duration and tick rate
        this.ticksPerWave = Math.floor(waveConfig.waveDuration * networkConfig.tickRate);
        this.ticksForInitialWave = Math.floor(waveConfig.initialWaveDuration * networkConfig.tickRate);

        console.log(`[WaveSystem] Initialized: ${waveConfig.waveDuration}s per wave (${this.ticksPerWave} ticks)`);
    }

    /**
     * Set the callback for deploying units
     */
    public setDeployUnitsCallback(callback: DeployUnitsCallback): void {
        this.deployUnitsCallback = callback;
    }

    /**
     * Register a player for wave deployments
     */
    public registerPlayer(playerId: string): void {
        if (!this.playerIds.includes(playerId)) {
            this.playerIds.push(playerId);
            console.log(`[WaveSystem] Registered player: ${playerId}`);
        }
    }

    /**
     * Start the wave system (called when game begins)
     * @param startTick The tick at which the wave system starts
     */
    public start(startTick: number = 0): void {
        this.currentWave = 0;
        this.waveStartTick = startTick;
        this.isActive = true;

        // Emit wave started event for Wave 0 (preparation wave)
        this.eventBus.emit<WaveStartedEvent>(GameEvents.WAVE_STARTED, {
            ...createEvent(),
            waveNumber: 0,
            isPreparationWave: true,
        });

        console.log(`[WaveSystem] Started at tick ${startTick}, Wave 0 (preparation)`);
    }

    /**
     * Process a simulation tick
     * Called by LockstepManager during deterministic simulation
     */
    public processTick(currentTick: number): void {
        if (!this.isActive) return;

        const ticksSinceWaveStart = currentTick - this.waveStartTick;
        const ticksForCurrentWave = this.currentWave === 0 
            ? this.ticksForInitialWave 
            : this.ticksPerWave;
        const ticksRemaining = ticksForCurrentWave - ticksSinceWaveStart;

        // Emit countdown event every second (every tickRate ticks)
        if (ticksSinceWaveStart % networkConfig.tickRate === 0) {
            const secondsRemaining = Math.ceil(ticksRemaining / networkConfig.tickRate);
            
            this.eventBus.emit<WaveCountdownEvent>(GameEvents.WAVE_COUNTDOWN, {
                ...createEvent(),
                waveNumber: this.currentWave,
                secondsRemaining,
                ticksRemaining,
            });
        }

        // Check if wave is complete
        if (ticksRemaining <= 0) {
            this.advanceWave(currentTick);
        }
    }

    /**
     * Advance to the next wave and deploy units
     */
    private advanceWave(currentTick: number): void {
        const previousWave = this.currentWave;
        this.currentWave++;
        this.waveStartTick = currentTick;

        console.log(`[WaveSystem] Wave ${this.currentWave} starting at tick ${currentTick}`);

        // Emit wave started event
        this.eventBus.emit<WaveStartedEvent>(GameEvents.WAVE_STARTED, {
            ...createEvent(),
            waveNumber: this.currentWave,
            isPreparationWave: false,
        });

        // Deploy units for all players (Wave 1+ always deploys)
        // Wave 0 is preparation only (deployOnWaveZero is false by default)
        if (previousWave > 0 || waveConfig.deployOnWaveZero) {
            this.deployAllUnits();
        } else {
            // This is the transition from Wave 0 to Wave 1
            // Now deploy units that were placed during Wave 0
            this.deployAllUnits();
        }
    }

    /**
     * Deploy units for all registered players
     */
    private deployAllUnits(): void {
        if (!this.deployUnitsCallback) {
            console.warn('[WaveSystem] No deploy callback set!');
            return;
        }

        let totalDeployed = 0;

        for (const playerId of this.playerIds) {
            const unitCount = this.deployUnitsCallback(playerId);
            totalDeployed += unitCount;

            console.log(`[WaveSystem] Deployed ${unitCount} units for player ${playerId}`);
        }

        // Emit deployment event
        this.eventBus.emit<WaveDeploymentEvent>(GameEvents.WAVE_DEPLOYMENT, {
            ...createEvent(),
            waveNumber: this.currentWave,
            totalUnitsDeployed: totalDeployed,
        });
    }

    /**
     * Get the current wave number
     */
    public getCurrentWave(): number {
        return this.currentWave;
    }

    /**
     * Get seconds remaining until next wave
     */
    public getSecondsRemaining(currentTick: number): number {
        if (!this.isActive) return 0;

        const ticksSinceWaveStart = currentTick - this.waveStartTick;
        const ticksForCurrentWave = this.currentWave === 0 
            ? this.ticksForInitialWave 
            : this.ticksPerWave;
        const ticksRemaining = ticksForCurrentWave - ticksSinceWaveStart;
        
        return Math.max(0, Math.ceil(ticksRemaining / networkConfig.tickRate));
    }

    /**
     * Check if currently in preparation wave (Wave 0)
     */
    public isPreparationWave(): boolean {
        return this.currentWave === 0;
    }

    /**
     * Cleanup
     */
    public dispose(): void {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.isActive = false;
        this.playerIds = [];
    }
}
