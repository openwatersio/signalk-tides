import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { getDefaultUnits } from '@neaps/react';
import { useUnitPreferences } from './useUnitPreferences';

function mockFetch(response: Partial<Response> | (() => Promise<never>)) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (typeof response === 'function'
      ? response
      : async () => response as Response) as typeof fetch,
  );
}

const localeDefault = getDefaultUnits(navigator.language);

describe('useUnitPreferences', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts not ready, then resolves feet for an imperial depth preset', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ categories: { depth: { targetUnit: 'foot' } } }),
    });

    const { result } = renderHook(() => useUnitPreferences());

    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.units).toBe('feet');
  });

  it('resolves meters for a metric depth preset', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ categories: { depth: { targetUnit: 'm' } } }),
    });

    const { result } = renderHook(() => useUnitPreferences());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.units).toBe('meters');
  });

  it('falls back to the locale default when the endpoint is missing (404)', async () => {
    mockFetch({ ok: false, status: 404 });

    const { result } = renderHook(() => useUnitPreferences());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.units).toBe(localeDefault);
  });

  it('falls back to the locale default on a network error', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });

    const { result } = renderHook(() => useUnitPreferences());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.units).toBe(localeDefault);
  });

  it('falls back to the locale default for an unsupported target unit', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ categories: { depth: { targetUnit: 'yard' } } }),
    });

    const { result } = renderHook(() => useUnitPreferences());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.units).toBe(localeDefault);
  });
});
