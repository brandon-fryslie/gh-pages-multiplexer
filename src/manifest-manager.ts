// [LAW:one-source-of-truth] versions.json is the sole authoritative record of deployed versions (MNFST-01).
// [LAW:dataflow-not-control-flow] updateManifest always performs the same ops; idempotent replace is encoded in data (filter + prepend).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest, ManifestEntry, SlotRename } from './types.js';
import { sanitizeRef } from './ref-resolver.js';
import { ROOT_ENTRIES } from './root-entries.js';

/**
 * Read versions.json from workdir. Returns an empty manifest if the file
 * does not exist. Throws if schema is not 1 (T-01-06).
 */
export async function readManifest(workdir: string): Promise<Manifest> {
  const file = path.join(workdir, ROOT_ENTRIES.manifest);
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
  const file = path.join(workdir, ROOT_ENTRIES.manifest);
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/**
 * Pure function: rename every entry whose version is not a slot name (deployed before the slot-name
 * rule narrowed) to the slot name sanitizeRef gives it. A manifest of slot names is returned as is,
 * with no renames. Throws when a rename would land on a slot another entry holds.
 * [LAW:single-enforcer] sanitizeRef decides what a slot name is; this only applies it to slots already deployed.
 */
export function renameUnsafeSlots(manifest: Manifest): { manifest: Manifest; renames: SlotRename[] } {
  const slots = manifest.versions.map((v) => ({ from: v.version, to: sanitizeRef(v.version) }));
  const holders = new Map<string, string>();
  for (const { from, to } of slots) {
    const holder = holders.get(to);
    if (holder !== undefined) {
      throw new Error(
        `Deployed slots "${holder}" and "${from}" both become slot "${to}" under the URL-safe slot-name rule; ` +
          `remove one of them from ${ROOT_ENTRIES.manifest} and its directory`,
      );
    }
    holders.set(to, from);
  }
  return {
    manifest: { schema: manifest.schema, versions: manifest.versions.map((v, i) => ({ ...v, version: slots[i].to })) },
    renames: slots.filter((r) => r.from !== r.to),
  };
}
