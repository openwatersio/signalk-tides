import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('renders the tide station without errors or warnings', async () => {
    render(<App />);

    // TideStation shows "Loading..." initially
    expect(screen.getByText('Loading...')).toBeDefined();

    // Wait for the tide table to load with real data
    const table = await screen.findByRole('table', {}, { timeout: 10_000 });
    expect(table).toBeDefined();

    // Verify Footer is rendered
    expect(screen.getByRole('contentinfo')).toBeDefined();

    // Verify no console errors or warnings
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
