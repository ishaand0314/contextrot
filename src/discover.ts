import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Best-effort discovery of the most recently modified Claude Code session
 * transcript on disk.
 *
 * Claude Code stores one `.jsonl` file per session, nested under a
 * project-specific subdirectory of `~/.claude/projects`, e.g.
 * `~/.claude/projects/<project-slug>/<session-id>.jsonl`. This walks that
 * directory tree a couple of levels deep and returns the path to whichever
 * `.jsonl` file has the newest mtime.
 */

const MAX_DEPTH = 3;

interface Candidate {
  filePath: string;
  mtimeMs: number;
}

/** Recursively collects `.jsonl` files under `dir`, up to `MAX_DEPTH` levels deep. */
function collectJsonlFiles(dir: string, depth: number, out: Candidate[]): void {
  if (depth > MAX_DEPTH) return;

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);

    if (dirent.isDirectory()) {
      collectJsonlFiles(fullPath, depth + 1, out);
      continue;
    }

    if (dirent.isFile() && fullPath.endsWith('.jsonl')) {
      try {
        const stat = fs.statSync(fullPath);
        out.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        continue;
      }
    }
  }
}

/**
 * Looks for the most recently modified `*.jsonl` transcript file under the
 * Claude Code projects directory (`~/.claude/projects`), searched a couple
 * of levels deep.
 *
 * Never throws: returns `null` on any error (missing home directory,
 * missing projects directory, permission issues, etc.) or if no `.jsonl`
 * file is found.
 */
export function discoverLatestClaudeCodeTranscript(): string | null {
  try {
    const home = os.homedir();
    if (!home) return null;

    const projectsDir = path.join(home, '.claude', 'projects');
    const candidates: Candidate[] = [];
    collectJsonlFiles(projectsDir, 0, candidates);

    if (candidates.length === 0) return null;

    let latest = candidates[0];
    for (const candidate of candidates) {
      if (candidate.mtimeMs > latest.mtimeMs) latest = candidate;
    }

    return latest.filePath;
  } catch {
    return null;
  }
}
