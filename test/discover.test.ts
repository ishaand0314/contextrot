import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverLatestClaudeCodeTranscript } from '../src/discover';

describe('discoverLatestClaudeCodeTranscript', () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'contextrot-discover-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns null when the projects directory does not exist', () => {
    expect(discoverLatestClaudeCodeTranscript()).toBeNull();
  });

  it('returns null when the projects directory has no .jsonl files', () => {
    const projectsDir = path.join(tmpHome, '.claude', 'projects', 'some-project');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(path.join(projectsDir, 'notes.txt'), 'not a transcript');

    expect(discoverLatestClaudeCodeTranscript()).toBeNull();
  });

  it('finds a .jsonl file nested a couple levels deep', () => {
    const projectsDir = path.join(tmpHome, '.claude', 'projects', 'my-project');
    fs.mkdirSync(projectsDir, { recursive: true });
    const sessionFile = path.join(projectsDir, 'session-1.jsonl');
    fs.writeFileSync(sessionFile, '{"type":"summary"}\n');

    const result = discoverLatestClaudeCodeTranscript();

    expect(result).toBe(sessionFile);
  });

  it('returns the most recently modified .jsonl file when several exist', () => {
    const projectsDir = path.join(tmpHome, '.claude', 'projects', 'my-project');
    fs.mkdirSync(projectsDir, { recursive: true });

    const older = path.join(projectsDir, 'session-old.jsonl');
    const newer = path.join(projectsDir, 'session-new.jsonl');
    fs.writeFileSync(older, '{"type":"summary"}\n');
    fs.writeFileSync(newer, '{"type":"summary"}\n');

    const now = Date.now();
    fs.utimesSync(older, new Date(now - 60_000), new Date(now - 60_000));
    fs.utimesSync(newer, new Date(now), new Date(now));

    const result = discoverLatestClaudeCodeTranscript();

    expect(result).toBe(newer);
  });

  it('never throws when the home directory resolves to a bogus path', () => {
    process.env.HOME = path.join(tmpHome, 'does', 'not', 'exist');
    process.env.USERPROFILE = process.env.HOME;

    expect(() => discoverLatestClaudeCodeTranscript()).not.toThrow();
    expect(discoverLatestClaudeCodeTranscript()).toBeNull();
  });
});
