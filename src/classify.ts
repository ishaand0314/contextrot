import { countTokens } from './tokenizer';
import type { RotCategory, TranscriptEntry } from './types';

/**
 * Heuristic rot classification for a parsed transcript.
 *
 * `classify` walks a `TranscriptEntry[]` in order and assigns each entry at
 * most one `RotCategory`, using a fixed priority order (first match wins):
 *
 *   1. duplicate-read
 *   2. superseded-read
 *   3. repeated-tool-call
 *   4. dead-system-reminder (or the more specific stale-todo-snapshot)
 *   5. unreferenced-large-output
 *
 * Everything is heuristic and best-effort: transcripts are noisy and the
 * goal is a useful signal, not a provably-correct classification.
 */

/** A `TranscriptEntry` annotated with its token count and rot classification. */
export type ClassifiedEntry = TranscriptEntry & {
  tokens: number;
  rot: RotCategory | null;
  rotReason?: string;
};

const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const STATE_CHANGING_TOOL_NAMES = new Set([...WRITE_TOOL_NAMES, 'Bash']);
// Tools that read the full contents of a specific file path. Deliberately
// narrower than "any tool_use with a filePath" — e.g. Glob/Grep carry a
// pattern/path in `filePath`-shaped metadata but don't read one file's
// contents, so they're out of scope for duplicate-read/superseded-read.
const READ_TOOL_NAMES = new Set(['Read', 'NotebookRead']);

/** True if a `tool_use` entry is a write/edit-style call against a file path. */
function isWriteToolUse(entry: TranscriptEntry): entry is TranscriptEntry & {
  type: 'tool_use';
  filePath?: string;
} {
  return entry.type === 'tool_use' && WRITE_TOOL_NAMES.has(entry.toolName);
}

/** True if a `tool_use` entry reads a file path (e.g. Read, NotebookRead). */
function isReadToolUse(entry: TranscriptEntry): entry is TranscriptEntry & {
  type: 'tool_use';
  filePath?: string;
} {
  return entry.type === 'tool_use' && READ_TOOL_NAMES.has(entry.toolName) && Boolean(entry.filePath);
}

/**
 * Best-effort key for "same tool call" comparison. `ToolUseEntry` on `main`
 * does not carry a raw `input` field (only the extracted `filePath` and the
 * inherited optional `content`), so we build a stand-in input payload from
 * whatever the entry actually exposes and JSON-stringify that. This is
 * equivalent to comparing JSON-stringified input whenever the source
 * transcript's tool input reduces to filePath/content, and degenerates
 * gracefully (matches purely on toolName) when neither is present.
 */
function toolCallKey(entry: TranscriptEntry & { type: 'tool_use' }): string {
  const pseudoInput = {
    filePath: entry.filePath,
    content: entry.content,
  };
  return `${entry.toolName}::${JSON.stringify(pseudoInput)}`;
}

/** Heuristic: does this text look like a todo-list snapshot? */
function looksLikeTodoSnapshot(content: string): boolean {
  const checkboxMarkers = content.match(/\[( |x|X|-)\]/g);
  if (checkboxMarkers && checkboxMarkers.length >= 2) return true;

  const statusMarkers = content.match(/"status"\s*:\s*"(pending|completed|in_progress)"/g);
  if (statusMarkers && statusMarkers.length >= 2) return true;

  // Also catch bullet/dash style todo lists with multiple pending/done markers.
  const bulletStatusMarkers = content.match(/\b(pending|completed|in_progress)\b/gi);
  if (bulletStatusMarkers && bulletStatusMarkers.length >= 2 && /todo/i.test(content)) return true;

  return false;
}

/**
 * Heuristic "kind" fingerprint for a system reminder: the first ~40 chars,
 * lowercased and whitespace-collapsed, so near-identical reminder headers
 * (e.g. "Todo list changed" banners with different bodies) are recognized
 * as the same recurring kind of reminder.
 */
function systemReminderKind(content: string): string {
  return content.trim().slice(0, 40).toLowerCase().replace(/\s+/g, ' ');
}

const LARGE_OUTPUT_TOKEN_THRESHOLD = 800;
const DISTINCTIVE_SUBSTRING_LENGTH = 40;
const DISTINCTIVE_SUBSTRING_MIN_LENGTH = 12;

/**
 * Pulls a "distinctive" substring out of a large tool result's content to
 * test whether later entries reference/quote it. Uses a chunk from the
 * middle of the content (skipping generic boilerplate that's more likely to
 * appear at the very start, e.g. shared headers) rather than the first N
 * characters.
 */
function distinctiveSubstring(content: string): string | undefined {
  const trimmed = content.trim();
  if (trimmed.length < DISTINCTIVE_SUBSTRING_MIN_LENGTH) return undefined;
  const start = Math.floor(trimmed.length / 2);
  const substring = trimmed.slice(start, start + DISTINCTIVE_SUBSTRING_LENGTH).trim();
  return substring.length >= DISTINCTIVE_SUBSTRING_MIN_LENGTH ? substring : undefined;
}

/**
 * Classifies each entry of a parsed transcript with a rot category (or
 * `null` if it's live signal), plus its token count.
 *
 * Detection runs in priority order (see module docs); each entry receives
 * at most one category, whichever the earliest matching rule assigns.
 */
