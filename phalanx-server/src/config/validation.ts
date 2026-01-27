import type { PhalanxConfig } from '../types/index.js';
import { DEFAULT_CONFIG, GAME_MODES } from './defaults.js';

/**
 * Validates and merges user configuration with defaults
 * @param userConfig - Partial user configuration
 * @returns Complete validated configuration
 */
export function validateConfig(
  userConfig: Partial<PhalanxConfig> = {}
): PhalanxConfig {
  const config: PhalanxConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    cors: {
      ...DEFAULT_CONFIG.cors,
      ...(userConfig.cors || {}),
    },
  };

  // Validate port
  if (config.port < 1 || config.port > 65535) {
    throw new Error(
      `Invalid port: ${config.port}. Must be between 1 and 65535.`
    );
  }

  // Validate tickRate
  if (config.tickRate < 1 || config.tickRate > 128) {
    throw new Error(
      `Invalid tickRate: ${config.tickRate}. Must be between 1 and 128.`
    );
  }

  // Validate tickDeadlineMs
  if (config.tickDeadlineMs < 1) {
    throw new Error(
      `Invalid tickDeadlineMs: ${config.tickDeadlineMs}. Must be positive.`
    );
  }

  // Validate gameMode
  if (typeof config.gameMode === 'string') {
    if (!GAME_MODES[config.gameMode]) {
      throw new Error(
        `Invalid gameMode: ${config.gameMode}. Valid presets: ${Object.keys(GAME_MODES).join(', ')}`
      );
    }
  } else if (typeof config.gameMode === 'object') {
    if (config.gameMode.playersPerMatch < 2) {
      throw new Error('playersPerMatch must be at least 2');
    }
    if (config.gameMode.teamsCount < 1) {
      throw new Error('teamsCount must be at least 1');
    }
    if (config.gameMode.teamsCount > config.gameMode.playersPerMatch) {
      throw new Error('teamsCount cannot exceed playersPerMatch');
    }
  }

  // Validate timeout values
  if (config.timeoutTicks < 1) {
    throw new Error('timeoutTicks must be positive');
  }
  if (config.disconnectTicks < config.timeoutTicks) {
    throw new Error('disconnectTicks must be >= timeoutTicks');
  }

  // Validate tick range limits
  if (config.maxTickBehind < 1) {
    throw new Error('maxTickBehind must be positive');
  }
  if (config.maxTickAhead < 1) {
    throw new Error('maxTickAhead must be positive');
  }

  return config;
}

/**
 * Gets the resolved game mode (players per match and teams count)
 */
export function resolveGameMode(gameMode: PhalanxConfig['gameMode']): {
  playersPerMatch: number;
  teamsCount: number;
} {
  if (typeof gameMode === 'string') {
    return GAME_MODES[gameMode];
  }
  return gameMode;
}
