import { vi } from 'vitest';
import type { SignalKApp } from '../src/types.js';

/**
 * Create a mock SignalK app for testing
 *
 * @param includeConfig - Whether to include config.configPath (required for NOAA source)
 */
export function createMockSignalKApp(includeConfig = false): SignalKApp {
  const app = {
    debug: vi.fn(),
    getDataDirPath: () => '/tmp/test-data',
  } as any;

  if (includeConfig) {
    app.config = { configPath: '/tmp/test-config' };
  }

  return app as SignalKApp;
}
