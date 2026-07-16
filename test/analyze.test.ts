import { describe, expect, it } from 'vitest';
import { analyze, project } from '../src/analyze';
import { countTokens } from '../src/tokenizer';
import type {
  AssistantMessageEntry,
  SystemReminderEntry,
  ToolResultEntry,
  ToolUseEntry,
  TranscriptEntry,
} from '../src/types';

function toolUse(overrides: Partial<ToolUseEntry> & Pick<ToolUseEntry, 'toolName' | 'toolUseId'>): ToolUseEntry {
  return {
    type: 'tool_use',
    role: 'assistant',
    ...overrides,
  };
}

function toolResult(overrides: Partial<ToolResultEntry> & Pick<ToolResultEntry, 'toolUseId' | 'content'>): ToolResultEntry {
  return {
    type: 'tool_result',
    role: 'tool',
    toolName: '',
    ...overrides,
  };
}

function assistantMessage(content: string): AssistantMessageEntry {
  return { type: 'assistant_message', role: 'assistant', content };
}

function systemReminder(content: string): SystemReminderEntry {
  return { type: 'system_reminder', role: 'system', content };
}

describe('analyze', () => {
  it('returns all-live totals for a transcript with no rot', () => {
    const entries: TranscriptEntry[] = [
      { type: 'user_message', role: 'user', content: 'Please read src/a.ts and summarize it.' },
      toolUse({ toolName: 'Read', toolUseId: 'tu1', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu1', content: 'short file contents' }),
      assistantMessage('Here is a summary of src/a.ts.'),
    ];

    const report = analyze(entries);

    const expectedTotal = entries.reduce((sum, e) => sum + countTokens(e.content ?? ''), 0);
    expect(report.totalTokens).toBe(expectedTotal);
    expect(report.rotTokens).toBe(0);
    expect(report.liveTokens).toBe(report.totalTokens);
    expect(report.rotPercentage).toBe(0);
    expect(report.topOffenders).toEqual([]);
    expect(report.entries).toHaveLength(entries.length);

    for (const stats of Object.values(report.byCategory)) {
      expect(stats.count).toBe(0);
      expect(stats.tokens).toBe(0);
    }
  });

  it('aggregates rot tokens by category and computes rotPercentage', () => {
    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Read', toolUseId: 'tu1', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu1', content: 'file a contents' }),
      toolUse({ toolName: 'Read', toolUseId: 'tu2', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu2', content: 'file a contents again' }),
    ];

    const report = analyze(entries);

    // The second Read (index 2) is duplicate-read; nothing else is rot.
    expect(report.byCategory['duplicate-read'].count).toBe(1);
    expect(report.byCategory['duplicate-read'].tokens).toBe(countTokens(''));
    expect(report.rotTokens).toBe(report.byCategory['duplicate-read'].tokens);
    expect(report.liveTokens).toBe(report.totalTokens - report.rotTokens);
    expect(report.rotPercentage).toBeCloseTo((report.rotTokens / report.totalTokens) * 100);
  });

  it('returns rotPercentage 0 when totalTokens is 0', () => {
    const report = analyze([]);
    expect(report.totalTokens).toBe(0);
    expect(report.rotTokens).toBe(0);
    expect(report.liveTokens).toBe(0);
    expect(report.rotPercentage).toBe(0);
    expect(report.entries).toEqual([]);
    expect(report.topOffenders).toEqual([]);
  });

  it('ranks topOffenders by token count, largest first, among rot-classified entries only', () => {
    const bigOutput = 'unique unreferenced boilerplate line '.repeat(400);
    const smallBigOutput = 'other unique unreferenced boilerplate '.repeat(150);

    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Bash', toolUseId: 'tu1' }),
      toolResult({ toolUseId: 'tu1', content: bigOutput }),
      toolUse({ toolName: 'Bash', toolUseId: 'tu2' }),
      toolResult({ toolUseId: 'tu2', content: smallBigOutput }),
      assistantMessage('Done with unrelated work, moving on.'),
    ];

    const report = analyze(entries);

    const rotEntries = report.entries.filter((e) => e.rot !== null);
    expect(rotEntries.length).toBeGreaterThanOrEqual(2);

    expect(report.topOffenders.length).toBeLessThanOrEqual(10);
    expect(report.topOffenders.length).toBeGreaterThanOrEqual(2);

    // Sorted descending by tokens.
    for (let i = 1; i < report.topOffenders.length; i++) {
      expect(report.topOffenders[i - 1].tokens).toBeGreaterThanOrEqual(report.topOffenders[i].tokens);
    }

    // Only rot categories show up, and the biggest entry leads.
    expect(report.topOffenders[0].category).toBe('unreferenced-large-output');
    expect(report.topOffenders[0].tokens).toBeGreaterThan(report.topOffenders[1].tokens);
  });

  it('caps topOffenders at 10 even when more than 10 entries are classified as rot', () => {
    const entries: TranscriptEntry[] = [];
    // 12 pairs of duplicate reads on 12 distinct files -> 12 duplicate-read entries.
    for (let i = 0; i < 12; i++) {
      const path = `src/file${i}.ts`;
      entries.push(toolUse({ toolName: 'Read', toolUseId: `r${i}a`, filePath: path }));
      entries.push(toolResult({ toolUseId: `r${i}a`, content: `contents ${i}` }));
      entries.push(toolUse({ toolName: 'Read', toolUseId: `r${i}b`, filePath: path }));
      entries.push(toolResult({ toolUseId: `r${i}b`, content: `contents ${i} again` }));
    }

    const report = analyze(entries);

    expect(report.byCategory['duplicate-read'].count).toBe(12);
    expect(report.topOffenders).toHaveLength(10);
  });

  it('includes a human-readable summary for each top offender', () => {
    const entries: TranscriptEntry[] = [
      systemReminder('Environment info (session snapshot): cwd is /repo'),
      assistantMessage('Got it.'),
      systemReminder('Environment info (session snapshot): cwd is /repo/sub'),
    ];

    const report = analyze(entries);

    expect(report.topOffenders).toHaveLength(1);
    expect(report.topOffenders[0].category).toBe('dead-system-reminder');
    expect(typeof report.topOffenders[0].summary).toBe('string');
    expect(report.topOffenders[0].summary.length).toBeGreaterThan(0);
  });
});

