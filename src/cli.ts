#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';

import { analyze, project } from './analyze';
import type { AnalysisReport, ProjectionResult } from './analyze';
import { discoverLatestClaudeCodeTranscript } from './discover';
import { DEMO_TRANSCRIPT } from './demo-data';
import { DEFAULT_CONTEXT_WINDOW, MODEL_CONTEXT_WINDOWS } from './models';
import { parseClaudeCodeTranscript, parseGenericTranscript } from './parse';
import type { RotCategory, TranscriptEntry } from './types';

/**
 * The `contextrot` CLI: analyzes an agent session transcript (a Claude Code
 * `.jsonl` session file, a generic JSON array of turns, or the bundled demo
 * transcript) and reports how much of the context window is live signal
 * versus rot.
 */

const CATEGORY_LABELS: Record<RotCategory, string> = {
  'duplicate-read': 'Duplicate reads',
  'superseded-read': 'Superseded reads',
  'repeated-tool-call': 'Repeated tool calls',
  'dead-system-reminder': 'Dead system reminders',
  'unreferenced-large-output': 'Unreferenced large output',
  'stale-todo-snapshot': 'Stale todo snapshots',
};

const CATEGORY_ORDER: RotCategory[] = [
  'duplicate-read',
  'superseded-read',
  'repeated-tool-call',
  'dead-system-reminder',
  'unreferenced-large-output',
  'stale-todo-snapshot',
];

/** Roughly estimates the number of "turns" observed in a transcript, for `project()`. */
function estimateTurnsObserved(entries: TranscriptEntry[]): number {
  const turns = entries.filter(
    (entry) => entry.type === 'user_message' || entry.type === 'assistant_message'
  ).length;
  return turns > 0 ? turns : entries.length > 0 ? 1 : 0;
}

/** Formats an integer with thousands separators, e.g. 12345 -> "12,345". */
function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Formats a percentage (0-100+) to one decimal place, e.g. 42 -> "42.0%". */
function formatPercentage(n: number): string {
  return `${n.toFixed(1)}%`;
}

/**
 * Renders a human-readable report: total tokens, live vs rot split, a
 * per-category breakdown table, a top-offenders list, and a projected
 * turns-until-compaction line.
 *
 * No em dashes are used anywhere in the output; use a comma, colon, or
 * period instead.
 */
export function formatHumanReport(report: AnalysisReport, projection: ProjectionResult): string {
  const lines: string[] = [];

  lines.push('Context rot report');
  lines.push('');
  lines.push(`Total tokens: ${formatNumber(report.totalTokens)}`);
  lines.push(
    `Live: ${formatNumber(report.liveTokens)} tokens (${formatPercentage(100 - report.rotPercentage)})`
  );
  lines.push(
    `Rot:  ${formatNumber(report.rotTokens)} tokens (${formatPercentage(report.rotPercentage)})`
  );
  lines.push('');

  lines.push('Breakdown by category:');
  const categoryRows = CATEGORY_ORDER.map((category) => {
    const stats = report.byCategory[category];
    return { label: CATEGORY_LABELS[category], count: stats.count, tokens: stats.tokens };
  });
  const labelWidth = Math.max(...categoryRows.map((row) => row.label.length));
  for (const row of categoryRows) {
    const label = row.label.padEnd(labelWidth, ' ');
    lines.push(`  ${label}  count ${String(row.count).padStart(3, ' ')}  tokens ${formatNumber(row.tokens)}`);
  }
  lines.push('');

  lines.push('Top offenders:');
  if (report.topOffenders.length === 0) {
    lines.push('  None, no rot detected.');
  } else {
    report.topOffenders.forEach((offender, index) => {
      lines.push(
        `  ${index + 1}. [${CATEGORY_LABELS[offender.category]}] ${formatNumber(offender.tokens)} tokens, ${offender.summary}`
      );
    });
  }
  lines.push('');

  lines.push(
    `Projection: at this rate, roughly ${formatNumber(projection.turnsRemaining)} turns until compaction ` +
      `(context window ${formatPercentage(projection.contextWindowUsedPercentage)} used).`
  );

  return lines.join('\n');
}

