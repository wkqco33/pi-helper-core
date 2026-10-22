import { spawn } from 'node:child_process';
import { getTransport } from './transport.ts';

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Cap applied to stdout and stderr independently. */
  maxBytes?: number;
  stdin?: string;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  durationMs: number;
}

function appendLimited(current: string, chunk: string, maxBytes: number): [string, boolean] {
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') <= maxBytes) return [next, false];
  return [Buffer.from(next, 'utf8').subarray(0, maxBytes).toString('utf8'), true];
}

/**
 * Single bounded subprocess entry point for every helper.
 *
 * User-supplied paths and package names must always reach the process through
 * `args`, never through a shell string, and every call must stay inside a
 * timeout and an output cap. Killing the whole process group matters because a
 * toolchain driver spawns compilers and linkers that would otherwise survive.
 *
 * This is the only place a transport is consulted: every helper routes through
 * here, so one branch makes all of them remote-capable. The local path below is
 * untouched when no transport is registered.
 */
export async function runCommand(
  executable: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  const transport = getTransport();
  if (transport) {
    // `mapCwd` may throw; that rejects the call rather than running the command
    // in a directory the transport cannot represent.
    return transport.exec({ ...options, executable, args, cwd: transport.mapCwd(options.cwd) });
  }
  return runLocalCommand(executable, args, options);
}

/**
 * Runs a command on this machine, ignoring any registered transport.
 *
 * A transport that shells out needs this: calling `runCommand` from inside a
 * transport would route the transport's own client process back into itself.
 */
export async function runLocalCommand(
  executable: string,
  args: string[],
  options: RunOptions,
): Promise<RunResult> {
  const maxBytes = options.maxBytes ?? 100 * 1024;
  const startedAt = Date.now();
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (options.stdin !== undefined) child.stdin.write(options.stdin);
  child.stdin.end();

  let stdout = '';
  let stderr = '';
  let truncated = false;
  let timedOut = false;
  let cancelled = false;
  let spawnError: Error | undefined;
  const onAbort = () => {
    cancelled = true;
    terminate(child);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        terminate(child);
      }, options.timeoutMs)
    : undefined;

  // A missing executable arrives here rather than as a rejection, so the
  // message is folded into stderr where a failure diagnosis already looks.
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stdout.on('data', (chunk: Buffer) => {
    const [next, wasTruncated] = appendLimited(stdout, chunk.toString(), maxBytes);
    stdout = next;
    truncated ||= wasTruncated;
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const [next, wasTruncated] = appendLimited(stderr, chunk.toString(), maxBytes);
    stderr = next;
    truncated ||= wasTruncated;
  });
  const code = await new Promise<number | null>((resolve) =>
    child.once('close', (exitCode) => resolve(exitCode)),
  );
  if (timeout) clearTimeout(timeout);
  options.signal?.removeEventListener('abort', onAbort);
  if (spawnError) stderr = `${stderr}${stderr ? '\n' : ''}${spawnError.message}`;
  return {
    code,
    stdout,
    stderr,
    timedOut,
    cancelled,
    truncated,
    durationMs: Date.now() - startedAt,
  };
}

function terminate(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return;
  try {
    // The negative pid targets the process group, so child compilers die too.
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/** A command failed to start at all, which is an environment problem.
 *
 * Node reports a spawn error through `error` and then closes the child with a
 * negative code, so the exit code alone cannot identify this case; the message
 * is the reliable signal.
 */
export function isSpawnFailure(result: RunResult): boolean {
  return (
    !result.timedOut &&
    !result.cancelled &&
    result.code !== 0 &&
    /ENOENT|EACCES|not found|Failed to spawn|command not found/i.test(result.stderr)
  );
}
