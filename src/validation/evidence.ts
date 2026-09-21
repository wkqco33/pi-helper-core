export interface PreparationStage {
  /** Stable identifier, for example `environment` or `build`. */
  name: string;
  /**
   * Human label used in blocker messages. The adapter supplies the concrete
   * wording (`uv sync`, `cargo build`) so the core stays ecosystem-neutral.
   */
  label: string;
  executed: boolean;
  ok: boolean;
}

export interface CompletionEvidenceInput {
  preparation: PreparationStage;
  testExecuted: boolean;
  testOk: boolean;
  stale: boolean;
  changedPaths: string[];
}

export interface CompletionEvidence {
  ok: boolean;
  blockers: string[];
  changedPaths: string[];
}

/**
 * Completion is only proven when the preparation stage ran and the tests
 * actually ran. Declaring completion on a partial run is a blocker, never a
 * warning, because a partial run is exactly how a false "done" is reported.
 */
export function buildCompletionEvidence(input: CompletionEvidenceInput): CompletionEvidence {
  const blockers: string[] = [];
  const { preparation } = input;
  if (!preparation.executed) {
    blockers.push(`The ${preparation.label} was not executed.`);
  } else if (!preparation.ok) {
    blockers.push(`The ${preparation.label} did not pass.`);
  }
  if (!input.testExecuted) blockers.push('Tests were not executed.');
  else if (!input.testOk) blockers.push('Tests did not pass.');
  if (input.stale) {
    blockers.push(
      'Stale artifacts were detected, so the test result does not describe the current sources.',
    );
  }
  return { ok: blockers.length === 0, blockers, changedPaths: input.changedPaths };
}
