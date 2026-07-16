import { classify } from './classify';
import type { ClassifiedEntry } from './classify';
import type { RotCategory, TranscriptEntry } from './types';

/**
 * Aggregated rot-analysis summary for a classified transcript.
 */
export interface AnalysisReport {
  /** Total tokens across every entry in the transcript. */
  totalTokens: number;
  /** Tokens belonging to entries with no rot classification (live signal). */
  liveTokens: number;
  /** Tokens belonging to entries classified as some form of rot. */
  rotTokens: number;
  /** rotTokens / totalTokens, as a percentage (0-100). 0 when totalTokens is 0. */
  rotPercentage: number;
  /** Per-category count and token totals, for every `RotCategory`. */
  byCategory: Record<RotCategory, { count: number; tokens: number }>;
  /** Top 10 rot-classified entries by token count, largest first. */
  topOffenders: Array<{ summary: string; tokens: number; category: RotCategory }>;
  /** The full classified transcript, in original order. */
  entries: ClassifiedEntry[];
}

/** Estimated turns-until-compaction, derived from an `AnalysisReport`. */
export interface ProjectionResult {
  /** Estimated number of additional turns before the context window fills, clamped to >= 0. */
  turnsRemaining: number;
  /** Average tokens added per turn, derived from totalTokens / turnsObserved. */
  avgTokensPerTurn: number;
  /** Percentage (0-100+) of the model's context window already used. */
  contextWindowUsedPercentage: number;
}

const ALL_ROT_CATEGORIES: RotCategory[] = [
  'duplicate-read',
  'superseded-read',
  'repeated-tool-call',
  'dead-system-reminder',
  'unreferenced-large-output',
  'stale-todo-snapshot',
];

const TOP_OFFENDERS_LIMIT = 10;
const SUMMARY_MAX_LENGTH = 80;

/** Best-effort one-line summary of a classified entry, for display in `topOffenders`. */
function summarize(entry: ClassifiedEntry): string {
  const raw =
    entry.type === 'tool_use'
      ? `${entry.toolName}${entry.filePath ? ` ${entry.filePath}` : ''}`
      : entry.type === 'tool_result'
        ? `${entry.toolName} result${entry.filePath ? ` (${entry.filePath})` : ''}`
        : (entry.content ?? entry.type);

  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return collapsed.length > SUMMARY_MAX_LENGTH ? `${collapsed.slice(0, SUMMARY_MAX_LENGTH)}…` : collapsed;
}

function emptyByCategory(): Record<RotCategory, { count: number; tokens: number }> {
  const result = {} as Record<RotCategory, { count: number; tokens: number }>;
  for (const category of ALL_ROT_CATEGORIES) {
    result[category] = { count: 0, tokens: 0 };
  }
  return result;
}

/**
 * Runs `classify` over `entries`, then aggregates token totals overall and
 * per rot category, plus the top rot-classified offenders by token count.
 */
export function analyze(entries: TranscriptEntry[]): AnalysisReport {
  const classified = classify(entries);

  let totalTokens = 0;
  let rotTokens = 0;
  const byCategory = emptyByCategory();

  for (const entry of classified) {
    totalTokens += entry.tokens;
    if (entry.rot) {
      rotTokens += entry.tokens;
      byCategory[entry.rot].count += 1;
      byCategory[entry.rot].tokens += entry.tokens;
    }
  }

  const liveTokens = totalTokens - rotTokens;
  const rotPercentage = totalTokens > 0 ? (rotTokens / totalTokens) * 100 : 0;

  const topOffenders = classified
    .filter((entry): entry is ClassifiedEntry & { rot: RotCategory } => entry.rot !== null)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, TOP_OFFENDERS_LIMIT)
    .map((entry) => ({
      summary: summarize(entry),
      tokens: entry.tokens,
      category: entry.rot,
    }));

  return {
    totalTokens,
    liveTokens,
    rotTokens,
    rotPercentage,
    byCategory,
    topOffenders,
    entries: classified,
  };
}

/**
 * Projects turns-until-compaction from an `AnalysisReport`.
 *
 * Estimates the average tokens added per turn as `totalTokens / turnsObserved`,
 * then estimates how many further turns fit before `modelContextWindow` is
 * exhausted. `turnsRemaining` is clamped to be non-negative; when
 * `turnsObserved` is 0 (no observed turns to estimate a rate from),
 * `avgTokensPerTurn` is 0 and `turnsRemaining` falls back to 0.
 */
export function project(
  report: AnalysisReport,
  modelContextWindow: number,
  turnsObserved: number
): ProjectionResult {
  const avgTokensPerTurn = turnsObserved > 0 ? report.totalTokens / turnsObserved : 0;

  const turnsRemaining =
    avgTokensPerTurn > 0
      ? Math.max(0, Math.floor((modelContextWindow - report.totalTokens) / avgTokensPerTurn))
      : 0;

  const contextWindowUsedPercentage =
    modelContextWindow > 0 ? (report.totalTokens / modelContextWindow) * 100 : 0;

  return {
    turnsRemaining,
    avgTokensPerTurn,
    contextWindowUsedPercentage,
  };
}
