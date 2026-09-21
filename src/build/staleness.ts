import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface StaleArtifact {
  code: string;
  message: string;
  path: string;
  artifactMtimeMs?: number;
  newestSource?: { path: string; mtimeMs: number };
}

export interface StalenessReport {
  stale: boolean;
  artifacts: StaleArtifact[];
  /** Populated when the check could not be completed, so `stale: false` is not overclaimed. */
  incompleteReason?: string;
}

/** One derived file that must be newer than the sources it describes. */
export interface StaleArtifactSpec {
  /** File name relative to the project root. */
  name: string;
  code: string;
  /** What the file holds, used in the message (`coverage results`). */
  describe: string;
}

export interface StalenessSpec {
  /** Extensions that count as source, including the dot (`.py`, `.rs`). */
  sourceExtensions: string[];
  artifacts: StaleArtifactSpec[];
  /** Directories that never hold sources worth comparing. */
  ignoredDirectories: ReadonlySet<string>;
  maxWalkedFiles?: number;
}

/** Directories that are never source in any ecosystem. */
export const UNIVERSAL_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox',
  '.eggs',
  'build',
  'dist',
]);

const DEFAULT_MAX_WALKED_FILES = 5000;

async function mtimeMs(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function newestSource(
  root: string,
  spec: StalenessSpec,
): Promise<{ path: string; mtimeMs: number } | undefined> {
  let newest: { path: string; mtimeMs: number } | undefined;
  let visited = 0;
  const maxFiles = spec.maxWalkedFiles ?? DEFAULT_MAX_WALKED_FILES;
  const ignored = new Set([...UNIVERSAL_IGNORED_DIRECTORIES, ...spec.ignoredDirectories]);
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      // A single unreadable directory must not abort the whole scan.
      continue;
    }
    for (const entry of entries) {
      if (visited > maxFiles) return newest;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        stack.push(path);
      } else if (entry.isFile() && spec.sourceExtensions.some((ext) => entry.name.endsWith(ext))) {
        visited += 1;
        const modified = await mtimeMs(path);
        if (modified === undefined) continue;
        if (!newest || modified > newest.mtimeMs) newest = { path, mtimeMs: modified };
      }
    }
  }
  return newest;
}

/**
 * Detect a derived artifact that predates the sources it claims to describe.
 *
 * Bytecode caches and build fingerprints are invalidated automatically by most
 * toolchains, so the artifacts that matter are the ones a tool writes and then
 * quotes later (a coverage report, a generated binding). Quoting one of those
 * after the sources changed is how a stale number becomes a false claim.
 *
 * When the check cannot be completed the report says why instead of returning a
 * clean `stale: false`.
 */
export async function detectStaleArtifacts(
  root: string,
  spec: StalenessSpec,
): Promise<StalenessReport> {
  const artifacts: StaleArtifact[] = [];
  let newest: { path: string; mtimeMs: number } | undefined;
  try {
    newest = await newestSource(root, spec);
  } catch (error) {
    return {
      stale: false,
      artifacts,
      incompleteReason: `Source scan failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!newest) {
    return {
      stale: false,
      artifacts,
      incompleteReason: `No source file (${spec.sourceExtensions.join(', ')}) was found.`,
    };
  }

  for (const artifact of spec.artifacts) {
    const path = join(root, artifact.name);
    const modified = await mtimeMs(path);
    if (modified === undefined) continue;
    if (modified < newest.mtimeMs) {
      artifacts.push({
        code: artifact.code,
        message: `${artifact.name} was written before ${newest.path} changed; ${artifact.describe} do not describe the current sources.`,
        path,
        artifactMtimeMs: modified,
        newestSource: newest,
      });
    }
  }

  return { stale: artifacts.length > 0, artifacts };
}
