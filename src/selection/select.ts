/**
 * Rank candidate test files against changed paths.
 *
 * Every ecosystem answers "what is a test file" and "what module does this path
 * become" differently, so those questions are injected. The ranking itself —
 * pytest conventions first, fuzzy token overlap second, ubiquitous signals
 * discarded — has proven stable across ecosystems and lives here.
 */

export interface TestSelection {
  path: string;
  score: number;
  reason: string;
}

export interface SelectionResult {
  selected: TestSelection[];
  /** True when no changed file could be mapped and every test file is returned. */
  fellBackToAll: boolean;
  /**
   * False when the selection covers every considered test file, so the
   * candidate list was not narrowed at all. Reported so a caller does not read
   * "30 of 30 selected" as a focused run.
   */
  narrowed: boolean;
  changedSourceFiles: string[];
  changedTestFiles: string[];
  consideredTestFiles: string[];
  /** Files under a test directory that the runner does not collect tests from. */
  supportFiles: string[];
  /**
   * True when at least one candidate was matched by an actual import of a
   * changed module, which is the strongest available signal. False means the
   * selection rests on naming conventions alone.
   */
  importEvidenceUsed: boolean;
}

/**
 * Dotted module names imported by each test file, keyed by test path.
 *
 * Supplied by the project model because a test named `test_db_session.py` gives
 * no naming hint that it covers `db/database.py`; its imports do.
 */
export type TestImportMap = Record<string, string[]>;

export interface SelectionSignals {
  isSourceFile(path: string): boolean;
  isTestFile(path: string): boolean;
  /** True when the runner collects tests from this file at all. */
  isRunnableTestFile(path: string): boolean;
  /** Lowercase words a path contributes, used for fuzzy matching. */
  pathTokens(path: string): string[];
  /** Dotted module names a source path can be imported as. */
  moduleNamesForFile(path: string): string[];
  /** First package segment of a path, used to detect a package-rooted test tree. */
  packageName(path: string): string;
  /**
   * Basenames that affect every test and so are always in scope once tests run
   * (a shared fixture file, a test module root).
   */
  supportFileNames?: ReadonlySet<string>;
  /** Affixes stripped from a test file name before stems are compared. */
  testNameAffixes?: { prefixes: string[]; suffixes: string[] };
  /** Share of candidates a value must reach before it stops being informative. */
  ubiquitousShare?: number;
}

export interface SelectionOptions {
  testImports?: TestImportMap;
}

export const DEFAULT_SCORE = {
  changedTestItself: 100,
  /** Importing the changed module is stronger than any name coincidence. */
  importsChangedModule: 90,
  sameStemSameDir: 80,
  sameStem: 60,
  sameDirectory: 40,
  sharedToken: 20,
  sharedModule: 30,
} as const;

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

function parentDir(path: string): string {
  const posix = toPosix(path);
  const index = posix.lastIndexOf('/');
  return index === -1 ? '' : posix.slice(0, index);
}

function baseName(path: string): string {
  const posix = toPosix(path);
  const index = posix.lastIndexOf('/');
  return index === -1 ? posix : posix.slice(index + 1);
}

function stem(path: string): string {
  return baseName(path).replace(/\.[A-Za-z0-9]+$/, '');
}

/** Strip the ecosystem's test affixes so `test_parser` and `parser` compare equal. */
export function normalizedStem(path: string, signals: SelectionSignals): string {
  const affixes = signals.testNameAffixes ?? { prefixes: [], suffixes: [] };
  let name = stem(path);
  for (const prefix of affixes.prefixes) {
    if (name.startsWith(prefix)) name = name.slice(prefix.length);
  }
  for (const suffix of affixes.suffixes) {
    if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
  }
  return name.toLowerCase();
}

/** True when a test imports the module, or a parent package of it. */
function importsModule(imported: string[], modules: string[]): string | undefined {
  let best: string | undefined;
  for (const candidate of modules) {
    for (const entry of imported) {
      const matches =
        entry === candidate ||
        entry.startsWith(`${candidate}.`) ||
        candidate.startsWith(`${entry}.`);
      if (!matches) continue;
      // Report the most specific import: naming `pkg` when the file actually
      // imports `pkg.routes.admin` overstates how broadly the test is coupled.
      if (!best || entry.length > best.length) best = entry;
    }
  }
  return best;
}

/**
 * Values that appear in at least this share of the candidates carry no
 * information about *which* candidate to run: in a project whose tests all live
 * inside the package under test, the package name matches every file.
 */
const DEFAULT_UBIQUITOUS_SHARE = 0.5;

