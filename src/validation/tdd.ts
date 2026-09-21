/** A production file and a test file that were matched to each other. */
export interface TddAssociation {
  source: string;
  test: string;
  /** Tokens both paths share, so the caller can judge the match. */
  sharedTokens: string[];
  /**
   * `module` when the match goes beyond the path prefix every file shares,
   * `package` when only the common package prefix matched. A package-level match
   * still passes the checkpoint, but it is weak evidence and is disclosed.
   */
  strength: 'module' | 'package';
}

export interface TddCheckpoint {
  ok: boolean;
  reasons: string[];
  sourceChanges: string[];
  testChanges: string[];
  associations: TddAssociation[];
  /** True when a match rested only on the shared package prefix. */
  weakAssociation: boolean;
}

/**
 * Which files count as production code or tests, and which words in a path
 * carry no information. Every ecosystem answers this differently: the core must
 * not assume a `.py` suffix or a `test_` prefix.
 */
export interface TddSignals {
  isSourceFile(path: string): boolean;
  isTestFile(path: string): boolean;
  /**
   * Tokens that appear in the prefix of most paths and so cannot distinguish
   * two modules (`tests`, `src`, `lib`).
   */
  prefixTokens: ReadonlySet<string>;
  /** Tokens shorter than this cannot distinguish two module names. */
  minTokenLength?: number;
}

const DEFAULT_MIN_TOKEN_LENGTH = 4;

function tokens(path: string, signals: TddSignals): string[] {
  const minLength = signals.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH;
  return path
    .replace(/\.[A-Za-z0-9]+$/, '')
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= minLength && !signals.prefixTokens.has(token));
}

function sharedTokens(source: string, test: string, signals: TddSignals): string[] {
  const testTokens = tokens(test, signals);
  const shared: string[] = [];
  for (const sourceToken of new Set(tokens(source, signals))) {
    if (
      testTokens.some(
        (testToken) =>
          sourceToken === testToken ||
          sourceToken.startsWith(testToken) ||
          testToken.startsWith(sourceToken),
      )
    ) {
      shared.push(sourceToken);
    }
  }
  return shared;
}

/**
 * Tokens contributed by the directory prefix every changed path shares.
 *
 * In a project whose tests live inside the package under test, every path
 * starts with the package name, so those tokens say nothing about whether a
 * specific test covers a specific module. A common prefix of nothing (no shared
 * directory) yields no exclusions, so an exact name match is never downgraded.
 */
function commonPrefixTokens(paths: string[], signals: TddSignals): Set<string> {
  if (paths.length < 2) return new Set();
  const directories = paths.map((path) => path.replace(/\\/g, '/').split('/').slice(0, -1));
  const [first, ...rest] = directories;
  const common: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (rest.every((entry) => entry[index] === segment)) common.push(segment);
    else break;
  }
  return new Set(common.flatMap((segment) => tokens(segment, signals)));
}

/**
 * Check that production changes are accompanied by a plausibly related test
 * change.
 *
 * Matching is name-based on purpose: it is cheap, deterministic, and only used
 * to decide whether to run the heavier verification bundle. Because it is only
 * name-based, it also reports *why* each pair matched and downgrades a match
 * that rests solely on the package prefix instead of silently counting it as
 * strong evidence.
 */
export function checkTdd(
  changedPaths: string[],
  testChangedPaths: string[],
  signals: TddSignals,
): TddCheckpoint {
  const all = [...new Set([...changedPaths, ...testChangedPaths])].map((path) =>
    path.replace(/\\/g, '/'),
  );
  const sourceChanges = all.filter(
    (path) => signals.isSourceFile(path) && !signals.isTestFile(path),
  );
  const testChanges = all.filter((path) => signals.isTestFile(path));

  // `pkg/db/database.py` and `pkg/tests/unit/test_db.py` share `pkg` with every
  // other file in the project, so those tokens are not evidence of a relation.
  const ubiquitous = commonPrefixTokens([...sourceChanges, ...testChanges], signals);

  const associations: TddAssociation[] = [];
  for (const source of sourceChanges) {
    for (const test of testChanges) {
      const shared = sharedTokens(source, test, signals);
      if (shared.length === 0) continue;
      const discriminating = shared.filter((token) => !ubiquitous.has(token));
      associations.push({
        source,
        test,
        sharedTokens: shared,
        strength: discriminating.length > 0 ? 'module' : 'package',
      });
    }
  }

  const strong = associations.some((entry) => entry.strength === 'module');
  const weakAssociation = associations.length > 0 && !strong;

  const reasons: string[] = [];
  if (sourceChanges.length > 0 && testChanges.length === 0) {
    reasons.push('Production source files changed without any test file change.');
  } else if (sourceChanges.length > 0 && associations.length === 0) {
    reasons.push('Changed test files do not appear related to the changed production modules.');
  }

  return {
    ok: reasons.length === 0,
    reasons,
    sourceChanges,
    testChanges,
    associations,
    weakAssociation,
  };
}
