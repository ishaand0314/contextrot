import { describe, expect, it } from 'vitest';
import { classify } from '../src/classify';
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

describe('classify', () => {
  it('flags duplicate-read: a second read of the same path with no intervening edit', () => {
    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Read', toolUseId: 'tu1', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu1', content: 'file a contents' }),
      toolUse({ toolName: 'Read', toolUseId: 'tu2', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu2', content: 'file a contents again' }),
    ];

    const result = classify(entries);

    expect(result[0].rot).toBeNull();
    expect(result[2].rot).toBe('duplicate-read');
  });

  it('does not flag duplicate-read when an edit happens between two reads of the same path', () => {
    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Read', toolUseId: 'tu1', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu1', content: 'file a contents' }),
      toolUse({ toolName: 'Edit', toolUseId: 'tu2', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu2', content: 'edit applied' }),
      toolUse({ toolName: 'Read', toolUseId: 'tu3', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu3', content: 'file a contents post-edit' }),
    ];

    const result = classify(entries);

    expect(result[0].rot).toBeNull();
    expect(result[4].rot).toBeNull();
  });

  it('flags superseded-read: a read whose file is written later in the transcript', () => {
    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Read', toolUseId: 'tu1', filePath: 'src/b.ts' }),
      toolResult({ toolUseId: 'tu1', filePath: 'src/b.ts', content: 'old contents of b' }),
      assistantMessage("I'll update this file now."),
      toolUse({ toolName: 'Write', toolUseId: 'tu2', filePath: 'src/b.ts' }),
      toolResult({ toolUseId: 'tu2', content: 'write applied' }),
    ];

    const result = classify(entries);

    expect(result[1].rot).toBe('superseded-read');
  });

  it('flags repeated-tool-call: same tool + input repeated with no state change in between', () => {
    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Glob', toolUseId: 'tu1', filePath: '**/*.ts' }),
      toolResult({ toolUseId: 'tu1', content: 'src/a.ts\nsrc/b.ts' }),
      assistantMessage('Let me check that again.'),
      toolUse({ toolName: 'Glob', toolUseId: 'tu2', filePath: '**/*.ts' }),
      toolResult({ toolUseId: 'tu2', content: 'src/a.ts\nsrc/b.ts' }),
    ];

    const result = classify(entries);

    expect(result[0].rot).toBeNull();
    expect(result[3].rot).toBe('repeated-tool-call');
  });

  it('does not flag repeated-tool-call when a state-changing call happens in between', () => {
    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Glob', toolUseId: 'tu1', filePath: '**/*.ts' }),
      toolResult({ toolUseId: 'tu1', content: 'src/a.ts\nsrc/b.ts' }),
      toolUse({ toolName: 'Write', toolUseId: 'tu2', filePath: 'src/c.ts' }),
      toolResult({ toolUseId: 'tu2', content: 'write applied' }),
      toolUse({ toolName: 'Glob', toolUseId: 'tu3', filePath: '**/*.ts' }),
      toolResult({ toolUseId: 'tu3', content: 'src/a.ts\nsrc/b.ts\nsrc/c.ts' }),
    ];

    const result = classify(entries);

    expect(result[4].rot).toBeNull();
  });

  it('flags dead-system-reminder: an earlier reminder superseded by a later one of the same kind', () => {
    const entries: TranscriptEntry[] = [
      systemReminder('Environment info (session snapshot): cwd is /repo'),
      assistantMessage('Got it.'),
      systemReminder('Environment info (session snapshot): cwd is /repo/sub'),
    ];

    const result = classify(entries);

    expect(result[0].rot).toBe('dead-system-reminder');
    expect(result[2].rot).toBeNull();
  });

  it('flags stale-todo-snapshot: a dead reminder that looks like a todo list snapshot', () => {
    const entries: TranscriptEntry[] = [
      systemReminder(
        '[{"content":"Write classify.ts","status":"pending"},{"content":"Write tests","status":"pending"}]'
      ),
      assistantMessage('Working on it.'),
      systemReminder(
        '[{"content":"Write classify.ts","status":"completed"},{"content":"Write tests","status":"in_progress"}]'
      ),
    ];

    const result = classify(entries);

    expect(result[0].rot).toBe('stale-todo-snapshot');
    expect(result[2].rot).toBeNull();
  });

  it('flags unreferenced-large-output: a large tool result never referenced again', () => {
    const bigOutput = 'line of unique boilerplate output '.repeat(400);
    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Bash', toolUseId: 'tu1' }),
      toolResult({ toolUseId: 'tu1', content: bigOutput }),
      assistantMessage('That ran fine, moving on to something unrelated.'),
    ];

    const result = classify(entries);

    expect(result[1].tokens).toBeGreaterThan(800);
    expect(result[1].rot).toBe('unreferenced-large-output');
  });

  it('does not flag unreferenced-large-output when a later entry quotes a distinctive substring', () => {
    // Long enough that a 40-char window taken from the exact middle of the
    // full content lands fully inside this marker (not straddling an edge).
    const middleMarker =
      'UNIQUE_MARKER_STRING_FOR_TEST_REFERENCE_CHECK_XYZ_PADDED_TO_BE_LONG_ENOUGH_FOR_THE_MIDDLE_WINDOW';
    const padding = 'padding text '.repeat(200);
    const bigOutput = `${padding}${middleMarker}${padding}`;
    const entries: TranscriptEntry[] = [
      toolUse({ toolName: 'Bash', toolUseId: 'tu1' }),
      toolResult({ toolUseId: 'tu1', content: bigOutput }),
      assistantMessage(`I noticed ${middleMarker} in the output, let's dig into that.`),
    ];

    const result = classify(entries);

    expect(result[1].tokens).toBeGreaterThan(800);
    expect(result[1].rot).toBeNull();
  });

  it('leaves unrelated live entries with rot: null', () => {
    const entries: TranscriptEntry[] = [
      { type: 'user_message', role: 'user', content: 'Please read src/a.ts and summarize it.' },
      toolUse({ toolName: 'Read', toolUseId: 'tu1', filePath: 'src/a.ts' }),
      toolResult({ toolUseId: 'tu1', content: 'short file contents' }),
      assistantMessage('Here is a summary of src/a.ts.'),
    ];

    const result = classify(entries);

    for (const entry of result) {
      expect(entry.rot).toBeNull();
      expect(typeof entry.tokens).toBe('number');
    }
  });
});
