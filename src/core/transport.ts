import type { RunOptions, RunResult } from './runner.ts';

/**
 * One fully specified command, independent of where it executes.
 *
 * The runner builds this from its own arguments, so a transport never has to
 * guess which parts of a call site were meant for the remote side.
 */
export type CommandSpec = RunOptions & {
  executable: string;
  args: string[];
};

/**
 * Executes the core's commands somewhere other than this process.
 *
 * The seam exists so every helper (`ros`, `python`, `rust`, …) becomes
 * remote-capable by changing one function instead of its thirty call sites.
 * A transport resolves a `RunResult` for a command that ran and failed; it
 * rejects only when the command could not be attempted at all, because a
 * silent empty result looks like a passing run.
 */
export interface CommandTransport {
  /** Stable identifier used in diagnostics, e.g. `ssh:robot-01`. */
  readonly id: string;
  /** Runs the command on the transport's side and returns its bounded result. */
  exec(spec: CommandSpec): Promise<RunResult>;
  /**
   * Translates a local working directory into the transport's equivalent.
   *
   * Must throw when the directory cannot be expressed on the other side.
   * Running in a fallback directory would put a build or a test in the wrong
   * tree, which reads as a mysterious failure much later.
   */
  mapCwd(cwd: string): string;
}

/**
 * A registered symbol, not a private one and not a module variable.
 *
 * npm can hoist two copies of this package into one process when a helper
 * narrows the version range, and each copy gets its own module scope. Only a
 * key registered on `globalThis` is shared by both, so routing still works
 * when the two copies disagree about which one is current.
 */
const REGISTRY_KEY = Symbol.for('pi-helper-core.transport');

type Registry = Partial<Record<symbol, CommandTransport | null>>;

function registry(): Registry {
  return globalThis as unknown as Registry;
}

/**
 * Installs the transport every `runCommand` call routes through.
 *
 * `null` restores local execution, which is also the default so a helper that
 * never touches this module behaves exactly as before.
 */
export function setTransport(transport: CommandTransport | null): void {
  registry()[REGISTRY_KEY] = transport;
}

/** The active transport, or `null` when commands run locally. */
export function getTransport(): CommandTransport | null {
  return registry()[REGISTRY_KEY] ?? null;
}

/**
 * Rewrites `cwd` from one root onto another, comparing whole path segments.
 *
 * A plain prefix replacement corrupts siblings that share a name prefix
 * (`/app` applied to `/application/x`), so the root has to end at a separator.
 * Anything outside the root throws instead of returning a plausible-looking
 * path. Paths are POSIX: a transport that needs Windows paths must translate
 * them itself.
 */
export function mapPathPrefix(cwd: string, localRoot: string, remoteRoot: string): string {
  const local = normalizeRoot(localRoot);
  const remote = normalizeRoot(remoteRoot);
  const target = normalizeRoot(cwd);

  if (!target.startsWith('/')) {
    throw new Error(`working directory is not an absolute POSIX path: ${cwd}`);
  }

  if (local === '/') {
    if (remote === '/') return target;
    return `${remote}${target}`;
  }
  if (target === local) return remote;
  if (target.startsWith(`${local}/`)) {
    const remainder = target.slice(local.length);
    return remote === '/' ? remainder : `${remote}${remainder}`;
  }
  throw new Error(`working directory ${cwd} is outside the transport root ${localRoot}`);
}

/** Strips trailing separators, keeping `/` for the root itself. */
function normalizeRoot(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}
