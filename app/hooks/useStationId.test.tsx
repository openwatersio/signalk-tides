import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStationId, VESSEL_STATION_ID } from './useStationId';

// Reset URL state between tests, preserving the test runner's path.
afterEach(() => window.history.replaceState(null, '', window.location.pathname));

describe('useStationId', () => {
  it('defaults to the vessel station with no query param', () => {
    const { result } = renderHook(() => useStationId());
    expect(result.current[0]).toBe(VESSEL_STATION_ID);
  });

  it('reads the station from the query param', () => {
    window.history.replaceState(null, '', '?station=noaa%2F9447130');
    const { result } = renderHook(() => useStationId());
    expect(result.current[0]).toBe('noaa/9447130');
  });

  it('selecting a station writes it to the query param', () => {
    const { result } = renderHook(() => useStationId());
    act(() => result.current[1]('noaa/9447130'));
    expect(result.current[0]).toBe('noaa/9447130');
    expect(new URLSearchParams(window.location.search).get('station')).toBe('noaa/9447130');
  });

  it('selecting the vessel station clears the query param', () => {
    window.history.replaceState(null, '', '?station=noaa%2F9447130');
    const { result } = renderHook(() => useStationId());
    act(() => result.current[1](VESSEL_STATION_ID));
    expect(result.current[0]).toBe(VESSEL_STATION_ID);
    expect(window.location.search).toBe('');
  });

  it('preserves neaps’s hash when writing the station', () => {
    window.history.replaceState(null, '', '#graph');
    const { result } = renderHook(() => useStationId());
    act(() => result.current[1]('noaa/9447130'));
    expect(window.location.hash).toBe('#graph');
  });
});
