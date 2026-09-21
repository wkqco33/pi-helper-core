export interface ValidationStep {
  /** Step label, used for the quality checks (`ruff`, `clippy`). */
  name?: string;
  executed: boolean;
  ok: boolean;
  exitCode?: number | null;
  failures?: number;
  /**
   * True when the runner reported success without executing any test. A run
   * that tested nothing is the most common false green, so it is never evidence.
   */
  noTestsRan?: boolean;
  /**
   * Why a step was not executed. A step that was skipped deliberately (the
   * environment is missing the tool it needs) must say so, otherwise the run
   * looks like an unexplained test failure.
   */
  skippedReason?: string;
}

/**
 * Concrete wording for the reasons. The adapter supplies the command names it
 * actually runs so the message reads naturally without the core knowing them.
 */
export interface ValidationLabels {
  lock: string;
  preparation: string;
  stale: string;
}

export interface ValidationSummary {
  ok: boolean;
  reason: string;
  checks: {
    lock: boolean;
    preparation: boolean;
    test: boolean;
    conformance: boolean;
    /**
     * True when every configured quality command passed. Vacuously true when the
     * project declares none, so a project without lint/type tooling is not
     * penalised.
     */
    quality: boolean;
    staleArtifacts: boolean;
  };
}

const DEFAULT_LABELS: ValidationLabels = {
  lock: 'the lockfile check',
  preparation: 'the preparation step',
  stale: 'a stale artifact',
};

const PREVIEW_REASON = 'Set execute=true to run the validation bundle.';

/**
 * Summarise a verification sequence as a single gate.
 *
 * Conformance must be proven, not merely not-failed: a test run that passed
 * against versions the lockfile does not describe is not evidence, so an
 * `unverifiable` verdict fails the gate exactly like drift does.
 *
 * A test step that was never executed is also not evidence, and when the reason
 * is known (the environment no longer provides the test runner) that reason is
 * reported instead of a generic failure.
 */
export function summarizeValidation(input: {
  lock: ValidationStep;
  preparation: ValidationStep;
  test: ValidationStep;
  /** Declared lint/type commands; omitted when the project declares none. */
  quality?: ValidationStep[];
  conformance: 'consistent' | 'drifted' | 'unverifiable';
  stale: boolean;
  /** True when nothing was executed because the caller only asked for a preview. */
  preview?: boolean;
  labels?: Partial<ValidationLabels>;
}): ValidationSummary {
  const labels = { ...DEFAULT_LABELS, ...input.labels };
  const lock = input.lock.executed && input.lock.ok;
  const preparation = input.preparation.executed && input.preparation.ok;
  const test =
    input.test.executed &&
    input.test.ok &&
    (input.test.failures ?? 0) === 0 &&
    input.test.noTestsRan !== true;
  const qualitySteps = input.quality ?? [];
  const quality = qualitySteps.every((step) => step.executed && step.ok);
  const failedQuality = qualitySteps.filter((step) => !step.executed || !step.ok);
  const conformance = input.conformance === 'consistent';
  const staleArtifacts = input.stale;

  let reason = `${labels.lock} passed, ${labels.preparation} passed, the tests passed, and the installed versions agree with the lockfile.`;
  if (input.preview) {
    reason = PREVIEW_REASON;
  } else if (!input.lock.executed || !input.preparation.executed) {
    reason = !input.lock.executed
      ? `${labels.lock} was not executed, so lockfile agreement is unproven.`
      : `${labels.preparation} was not executed, so the environment the tests ran in is unknown.`;
  } else if (!lock) {
    reason = `The lockfile is out of date; refresh it before trusting any test result.`;
  } else if (!preparation) {
    reason = `${labels.preparation} could not be completed from the locked state.`;
  } else if (!input.test.executed) {
    reason =
      input.test.skippedReason ?? 'Tests were not executed, so no test result exists to report.';
  } else if (input.test.noTestsRan) {
    reason = 'The test run completed without executing any test, so it proves nothing.';
  } else if (!test) {
    reason = 'Tests failed; inspect the first failing case and its project frame.';
  } else if (input.conformance === 'drifted') {
    reason =
      'Tests passed, but the installed versions do not match the lockfile, so the run does not describe the locked environment.';
  } else if (input.conformance === 'unverifiable') {
    reason =
      'The installed environment could not be compared with the lockfile, so the passing test run is not proven to be on the locked versions.';
  } else if (failedQuality.length > 0) {
    const names = failedQuality.map((step) => step.name ?? 'quality check').join(', ');
    reason = `Tests passed, but the declared quality check(s) failed: ${names}.`;
  } else if (staleArtifacts) {
    reason = `Tests passed, but ${labels.stale} was detected; refresh it and rerun.`;
  }
  return {
    // A preview is never a passing validation: nothing was executed, so nothing
    // is proven, regardless of how the placeholder steps were filled in.
    ok: !input.preview && lock && preparation && test && conformance && quality && !staleArtifacts,
    reason,
    checks: { lock, preparation, test, conformance, quality, staleArtifacts },
  };
}
