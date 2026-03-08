import { vi } from 'vitest';
import type { SignalKApp } from '../src/types.js';

/**
 * Create a mock SignalK app for testing
 */
export function createMockSignalKApp(dataDir = '/tmp/test-data'): SignalKApp {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    setPluginError: vi.fn(),
    setPluginStatus: vi.fn(),
    getDataDirPath: () => dataDir,
    config: { configPath: '/tmp/test-config' },
  } as unknown as SignalKApp;
}
