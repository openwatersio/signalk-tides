import nock from 'nock';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { existsSync } from 'fs';

let recording = false;

export interface VCROptions {
  cassettePath: string;
  mode?: 'record' | 'playback' | 'auto';
  /** Query parameter names to redact when saving and ignore when matching */
  redact?: string[];
}

/**
 * VCR (Video Cassette Recorder) helper for recording and replaying HTTP requests
 *
 * @param options.cassettePath - Path to the cassette file (relative to test/__cassettes__/)
 * @param options.mode - 'record' (always record new), 'playback' (only use existing), 'auto' (record if missing)
 * @param options.redact - Query parameter names to strip before matching and before saving
 */
export async function useVCR(options: VCROptions): Promise<void> {
  const { cassettePath, mode = 'auto', redact = [] } = options;
  const fullPath = `test/__cassettes__/${cassettePath}`;

  recording = mode === 'record' || (mode === 'auto' && !existsSync(fullPath));

  if (recording) {
    nock.recorder.rec({
      dont_print: true,
      output_objects: true,
    });
  } else {
    const cassetteData = await readFile(fullPath, 'utf-8');
    const definitions: nock.Definition[] = JSON.parse(cassetteData);

    if (redact.length > 0) {
      // Create interceptors manually so we can use filteringPath
      for (const def of definitions) {
        nock(def.scope)
          .filteringPath((path) => stripQueryParams(path, redact))
          .get(stripQueryParams(def.path as string, redact))
          .reply(def.status ?? 200, def.response, def.headers as Record<string, string>);
      }
    } else {
      nock.define(definitions);
    }
  }
}

/**
 * Save recorded HTTP interactions to cassette file
 */
export async function saveVCR(cassettePath: string, redact: string[] = []): Promise<void> {
  if (recording) {
    const fullPath = `test/__cassettes__/${cassettePath}`;
    const recordings = nock.recorder.play() as nock.Definition[];

    if (recordings.length > 0) {
      // Redact sensitive query params before saving
      if (redact.length > 0) {
        for (const rec of recordings) {
          if (typeof rec.path === 'string') {
            rec.path = stripQueryParams(rec.path, redact);
          }
        }
      }

      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, JSON.stringify(recordings, null, 2), 'utf-8');
    }

    nock.recorder.clear();
    nock.restore();
  }

  nock.cleanAll();
  recording = false;
}

function stripQueryParams(path: string, params: string[]): string {
  const [pathname, query] = path.split('?');
  if (!query) return path;
  const searchParams = new URLSearchParams(query);
  for (const param of params) {
    searchParams.delete(param);
  }
  const remaining = searchParams.toString();
  return remaining ? `${pathname}?${remaining}` : pathname;
}
