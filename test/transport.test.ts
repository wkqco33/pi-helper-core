import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTransport,
  mapPathPrefix,
  setTransport,
  type CommandSpec,
  type CommandTransport,
} from '../src/core/transport.ts';
import { runCommand, runLocalCommand, type RunResult } from '../src/core/runner.ts';

const NODE = process.execPath;

function remoteResult(stdout: string): RunResult {
  return {
    code: 0,
    stdout,
    stderr: '',
    timedOut: false,
    cancelled: false,
    truncated: false,
    durationMs: 0,
  };
}

function fakeTransport(overrides: Partial<CommandTransport> = {}): {
  transport: CommandTransport;
  seen: CommandSpec[];
} {
  const seen: CommandSpec[] = [];
  const transport: CommandTransport = {
    id: 'fake',
    async exec(spec) {
      seen.push(spec);
      return remoteResult('remote');
    },
    mapCwd: (cwd) => cwd.replace('/local', '/remote'),
    ...overrides,
  };
  return { transport, seen };
}

test('a registered transport receives the command instead of spawning it locally', async () => {
  const { transport, seen } = fakeTransport();
  setTransport(transport);
  try {
    // The executable does not exist locally, so a local spawn would report a
    // spawn failure. Reaching the fake transport proves the branch is taken.
    const result = await runCommand('definitely-not-installed-xyz', ['--version'], {
      cwd: '/local/ws',
      timeoutMs: 20_000,
      maxBytes: 4096,
    });
    assert.equal(result.stdout, 'remote');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].executable, 'definitely-not-installed-xyz');
    assert.deepEqual(seen[0].args, ['--version']);
    assert.equal(seen[0].cwd, '/remote/ws');
    assert.equal(seen[0].timeoutMs, 20_000);
    assert.equal(seen[0].maxBytes, 4096);
  } finally {
    setTransport(null);
  }
});

test('a cwd the transport cannot map rejects and never runs the command', async () => {
  const { transport, seen } = fakeTransport({
    mapCwd: () => {
      throw new Error('working directory /elsewhere is outside the transport root');
    },
  });
  setTransport(transport);
  try {
    await assert.rejects(
      runCommand(NODE, ['-e', 'process.stdout.write("local")'], {
        cwd: '/elsewhere',
        timeoutMs: 20_000,
      }),
      /outside the transport root/,
    );
    assert.equal(seen.length, 0, 'no command may run when the cwd is unmappable');
  } finally {
    setTransport(null);
  }
});

test('runLocalCommand ignores the registered transport, so a transport cannot recurse', async () => {
  const { transport, seen } = fakeTransport();
  setTransport(transport);
  try {
    const result = await runLocalCommand(NODE, ['-e', 'process.stdout.write("local")'], {
      cwd: process.cwd(),
      timeoutMs: 20_000,
    });
    assert.equal(result.stdout, 'local');
    assert.equal(seen.length, 0);
  } finally {
    setTransport(null);
  }
});

test('without a transport the local runner still executes, so the default is unchanged', async () => {
  setTransport(null);
  assert.equal(getTransport(), null);
  const result = await runCommand(NODE, ['-e', 'process.stdout.write("local")'], {
    cwd: process.cwd(),
    timeoutMs: 20_000,
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'local');
});

test('the registry is a registered symbol on globalThis, shared by duplicate module copies', () => {
  const { transport } = fakeTransport();
  setTransport(transport);
  try {
    // Two hoisted copies of this package each own their module scope; the
    // global symbol is what keeps routing consistent between them.
    const shared = (globalThis as unknown as Record<symbol, unknown>)[
      Symbol.for('pi-helper-core.transport')
    ];
    assert.equal(shared, transport);
    assert.equal(getTransport(), transport);
  } finally {
    setTransport(null);
  }
  assert.equal(
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('pi-helper-core.transport')],
    null,
  );
  assert.equal(getTransport(), null);
});

test('mapPathPrefix rewrites a segment boundary without touching lookalike siblings', () => {
  assert.equal(mapPathPrefix('/work/ws/pkg', '/work', '/srv/app'), '/srv/app/ws/pkg');
  assert.equal(mapPathPrefix('/work', '/work', '/srv/app'), '/srv/app');
  assert.equal(mapPathPrefix('/work/ws/', '/work/', '/srv/app/'), '/srv/app/ws');
  assert.equal(mapPathPrefix('/a/b/c', '/a/b', '/x'), '/x/c');
});

test('mapPathPrefix handles a root on either side', () => {
  assert.equal(mapPathPrefix('/work/ws', '/', '/srv'), '/srv/work/ws');
  assert.equal(mapPathPrefix('/work/ws', '/', '/'), '/work/ws');
  assert.equal(mapPathPrefix('/work/ws', '/work', '/'), '/ws');
});

test('mapPathPrefix fails closed instead of returning a plausible wrong path', () => {
  assert.throws(
    () => mapPathPrefix('/application/x', '/app', '/srv'),
    /outside the transport root/,
  );
  assert.throws(() => mapPathPrefix('/elsewhere', '/app', '/srv'), /outside the transport root/);
  assert.throws(() => mapPathPrefix('relative/dir', '/app', '/srv'), /not an absolute POSIX path/);
});