export function classify(entries: TranscriptEntry[]): ClassifiedEntry[] {
  const rot = new Map<number, { category: RotCategory; reason: string }>();

  // --- 1. duplicate-read -----------------------------------------------
  // For each file path, the earliest read stays live. Any subsequent read
  // of the same path is duplicate-read, UNLESS a write/edit to that path
  // happened in between (which resets the path back to "not yet re-read").
  {
    const liveReadSeen = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (isWriteToolUse(entry) && entry.filePath) {
        liveReadSeen.delete(entry.filePath);
        continue;
      }
      if (isReadToolUse(entry) && entry.filePath) {
        const path = entry.filePath;
        if (liveReadSeen.has(path)) {
          rot.set(i, {
            category: 'duplicate-read',
            reason: `Repeated read of "${path}" with no intervening edit/write.`,
          });
        } else {
          liveReadSeen.add(path);
        }
      }
    }
  }

  // --- 2. superseded-read ------------------------------------------------
  // A tool_result reading path P is stale if some LATER entry writes/edits
  // P. Only applies to entries not already classified as duplicate-read.
  {
    // Map filePath -> list of indices where it is written/edited (tool_use).
    const writeIndicesByPath = new Map<string, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (isWriteToolUse(entry) && entry.filePath) {
        const list = writeIndicesByPath.get(entry.filePath) ?? [];
        list.push(i);
        writeIndicesByPath.set(entry.filePath, list);
      }
    }

    for (let i = 0; i < entries.length; i++) {
      if (rot.has(i)) continue;
      const entry = entries[i];
      if (entry.type !== 'tool_result' || !entry.filePath) continue;
      const writeIndices = writeIndicesByPath.get(entry.filePath);
      if (!writeIndices) continue;
      const hasLaterWrite = writeIndices.some((writeIndex) => writeIndex > i);
      if (hasLaterWrite) {
        rot.set(i, {
          category: 'superseded-read',
          reason: `File "${entry.filePath}" was written/edited later in the transcript, making this read stale.`,
        });
      }
    }
  }

  // --- 3. repeated-tool-call ----------------------------------------------
  // A tool_use with the same toolName + (pseudo) input as an earlier
  // tool_use, with no state-changing tool call (write/edit/bash) in
  // between, is a repeated-tool-call.
  {
    const lastSeenAt = new Map<string, number>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type !== 'tool_use') continue;

      if (STATE_CHANGING_TOOL_NAMES.has(entry.toolName)) {
        // A state-changing call invalidates all previously-seen call keys:
        // anything could have changed as a result.
        lastSeenAt.clear();
        continue;
      }

      const key = toolCallKey(entry);
      if (lastSeenAt.has(key)) {
        if (!rot.has(i)) {
          rot.set(i, {
            category: 'repeated-tool-call',
            reason: `Same "${entry.toolName}" call repeated with identical input, no state change in between.`,
          });
        }
      }
      lastSeenAt.set(key, i);
    }
  }

  // --- 4 & 5. dead-system-reminder / stale-todo-snapshot ------------------
  // For each "kind" of system reminder (heuristic similarity on the first
  // ~40 chars), only the latest one is live; earlier ones of the same kind
  // are dead. If the dead reminder's content looks like a todo snapshot,
  // label it stale-todo-snapshot instead.
  {
    const indicesByKind = new Map<string, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type !== 'system_reminder') continue;
      const kind = systemReminderKind(entry.content);
      const list = indicesByKind.get(kind) ?? [];
      list.push(i);
      indicesByKind.set(kind, list);
    }

    for (const indices of indicesByKind.values()) {
      if (indices.length < 2) continue;
      const latest = indices[indices.length - 1];
      for (const i of indices) {
        if (i === latest) continue;
        if (rot.has(i)) continue;
        const entry = entries[i];
        if (entry.type !== 'system_reminder') continue;
        if (looksLikeTodoSnapshot(entry.content)) {
          rot.set(i, {
            category: 'stale-todo-snapshot',
            reason: 'Superseded todo-list snapshot; a later reminder of the same kind is now live.',
          });
        } else {
          rot.set(i, {
            category: 'dead-system-reminder',
            reason: 'Superseded by a later system reminder of the same kind.',
          });
        }
      }
    }
  }

  // --- 6. unreferenced-large-output --------------------------------------
  // A tool_result over the token threshold, not already classified, whose
  // content is never referenced/quoted (via a distinctive substring) by any
  // later entry's text content.
  {
    for (let i = 0; i < entries.length; i++) {
      if (rot.has(i)) continue;
      const entry = entries[i];
      if (entry.type !== 'tool_result') continue;

      const tokens = countTokens(entry.content);
      if (tokens <= LARGE_OUTPUT_TOKEN_THRESHOLD) continue;

      const substring = distinctiveSubstring(entry.content);
      // If we can't extract a meaningful distinctive substring, we can't
      // prove it's unreferenced either way; skip rather than false-positive.
      if (!substring) continue;

      const isReferencedLater = entries.slice(i + 1).some((later) => {
        const text =
          later.type === 'assistant_message' || later.type === 'user_message'
            ? later.content
            : later.type === 'tool_result'
              ? later.content
              : undefined;
        return typeof text === 'string' && text.includes(substring);
      });

      if (!isReferencedLater) {
        rot.set(i, {
          category: 'unreferenced-large-output',
          reason: `Large tool result (${tokens} tokens) never referenced again later in the transcript.`,
        });
      }
    }
  }

  return entries.map((entry, i) => {
    const tokens = countTokens(entry.content ?? '');
    const classification = rot.get(i);
    return {
      ...entry,
      tokens,
      rot: classification?.category ?? null,
      ...(classification ? { rotReason: classification.reason } : {}),
    };
  });
}
