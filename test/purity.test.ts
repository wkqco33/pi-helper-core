import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The core exists so a new helper only has to describe its ecosystem. If an
 * ecosystem name appears in executable code the boundary has already leaked,
 * and the next helper will copy it instead of writing an adapter.
 *
 * Comments are stripped first: explaining *why* a rule exists with an example
 * (`uv sync`, `cargo build`) is useful documentation and not a coupling.
 */
const SRC = new URL('../src', import.meta.url).pathname;

const FORBIDDEN: [string, RegExp][] = [
  ['python', /\bpython\b/i],
  ['cargo', /\bcargo\b/i],
  ['rustc', /\brustc\b/i],
  ['rustup', /\brustup\b/i],
  ['pyproject', /\bpyproject\b/i],
  ['pytest', /\bpytest\b/i],
  ['conftest', /\bconftest\b/i],
  ['uv', /\buv\b/i],
  ['pip', /\bpip\b/i],
  ['poetry', /\bpoetry\b/i],
  ['conda', /\bconda\b/i],
  ['colcon', /\bcolcon\b/i],
  ['ament', /\bament\b/i],
  ['rclpy', /\brclpy\b/i],
  ['go.mod', /\bgo\.mod\b/i],
  ['flutter', /\bflutter\b/i],
  ['dart', /\bdart\b/i],
  ['pubspec', /\bpubspec\b/i],
  ['gradle', /\bgradle\b/i],
  ['maven', /\bmaven\b/i],
  ['.py extension', /\.py\b/],
  ['.rs extension', /\.rs\b/],
  ['.go extension', /\.go\b/],
  ['.dart extension', /\.dart\b/],
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/^\s*\/\/.*$/gm, '');
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

test('the core names no ecosystem in executable code', async () => {
  const files = await sourceFiles(SRC);
  assert.ok(files.length >= 8, `expected the core sources, found ${files.length}`);

  const violations: string[] = [];
  for (const file of files) {
    const code = stripComments(await readFile(file, 'utf8'));
    for (const [label, pattern] of FORBIDDEN) {
      if (pattern.test(code)) violations.push(`${file.replace(SRC, 'src')}: ${label}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `ecosystem coupling found in the core:\n${violations.join('\n')}`,
  );
});

test('the core imports nothing outside itself and node builtins', async () => {
  const files = await sourceFiles(SRC);
  const violations: string[] = [];
  for (const file of files) {
    const code = await readFile(file, 'utf8');
    for (const match of stripComments(code).matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      violations.push(`${file.replace(SRC, 'src')}: ${specifier}`);
    }
  }
  // Type-only self references would also show up here; none are expected.
  assert.deepEqual(violations, [], `unexpected dependency:\n${violations.join('\n')}`);
});
