/**
 * Game constants
 */

// Ground dimensions (2m x 4m)
export const GROUND_WIDTH = 2;
export const GROUND_DEPTH = 4;

// Unit settings
export const UNIT_RADIUS = 0.15;
export const UNIT_SPEED = 1.0; // meters per second

// Fixed timestep game loop settings
export const FIXED_TIMESTEP = 1 / 60; // 60 FPS
export const MAX_FRAME_TIME = 0.25; // Maximum time to process per frame (prevents spiral of death)

// Server settings
export const SERVER_URL = 'http://localhost:3000';
