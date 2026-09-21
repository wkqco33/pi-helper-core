import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_SCHEMA_VERSION,
  createResultFactory,
  isActionable,
  note,
  warn,
  type ResultInput,
  type ToolResult,
} from '../src/core/result.ts';

const { result, failure } = createResultFactory('9.9.9');

function base<T>(overrides: Partial<ResultInput<T>> = {}): ResultInput<T> {
  return {
    ok: true,
    summary: 'ok',
    evidence: [],
    warnings: [],
    errors: [],
    suggestions: [],
    ...overrides,
  } as ResultInput<T>;
}

test('the envelope carries a schema version so a consumer can refuse a change', () => {
  assert.equal(CORE_SCHEMA_VERSION, 1);
});

test('attention is derived so a diagnostic is never silently ignored', () => {
  const clean = result('/tmp', Date.now(), base());
  assert.equal(clean.ok, true);
  assert.equal(clean.attention, false);

  const warned = result('/tmp', Date.now(), base({ warnings: [warn('W', 'warning')] }));
  assert.equal(warned.ok, true);
  assert.equal(warned.attention, true);

  const failed = result('/tmp', Date.now(), base({ ok: false }));
  assert.equal(failed.attention, true);
});

test('an info note documents a fact without demanding action', () => {
  const noted = result('/tmp', Date.now(), base({ warnings: [note('N', 'informational')] }));
  assert.equal(noted.attention, false);
  assert.equal(isActionable({ warnings: [note('N', 'x')], errors: [] }), false);
  assert.equal(isActionable({ warnings: [warn('W', 'x')], errors: [] }), true);
});

test('attention can be overridden but never contradicts a failure by default', () => {
  const overridden = result('/tmp', Date.now(), base({ ok: false, attention: true }));
  assert.equal(overridden.attention, true);

  const failureResult = failure('/tmp', Date.now(), 'boom', 'E_CODE');
  assert.equal(failureResult.ok, false);
  assert.equal(failureResult.attention, true);
  assert.equal(failureResult.errors[0].code, 'E_CODE');
});

test('metadata is assembled by the factory, not by the tool', () => {
  const started = Date.now() - 5;
  const value = result('/work', started, base({ projectRoot: '/work', truncated: true }));
  assert.equal(value.metadata.toolVersion, '9.9.9');
  assert.equal(value.metadata.cwd, '/work');
  assert.equal(value.metadata.truncated, true);
  assert.equal(value.metadata.projectRoot, '/work');
  assert.ok(value.metadata.durationMs >= 0);
  // Truncation and project root are metadata, not top-level envelope fields.
  assert.equal((value as unknown as Record<string, unknown>).truncated, undefined);
});

test('a toolchain descriptor replaces per-ecosystem metadata fields', () => {
  const value = result(
    '/work',
    Date.now(),
    base({
      toolchain: { kind: 'rust', version: '1.98.1', source: 'override', host: 'x86_64' },
      detail: { edition: '2021' },
    }),
  );
  assert.equal(value.metadata.toolchain?.kind, 'rust');
  assert.equal(value.metadata.toolchain?.source, 'override');
  assert.equal(value.metadata.detail?.edition, '2021');
});

test('a tool never defines its own envelope shape', () => {
  // The factory is the only constructor; this guards against a helper growing a
  // second response contract that drifts from the shared one.
  const value: ToolResult = failure('/tmp', Date.now(), 'x', 'C');
  const keys = Object.keys(value).sort();
  assert.deepEqual(keys, [
    'attention',
    'errors',
    'evidence',
    'metadata',
    'ok',
    'suggestions',
    'summary',
    'warnings',
  ]);
});
