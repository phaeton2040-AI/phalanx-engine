/**
 * Game constants and server configuration
 */

// Server settings
export const SERVER_URL = 'http://localhost:3000';

/**
 * Network tick configuration for deterministic lockstep simulation
 * All clients simulate the game in lockstep using these settings
 */
export const networkConfig = {
    // Tick rate (ticks per second) - must match server's tickRate
    tickRate: 20,

    // Fixed timestep for simulation (seconds per tick)
    // This is 1/tickRate = 1/20 = 0.05 seconds = 50ms per tick
    tickTimestep: 1 / 20,

    // Number of physics sub-steps per network tick
    // Higher = more accurate physics, but more CPU
    // 3 substeps at 20 ticks/sec = 60 physics updates/sec
    physicsSubsteps: 3,
};

/**
 * Camera configuration for RTS-style top-down camera
 */
export const cameraConfig = {
    // Camera height above ground (not too far, good for RTS view)
    height: 60,

    // How far ahead of camera position to look (creates the angled view)
    lookAheadOffset: 25,

    // Camera movement speed (units per second)
    moveSpeed: 40,

    // Padding from arena edges (prevents camera going too far out)
    boundsPadding: 10,
};

// Game settings
export const UNITS_PER_PLAYER = 3;
export const TOWERS_PER_PLAYER = 1;

/**
 * Resource system configuration
 */
export const resourceConfig = {
    // Starting resources for each player
    initialResources: 200,

    // Base resource generation rate (per second)
    baseGenerationRate: 5,

    // Aggression bonus multiplier when on enemy territory
    aggressionBonusMultiplier: 1.5,

    // Resource bonus for destroying enemy tower
    towerDestructionBonus: 100,
};

/**
 * Unit costs and stats
 */
export const unitConfig = {
    sphere: {
        cost: 100,
        health: 50,
        attackDamage: 10,
        attackRange: 12,
        attackCooldown: 1.0,
        moveSpeed: 8,
        gridSize: 1, // 1x1
    },
    prisma: {
        cost: 350,
        health: 200,
        attackDamage: 35,
        attackRange: 15,
        attackCooldown: 1,
        moveSpeed: 8,
        gridSize: 2, // 2x2
    },
};

/**
 * Wave system configuration
 * Units are deployed in waves at regular intervals
 */
export const waveConfig = {
    // Duration of each wave in seconds
    waveDuration: 30,

    // Wave 0 duration - initial preparation time before first deployment
    // Set to same as waveDuration by default, but can be customized
    initialWaveDuration: 30,

    // Whether Wave 0 deploys units (false = preparation wave only)
    deployOnWaveZero: false,
};

/**
 * Arena parameters for the game map
 * Ground: 168w x 72h units (40% larger in length than 120)
 * Split vertically at x=0
 */
export const arenaParams = {
    // Ground dimensions (40% longer)
    ground: {
        width: 168,
        height: 72,
    },

    // Formation grid dimensions (spawn area)
    // 5 cells wide x 10 cells tall (rotated 90 degrees)
    formationGrid: {
        width: 20,   // 5 cells * 4 spacing
        height: 40,  // 10 cells * 4 spacing
        gridSpacing: 4, // Space between grid lines
    },

    // Team A (Left side, x < 0)
    // Grid center at x=-74, width 20, so grid spans x=-84 to x=-64
    teamA: {
        formationGridCenter: { x: -74, z: 0 },  // Grid spans -84 to -64
        base: { x: -61, z: 0 },                  // Right next to grid (grid inner edge is at -64)
        // Spawn area is in front of the base (towards enemy)
        spawnArea: { x: -54, z: 0 },             // Units spawn here and move towards x=0
        towers: [
            { x: -36, z: 0 },   // First tower - evenly distributed along X
            { x: -18, z: 0 },   // Second tower - evenly distributed along X
        ],
    },

    // Team B (Right side, x > 0) - Mirror of Team A
    // Grid center at x=74, width 20, so grid spans x=64 to x=84
    teamB: {
        formationGridCenter: { x: 74, z: 0 },   // Grid spans 64 to 84
        base: { x: 61, z: 0 },                   // Right next to grid (grid inner edge is at 64)
        // Spawn area is in front of the base (towards enemy)
        spawnArea: { x: 54, z: 0 },              // Units spawn here and move towards x=0
        towers: [
            { x: 36, z: 0 },    // First tower - evenly distributed along X
            { x: 18, z: 0 },    // Second tower - evenly distributed along X
        ],
    },

    // Walls
    walls: {
        top: { z: 36 },
        bottom: { z: -36 },
        thickness: 1,
        height: 2,
    },

    // Divider line
    divider: {
        x: 0,
    },

    // Visual settings
    colors: {
        ground: { r: 0.15, g: 0.25, b: 0.2 },
        teamA: { r: 0.2, g: 0.4, b: 0.8 },       // Blue
        teamB: { r: 0.8, g: 0.2, b: 0.2 },       // Red
        wall: { r: 0.3, g: 0.3, b: 0.3 },
        divider: { r: 0, g: 0, b: 0 },          // Black
        gridLine: { r: 0.4, g: 0.4, b: 0.4 },
        base: { r: 0.5, g: 0.5, b: 0.5 },
    },
};

// Spawn positions for 1v1 (on formation grids)
export const TEAM1_SPAWN = {
    tower: arenaParams.teamA.base, // Base position for reference
    units: [
        { x: arenaParams.teamA.formationGridCenter.x, z: 0 },
        { x: arenaParams.teamA.formationGridCenter.x - 4, z: 8 },
        { x: arenaParams.teamA.formationGridCenter.x + 4, z: -8 },
    ],
};

export const TEAM2_SPAWN = {
    tower: arenaParams.teamB.base, // Base position for reference
    units: [
        { x: arenaParams.teamB.formationGridCenter.x, z: 0 },
        { x: arenaParams.teamB.formationGridCenter.x + 4, z: 8 },
        { x: arenaParams.teamB.formationGridCenter.x - 4, z: -8 },
    ],
};
