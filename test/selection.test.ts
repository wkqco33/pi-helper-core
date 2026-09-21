import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTests, type SelectionSignals } from '../src/selection/select.ts';

const STOP = new Set(['src', 'spec', 'lib', 'test', 'tests']);

function tokens(path: string): string[] {
  return path
    .replace(/\.[A-Za-z0-9]+$/, '')
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !STOP.has(token));
}

/** `src/pkg/db/database.src` is imported as `pkg.db.database`. */
function moduleNamesForFile(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  const index = segments.lastIndexOf('src');
  const trimmed = (index === -1 ? segments : segments.slice(index + 1)).map((segment) =>
    segment.replace(/\.[A-Za-z0-9]+$/, ''),
  );
  if (trimmed.length === 0) return [];
  return [trimmed.join('.')];
}

function packageName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const index = segments.lastIndexOf('src');
  return (index === -1 ? segments[0] : segments[index + 1]) ?? '';
}

const signals: SelectionSignals = {
  isSourceFile: (path) => path.endsWith('.src'),
  isTestFile: (path) => path.startsWith('spec/'),
  isRunnableTestFile: (path) => path.startsWith('spec/') && path.endsWith('_spec.src'),
  pathTokens: tokens,
  moduleNamesForFile,
  packageName,
  supportFileNames: new Set(['shared.src']),
  testNameAffixes: { prefixes: [], suffixes: ['_spec'] },
};

const TEST_FILES = [
  'spec/parser_spec.src',
  'spec/db/database_spec.src',
  'spec/api_spec.src',
  'spec/unrelated_spec.src',
  'spec/shared.src',
];

test('an actual import of the changed module outranks any name coincidence', () => {
  const result = selectTests(['src/pkg/db/database.src'], TEST_FILES, signals, {
    testImports: {
      'spec/db/database_spec.src': ['pkg.db.database'],
      'spec/unrelated_spec.src': ['os'],
    },
  });
  assert.equal(result.importEvidenceUsed, true);
  assert.equal(result.selected[0].path, 'spec/db/database_spec.src');
  assert.match(result.selected[0].reason, /imports the changed module/);
  assert.ok(result.selected[0].score >= 90);
});

test('a naming convention match still selects when no import evidence exists', () => {
  const result = selectTests(['src/pkg/parser.src'], TEST_FILES, signals);
  assert.equal(result.importEvidenceUsed, false);
  const parser = result.selected.find((entry) => entry.path === 'spec/parser_spec.src');
  assert.ok(parser, 'the matching stem must be selected');
  assert.match(parser.reason, /module name matches/);
});

test('the shared test fixture is always in scope once tests run', () => {
  const result = selectTests(['src/pkg/parser.src'], TEST_FILES, signals);
  const support = result.selected.find((entry) => entry.path === 'spec/shared.src');
  assert.ok(support);
  assert.equal(support.score, 1);
});

test('a signal every candidate shares is discarded instead of scoring', () => {
  // Every candidate lives under the same package, so the package name and its
  // token carry no information; without suppression the selection would be the
  // whole suite while looking focused.
  const rooted: SelectionSignals = {
    ...signals,
    isTestFile: (path) => path.startsWith('pkg/spec/') || path.startsWith('spec/'),
    isRunnableTestFile: (path) => path.endsWith('_spec.src') && path.includes('/spec/'),
  };
  const candidates = [
    'pkg/spec/alpha_spec.src',
    'pkg/spec/beta_spec.src',
    'pkg/spec/gamma_spec.src',
  ];
  const result = selectTests(['pkg/alpha.src'], candidates, rooted);
  assert.equal(result.narrowed, true);
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].path, 'pkg/spec/alpha_spec.src');
  // The only match is the module name; the package token was suppressed, so no
  // candidate is selected for sharing it.
  assert.match(result.selected[0].reason, /module name matches/);
  assert.match(result.selected[0].reason, /shares token\(s\): alpha/);
  assert.doesNotMatch(result.selected[0].reason, /shares token\(s\):[^;]*pkg/);
});

test('an unmatchable change falls back to the whole suite', () => {
  const result = selectTests(['src/pkg/brandnew.src'], ['spec/unrelated_spec.src'], signals);
  assert.equal(result.fellBackToAll, true);
  assert.equal(result.selected.length, 1);
  assert.match(result.selected[0].reason, /full suite/);
});

test('a change with no source file selects nothing without claiming a fallback', () => {
  const result = selectTests(['docs/guide.md'], TEST_FILES, signals);
  assert.deepEqual(result.selected, []);
  assert.equal(result.fellBackToAll, false);
  assert.deepEqual(result.changedSourceFiles, []);
});

test('test infrastructure is reported separately from the targets', () => {
  const result = selectTests(['src/pkg/parser.src'], TEST_FILES, signals);
  assert.deepEqual(result.supportFiles, ['spec/shared.src']);
  assert.equal(result.consideredTestFiles.length, TEST_FILES.length);
});

test('a changed test file is selected as itself', () => {
  const result = selectTests(['spec/api_spec.src'], TEST_FILES, signals);
  const api = result.selected.find((entry) => entry.path === 'spec/api_spec.src');
  assert.ok(api);
  assert.match(api.reason, /the test file itself changed/);
});