function ubiquitousValues(documents: string[][], share: number): Set<string> {
  const counts = new Map<string, number>();
  for (const values of documents) {
    for (const value of new Set(values)) {
      if (value.length === 0) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, documents.length * share);
  const ubiquitous = new Set<string>();
  for (const [value, count] of counts) {
    if (count >= threshold) ubiquitous.add(value);
  }
  return ubiquitous;
}

/**
 * Rank test files against changed paths.
 *
 * Signals shared by every candidate are discarded rather than scored. Without
 * that step a package-rooted test tree matches its own package on every file and
 * the selection degenerates into the full suite while appearing focused.
 */
export function selectTests(
  changedPaths: string[],
  testFiles: string[],
  signals: SelectionSignals,
  options: SelectionOptions = {},
): SelectionResult {
  const share = signals.ubiquitousShare ?? DEFAULT_UBIQUITOUS_SHARE;
  const changed = changedPaths
    .map(toPosix)
    .filter((path) => signals.isSourceFile(path) || signals.isTestFile(path));
  const changedSourceFiles = changed.filter((path) => !signals.isTestFile(path));
  const changedTestFiles = changed.filter((path) => signals.isTestFile(path));
  const considered = [...new Set(testFiles.map(toPosix))]
    .filter((path) => signals.isSourceFile(path) || signals.isTestFile(path))
    .sort();
  const supportFiles = considered.filter((path) => !signals.isRunnableTestFile(path));
  const testImports = options.testImports ?? {};

  if (!changed.length) {
    return {
      selected: [],
      fellBackToAll: false,
      narrowed: false,
      changedSourceFiles,
      changedTestFiles,
      consideredTestFiles: considered,
      supportFiles,
      importEvidenceUsed: false,
    };
  }

  const sourceTokens = new Set(changedSourceFiles.flatMap((path) => signals.pathTokens(path)));
  const sourceModules = new Set(changedSourceFiles.map((path) => signals.packageName(path)));
  const sourceStems = new Set(changedSourceFiles.map((path) => normalizedStem(path, signals)));
  const sourceModulePaths = changedSourceFiles.map((path) => signals.moduleNamesForFile(path));

  const ubiquitousTokens = ubiquitousValues(
    considered.map((path) => signals.pathTokens(path)),
    share,
  );
  const ubiquitousModules = ubiquitousValues(
    considered.map((path) => [signals.packageName(path)]),
    share,
  );
  // A source directory that contains every test file (the package root) cannot
  // distinguish candidates, so it does not score.
  const sourceDirs = new Set(
    [...new Set(changedSourceFiles.map(parentDir))].filter(
      (directory) =>
        directory === '' || !considered.every((path) => path.startsWith(`${directory}/`)),
    ),
  );

  let importEvidenceUsed = false;
  const selections: TestSelection[] = [];
  for (const testFile of considered) {
    // Test infrastructure is not a target, but it can still affect the run, so
    // it is reported separately instead of being scored as a test file.
    if (!signals.isRunnableTestFile(testFile)) continue;

    const reasons: string[] = [];
    let score = 0;

    if (changedTestFiles.includes(testFile)) {
      score += DEFAULT_SCORE.changedTestItself;
      reasons.push('the test file itself changed');
    }

    const imported = testImports[testFile];
    if (imported && imported.length > 0) {
      const matched = sourceModulePaths
        .map((modules) => importsModule(imported, modules))
        .find((value) => value !== undefined);
      if (matched) {
        score += DEFAULT_SCORE.importsChangedModule;
        importEvidenceUsed = true;
        reasons.push(`imports the changed module "${matched}"`);
      }
    }

    const testStem = normalizedStem(testFile, signals);
    const testDir = parentDir(testFile);
    if (sourceStems.has(testStem)) {
      score += DEFAULT_SCORE.sameStem;
      reasons.push(`module name matches "${testStem}"`);
      if (sourceDirs.has(testDir)) {
        score += DEFAULT_SCORE.sameStemSameDir - DEFAULT_SCORE.sameStem;
        reasons.push('same directory as the changed module');
      }
    } else if (sourceDirs.has(testDir)) {
      score += DEFAULT_SCORE.sameDirectory;
      reasons.push('same directory as a changed module');
    } else if (sourceDirs.has(parentDir(testDir))) {
      score += DEFAULT_SCORE.sameDirectory - 10;
      reasons.push('nested under a changed directory');
    }

    const module = signals.packageName(testFile);
    if (module && sourceModules.has(module) && !ubiquitousModules.has(module)) {
      score += DEFAULT_SCORE.sharedModule;
      reasons.push(`covers module "${module}"`);
    }

    const tokens = signals.pathTokens(testFile);
    const shared = tokens.filter(
      (token) => sourceTokens.has(token) && !ubiquitousTokens.has(token),
    );
    if (shared.length) {
      score += DEFAULT_SCORE.sharedToken * Math.min(shared.length, 2);
      reasons.push(`shares token(s): ${shared.slice(0, 4).join(', ')}`);
    }

    if (score > 0) {
      selections.push({ path: testFile, score, reason: reasons.join('; ') });
    }
  }

  selections.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  // A shared fixture can affect every test, so it is always in scope once tests run.
  const supportNames = signals.supportFileNames ?? new Set<string>();
  for (const testFile of considered) {
    if (supportNames.has(baseName(testFile)) && !selections.some((s) => s.path === testFile)) {
      selections.push({ path: testFile, score: 1, reason: 'shared test fixture scope' });
    }
  }

  const runnableConsidered = considered.filter((path) => signals.isRunnableTestFile(path));
  const selectedRunnable = selections.filter((entry) => signals.isRunnableTestFile(entry.path));
  const fellBackToAll = selections.length === 0 && considered.length > 0;
  if (fellBackToAll) {
    return {
      selected: considered.map((path) => ({
        path,
        score: 0,
        reason: 'no match; running the full suite',
      })),
      fellBackToAll: true,
      narrowed: false,
      changedSourceFiles,
      changedTestFiles,
      consideredTestFiles: considered,
      supportFiles,
      importEvidenceUsed,
    };
  }

  return {
    selected: selections,
    fellBackToAll: false,
    narrowed: selectedRunnable.length < runnableConsidered.length,
    changedSourceFiles,
    changedTestFiles,
    consideredTestFiles: considered,
    supportFiles,
    importEvidenceUsed,
  };
}
