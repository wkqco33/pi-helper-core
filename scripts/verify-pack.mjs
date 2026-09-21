/**
 * Verify the published tarball before it exists.
 *
 * `files` in package.json is easy to get wrong in a way no test notices: the
 * sources ship, or the tests ship too. Both are cheap to check here and
 * impossible to fix after `npm publish`.
 */
import { execFileSync } from 'node:child_process';

const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'src/index.ts'];
const FORBIDDEN_PREFIXES = ['test/', 'node_modules/'];

const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const [manifest] = JSON.parse(raw);
const files = new Set(manifest.files.map((entry) => entry.path));

const problems = [];
for (const required of REQUIRED) {
  if (!files.has(required)) problems.push(`missing from the tarball: ${required}`);
}
for (const prefix of FORBIDDEN_PREFIXES) {
  const leaked = [...files].filter((path) => path.startsWith(prefix));
  if (leaked.length > 0) problems.push(`must not ship: ${leaked.slice(0, 3).join(', ')}`);
}

if (
  manifest.version !==
  JSON.parse(
    execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { encoding: 'utf8' }),
  ).version
) {
  problems.push('package.json version does not match the packed manifest');
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `tarball ok: ${manifest.name}@${manifest.version}, ${files.size} files, ${manifest.unpackedSize} bytes`,
);
