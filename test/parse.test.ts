import { describe, expect, it } from 'vitest';
import { parseClaudeCodeTranscript, parseGenericTranscript } from '../src/parse';

describe('parseClaudeCodeTranscript', () => {
  it('parses a simple user/assistant text exchange', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-07-01T00:00:00.000Z',
        message: { role: 'user', content: 'Hello there' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-07-01T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi! How can I help?' }],
        },
      }),
    ];
    const raw = lines.join('\n');

    const entries = parseClaudeCodeTranscript(raw);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: 'user_message',
      role: 'user',
      content: 'Hello there',
      timestamp: '2026-07-01T00:00:00.000Z',
    });
    expect(entries[1]).toMatchObject({
      type: 'assistant_message',
      role: 'assistant',
      content: 'Hi! How can I help?',
    });
  });

  it('expands an assistant message with text + tool_use blocks into multiple entries', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-01T00:00:02.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: "I'll read the file." },
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'Read',
            input: { file_path: '/tmp/example.ts' },
          },
        ],
      },
    });

    const entries = parseClaudeCodeTranscript(line);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      type: 'assistant_message',
      role: 'assistant',
      content: "I'll read the file.",
    });
    expect(entries[1]).toMatchObject({
      type: 'tool_use',
      role: 'assistant',
      toolName: 'Read',
      toolUseId: 'toolu_01',
      filePath: '/tmp/example.ts',
    });
  });

  it('parses a tool_result nested inside a user message content array', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-07-01T00:00:03.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_01',
            content: [{ type: 'text', text: 'file contents here' }],
          },
        ],
      },
    });

    const entries = parseClaudeCodeTranscript(line);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'tool_result',
      role: 'tool',
      toolUseId: 'toolu_01',
      content: 'file contents here',
    });
  });

  it('handles a tool_result whose content is a plain string', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_02', content: 'plain string result' },
        ],
      },
    });

    const entries = parseClaudeCodeTranscript(line);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'toolu_02',
      content: 'plain string result',
    });
  });

  it('skips blank lines and metadata lines with no message body', () => {
    const lines = [
      '',
      '   ',
      JSON.stringify({ type: 'summary', summary: 'A conversation about widgets' }),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'real message' },
      }),
    ];

    const entries = parseClaudeCodeTranscript(lines.join('\n'));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'user_message', content: 'real message' });
  });

  it('skips malformed JSON lines without throwing, returning what could be parsed', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first' } }),
      '{not valid json',
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'second' } }),
    ];

    expect(() => parseClaudeCodeTranscript(lines.join('\n'))).not.toThrow();
    const entries = parseClaudeCodeTranscript(lines.join('\n'));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ content: 'first' });
    expect(entries[1]).toMatchObject({ content: 'second' });
  });

  it('returns an empty array for empty or non-string input without throwing', () => {
    expect(parseClaudeCodeTranscript('')).toEqual([]);
    // @ts-expect-error deliberately passing a bad type to verify defensive handling
    expect(() => parseClaudeCodeTranscript(undefined)).not.toThrow();
  });

  it('never throws on a completely garbage payload', () => {
    const garbage = 'not json at all\n{"partial": true\n[1,2,3]\nnull';
    expect(() => parseClaudeCodeTranscript(garbage)).not.toThrow();
    expect(Array.isArray(parseClaudeCodeTranscript(garbage))).toBe(true);
  });
});

describe('parseGenericTranscript', () => {
  it('parses a plain JSON array of already-shaped turn records', () => {
    const raw = JSON.stringify([
      { type: 'user_message', role: 'user', content: 'hi', timestamp: '2026-07-01T00:00:00Z' },
      { type: 'assistant_message', role: 'assistant', content: 'hello back' },
      {
        type: 'tool_use',
        role: 'assistant',
        toolName: 'Read',
        toolUseId: 'abc123',
        filePath: 'src/index.ts',
      },
      {
        type: 'tool_result',
        role: 'tool',
        toolName: 'Read',
        toolUseId: 'abc123',
        content: 'file body',
      },
      { type: 'system_reminder', role: 'system', content: 'reminder text' },
    ]);

    const entries = parseGenericTranscript(raw);

    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({ type: 'user_message', content: 'hi' });
    expect(entries[1]).toMatchObject({ type: 'assistant_message', content: 'hello back' });
    expect(entries[2]).toMatchObject({ type: 'tool_use', toolUseId: 'abc123', filePath: 'src/index.ts' });
    expect(entries[3]).toMatchObject({ type: 'tool_result', toolUseId: 'abc123', content: 'file body' });
    expect(entries[4]).toMatchObject({ type: 'system_reminder', content: 'reminder text' });
  });

  it('infers the entry type from `role` when `type` is missing', () => {
    const raw = JSON.stringify([
      { role: 'user', content: 'inferred user' },
      { role: 'assistant', content: 'inferred assistant' },
    ]);

    const entries = parseGenericTranscript(raw);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ type: 'user_message', content: 'inferred user' });
    expect(entries[1]).toMatchObject({ type: 'assistant_message', content: 'inferred assistant' });
  });

  it('skips entries missing required fields for their type', () => {
    const raw = JSON.stringify([
      { type: 'user_message', role: 'user', content: 'valid' },
      { type: 'user_message', role: 'user' }, // missing content
      { type: 'tool_use', role: 'assistant', toolName: 'Read' }, // missing toolUseId
      { type: 'tool_result', role: 'tool', toolUseId: 'x' }, // missing content
      { type: 'unknown_type', role: 'nobody', content: 'nope' },
    ]);

    const entries = parseGenericTranscript(raw);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ content: 'valid' });
  });

  it('never throws and returns [] for malformed JSON', () => {
    expect(() => parseGenericTranscript('{not valid json')).not.toThrow();
    expect(parseGenericTranscript('{not valid json')).toEqual([]);
  });

  it('returns [] when the parsed JSON is not an array', () => {
    expect(parseGenericTranscript(JSON.stringify({ foo: 'bar' }))).toEqual([]);
    expect(parseGenericTranscript('42')).toEqual([]);
    expect(parseGenericTranscript('null')).toEqual([]);
  });

  it('returns an empty array for empty string input', () => {
    expect(parseGenericTranscript('')).toEqual([]);
  });

  it('skips non-object entries within an otherwise valid array', () => {
    const raw = JSON.stringify([
      'just a string',
      42,
      null,
      { type: 'user_message', role: 'user', content: 'kept' },
    ]);

    const entries = parseGenericTranscript(raw);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ content: 'kept' });
  });
});
