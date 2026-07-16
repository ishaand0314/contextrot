# contextrot

Measure how much of your AI agent session's context window is live signal versus rot.

[![npm version](https://img.shields.io/npm/v/contextrot.svg)](https://www.npmjs.com/package/contextrot)
[![CI](https://github.com/ishaand0314/contextrot/actions/workflows/ci.yml/badge.svg)](https://github.com/ishaand0314/contextrot/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-source--available-blue.svg)](./LICENSE)

## Why this exists

Long-running coding agent sessions accumulate cruft. A file gets read, then read again a dozen turns later because the agent forgot it already had the contents. A tool result sits in the transcript long after the edit that made it stale. A system reminder repeats the same warning every few turns. A todo-list snapshot gets re-sent every time one item changes state, leaving the old snapshots behind.

None of this is a bug in any single tool call. Each read, each reminder, each snapshot is reasonable on its own. The problem is cumulative: none of it gets removed, so it all stays resident in the context window, quietly competing with the code and instructions that actually matter for the model's attention. Eventually the session hits compaction, history gets summarized or dropped, and the agent loses track of things it "knew" a few turns earlier.

contextrot reads a session transcript and tells you how much of it is dead weight. It classifies every entry into a rot category or marks it as live, reports token totals per category, and projects roughly how many turns remain before the context window fills up at the current rate. Point it at a real transcript to see where the tokens are going, or use it in CI to fail a build when a session's rot percentage crosses a threshold.

## Quick Start

```
npx contextrot --demo
```

This runs contextrot against a bundled sample transcript so you can see the report format without pointing it at your own data.

## Installation

Run it directly with npx, no install required:

```
npx contextrot --demo
```

Or install it globally:

```
npm install -g contextrot
```

Or add it as a dev dependency for use in scripts or CI:

```
npm install --save-dev contextrot
```

Requires Node.js 20 or later.

## Usage

```
Usage: contextrot [options]

Analyzes an AI agent session transcript and reports how much of the context
window is live signal versus rot.

Options:
  -V, --version    output the current version
  --demo           use the bundled demo transcript
  --file <path>    path to a Claude Code JSONL transcript or a generic JSON
                   array transcript
  --model <name>   model name, used to look up the context window size (default:
                   "claude-sonnet-5")
  --json           output the report as JSON
  --markdown       output the report as Markdown
  --threshold <n>  exit with status 1 if rot percentage exceeds n
  -h, --help       display help for command
```

If you pass neither `--demo` nor `--file`, contextrot looks for the most recently modified Claude Code session transcript under `~/.claude/projects` and analyzes that. If it can't find one, it exits with an error telling you to pass `--demo` or `--file`.

## Examples

### Demo data

See the report format without any transcript of your own:

```
npx contextrot --demo
```

Sample output:

```
Context rot report

Total tokens: 3,757
Live: 1,386 tokens (36.9%)
Rot:  2,371 tokens (63.1%)

Breakdown by category:
  Duplicate reads            count   1  tokens 0
  Superseded reads           count   6  tokens 781
  Repeated tool calls        count   1  tokens 0
  Dead system reminders      count   3  tokens 93
  Unreferenced large output  count   1  tokens 1,380
  Stale todo snapshots       count   2  tokens 117

Top offenders:
  1. [Unreferenced large output] 1,380 tokens, Bash result
  2. [Superseded reads] 174 tokens, Edit result (src/rateLimiter.test.ts)
  ...

Projection: at this rate, roughly 783 turns until compaction (context window 1.9% used).
```

### A real transcript

Point `--file` at a Claude Code session's `.jsonl` file:

```
npx contextrot --file ~/.claude/projects/my-project/some-session.jsonl
```

`--file` also accepts a generic JSON array of turns, for transcripts from other agent tools. See [Library usage](#library-usage) for the shape contextrot expects.

### JSON output for scripting

```
npx contextrot --demo --json
```

This prints the full analysis report (token totals, per-category breakdown, top offenders, and the projection) as a single JSON object, suitable for piping into `jq` or another script.

### CI gating on a rot threshold

```
npx contextrot --file ./session.jsonl --threshold 40
```

If the transcript's rot percentage exceeds 40, contextrot exits with status 1. Use this in a CI step to catch sessions that are accumulating too much dead weight before they get committed as fixtures or shared as examples.

## Rot categories

contextrot classifies each transcript entry into at most one category. Categories are checked in a fixed priority order, so an entry that matches more than one rule is counted under whichever check runs first.

- **Duplicate reads.** The same file gets read more than once with no edit or write to that file in between. The first read is live; every read after it is rot, because the agent already had the contents.
- **Superseded reads.** A file gets read, and later in the transcript that same file is written or edited. The earlier read is now describing contents that no longer exist, so it's counted as rot even though it wasn't a duplicate at the time.
- **Repeated tool calls.** The same tool gets called again with the same input, with no state-changing call (a write, an edit, or a shell command) happening in between. If nothing changed, the second call can't have learned anything new.
- **Dead system reminders.** A system-injected reminder repeats with the same general content as an earlier one. Only the most recent reminder of a given kind is live; earlier copies are rot.
- **Stale todo snapshots.** A specific case of dead system reminders: when the repeated content looks like a todo list (checkboxes or status fields), it's labeled separately so you can see how much of the rot is todo-list churn specifically.
- **Unreferenced large output.** A large tool result (roughly 800 tokens or more) that never gets quoted or referenced again later in the transcript. It's taking up space but nothing downstream depends on it.

Everything above is heuristic. Transcripts are messy, and the goal is a useful signal about where tokens are going, not a provably exact classification of every entry.

## Library usage

contextrot's parsing, classification, and analysis logic is available as a library, independent of the CLI.

```typescript
import { analyze, parseClaudeCodeTranscript, project } from 'contextrot';
import * as fs from 'fs';

const raw = fs.readFileSync('session.jsonl', 'utf-8');
const entries = parseClaudeCodeTranscript(raw);

const report = analyze(entries);
console.log(`${report.rotPercentage.toFixed(1)}% rot`);

const projection = project(report, 200_000, entries.length);
console.log(`~${projection.turnsRemaining} turns until compaction`);
```

Other exports include `parseGenericTranscript` (for a plain JSON array of turns), `classify` (the lower-level per-entry classifier `analyze` builds on), `MODEL_CONTEXT_WINDOWS` and `DEFAULT_CONTEXT_WINDOW` (known model context sizes), `DEMO_TRANSCRIPT` (the same sample data behind `--demo`), and the `TranscriptEntry`, `RotCategory`, `AnalysisReport`, and `ProjectionResult` types.

## Requirements and license

contextrot requires Node.js 20 or later.

This project is source-available, not open source. You may install and run the published npm package for any purpose, including commercial use. Forking, redistributing, or creating derivative works from this repository's source is not permitted without written permission from the copyright holder. See [LICENSE](./LICENSE) for the full terms.
