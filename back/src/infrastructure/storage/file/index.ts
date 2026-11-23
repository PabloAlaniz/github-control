/**
 * File-backed storage (Node only): the in-memory adapter plus loading and
 * saving of its state as one file per collection, in JSON or CSV.
 *
 *   <dir>/_meta.json            format, layout version and id sequences
 *   <dir>/repos.json|csv        one file per collection
 *
 * Meant for a single process. Every write is on disk before the store method
 * resolves; files are replaced atomically (temp file + rename), so a crash
 * leaves either the old or the new version of each file, never half of one.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Storage } from '../../../application/ports/storage';
import { createMemoryStorage, emptyState, type MemoryOptions, type MemoryState } from '../memory';
import { COLLECTIONS, type CollectionName } from '../schema';
import { CODECS, type FileFormat } from './codecs';

export type { FileFormat };

const META_FILE = '_meta.json';
const LAYOUT_VERSION = 1;

export interface FileStorageOptions {
  dir: string;
  format: FileFormat;
  /** Clock override (tests). */
  now?: MemoryOptions['now'];
}

interface Meta {
  format: FileFormat;
  version: number;
  seq: MemoryState['seq'];
}

function loadState(dir: string, format: FileFormat): MemoryState {
  const state = emptyState();
  const metaPath = join(dir, META_FILE);
  if (!existsSync(metaPath)) return state;

  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Meta;
  if (meta.format !== format) {
    throw new Error(`Storage directory ${dir} holds ${meta.format} data, but the configured format is ${format}`);
  }
  if (meta.version !== LAYOUT_VERSION) {
    throw new Error(`Storage directory ${dir} uses layout version ${meta.version}; this build supports ${LAYOUT_VERSION}`);
  }

  const codec = CODECS[format];
  state.seq = meta.seq ?? {};
  for (const collection of Object.keys(COLLECTIONS) as CollectionName[]) {
    const path = join(dir, `${collection}.${codec.extension}`);
    if (existsSync(path)) state[collection] = codec.decode(collection, readFileSync(path, 'utf8'));
  }
  return state;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
}

export function createFileStorage(options: FileStorageOptions): Storage {
  const { dir, format } = options;
  const codec = CODECS[format];
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const state = loadState(dir, format);

  // Saves run one at a time, in the order the writes happened.
  let queue: Promise<void> = Promise.resolve();

  const save = async (current: MemoryState, changed: ReadonlySet<CollectionName>) => {
    for (const collection of changed) {
      await writeAtomic(join(dir, `${collection}.${codec.extension}`), codec.encode(collection, current[collection]));
    }
    const meta: Meta = { format, version: LAYOUT_VERSION, seq: current.seq };
    await writeAtomic(join(dir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
  };

  return createMemoryStorage(state, {
    now: options.now,
    onChange(current, changed) {
      const run = queue.then(() => save(current, changed));
      queue = run.catch(() => undefined); // a failed save must not block later ones
      return run;
    },
  });
}
