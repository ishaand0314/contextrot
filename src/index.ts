export const VERSION = '0.1.0';

/**
 * Public API surface for the `contextrot` library: parsing, classification,
 * analysis, projection, model context-window data, and the bundled demo
 * transcript.
 */

export { parseClaudeCodeTranscript, parseGenericTranscript } from './parse';
export { classify } from './classify';
export type { ClassifiedEntry } from './classify';
export { analyze, project } from './analyze';
export type { AnalysisReport, ProjectionResult } from './analyze';
export { MODEL_CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from './models';
export { DEMO_TRANSCRIPT } from './demo-data';
export type {
  TranscriptEntryType,
  TranscriptEntry,
  UserMessageEntry,
  AssistantMessageEntry,
  ToolUseEntry,
  ToolResultEntry,
  SystemReminderEntry,
  RotCategory,
} from './types';
