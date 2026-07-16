import { describe, expect, it, vi } from 'vitest';
import { analyze, project } from '../src/analyze';
import {
  formatHumanReport,
  formatJsonReport,
  formatMarkdownReport,
  parseTranscriptFile,
  runCli,
} from '../src/cli';
import { DEMO_TRANSCRIPT } from '../src/demo-data';
import { DEFAULT_CONTEXT_WINDOW } from '../src/models';
import type { TranscriptEntry } from '../src/types';

const report = analyze(DEMO_TRANSCRIPT);
const projection = project(report, DEFAULT_CONTEXT_WINDOW, 10);

function noRotEntries(): TranscriptEntry[] {
  return [
    { type: 'user_message', role: 'user', content: 'Please read src/a.ts and summarize it.' },
    { type: 'assistant_message', role: 'assistant', content: 'Here is a summary of src/a.ts.' },
  ];
}

describe('formatHumanReport', () => {
  it('includes total tokens, live/rot split, and percentage', () => {
    const output = formatHumanReport(report, projection);

    expect(output).toContain('Total tokens:');
    expect(output).toContain(`${report.totalTokens.toLocaleString('en-US')}`);
    expect(output).toContain('Live:');
    expect(output).toContain('Rot:');
    expect(output).toMatch(/\d+\.\d%/);
  });

  it('includes a breakdown row for every rot category with count and tokens', () => {
    const output = formatHumanReport(report, projection);

    expect(output).toContain('Breakdown by category:');
    expect(output).toContain('Duplicate reads');
    expect(output).toContain('Superseded reads');
    expect(output).toContain('Repeated tool calls');
    expect(output).toContain('Dead system reminders');
    expect(output).toContain('Unreferenced large output');
    expect(output).toContain('Stale todo snapshots');
    expect(output).toMatch(/count\s+\d+/);
    expect(output).toMatch(/tokens\s+[\d,]+/);
  });

  it('lists top offenders', () => {
    const output = formatHumanReport(report, projection);

    expect(output).toContain('Top offenders:');
    expect(report.topOffenders.length).toBeGreaterThan(0);
    expect(output).toContain(report.topOffenders[0].summary);
  });

  it('shows "None, no rot detected." when there are no offenders', () => {
    const emptyReport = analyze(noRotEntries());
    const emptyProjection = project(emptyReport, DEFAULT_CONTEXT_WINDOW, 2);

    const output = formatHumanReport(emptyReport, emptyProjection);

    expect(output).toContain('None, no rot detected.');
  });

  it('includes a turns-until-compaction projection line', () => {
    const output = formatHumanReport(report, projection);

    expect(output).toMatch(/turns until compaction/);
    expect(output).toContain(`${projection.turnsRemaining.toLocaleString('en-US')}`);
  });

  it('never contains an em dash', () => {
    const output = formatHumanReport(report, projection);

    expect(output).not.toContain('—');
  });
});

describe('formatMarkdownReport', () => {
  it('renders a markdown table with a header row and one row per category', () => {
    const output = formatMarkdownReport(report, projection);

    expect(output).toContain('# Context rot report');
    expect(output).toContain('| Category | Count | Tokens |');
    expect(output).toContain('| Duplicate reads |');
    expect(output).toContain('## Top offenders');
    expect(output).toContain('## Projection');
  });

  it('never contains an em dash', () => {
    const output = formatMarkdownReport(report, projection);

    expect(output).not.toContain('—');
  });
});

describe('formatJsonReport', () => {
  it('produces valid JSON containing the report fields and the projection', () => {
    const output = formatJsonReport(report, projection);
    const parsed = JSON.parse(output);

    expect(parsed.totalTokens).toBe(report.totalTokens);
    expect(parsed.rotPercentage).toBe(report.rotPercentage);
    expect(parsed.projection.turnsRemaining).toBe(projection.turnsRemaining);
  });
});

describe('parseTranscriptFile', () => {
  it('parses .jsonl files with the Claude Code parser', () => {
    const raw = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'hello from jsonl' },
    });

    const entries = parseTranscriptFile(raw, '/tmp/session.jsonl');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'user_message', content: 'hello from jsonl' });
  });

  it('parses a JSON array with the generic parser', () => {
    const raw = JSON.stringify([{ type: 'user_message', role: 'user', content: 'hello from array' }]);

    const entries = parseTranscriptFile(raw, '/tmp/transcript.json');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'user_message', content: 'hello from array' });
  });

  it('sniffs a non-.jsonl extension whose first line is a standalone JSON object as JSONL', () => {
    const raw = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first line' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'second line' } }),
    ].join('\n');

    const entries = parseTranscriptFile(raw, '/tmp/transcript.txt');

    expect(entries).toHaveLength(2);
  });
});

