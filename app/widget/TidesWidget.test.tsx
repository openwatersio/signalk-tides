import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { connectExtension, type ExtensionClient } from 'signalk-plotterext-bus/extension';
import { TidesWidget, TIDES_PANEL, RECENTER_INTERVAL_MS } from './TidesWidget';

vi.mock('signalk-plotterext-bus/extension', () => ({
  connectExtension: vi.fn(),
}));

function plotterHost(capabilities: string[]) {
  const call = vi.fn(() => Promise.resolve({}));
  const host = {
    hasCapability: (id: string) => capabilities.includes(id),
    call,
  } as unknown as ExtensionClient;
  vi.mocked(connectExtension).mockResolvedValue(host);
  return { call };
}

describe('TidesWidget', () => {
  beforeEach(() => {
    vi.mocked(connectExtension).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the level now and the next high or low water', async () => {
    vi.mocked(connectExtension).mockRejectedValue(new Error('no host'));
    render(<TidesWidget />);

    expect(await screen.findByText(/now/i, {}, { timeout: 10_000 })).toBeDefined();
    expect(await screen.findByText(/next/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Open Tides' })).toBeNull();
  });

  it('opens the Tides panel when tapped in a chart plotter', async () => {
    const { call } = plotterHost(['widgets', 'panels.iframe', 'ui']);
    render(<TidesWidget />);

    const widget = await screen.findByRole(
      'button',
      { name: 'Open Tides' },
      { timeout: 10_000 },
    );
    await userEvent.click(widget);

    expect(call).toHaveBeenCalledWith('ui.togglePanel', { panel: TIDES_PANEL });
  });

  it('stays as it is when the chart plotter cannot open the panel', async () => {
    // A plain function rather than vi.fn(): vitest attaches its own handlers to
    // the promises a vi.fn() returns, which would hide an unhandled rejection.
    const calls: unknown[][] = [];
    vi.mocked(connectExtension).mockResolvedValue({
      hasCapability: () => true,
      call: (...args: unknown[]) => {
        calls.push(args);
        return Promise.reject(new Error('no such panel'));
      },
    } as unknown as ExtensionClient);
    render(<TidesWidget />);

    const widget = await screen.findByRole(
      'button',
      { name: 'Open Tides' },
      { timeout: 10_000 },
    );
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    await userEvent.click(widget);
    // unhandledrejection is dispatched after the rejection settles
    await new Promise((resolve) => setTimeout(resolve, 50));
    window.removeEventListener('unhandledrejection', unhandled);

    expect(calls).toEqual([['ui.togglePanel', { panel: TIDES_PANEL }]]);
    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open Tides' })).toBeDefined();
  });

  it('is not tappable in a chart plotter that cannot show its panel', async () => {
    plotterHost(['widgets', 'ui']);
    render(<TidesWidget />);

    expect(await screen.findByText(/now/i, {}, { timeout: 10_000 })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Open Tides' })).toBeNull();
  });

  it('opens its settings on a press-and-hold instead of the Tides panel', async () => {
    const { call } = plotterHost(['widgets', 'panels.iframe', 'ui']);
    render(<TidesWidget />);
    const widget = await screen.findByRole(
      'button',
      { name: 'Open Tides' },
      { timeout: 10_000 },
    );

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(widget);
    vi.advanceTimersByTime(1500);
    fireEvent.pointerUp(widget);
    fireEvent.click(widget);

    expect(call).toHaveBeenCalledWith('ui.openConfigPanel');
    expect(call).not.toHaveBeenCalledWith('ui.togglePanel', { panel: TIDES_PANEL });
  });

  it('opens its settings on a press-and-hold where it cannot open the panel', async () => {
    const { call } = plotterHost(['widgets']);
    render(<TidesWidget />);
    const conditions = await screen.findByText(/now/i, {}, { timeout: 10_000 });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(conditions);
    vi.advanceTimersByTime(1500);
    fireEvent.pointerUp(conditions);

    expect(call).toHaveBeenCalledWith('ui.openConfigPanel');
  });

  it('does not open its settings on a short tap', async () => {
    const { call } = plotterHost(['widgets', 'panels.iframe', 'ui']);
    render(<TidesWidget />);
    const widget = await screen.findByRole(
      'button',
      { name: 'Open Tides' },
      { timeout: 10_000 },
    );

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.pointerDown(widget);
    vi.advanceTimersByTime(300);
    fireEvent.pointerUp(widget);
    fireEvent.click(widget);
    vi.advanceTimersByTime(1500);

    expect(call).toHaveBeenCalledWith('ui.togglePanel', { panel: TIDES_PANEL });
    expect(call).not.toHaveBeenCalledWith('ui.openConfigPanel');
  });

  it('moves its prediction window along with the time', async () => {
    vi.mocked(connectExtension).mockRejectedValue(new Error('no host'));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'Date'] });
    const fetchSpy = vi.spyOn(window, 'fetch');
    const timelineStarts = () =>
      fetchSpy.mock.calls
        .map(([input]) => new URL(String(input instanceof Request ? input.url : input), window.location.href))
        .filter((url) => url.pathname.endsWith('/timeline'))
        .map((url) => Date.parse(url.searchParams.get('start')!));

    render(<TidesWidget />);
    expect(await screen.findByText(/now/i, {}, { timeout: 10_000 })).toBeDefined();
    const [first] = timelineStarts();
    expect(first).toBeGreaterThan(0);

    vi.advanceTimersByTime(RECENTER_INTERVAL_MS);

    await vi.waitFor(() => expect(timelineStarts().length).toBeGreaterThan(1), { timeout: 10_000 });
    const starts = timelineStarts();
    const latest = starts[starts.length - 1];
    expect(latest - first).toBeGreaterThanOrEqual(RECENTER_INTERVAL_MS);
  });
});
