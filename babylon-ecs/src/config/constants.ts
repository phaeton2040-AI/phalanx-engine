/**
 * Game constants and server configuration
 */

// Server settings
export const SERVER_URL = 'http://localhost:3000';

// Game settings
export const UNITS_PER_PLAYER = 3;
export const TOWERS_PER_PLAYER = 1;

/**
 * Arena parameters for the game map
 * Ground: 120w x 72h units (20% larger than original 100x60)
 * Split vertically at x=0
 */
export const arenaParams = {
    // Ground dimensions (20% larger)
    ground: {
        width: 120,
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
    // Grid center at x=-50, width 20, so grid spans x=-60 to x=-40
    teamA: {
        formationGridCenter: { x: -50, z: 0 },  // Grid spans -60 to -40
        base: { x: -37, z: 0 },                  // Right next to grid (grid inner edge is at -40)
        towers: [
            { x: -25, z: 0 },   // First tower - evenly distributed along X
            { x: -12, z: 0 },   // Second tower - evenly distributed along X
        ],
    },

    // Team B (Right side, x > 0) - Mirror of Team A
    // Grid center at x=50, width 20, so grid spans x=40 to x=60
    teamB: {
        formationGridCenter: { x: 50, z: 0 },   // Grid spans 40 to 60
        base: { x: 37, z: 0 },                   // Right next to grid (grid inner edge is at 40)
        towers: [
            { x: 25, z: 0 },    // First tower - evenly distributed along X
            { x: 12, z: 0 },    // Second tower - evenly distributed along X
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
