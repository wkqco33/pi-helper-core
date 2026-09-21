/**
 * The single response contract every helper tool returns, so an agent can rely
 * on one shape regardless of which ecosystem the helper targets.
 *
 * Nothing here may mention a specific ecosystem: the fields are the union of
 * what a Python, ROS, Rust, Go, or Flutter helper needs, and anything else an
 * ecosystem requires goes into `metadata.detail` rather than into a new field.
 */

/**
 * Bumped when the envelope's shape changes. A consumer that pins a helper and
 * this library independently can compare it and refuse a document it does not
 * understand, the same way a scanner protocol version works.
 */
export const CORE_SCHEMA_VERSION = 1;

export type Severity = 'info' | 'warning' | 'error';

/**
 * How dangerous running a command is. `read` is safe to run automatically;
 * `mutating` and `irreversible` require explicit opt-in from the caller.
 */
export type CommandRisk = 'read' | 'mutating' | 'irreversible';

export interface Diagnostic {
  code?: string;
  message: string;
  severity: Severity;
  path?: string;
  line?: number;
}

export interface Evidence {
  kind: string;
  message?: string;
  [key: string]: unknown;
}

export interface Suggestion {
  message: string;
  confidence?: 'low' | 'medium' | 'high';
  command?: string;
}

export interface CommandPreview {
  executable: string;
  args: string[];
  cwd?: string;
  /** Risk classification for the command; `read` commands never change state. */
  risk?: CommandRisk;
}

/**
 * Ecosystem-neutral description of the toolchain a helper actually inspected.
 *
 * This replaces per-ecosystem metadata fields (`pythonVersion`, `rosDistro`):
 * a consumer reads `toolchain.kind` and `toolchain.version` without knowing
 * which helper produced the response.
 */
export interface ToolchainInfo {
  /** Ecosystem identifier, for example `rust`, `python`, or `ros`. */
  kind: string;
  /** Version of the toolchain that would run commands. */
  version?: string;
  /**
   * How the toolchain was located, so a caller can tell a project-local
   * environment from whatever happened to be on `PATH`.
   */
  source?: 'project' | 'path' | 'override' | 'unknown';
  /** Target triple, platform string, or distribution name. */
  host?: string;
  /** Ecosystem-specific extras that do not deserve a shared field. */
  detail?: Record<string, string>;
}

export interface ToolMetadata {
  toolVersion: string;
  cwd: string;
  durationMs: number;
  truncated: boolean;
  projectRoot?: string;
  toolchain?: ToolchainInfo;
  /** Escape hatch for ecosystem-specific metadata that is not shared. */
  detail?: Record<string, unknown>;
}

export interface ToolResult<T = unknown> {
  /**
   * The tool's own verdict, not "the tool ran". `true` means the question this
   * tool asks was answered affirmatively: the project state is acceptable, the
   * command succeeded, or the gate may proceed. A diagnostic tool that finds a
   * problem therefore returns `ok: false` without the tool itself having
   * failed. Read `attention` for "must the caller act".
   */
  ok: boolean;
  /**
   * `true` when the caller must act before proceeding: the tool failed, or it
   * emitted a warning or an error. An `info` diagnostic is informational by
   * definition and does not set this. Derived from `ok`, `warnings`, and
   * `errors` unless a tool sets it explicitly, so `ok: false` always implies
   * `attention: true` and no diagnostic is silently dropped. This is the field
   * to read when the question is "do I need to do something".
   */
  attention: boolean;
  summary: string;
  data?: T;
  evidence: Evidence[];
  warnings: Diagnostic[];
  errors: Diagnostic[];
  suggestions: Suggestion[];
  commands?: CommandPreview[];
  metadata: ToolMetadata;
}

/**
 * Values a tool supplies. `attention` is normally derived, and `metadata` is
 * assembled by the factory, so neither is expected from the caller.
 */
export type ResultInput<T = unknown> = Omit<ToolResult<T>, 'metadata' | 'attention'> & {
  attention?: boolean;
  truncated?: boolean;
  projectRoot?: string;
  toolchain?: ToolchainInfo;
  detail?: Record<string, unknown>;
};

/**
 * An `info` diagnostic records a fact; only a warning or an error asks the
 * caller to do something. Keeping them apart stops a purely informational note
 * from raising `attention`.
 */
export function isActionable(value: { warnings: Diagnostic[]; errors: Diagnostic[] }): boolean {
  return [...value.warnings, ...value.errors].some((entry) => entry.severity !== 'info');
}

export interface ResultFactory {
  result: <T>(cwd: string, startedAt: number, value: ResultInput<T>) => ToolResult<T>;
  failure: (
    cwd: string,
    startedAt: number,
    message: string,
    code: string,
    details?: Partial<ResultInput>,
  ) => ToolResult;
  toolVersion: string;
}

/**
 * Bind the envelope to one package's version.
 *
 * A helper keeps a two-line local shim so its own modules keep importing
 * `result`/`failure` unchanged:
 *
 * ```ts
 * export const { result, failure } = createResultFactory(TOOL_VERSION);
 * export type { ToolResult, Diagnostic, CommandPreview } from 'pi-helper-core';
 * ```
 */
export function createResultFactory(toolVersion: string): ResultFactory {
  const result = <T>(cwd: string, startedAt: number, value: ResultInput<T>): ToolResult<T> => {
    const { attention, truncated, projectRoot, toolchain, detail, ...rest } = value;
    return {
      ...rest,
      attention: attention ?? (!rest.ok || isActionable(rest)),
      metadata: {
        toolVersion,
        cwd,
        durationMs: Date.now() - startedAt,
        truncated: truncated ?? false,
        projectRoot,
        toolchain,
        detail,
      },
    } as ToolResult<T>;
  };

  const failure = (
    cwd: string,
    startedAt: number,
    message: string,
    code: string,
    details?: Partial<ResultInput>,
  ): ToolResult =>
    result(cwd, startedAt, {
      ok: false,
      summary: message,
      evidence: [],
      warnings: [],
      errors: [{ code, message, severity: 'error' }],
      suggestions: [],
      ...details,
    });

  return { result, failure, toolVersion };
}

/** Shared helper so diagnostics never lose their code when built inline. */
export function warn(code: string, message: string, path?: string, line?: number): Diagnostic {
  return { code, message, severity: 'warning', path, line };
}

/** Shared helper for informational notes, which never raise `attention`. */
export function note(code: string, message: string, path?: string, line?: number): Diagnostic {
  return { code, message, severity: 'info', path, line };
}
