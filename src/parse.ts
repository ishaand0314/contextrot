import type {
  AssistantMessageEntry,
  SystemReminderEntry,
  ToolResultEntry,
  ToolUseEntry,
  TranscriptEntry,
  UserMessageEntry,
} from './types';

/**
 * Parsers that turn raw transcript text into `TranscriptEntry[]`.
 *
 * Both parsers are defensive by design: transcripts come from files on
 * disk (or piped input) that may be partially written, truncated, or from
 * an unexpected schema version. Malformed lines/entries are skipped
 * rather than thrown, so a single bad line never crashes the CLI.
 */

/** Narrow, structural view of a single line in a Claude Code `.jsonl` transcript. */
interface ClaudeCodeLine {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

/** Structural view of a content block nested inside a message's `content` array. */
interface ClaudeCodeContentBlock {
  type?: string;
  text?: string;
  // tool_use blocks
  id?: string;
  name?: string;
  input?: unknown;
  // tool_result blocks
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Best-effort extraction of a file path from a tool_use's `input` payload. */
function extractFilePath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const candidate = input.file_path ?? input.path ?? input.filePath;
  return typeof candidate === 'string' ? candidate : undefined;
}

/** Flattens a tool_result's `content` (string, or array of text/blocks) into a string. */
function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (isRecord(block) && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter((text) => text.length > 0)
      .join('\n');
  }
  if (content === undefined || content === null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

/** Flattens an assistant message's textual content blocks into a single string. */
function stringifyTextBlocks(blocks: ClaudeCodeContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

/**
 * Converts the content blocks nested inside a single `message.content` array
 * (Claude Code's Anthropic-API-shaped message body) into zero or more
 * TranscriptEntry values. A single JSONL line can therefore expand into
 * several entries (e.g. an assistant message with text + multiple tool_use
 * blocks).
 */
function entriesFromContentBlocks(
  role: 'user' | 'assistant',
  blocks: ClaudeCodeContentBlock[],
  timestamp: string | undefined
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];

  const text = stringifyTextBlocks(blocks);
  if (text.length > 0) {
    if (role === 'assistant') {
      const entry: AssistantMessageEntry = {
        type: 'assistant_message',
        role: 'assistant',
        content: text,
        ...(timestamp ? { timestamp } : {}),
      };
      entries.push(entry);
    } else {
      const entry: UserMessageEntry = {
        type: 'user_message',
        role: 'user',
        content: text,
        ...(timestamp ? { timestamp } : {}),
      };
      entries.push(entry);
    }
  }

  for (const block of blocks) {
    if (!isRecord(block)) continue;

    if (block.type === 'tool_use') {
      const toolUseId = typeof block.id === 'string' ? block.id : undefined;
      const toolName = typeof block.name === 'string' ? block.name : undefined;
      if (!toolUseId || !toolName) continue;
      const filePath = extractFilePath(block.input);
      const entry: ToolUseEntry = {
        type: 'tool_use',
        role: 'assistant',
        toolName,
        toolUseId,
        ...(filePath ? { filePath } : {}),
        ...(timestamp ? { timestamp } : {}),
      };
      entries.push(entry);
    } else if (block.type === 'tool_result') {
      const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined;
      if (!toolUseId) continue;
      const entry: ToolResultEntry = {
        type: 'tool_result',
        role: 'tool',
        toolName: '',
        toolUseId,
        content: stringifyToolResultContent(block.content),
        ...(timestamp ? { timestamp } : {}),
      };
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Parses a single JSONL line from a Claude Code `~/.claude/projects/**\/*.jsonl`
 * transcript into zero or more TranscriptEntry values. Returns an empty
 * array if the line is malformed or not a recognized shape, rather than
 * throwing.
 */
function parseClaudeCodeLine(line: string): TranscriptEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) return [];
  const raw = parsed as ClaudeCodeLine;
  const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : undefined;

  // Some transcript lines are metadata/summary records with no message body
  // (e.g. `type: "summary"`); skip those quietly.
  const message = raw.message;
  if (!isRecord(message)) return [];

  const role = message.role;
  if (role !== 'user' && role !== 'assistant') return [];

  const content = message.content;

  // Content can be a plain string (simple text-only turn) or an array of
  // content blocks (text/tool_use/tool_result mixed together).
  if (typeof content === 'string') {
    if (content.length === 0) return [];
    if (role === 'assistant') {
      const entry: AssistantMessageEntry = {
        type: 'assistant_message',
        role: 'assistant',
        content,
        ...(timestamp ? { timestamp } : {}),
      };
      return [entry];
    }
    const entry: UserMessageEntry = {
      type: 'user_message',
      role: 'user',
      content,
      ...(timestamp ? { timestamp } : {}),
    };
    return [entry];
  }

  if (Array.isArray(content)) {
    const blocks = content.filter(isRecord) as ClaudeCodeContentBlock[];
    return entriesFromContentBlocks(role, blocks, timestamp);
  }

  return [];
}

/**
 * Parses a Claude Code session transcript (`~/.claude/projects/**\/*.jsonl`):
 * one JSON object per line, each line wrapping a `message` body shaped like
 * the Anthropic Messages API (role + string or content-block-array content).
 *
 * Never throws: unparseable or unrecognized lines are skipped, and parsing
 * always returns whatever entries could be recovered (including an empty
 * array for fully malformed input).
 */
export function parseClaudeCodeTranscript(raw: string): TranscriptEntry[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];

  const entries: TranscriptEntry[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      entries.push(...parseClaudeCodeLine(trimmed));
    } catch {
      // Defensive: parseClaudeCodeLine shouldn't throw, but never let a
      // single bad line take down the whole parse.
      continue;
    }
  }

  return entries;
}

const VALID_TYPES: ReadonlySet<string> = new Set([
  'user_message',
  'assistant_message',
  'tool_use',
  'tool_result',
  'system_reminder',
]);

/**
 * Loosely validates and normalizes a single already-shaped turn record
 * (as found in a generic JSON-array transcript) into a TranscriptEntry.
 * Returns undefined if the record can't be salvaged into a valid entry.
 */
function normalizeGenericEntry(value: unknown): TranscriptEntry | undefined {
  if (!isRecord(value)) return undefined;

  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : undefined;

  // Determine the discriminant type, falling back to inference from `role`
  // when `type` is missing or unrecognized (loose validation).
  let type = typeof value.type === 'string' ? value.type : undefined;
  const role = typeof value.role === 'string' ? value.role : undefined;

  if (!type || !VALID_TYPES.has(type)) {
    if (role === 'user') type = 'user_message';
    else if (role === 'assistant') type = 'assistant_message';
    else if (role === 'tool') type = 'tool_result';
    else if (role === 'system') type = 'system_reminder';
    else return undefined;
  }

  switch (type) {
    case 'user_message': {
      if (typeof value.content !== 'string') return undefined;
      const entry: UserMessageEntry = {
        type: 'user_message',
        role: 'user',
        content: value.content,
        ...(timestamp ? { timestamp } : {}),
      };
      return entry;
    }
    case 'assistant_message': {
      if (typeof value.content !== 'string') return undefined;
      const entry: AssistantMessageEntry = {
        type: 'assistant_message',
        role: 'assistant',
        content: value.content,
        ...(timestamp ? { timestamp } : {}),
      };
      return entry;
    }
    case 'tool_use': {
      const toolName = typeof value.toolName === 'string' ? value.toolName : undefined;
      const toolUseId = typeof value.toolUseId === 'string' ? value.toolUseId : undefined;
      if (!toolName || !toolUseId) return undefined;
      const filePath = typeof value.filePath === 'string' ? value.filePath : undefined;
      const content = typeof value.content === 'string' ? value.content : undefined;
      const entry: ToolUseEntry = {
        type: 'tool_use',
        role: 'assistant',
        toolName,
        toolUseId,
        ...(filePath ? { filePath } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(timestamp ? { timestamp } : {}),
      };
      return entry;
    }
    case 'tool_result': {
      const toolName = typeof value.toolName === 'string' ? value.toolName : '';
      const toolUseId = typeof value.toolUseId === 'string' ? value.toolUseId : undefined;
      const content = typeof value.content === 'string' ? value.content : undefined;
      if (!toolUseId || content === undefined) return undefined;
      const filePath = typeof value.filePath === 'string' ? value.filePath : undefined;
      const entry: ToolResultEntry = {
        type: 'tool_result',
        role: 'tool',
        toolName,
        toolUseId,
        content,
        ...(filePath ? { filePath } : {}),
        ...(timestamp ? { timestamp } : {}),
      };
      return entry;
    }
    case 'system_reminder': {
      if (typeof value.content !== 'string') return undefined;
      const entry: SystemReminderEntry = {
        type: 'system_reminder',
        role: 'system',
        content: value.content,
        ...(timestamp ? { timestamp } : {}),
      };
      return entry;
    }
    default:
      return undefined;
  }
}

/**
 * Parses a plain JSON array of already-shaped turn records into
 * `TranscriptEntry[]`, validating loosely and normalizing each record.
 *
 * Never throws: if `raw` isn't valid JSON, isn't an array, or individual
 * entries are malformed/unrecognized, those entries are skipped and
 * whatever could be parsed is returned (including an empty array).
 */
export function parseGenericTranscript(raw: string): TranscriptEntry[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const entries: TranscriptEntry[] = [];
  for (const item of parsed) {
    try {
      const entry = normalizeGenericEntry(item);
      if (entry) entries.push(entry);
    } catch {
      continue;
    }
  }

  return entries;
}
