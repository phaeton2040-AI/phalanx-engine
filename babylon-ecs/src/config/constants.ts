/**
 * Game constants and server configuration
 */

// Server settings
export const SERVER_URL = 'http://localhost:3000';

// Game settings
export const UNITS_PER_PLAYER = 3;
export const TOWERS_PER_PLAYER = 1;

// Spawn positions for 1v1
export const TEAM1_SPAWN = {
    tower: { x: -15, z: 0 },
    units: [
        { x: -10, z: 0 },
        { x: -12, z: 3 },
        { x: -12, z: -3 },
    ],
};

export const TEAM2_SPAWN = {
    tower: { x: 15, z: 0 },
    units: [
        { x: 10, z: 0 },
        { x: 12, z: 3 },
        { x: 12, z: -3 },
    ],
};