describe('runCli', () => {
  function makeIo(overrides: {
    print?: ReturnType<typeof vi.fn<(message: string) => void>>;
    printError?: ReturnType<typeof vi.fn<(message: string) => void>>;
    exit?: ReturnType<typeof vi.fn<(code: number) => void>>;
    readFile?: ReturnType<typeof vi.fn<(filePath: string) => string>>;
    discover?: ReturnType<typeof vi.fn<() => string | null>>;
  } = {}) {
    return {
      print: vi.fn<(message: string) => void>(),
      printError: vi.fn<(message: string) => void>(),
      exit: vi.fn<(code: number) => void>(),
      readFile: vi.fn<(filePath: string) => string>(() => ''),
      discover: vi.fn<() => string | null>(() => null),
      ...overrides,
    };
  }

  it('uses the demo transcript when --demo is passed', () => {
    const io = makeIo();

    runCli({ demo: true, model: 'claude-sonnet-5' }, io);

    expect(io.print).toHaveBeenCalledTimes(1);
    expect(io.print.mock.calls[0][0]).toContain('Total tokens:');
    expect(io.exit).not.toHaveBeenCalled();
  });

  it('reads and parses --file when passed', () => {
    const raw = JSON.stringify([{ type: 'user_message', role: 'user', content: 'hi' }]);
    const io = makeIo({ readFile: vi.fn(() => raw) });

    runCli({ file: '/tmp/t.json', model: 'claude-sonnet-5' }, io);

    expect(io.readFile).toHaveBeenCalledWith('/tmp/t.json');
    expect(io.print).toHaveBeenCalledTimes(1);
  });

  it('falls back to discovery when neither --demo nor --file is passed', () => {
    const raw = JSON.stringify([{ type: 'user_message', role: 'user', content: 'hi' }]);
    const io = makeIo({ discover: vi.fn(() => '/found/session.jsonl'), readFile: vi.fn(() => raw) });

    runCli({ model: 'claude-sonnet-5' }, io);

    expect(io.discover).toHaveBeenCalled();
    expect(io.readFile).toHaveBeenCalledWith('/found/session.jsonl');
    expect(io.print).toHaveBeenCalledTimes(1);
  });

  it('prints a helpful error and exits 1 when discovery finds nothing', () => {
    const io = makeIo({ discover: vi.fn(() => null) });

    runCli({ model: 'claude-sonnet-5' }, io);

    expect(io.printError).toHaveBeenCalledTimes(1);
    expect(io.printError.mock.calls[0][0]).toMatch(/--demo/);
    expect(io.printError.mock.calls[0][0]).toMatch(/--file/);
    expect(io.exit).toHaveBeenCalledWith(1);
    expect(io.print).not.toHaveBeenCalled();
  });

  it('exits 1 when the given --file cannot be read', () => {
    const io = makeIo({
      readFile: vi.fn(() => {
        throw new Error('ENOENT');
      }),
    });

    runCli({ file: '/missing.jsonl', model: 'claude-sonnet-5' }, io);

    expect(io.printError).toHaveBeenCalledTimes(1);
    expect(io.exit).toHaveBeenCalledWith(1);
  });

  it('warns and falls back to the default context window for an unknown model', () => {
    const io = makeIo();

    runCli({ demo: true, model: 'not-a-real-model' }, io);

    expect(io.printError).toHaveBeenCalledTimes(1);
    expect(io.printError.mock.calls[0][0]).toMatch(/unknown model/);
    expect(io.print).toHaveBeenCalledTimes(1);
  });

  it('outputs JSON when --json is passed', () => {
    const io = makeIo();

    runCli({ demo: true, model: 'claude-sonnet-5', json: true }, io);

    const output = io.print.mock.calls[0][0];
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('outputs Markdown when --markdown is passed', () => {
    const io = makeIo();

    runCli({ demo: true, model: 'claude-sonnet-5', markdown: true }, io);

    const output = io.print.mock.calls[0][0];
    expect(output).toContain('# Context rot report');
  });

  it('exits 1 when rotPercentage exceeds --threshold', () => {
    const io = makeIo();

    runCli({ demo: true, model: 'claude-sonnet-5', threshold: '0' }, io);

    expect(io.exit).toHaveBeenCalledWith(1);
  });

  it('does not exit nonzero when rotPercentage is within --threshold', () => {
    const io = makeIo();

    runCli({ demo: true, model: 'claude-sonnet-5', threshold: '100' }, io);

    expect(io.exit).not.toHaveBeenCalled();
  });
});