describe('project', () => {
  it('computes avgTokensPerTurn and turnsRemaining from totalTokens and turnsObserved', () => {
    const report = analyze([assistantMessage('hello '.repeat(20))]);
    const turnsObserved = 2;
    const modelContextWindow = 200000;

    const result = project(report, modelContextWindow, turnsObserved);

    const expectedAvg = report.totalTokens / turnsObserved;
    expect(result.avgTokensPerTurn).toBeCloseTo(expectedAvg);
    expect(result.turnsRemaining).toBe(
      Math.max(0, Math.floor((modelContextWindow - report.totalTokens) / expectedAvg))
    );
    expect(result.contextWindowUsedPercentage).toBeCloseTo((report.totalTokens / modelContextWindow) * 100);
  });

  it('clamps turnsRemaining to 0 when totalTokens already exceeds the context window', () => {
    const report = analyze([assistantMessage('word '.repeat(5000))]);
    const result = project(report, 1000, 1);

    expect(result.turnsRemaining).toBe(0);
    expect(result.turnsRemaining).toBeGreaterThanOrEqual(0);
    expect(result.contextWindowUsedPercentage).toBeGreaterThan(100);
  });

  it('falls back to 0 avgTokensPerTurn and 0 turnsRemaining when turnsObserved is 0', () => {
    const report = analyze([assistantMessage('some content here')]);
    const result = project(report, 200000, 0);

    expect(result.avgTokensPerTurn).toBe(0);
    expect(result.turnsRemaining).toBe(0);
  });

  it('returns an integer turnsRemaining', () => {
    const report = analyze([assistantMessage('a bit of content '.repeat(7))]);
    const result = project(report, 50000, 3);

    expect(Number.isInteger(result.turnsRemaining)).toBe(true);
  });
});
