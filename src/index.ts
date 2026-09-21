/**
 * Ecosystem-neutral core for pi language helper extensions.
 *
 * A helper keeps the ecosystem knowledge (command names, manifest formats,
 * output parsers) and imports everything shared from here: the response
 * envelope, the bounded command runner, risk classification, the completion
 * gates, artifact staleness, and test selection.
 *
 * Nothing in this package may name an ecosystem. `test/purity.test.ts` enforces
 * that, because the whole point of extracting the core is that a new helper
 * only has to write its adapter.
 */

export {
  CORE_SCHEMA_VERSION,
  createResultFactory,
  isActionable,
  note,
  warn,
  type CommandPreview,
  type CommandRisk,
  type Diagnostic,
  type Evidence,
  type ResultFactory,
  type ResultInput,
  type Severity,
  type Suggestion,
  type ToolchainInfo,
  type ToolMetadata,
  type ToolResult,
} from './core/result.ts';

export { isSpawnFailure, runCommand, type RunOptions, type RunResult } from './core/runner.ts';

export {
  classifyCommand,
  isMutatingCommand,
  riskOf,
  splitCommandSegments,
  UNIVERSAL_RISK_PATTERNS,
  UNIVERSAL_SAFE_OVERRIDES,
  type CommandClassification,
  type RiskRule,
  type SafetyRules,
} from './core/safety.ts';

export {
  buildCompletionEvidence,
  type CompletionEvidence,
  type CompletionEvidenceInput,
  type PreparationStage,
} from './validation/evidence.ts';

export {
  checkTdd,
  type TddAssociation,
  type TddCheckpoint,
  type TddSignals,
} from './validation/tdd.ts';

export {
  summarizeValidation,
  type ValidationLabels,
  type ValidationStep,
  type ValidationSummary,
} from './validation/bundle.ts';

export {
  detectStaleArtifacts,
  UNIVERSAL_IGNORED_DIRECTORIES,
  type StaleArtifact,
  type StaleArtifactSpec,
  type StalenessReport,
  type StalenessSpec,
} from './build/staleness.ts';

export {
  DEFAULT_SCORE,
  normalizedStem,
  selectTests,
  type SelectionOptions,
  type SelectionResult,
  type SelectionSignals,
  type TestImportMap,
  type TestSelection,
} from './selection/select.ts';

export {
  defineAdapter,
  type AdapterContext,
  type CheckCommandInput,
  type DerivedArtifact,
  type EcosystemAdapter,
  type FailureDiagnosis,
  type FailureFrame,
  type ProjectModel,
  type ProjectPackage,
  type TestCommandInput,
  type TestCounts,
  type TestFailure,
  type TestReport,
} from './adapter.ts';
