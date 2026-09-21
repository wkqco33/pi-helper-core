import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompletionEvidence } from '../src/validation/evidence.ts';
import { checkTdd, type TddSignals } from '../src/validation/tdd.ts';
import { summarizeValidation, type ValidationStep } from '../src/validation/bundle.ts';

const preparation = {
  name: 'environment',
  label: 'the environment sync',
  executed: true,
  ok: true,
};

test('completion is not proven when a stage never ran', () => {
  const evidence = buildCompletionEvidence({
    preparation: { ...preparation, executed: false, ok: false },
    testExecuted: false,
    testOk: false,
    stale: false,
    changedPaths: ['src/app/core.src'],
  });
  assert.equal(evidence.ok, false);
  assert.equal(evidence.blockers.length, 2);
  assert.match(evidence.blockers[0], /the environment sync was not executed/);
  assert.match(evidence.blockers[1], /Tests were not executed/);
  assert.deepEqual(evidence.changedPaths, ['src/app/core.src']);
});

test('a stale artifact invalidates an otherwise complete run', () => {
  const evidence = buildCompletionEvidence({
    preparation,
    testExecuted: true,
    testOk: true,
    stale: true,
    changedPaths: [],
  });
  assert.equal(evidence.ok, false);
  assert.match(evidence.blockers[0], /Stale artifacts/);
});

test('completion is proven only when everything ran and passed', () => {
  const evidence = buildCompletionEvidence({
    preparation,
    testExecuted: true,
    testOk: true,
    stale: false,
    changedPaths: ['src/app/core.src'],
  });
  assert.equal(evidence.ok, true);
  assert.deepEqual(evidence.blockers, []);
});

const signals: TddSignals = {
  isSourceFile: (path) => path.endsWith('.src'),
  isTestFile: (path) => path.startsWith('spec/') || path.includes('/spec/'),
  prefixTokens: new Set(['src', 'spec', 'lib', 'test']),
};

test('a production change without a test change is a blocker', () => {
  const checkpoint = checkTdd(['src/ledger/totals.src'], [], signals);
  assert.equal(checkpoint.ok, false);
  assert.match(checkpoint.reasons[0], /without any test file change/);
});

test('a related test change passes and records why it matched', () => {
  const checkpoint = checkTdd(['src/ledger/totals.src'], ['spec/ledger/totals_spec.src'], signals);
  assert.equal(checkpoint.ok, true);
  assert.equal(checkpoint.associations.length, 1);
  assert.equal(checkpoint.associations[0].strength, 'module');
  assert.ok(checkpoint.associations[0].sharedTokens.includes('ledger'));
  assert.equal(checkpoint.weakAssociation, false);
});

test('a match resting only on the shared package prefix is disclosed', () => {
  const checkpoint = checkTdd(
    ['packagename/alpha/one.src', 'packagename/beta/two.src'],
    ['packagename/spec/three.src'],
    signals,
  );
  // The pair shares only the prefix every path has, so it passes the checkpoint
  // but is disclosed as weak evidence rather than counted as a real match.
  assert.equal(checkpoint.ok, true);
  assert.equal(checkpoint.weakAssociation, true);
  assert.equal(checkpoint.associations[0].strength, 'package');
  assert.deepEqual(checkpoint.associations[0].sharedTokens, ['packagename']);
});

test('changed tests that share nothing with the change are reported', () => {
  const checkpoint = checkTdd(['packagename/alpha/one.src'], ['spec/three.src'], signals);
  assert.equal(checkpoint.ok, false);
  assert.match(checkpoint.reasons[0], /do not appear related/);
});

test('a non-source change needs no test', () => {
  const checkpoint = checkTdd(['README.md', 'manifest.toml'], [], signals);
  assert.equal(checkpoint.ok, true);
  assert.deepEqual(checkpoint.sourceChanges, []);
});

const step = (overrides: Partial<ValidationStep> = {}): ValidationStep => ({
  executed: true,
  ok: true,
  ...overrides,
});

function summarize(overrides: Record<string, unknown> = {}) {
  return summarizeValidation({
    lock: step(),
    preparation: step(),
    test: step({ failures: 0 }),
    conformance: 'consistent',
    stale: false,
    ...overrides,
  } as Parameters<typeof summarizeValidation>[0]);
}

test('preview and skipped steps never pass the gate', () => {
  const preview = summarize({ preview: true });
  assert.equal(preview.ok, false);
  assert.match(preview.reason, /execute=true/);

  const missing = summarize({ preparation: step({ executed: false, ok: false }) });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /preparation step was not executed/);
});

test('a run that executed no test is not evidence', () => {
  const summary = summarize({ test: step({ failures: 0, noTestsRan: true }) });
  assert.equal(summary.ok, false);
  assert.match(summary.reason, /without executing any test/);
  assert.equal(summary.checks.test, false);
});

test('conformance must be proven, not merely not-failed', () => {
  assert.equal(summarize({ conformance: 'drifted' }).ok, false);
  const unverifiable = summarize({ conformance: 'unverifiable' });
  assert.equal(unverifiable.ok, false);
  assert.match(unverifiable.reason, /not proven to be on the locked versions/);
});

test('declared quality checks gate the run and report which failed', () => {
  const passed = summarize({ quality: [{ name: 'linter', executed: true, ok: true }] });
  assert.equal(passed.ok, true);

  const failed = summarize({
    quality: [
      { name: 'linter', executed: true, ok: true },
      { name: 'types', executed: true, ok: false },
    ],
  });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /failed: types/);

  // A project declaring no quality command is not penalised.
  assert.equal(summarize({ quality: [] }).ok, true);
});

test('adapter labels keep the reason readable without the core knowing commands', () => {
  const summary = summarize({
    lock: step({ executed: false, ok: false }),
    labels: { lock: 'the manifest check' },
  });
  assert.match(summary.reason, /the manifest check was not executed/);
});

test('a skip reason is reported instead of an unexplained failure', () => {
  const summary = summarize({
    test: step({ executed: false, ok: false, skippedReason: 'the test runner is missing' }),
  });
  assert.equal(summary.ok, false);
  assert.match(summary.reason, /the test runner is missing/);
});
