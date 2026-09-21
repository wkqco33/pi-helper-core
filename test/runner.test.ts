import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpawnFailure, runCommand } from '../src/core/runner.ts';

const NODE = process.execPath;

test('a bounded command captures stdout, stderr, and its exit code', async () => {
  const result = await runCommand(
    NODE,
    ['-e', 'process.stdout.write("out"); process.stderr.write("err")'],
    {
      cwd: process.cwd(),
      timeoutMs: 20_000,
    },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'out');
  assert.equal(result.stderr, 'err');
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, false);
  assert.ok(result.durationMs >= 0);
});

test('a non-zero exit code is reported rather than thrown', async () => {
  const result = await runCommand(NODE, ['-e', 'process.exit(3)'], {
    cwd: process.cwd(),
    timeoutMs: 20_000,
  });
  assert.equal(result.code, 3);
  assert.equal(result.timedOut, false);
});

test('output beyond the cap is truncated and flagged', async () => {
  const result = await runCommand(NODE, ['-e', 'process.stdout.write("x".repeat(5000))'], {
    cwd: process.cwd(),
    timeoutMs: 20_000,
    maxBytes: 128,
  });
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length <= 128);
});

test('a command that exceeds its timeout is terminated and flagged', async () => {
  const result = await runCommand(NODE, ['-e', 'setTimeout(() => {}, 30_000)'], {
    cwd: process.cwd(),
    timeoutMs: 500,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.code === 0, false);
});

test('an abort signal cancels the run and is distinguished from a timeout', async () => {
  const controller = new AbortController();
  const promise = runCommand(NODE, ['-e', 'setTimeout(() => {}, 30_000)'], {
    cwd: process.cwd(),
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  controller.abort();
  const result = await promise;
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});

test('a missing executable surfaces as a spawn failure, not an exception', async () => {
  const result = await runCommand('definitely-not-installed-xyz', [], {
    cwd: process.cwd(),
    timeoutMs: 20_000,
  });
  assert.notEqual(result.code, 0);
  assert.equal(isSpawnFailure(result), true);
  assert.match(result.stderr, /ENOENT|not found/i);
  // A timeout or a cancellation is not a spawn failure.
  assert.equal(isSpawnFailure({ ...result, timedOut: true }), false);
  assert.equal(isSpawnFailure({ ...result, cancelled: true }), false);
});
