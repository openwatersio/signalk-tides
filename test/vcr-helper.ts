import nock from 'nock';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { existsSync } from 'fs';

export interface VCROptions {
  cassettePath: string;
  mode?: 'record' | 'playback' | 'auto';
}

/**
 * VCR (Video Cassette Recorder) helper for recording and replaying HTTP requests
 *
 * @param options.cassettePath - Path to the cassette file (relative to test/__cassettes__/)
 * @param options.mode - 'record' (always record new), 'playback' (only use existing), 'auto' (record if missing)
 */
export async function useVCR(options: VCROptions): Promise<void> {
  const { cassettePath, mode = 'auto' } = options;
  const fullPath = `test/__cassettes__/${cassettePath}`;

  const shouldRecord = mode === 'record' || (mode === 'auto' && !existsSync(fullPath));

  if (shouldRecord) {
    // Record mode: allow real HTTP and save responses
    nock.recorder.rec({
      dont_print: true,
      output_objects: true,
    });
  } else {
    // Playback mode: load and replay saved responses
    try {
      const cassetteData = await readFile(fullPath, 'utf-8');
      const definitions = JSON.parse(cassetteData);
      nock.define(definitions);
    } catch (error) {
      throw new Error(`Failed to load VCR cassette from ${fullPath}: ${error}`);
    }
  }
}

/**
 * Save recorded HTTP interactions to cassette file
 */
export async function saveVCR(cassettePath: string): Promise<void> {
  const fullPath = `test/__cassettes__/${cassettePath}`;
  const recordings = nock.recorder.play();

  if (recordings.length > 0) {
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(recordings, null, 2), 'utf-8');
  }

  nock.recorder.clear();
  nock.restore();
  nock.cleanAll();
}
