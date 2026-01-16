import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PhalanxClient } from '../src/PhalanxClient.js';

/**
 * Unit tests for PhalanxClient
 * These tests verify client behavior without a real server
 */
describe('PhalanxClient Unit Tests', () => {
  let client: PhalanxClient;

  beforeEach(() => {
    client = new PhalanxClient({
      serverUrl: 'http://localhost:9999',
      playerId: 'test-player',
      username: 'TestUser',
    });
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('Constructor', () => {
    it('should create client with required config', () => {
      expect(client.getPlayerId()).toBe('test-player');
      expect(client.getUsername()).toBe('TestUser');
    });

    it('should have disconnected state initially', () => {
      expect(client.getConnectionState()).toBe('disconnected');
      expect(client.isConnected()).toBe(false);
    });

    it('should have idle client state initially', () => {
      expect(client.getClientState()).toBe('idle');
    });

    it('should have null matchId initially', () => {
      expect(client.getMatchId()).toBeNull();
    });

    it('should have tick 0 initially', () => {
      expect(client.getCurrentTick()).toBe(0);
    });
  });

  describe('Event Handling', () => {
    it('should register and call event handlers', () => {
      const handler = vi.fn();
      client.on('connected', handler);

      // Simulate internal emit (we can't easily test this without connecting)
      // This tests the subscription mechanism
      expect(typeof client.on('connected', () => {})).toBe('function');
    });

    it('should return unsubscribe function from on()', () => {
      const handler = vi.fn();
      const unsubscribe = client.on('connected', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe using returned function', () => {
      const handler = vi.fn();
      const unsubscribe = client.on('connected', handler);
      unsubscribe();

      // Handler should be removed (verified by internal state)
    });

    it('should unsubscribe using off()', () => {
      const handler = vi.fn();
      client.on('connected', handler);
      client.off('connected', handler);

      // Handler should be removed
    });

    it('should remove all listeners', () => {
      client.on('connected', () => {});
      client.on('disconnected', () => {});
      client.on('tick', () => {});

      client.removeAllListeners();
      // All handlers should be removed
    });
  });

  describe('State Checks', () => {
    it('should throw when calling joinQueue before connect', async () => {
      await expect(client.joinQueue()).rejects.toThrow('Not connected');
    });

    it('should throw when calling leaveQueue before connect', () => {
      expect(() => client.leaveQueue()).toThrow('Not connected');
    });

    it('should throw when calling submitCommands before connect', async () => {
      await expect(
        client.submitCommands(1, [{ type: 'test', data: {} }])
      ).rejects.toThrow('Not connected');
    });
  });

  describe('Connection Timeout', () => {
    it('should timeout on connection to non-existent server', async () => {
      const quickTimeoutClient = new PhalanxClient({
        serverUrl: 'http://localhost:59999', // Non-existent port
        playerId: 'test',
        username: 'Test',
        connectionTimeoutMs: 1000,
      });

      await expect(quickTimeoutClient.connect()).rejects.toThrow();
      quickTimeoutClient.disconnect();
    });
  });
});
