import type { CommandPreview, Diagnostic, Suggestion, ToolchainInfo } from './core/result.ts';
import type { RiskRule } from './core/safety.ts';
import type { StaleArtifactSpec } from './build/staleness.ts';
import type { SelectionSignals } from './selection/select.ts';

/**
 * The seam between the shared core and one ecosystem.
 *
 * Only the methods a helper's implemented tools actually need must exist; the
 * rest can land later. The interface is deliberately narrower than "everything
 * a helper might want" so that a single pilot cannot freeze a wrong abstraction
 * for the other ecosystems.
 */

export interface AdapterContext {
  cwd: string;
  projectRoot?: string;
  signal?: AbortSignal;
}

export interface FailureFrame {
  path: string;
  line: number;
  column?: number;
  /** True for installed dependencies and toolchain internals. */
  library: boolean;
}

export interface FailureDiagnosis {
  /** Ecosystem-defined kind; `unknown` must mean "not classified". */
  kind: string;
  summary: string;
  /** Error code or exception type, for example `E0599`. */
  exceptionType?: string;
  missingModule?: string;
  missingExecutable?: string;
  frames: FailureFrame[];
  /** The frame the user should look at, which is never a library frame. */
  firstUserFrame?: FailureFrame;
  evidence: { message: string; file?: string; line?: number }[];
  suggestions: Suggestion[];
}

export interface TestCounts {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  xfailed?: number;
  xpassed?: number;
  warnings?: number;
}

export interface TestFailure {
  test: string;
  message: string;
  file?: string;
  line?: number;
}

export interface TestReport {
  executed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  counts: TestCounts;
  /**
   * The units that actually ran. In a workspace, "tests passed" is only
   * meaningful next to the list of members that were compiled and tested,
   * because a root-level run often covers a subset.
   */
  ranTargets: string[];
  /** True when documentation tests were part of the run. */
  includedDocTests?: boolean;
  /** True when the runner completed without executing a single test. */
  noTestsRan: boolean;
  /** True when no trustworthy summary could be parsed. */
  incomplete: boolean;
  summaryLine?: string;
  failures: TestFailure[];
}

export interface ProjectPackage {
  name: string;
  version?: string;
  manifest: string;
  /** True when the package is a member of the workspace. */
  member: boolean;
  /** True when a bare workspace-level run covers this package. */
  defaultMember?: boolean;
  /** Declared minimum toolchain version, when the manifest carries one. */
  minimumToolchain?: string;
  detail?: Record<string, string>;
}

export interface ProjectModel {
  root: string;
  toolchain: ToolchainInfo;
  packages: ProjectPackage[];
  warnings: Diagnostic[];
}

/** A derived file that must be newer than the sources it describes. */
export type DerivedArtifact = StaleArtifactSpec;

export interface TestCommandInput {
  /** Workspace members to restrict the run to. */
  targets?: string[];
  /** Individual files to run, when the runner accepts them directly. */
  files?: string[];
  /** Run tests for every target the manifest declares. */
  allTargets?: boolean;
  /** Include documentation tests, when the ecosystem has them. */
  docTests?: boolean;
  extraArgs?: string[];
}

export interface CheckCommandInput {
  targets?: string[];
  allTargets?: boolean;
  /** Compile only, without producing final artifacts. */
  extraArgs?: string[];
}

export interface EcosystemAdapter {
  /** Ecosystem identifier, for example `rust`. */
  readonly id: string;
  /** Ecosystem-specific additions to the universal risk rules. */
  readonly riskRules: RiskRule[];
  /** File-classification and ranking signals for test selection. */
  readonly selectionSignals: SelectionSignals;
  /** Tdd checkpoint signals; defaults to the selection signals when omitted. */
  readonly tddSignals?: import('./validation/tdd.ts').TddSignals;

  resolveToolchain(ctx: AdapterContext): Promise<ToolchainInfo>;
  readProjectModel(ctx: AdapterContext): Promise<ProjectModel>;

  testCommand(input: TestCommandInput, ctx: AdapterContext): CommandPreview;
  checkCommand(input: CheckCommandInput, ctx: AdapterContext): CommandPreview;
  parseTestOutput(stdout: string, stderr: string): TestReport;
  diagnoseFailure(output: string, model?: ProjectModel): FailureDiagnosis;

  /** Derived artifacts worth a staleness comparison; may be empty. */
  derivedArtifacts(model: ProjectModel): DerivedArtifact[];
  /** Directories the runner collects tests from. */
  testDirectories(model: ProjectModel): string[];
}

/** Identity helper that preserves literal types when defining an adapter. */
export function defineAdapter<T extends EcosystemAdapter>(adapter: T): T {
  return adapter;
}
