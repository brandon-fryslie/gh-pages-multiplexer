// [LAW:one-source-of-truth] versions.json is the sole authoritative record of deployed versions (MNFST-01).
// [LAW:dataflow-not-control-flow] updateManifest always performs the same ops; idempotent replace is encoded in data (filter + prepend).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest, ManifestEntry } from './types.js';

const MANIFEST_FILE = 'versions.json';

/**
 * Read versions.json from workdir. Returns an empty manifest if the file
 * does not exist. Throws if schema is not 1 (T-01-06).
 */
export async function readManifest(workdir: string): Promise<Manifest> {
  const file = path.join(workdir, MANIFEST_FILE);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schema: 2, versions: [] };
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Manifest;
  // [LAW:one-source-of-truth] D-02: reader accepts 1|2, writer always emits 2.
  if (parsed.schema !== 1 && parsed.schema !== 2) {
    throw new Error(`Unsupported manifest schema: ${parsed.schema as unknown as number}`);
  }
  if (!Array.isArray(parsed.versions)) {
    throw new Error('Manifest versions field is not an array');
  }
  return parsed;
}

/**
 * Pure function: return a new manifest with the entry added (or replaced if
 * one with the same version already exists). Newest first.
 */
export function updateManifest(manifest: Manifest, entry: ManifestEntry): Manifest {
  const filtered = manifest.versions.filter((v) => v.version !== entry.version);
  // [LAW:one-source-of-truth] D-02: reader accepts 1|2, writer always emits 2.
  return {
    schema: 2,
    versions: [entry, ...filtered],
  };
}

/**
 * Pure function: return a new manifest with the specified versions removed.
 * When the removal set is empty, the returned manifest is identical to the input.
 * [LAW:dataflow-not-control-flow] Always runs; empty set = identity transform in data.
 */
export function removeVersions(manifest: Manifest, versions: string[]): Manifest {
  const removalSet = new Set(versions);
  return {
    schema: 2,
    versions: manifest.versions.filter((v) => !removalSet.has(v.version)),
  };
}

/**
 * Write the manifest to workdir/versions.json as formatted JSON.
 */
export async function writeManifest(workdir: string, manifest: Manifest): Promise<void> {
  const file = path.join(workdir, MANIFEST_FILE);
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