/**
 * Renders the same report as Markdown: a summary section, a category
 * breakdown table, a top-offenders list, and a projection line.
 *
 * No em dashes are used anywhere in the output; use a comma, colon, or
 * period instead.
 */
export function formatMarkdownReport(report: AnalysisReport, projection: ProjectionResult): string {
  const lines: string[] = [];

  lines.push('# Context rot report');
  lines.push('');
  lines.push(`- **Total tokens:** ${formatNumber(report.totalTokens)}`);
  lines.push(
    `- **Live:** ${formatNumber(report.liveTokens)} tokens (${formatPercentage(100 - report.rotPercentage)})`
  );
  lines.push(
    `- **Rot:** ${formatNumber(report.rotTokens)} tokens (${formatPercentage(report.rotPercentage)})`
  );
  lines.push('');

  lines.push('## Breakdown by category');
  lines.push('');
  lines.push('| Category | Count | Tokens |');
  lines.push('| --- | --- | --- |');
  for (const category of CATEGORY_ORDER) {
    const stats = report.byCategory[category];
    lines.push(`| ${CATEGORY_LABELS[category]} | ${stats.count} | ${formatNumber(stats.tokens)} |`);
  }
  lines.push('');

  lines.push('## Top offenders');
  lines.push('');
  if (report.topOffenders.length === 0) {
    lines.push('None, no rot detected.');
  } else {
    report.topOffenders.forEach((offender, index) => {
      lines.push(
        `${index + 1}. **[${CATEGORY_LABELS[offender.category]}]** ${formatNumber(offender.tokens)} tokens, ${offender.summary}`
      );
    });
  }
  lines.push('');

  lines.push('## Projection');
  lines.push('');
  lines.push(
    `At this rate, roughly **${formatNumber(projection.turnsRemaining)} turns** until compaction ` +
      `(context window ${formatPercentage(projection.contextWindowUsedPercentage)} used).`
  );

  return lines.join('\n');
}

/** Renders the report as a JSON string, combining the analysis and projection. */
export function formatJsonReport(report: AnalysisReport, projection: ProjectionResult): string {
  return JSON.stringify({ ...report, projection }, null, 2);
}

/**
 * Detects whether raw file content looks like a Claude Code `.jsonl`
 * transcript (one JSON object per non-empty line) versus a generic JSON
 * array of turns, then parses it with the matching parser.
 *
 * Falls back to the generic parser if the content can't be identified as
 * JSONL (e.g. it parses as a top-level JSON array or object).
 */
export function parseTranscriptFile(raw: string, filePath: string): TranscriptEntry[] {
  if (filePath.endsWith('.jsonl')) {
    return parseClaudeCodeTranscript(raw);
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return parseGenericTranscript(raw);
  }

  // Ambiguous extension (e.g. .json, .txt, no extension): sniff the first
  // non-empty line. If it parses as a standalone JSON object, treat this as
  // JSONL; otherwise fall back to the generic array parser.
  const firstLine = trimmed.split('\n').find((line) => line.trim().length > 0);
  if (firstLine) {
    try {
      const parsed = JSON.parse(firstLine.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parseClaudeCodeTranscript(raw);
      }
    } catch {
      // Not a standalone JSON object on the first line; fall through.
    }
  }

  return parseGenericTranscript(raw);
}

/** Resolves the context window for `modelName`, warning and falling back if unknown. */
function resolveContextWindow(modelName: string, warn: (message: string) => void): number {
  const contextWindow = MODEL_CONTEXT_WINDOWS[modelName];
  if (contextWindow !== undefined) return contextWindow;

  warn(
    `Warning: unknown model "${modelName}", falling back to a default context window of ${DEFAULT_CONTEXT_WINDOW.toLocaleString('en-US')} tokens.`
  );
  return DEFAULT_CONTEXT_WINDOW;
}

