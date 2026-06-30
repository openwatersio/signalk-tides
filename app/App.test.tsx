import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    // The tide station is gated behind unit preferences, so "Loading..."
    // appears once the active preset resolves (a tick after render).
    expect(await screen.findByText('Loading...')).toBeDefined();

    // Wait for the tide table to load with real data
    const table = await screen.findByRole('table', {}, { timeout: 10_000 });
    expect(table).toBeDefined();

    // Verify no console errors or warnings
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('opens the station browser from the menu button', async () => {
    render(<App />);

    const menu = await screen.findByRole('button', { name: /browse stations/i });
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(menu);
    expect(await screen.findByRole('dialog')).toBeDefined();
  });
});
