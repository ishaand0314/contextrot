/**
 * Core transcript and rot-classification types shared across contextrot.
 */

/** Discriminant for the kind of entry found in an agent session transcript. */
export type TranscriptEntryType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'system_reminder';

interface BaseTranscriptEntry {
  type: TranscriptEntryType;
  /** Raw or rendered content for this entry, if applicable. */
  content?: string;
  /** ISO-8601 timestamp, when available from the source transcript. */
  timestamp?: string;
}

/** A message authored by the human user. */
export interface UserMessageEntry extends BaseTranscriptEntry {
  type: 'user_message';
  role: 'user';
  content: string;
}

/** A message authored by the assistant. */
export interface AssistantMessageEntry extends BaseTranscriptEntry {
  type: 'assistant_message';
  role: 'assistant';
  content: string;
}

/** An invocation of a tool by the assistant. */
export interface ToolUseEntry extends BaseTranscriptEntry {
  type: 'tool_use';
  role: 'assistant';
  toolName: string;
  toolUseId: string;
  /** Path being read/written, for file-oriented tools (Read, Edit, Write, Glob, ...). */
  filePath?: string;
}

/** The result returned from a previously invoked tool. */
export interface ToolResultEntry extends BaseTranscriptEntry {
  type: 'tool_result';
  role: 'tool';
  toolName: string;
  toolUseId: string;
  /** Path the result pertains to, for file-oriented tools. */
  filePath?: string;
  content: string;
}

/** A system-injected reminder (e.g. environment or state nudges). */
export interface SystemReminderEntry extends BaseTranscriptEntry {
  type: 'system_reminder';
  role: 'system';
  content: string;
}

/**
 * A single entry in an agent session transcript. Discriminated on `type`
 * so callers can narrow with a `switch`/`if` on `entry.type`.
 */
export type TranscriptEntry =
  | UserMessageEntry
  | AssistantMessageEntry
  | ToolUseEntry
  | ToolResultEntry
  | SystemReminderEntry;

/**
 * Categories of "context rot" contextrot can detect in a transcript.
 */
export type RotCategory =
  | 'duplicate-read'
  | 'superseded-read'
  | 'repeated-tool-call'
  | 'dead-system-reminder'
  | 'unreferenced-large-output'
  | 'stale-todo-snapshot';