interface CliOptions {
  demo?: boolean;
  file?: string;
  model: string;
  json?: boolean;
  markdown?: boolean;
  threshold?: string;
}

/**
 * Runs the CLI's core logic against parsed options, using the given I/O
 * hooks. Factored out from `main()` so the option-parsing/process wiring
 * stays thin and this remains testable without shelling out.
 */
export function runCli(
  options: CliOptions,
  io: {
    print: (message: string) => void;
    printError: (message: string) => void;
    exit: (code: number) => void;
    readFile: (filePath: string) => string;
    discover: () => string | null;
  }
): void {
  let entries: TranscriptEntry[];

  if (options.file) {
    let raw: string;
    try {
      raw = io.readFile(options.file);
    } catch {
      io.printError(`Error: could not read file "${options.file}".`);
      io.exit(1);
      return;
    }
    entries = parseTranscriptFile(raw, options.file);
  } else if (options.demo) {
    entries = DEMO_TRANSCRIPT;
  } else {
    const discovered = io.discover();
    if (!discovered) {
      io.printError(
        'No transcript file found. Pass --demo to try contextrot with sample data, ' +
          'or --file <path> to analyze a specific Claude Code JSONL or JSON transcript.'
      );
      io.exit(1);
      return;
    }
    let raw: string;
    try {
      raw = io.readFile(discovered);
    } catch {
      io.printError(`Error: could not read discovered transcript "${discovered}".`);
      io.exit(1);
      return;
    }
    entries = parseTranscriptFile(raw, discovered);
  }

  const contextWindow = resolveContextWindow(options.model, io.printError);
  const report = analyze(entries);
  const turnsObserved = estimateTurnsObserved(entries);
  const projection = project(report, contextWindow, turnsObserved);

  if (options.json) {
    io.print(formatJsonReport(report, projection));
  } else if (options.markdown) {
    io.print(formatMarkdownReport(report, projection));
  } else {
    io.print(formatHumanReport(report, projection));
  }

  if (options.threshold !== undefined) {
    const thresholdValue = Number(options.threshold);
    if (!Number.isNaN(thresholdValue) && report.rotPercentage > thresholdValue) {
      io.exit(1);
      return;
    }
  }
}

/** Builds the commander program. Exported for testing option parsing in isolation. */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('contextrot')
    .description(
      'Analyzes an AI agent session transcript and reports how much of the context window is live signal versus rot.'
    )
    .version('0.1.0', '-V, --version', 'output the current version')
    .helpOption('-h, --help', 'display help for command')
    .option('--demo', 'use the bundled demo transcript')
    .option('--file <path>', 'path to a Claude Code JSONL transcript or a generic JSON array transcript')
    .option('--model <name>', 'model name, used to look up the context window size', 'claude-sonnet-5')
    .option('--json', 'output the report as JSON')
    .option('--markdown', 'output the report as Markdown')
    .option('--threshold <n>', 'exit with status 1 if rot percentage exceeds n')
    .action((options: CliOptions) => {
      runCli(options, {
        print: (message) => console.log(message),
        printError: (message) => console.error(message),
        exit: (code) => process.exit(code),
        readFile: (filePath) => fs.readFileSync(filePath, 'utf-8'),
        discover: () => discoverLatestClaudeCodeTranscript(),
      });
    });

  return program;
}

/**
 * Parses `process.argv` and runs the CLI. Exported so `bin/contextrot.js`
 * can invoke it explicitly.
 *
 * Deliberately not gated on `require.main === module`: `bin/contextrot.js`
 * loads this module via `require('../dist/cli.js')`, so `require.main` is
 * always the bin shim, never this module itself. That guard would silently
 * no-op the whole CLI under the normal packaged entry point. Tests instead
 * import the individual formatting/parsing helpers and `runCli`, not this
 * function, so importing this module never triggers argv parsing as a
 * side effect.
 */
export function main(): void {
  const program = buildProgram();
  program.parse(process.argv);
}
