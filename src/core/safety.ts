import type { CommandRisk } from './result.ts';

/**
 * Risk is inferred from the command text, never from a domain name, because no
 * toolchain has a deterministic signal like `cmd_vel`. A compound command
 * inherits the highest risk of its segments so nothing hides behind a safe
 * sibling.
 */

const RISK_ORDER: Record<CommandRisk, number> = { read: 0, mutating: 1, irreversible: 2 };

export interface RiskRule {
  pattern: RegExp;
  risk: Exclude<CommandRisk, 'read'>;
  reason: string;
}

export interface SafetyRules {
  /**
   * Matched before risk patterns so a read-only flag does not inherit the risk
   * of the command it qualifies (`--check`, `--dry-run`, `--collect-only`).
   */
  safeOverrides: RegExp[];
  patterns: RiskRule[];
}

/**
 * Read-only forms that would otherwise inherit their command's risk.
 * Ecosystem-neutral: these are generic flags, not tool names.
 */
export const UNIVERSAL_SAFE_OVERRIDES: RegExp[] = [
  /\bgit\s+(?:diff|log|status|show|rev-parse|ls-files|cat-file|describe|rev-list)\b/,
  /\bgit\s+branch\s+--show-current\b/,
  /(?:^|\s)--(?:check|dry-run|collect-only|list|frozen|locked)\b/,
];

/**
 * Risks that do not depend on the ecosystem: repository history, the file
 * system, containers, and databases behave the same everywhere. Anything that
 * names a package manager belongs to the adapter.
 */
export const UNIVERSAL_RISK_PATTERNS: RiskRule[] = [
  // Irreversible: cannot be undone by a local revert.
  {
    risk: 'irreversible',
    pattern: /\bgit\s+push\b[^&|;]*(?:--force(?:-with-lease)?|(?<![\w-])-f(?![a-z]))/,
    reason: 'Force pushing rewrites shared remote history.',
  },
  {
    risk: 'irreversible',
    pattern: /\bgit\s+(?:reset\s+--hard|clean\b[^&|;]*-[a-z]*f)/,
    reason: 'Hard reset or clean discards uncommitted work permanently.',
  },
  {
    risk: 'irreversible',
    pattern: /\brm\b[^&|;]*-[a-z]*[rf][a-z]*/,
    reason: 'Recursive or forced deletion is not recoverable.',
  },
  {
    risk: 'irreversible',
    pattern:
      /\b(?:drop|truncate)\s+(?:table|database|schema)\b|\bdelete\s+from\b(?![^&|;]*\bwhere\b)/i,
    reason: 'Destructive SQL without a narrowing predicate.',
  },
  {
    risk: 'irreversible',
    pattern: /\bdocker\s+(?:system|volume|image)\s+(?:prune|rm)\b/,
    reason: 'Docker prune removes volumes or images outside the project.',
  },

  // Mutating: recoverable, but changes project, repository, or remote state.
  {
    risk: 'mutating',
    pattern: /\bgit\s+(?:commit|add|checkout|switch|restore|stash|merge|rebase|push|tag|init)\b/,
    reason: 'Changes repository or remote state.',
  },
  {
    risk: 'mutating',
    pattern: /\b(?:rm|mv|chmod|chown|truncate)\b/,
    reason: 'Changes files on disk.',
  },
];

/**
 * `curl ... | sh` is invisible after segment splitting because the pipe itself
 * is the hazard, so it is matched against the whole command first.
 */
const PIPE_TO_SHELL = /\b(?:curl|wget)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/;

export interface CommandClassification {
  risk: CommandRisk;
  reasons: { segment: string; risk: CommandRisk; reason: string }[];
}

/** Split a compound command so no segment can hide behind a safe sibling. */
export function splitCommandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\n|\|/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function mergeRules(rules?: Partial<SafetyRules>): SafetyRules {
  return {
    safeOverrides: [...UNIVERSAL_SAFE_OVERRIDES, ...(rules?.safeOverrides ?? [])],
    patterns: [...UNIVERSAL_RISK_PATTERNS, ...(rules?.patterns ?? [])],
  };
}

function classifySegment(
  segment: string,
  rules: SafetyRules,
): { risk: CommandRisk; reason?: string } {
  if (rules.safeOverrides.some((pattern) => pattern.test(segment))) return { risk: 'read' };
  for (const entry of rules.patterns) {
    if (entry.pattern.test(segment)) return { risk: entry.risk, reason: entry.reason };
  }
  return { risk: 'read' };
}

/**
 * Classify a shell command by the highest risk of its segments. Used to warn
 * before running something that cannot be undone, and to gate a helper's own
 * state-changing commands behind explicit opt-in.
 *
 * The adapter supplies only the ecosystem-specific rules; the universal ones
 * are always applied, so a new helper cannot forget `git push --force`.
 */
export function classifyCommand(
  command: string,
  rules?: Partial<SafetyRules>,
): CommandClassification {
  const merged = mergeRules(rules);
  const piped = command.match(PIPE_TO_SHELL);
  if (piped) {
    return {
      risk: 'irreversible',
      reasons: [
        {
          segment: piped[0].trim(),
          risk: 'irreversible',
          reason: 'Piping a download into a shell runs unreviewed code.',
        },
      ],
    };
  }

  const reasons: CommandClassification['reasons'] = [];
  let risk: CommandRisk = 'read';
  for (const segment of splitCommandSegments(command)) {
    const classified = classifySegment(segment, merged);
    if (RISK_ORDER[classified.risk] > RISK_ORDER[risk]) risk = classified.risk;
    if (classified.risk !== 'read' && classified.reason) {
      reasons.push({ segment, risk: classified.risk, reason: classified.reason });
    }
  }
  return { risk, reasons };
}

export function isMutatingCommand(command: string, rules?: Partial<SafetyRules>): boolean {
  return classifyCommand(command, rules).risk !== 'read';
}

/** Commands a helper runs itself always carry a known risk class. */
export function riskOf(args: string[], rules?: Partial<SafetyRules>): CommandRisk {
  return classifyCommand(args.join(' '), rules).risk;
}
