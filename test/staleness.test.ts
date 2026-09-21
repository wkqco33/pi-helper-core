import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectStaleArtifacts, type StalenessSpec } from '../src/build/staleness.ts';

const spec: StalenessSpec = {
  sourceExtensions: ['.src'],
  artifacts: [{ name: 'report.dat', code: 'STALE_REPORT', describe: 'report results' }],
  ignoredDirectories: new Set(['vendor']),
};

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'core-stale-'));
}

test('an artifact older than the newest source is stale', async () => {
  const root = await project();
  try {
    await writeFile(join(root, 'main.src'), 'one\n');
    await writeFile(join(root, 'report.dat'), 'data\n');
    const old = new Date(Date.now() - 60_000);
    const recent = new Date();
    await utimes(join(root, 'report.dat'), old, old);
    await utimes(join(root, 'main.src'), recent, recent);

    const report = await detectStaleArtifacts(root, spec);
    assert.equal(report.stale, true);
    assert.equal(report.artifacts[0].code, 'STALE_REPORT');
    assert.match(report.artifacts[0].message, /report results do not describe the current sources/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an artifact newer than the sources is accepted', async () => {
  const root = await project();
  try {
    await writeFile(join(root, 'main.src'), 'one\n');
    await writeFile(join(root, 'report.dat'), 'data\n');
    const recent = new Date();
    const old = new Date(Date.now() - 60_000);
    await utimes(join(root, 'main.src'), old, old);
    await utimes(join(root, 'report.dat'), recent, recent);

    const report = await detectStaleArtifacts(root, spec);
    assert.equal(report.stale, false);
    assert.deepEqual(report.artifacts, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a missing artifact is not reported as stale', async () => {
  const root = await project();
  try {
    await writeFile(join(root, 'main.src'), 'one\n');
    const report = await detectStaleArtifacts(root, spec);
    assert.equal(report.stale, false);
    assert.equal(report.incompleteReason, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ignored directories do not count as sources', async () => {
  const root = await project();
  try {
    await writeFile(join(root, 'report.dat'), 'data\n');
    const ignored = new Date(Date.now() - 120_000);
    await utimes(join(root, 'report.dat'), ignored, ignored);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(root, 'vendor'), { recursive: true });
    await writeFile(join(root, 'vendor', 'generated.src'), 'newer\n');

    const report = await detectStaleArtifacts(root, spec);
    // No non-ignored source exists, so staleness cannot be judged.
    assert.equal(report.stale, false);
    assert.match(report.incompleteReason ?? '', /No source file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unjudgeable check says why instead of claiming freshness', async () => {
  const root = await project();
  try {
    const report = await detectStaleArtifacts(root, spec);
    assert.equal(report.stale, false);
    assert.match(report.incompleteReason ?? '', /No source file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
