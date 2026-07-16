import type { TranscriptEntry } from './types';

/**
 * A bundled, fully offline synthetic Claude Code-style agent session,
 * hand-written to depict a realistic bug-fix task: hardening a sliding-window
 * rate limiter against a burst-at-window-boundary bug, then adding a
 * regression test and a couple of small follow-up fixes.
 *
 * This dataset intentionally exercises every `RotCategory` at least once so
 * `contextrot --demo` has something interesting to show without requiring a
 * real transcript file:
 *
 *   - duplicate-read:          `src/rateLimiter.ts` is read twice back to
 *                               back with no edit in between (entries 3 and
 *                               13).
 *   - superseded-read:         `src/server.ts` is read, then later edited,
 *                               leaving the earlier read stale (entries 19
 *                               and 31).
 *   - repeated-tool-call:      the same `Grep` call for "RateLimiter" is
 *                               re-run verbatim with no state change in
 *                               between (entries 9 and 11).
 *   - dead-system-reminder:    an "environment info" reminder kind repeated
 *                               4x as the session progresses (entries 0, 15,
 *                               29, 45 -- only the last stays live).
 *   - stale-todo-snapshot:     a todo-list-shaped system reminder evolving
 *                               3x over the session (entries 2, 23, 43 --
 *                               only the last stays live).
 *   - unreferenced-large-output: a large `npm test` failure log (>800
 *                               tokens) that is skimmed once and never
 *                               quoted again (entry 17).
 */
export const DEMO_TRANSCRIPT: TranscriptEntry[] = [
  // --- 0: dead-system-reminder (kind #1 of 4: "environment info") ---------
  {
    type: 'system_reminder',
    role: 'system',
    content:
      'Environment info (session snapshot): cwd is /home/dev/projects/api-gateway, git branch is main, 0 files staged.',
    timestamp: '2026-07-10T14:02:01.000Z',
  },

  // --- 1: user message -----------------------------------------------------
  {
    type: 'user_message',
    role: 'user',
    content:
      "We're seeing intermittent 429s slip through under load even though the rate limiter should be blocking them. Users report bursts of requests right at the top of a new minute get through way over the limit. Can you look at src/rateLimiter.ts and figure out what's going on?",
    timestamp: '2026-07-10T14:02:05.000Z',
  },

  // --- 2: stale-todo-snapshot (kind #1 of 3) --------------------------------
  {
    type: 'system_reminder',
    role: 'system',
    content:
      '[{"content":"Reproduce the burst-at-window-boundary bug","status":"pending"},{"content":"Read rateLimiter.ts and understand the windowing logic","status":"pending"},{"content":"Fix the boundary bug","status":"pending"},{"content":"Add a regression test","status":"pending"}]',
    timestamp: '2026-07-10T14:02:06.000Z',
  },

  // --- 3: duplicate-read pair, first (live) read of rateLimiter.ts ---------
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Read',
    toolUseId: 'tu_001',
    filePath: 'src/rateLimiter.ts',
    timestamp: '2026-07-10T14:02:10.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Read',
    toolUseId: 'tu_001',
    filePath: 'src/rateLimiter.ts',
    content:
      "export class RateLimiter {\n  private hits = new Map<string, number[]>();\n  constructor(private readonly limit: number, private readonly windowMs: number) {}\n\n  private currentWindowStart(now: number): number {\n    return Math.floor(now / this.windowMs) * this.windowMs;\n  }\n\n  allow(key: string, now: number = Date.now()): boolean {\n    const windowStart = this.currentWindowStart(now);\n    const timestamps = this.hits.get(key) ?? [];\n    const inWindow = timestamps.filter((t) => t >= windowStart);\n    if (inWindow.length >= this.limit) {\n      this.hits.set(key, inWindow);\n      return false;\n    }\n    inWindow.push(now);\n    this.hits.set(key, inWindow);\n    return true;\n  }\n}\n",
    timestamp: '2026-07-10T14:02:10.500Z',
  },

  // --- 5: assistant reasons about the bug ----------------------------------
  {
    type: 'assistant_message',
    role: 'assistant',
    content:
      "Found it. `currentWindowStart` snaps to fixed-size buckets aligned to epoch time, not a rolling window from each request. So a client can send `limit` requests in the last millisecond of one bucket, then immediately send `limit` more in the first millisecond of the next bucket -- that's 2x the limit in a couple of milliseconds, which matches the burst reports. This is the classic fixed-window counter problem; a sliding window (or sliding-window log with a rolling cutoff) fixes it. Let me check how the limiter is wired up in the server first.",
    timestamp: '2026-07-10T14:02:22.000Z',
  },

  // --- 6: grep for RateLimiter usage (first, live) -------------------------
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Grep',
    toolUseId: 'tu_002',
    filePath: 'RateLimiter',
    timestamp: '2026-07-10T14:02:23.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Grep',
    toolUseId: 'tu_002',
    content: 'src/server.ts:12:import { RateLimiter } from \'./rateLimiter\';\nsrc/server.ts:18:const limiter = new RateLimiter(100, 60_000);\nsrc/rateLimiter.test.ts:3:import { RateLimiter } from \'../src/rateLimiter\';',
    timestamp: '2026-07-10T14:02:23.400Z',
  },

  // --- 8: assistant message between the two identical Grep calls -----------
  {
    type: 'assistant_message',
    role: 'assistant',
    content: 'Three call sites. Let me double check I got the full picture -- re-running that search to be sure nothing scrolled past.',
    timestamp: '2026-07-10T14:02:24.000Z',
  },

  // --- 9: repeated-tool-call, second identical Grep call -------------------
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Grep',
    toolUseId: 'tu_003',
    filePath: 'RateLimiter',
    timestamp: '2026-07-10T14:02:24.500Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Grep',
    toolUseId: 'tu_003',
    content: 'src/server.ts:12:import { RateLimiter } from \'./rateLimiter\';\nsrc/server.ts:18:const limiter = new RateLimiter(100, 60_000);\nsrc/rateLimiter.test.ts:3:import { RateLimiter } from \'../src/rateLimiter\';',
    timestamp: '2026-07-10T14:02:24.900Z',
  },

  // --- 11: user nudges toward reproducing first ----------------------------
  {
    type: 'user_message',
    role: 'user',
    content: 'Good catch. Before you change anything, can you write a quick failing test that reproduces the boundary burst?',
    timestamp: '2026-07-10T14:02:40.000Z',
  },

  // --- 12: duplicate-read pair, second (rot) read of rateLimiter.ts --------
  // Re-reads the same file with no intervening edit -- classic
  // "re-orient before writing a test" duplicate read.
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Read',
    toolUseId: 'tu_004',
    filePath: 'src/rateLimiter.ts',
    timestamp: '2026-07-10T14:02:41.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Read',
    toolUseId: 'tu_004',
    filePath: 'src/rateLimiter.ts',
    content:
      "export class RateLimiter {\n  private hits = new Map<string, number[]>();\n  constructor(private readonly limit: number, private readonly windowMs: number) {}\n\n  private currentWindowStart(now: number): number {\n    return Math.floor(now / this.windowMs) * this.windowMs;\n  }\n\n  allow(key: string, now: number = Date.now()): boolean {\n    const windowStart = this.currentWindowStart(now);\n    const timestamps = this.hits.get(key) ?? [];\n    const inWindow = timestamps.filter((t) => t >= windowStart);\n    if (inWindow.length >= this.limit) {\n      this.hits.set(key, inWindow);\n      return false;\n    }\n    inWindow.push(now);\n    this.hits.set(key, inWindow);\n    return true;\n  }\n}\n",
    timestamp: '2026-07-10T14:02:41.400Z',
  },

  // --- 14: system reminder: environment info kind #2 (still dead later) ---
  {
    type: 'system_reminder',
    role: 'system',
    content:
      'Environment info (session snapshot): cwd is /home/dev/projects/api-gateway, git branch is main, 1 file modified (untracked test file pending).',
    timestamp: '2026-07-10T14:03:00.000Z',
  },

  // --- 15: assistant writes the failing test -------------------------------
  {
    type: 'assistant_message',
    role: 'assistant',
    content:
      "Writing a test that hammers the limiter right at a window boundary using a fake clock, so it doesn't flake on real timing.",
    timestamp: '2026-07-10T14:03:05.000Z',
  },
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Edit',
    toolUseId: 'tu_005',
    filePath: 'src/rateLimiter.test.ts',
    timestamp: '2026-07-10T14:03:10.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Edit',
    toolUseId: 'tu_005',
    filePath: 'src/rateLimiter.test.ts',
    content:
      "it('does not allow more than 2x the limit across a window boundary', () => {\n  const limiter = new RateLimiter(5, 1000);\n  const boundary = 60_000; // aligned to a 1000ms window edge\n  for (let i = 0; i < 5; i++) {\n    expect(limiter.allow('k', boundary - 1)).toBe(true);\n  }\n  expect(limiter.allow('k', boundary - 1)).toBe(false);\n  // Bug: the next bucket resets the counter to zero immediately, so a\n  // client can burst again 1ms later far above the intended rate.\n  for (let i = 0; i < 5; i++) {\n    expect(limiter.allow('k', boundary)).toBe(true);\n  }\n});",
    timestamp: '2026-07-10T14:03:10.600Z',
  },

  // --- 18: run the test suite, it fails with a big log ---------------------
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Bash',
    toolUseId: 'tu_006',
    content: 'npm test -- rateLimiter',
    timestamp: '2026-07-10T14:03:15.000Z',
  },
  // --- 19: unreferenced-large-output: full verbose test runner log (>800 tok)
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Bash',
    toolUseId: 'tu_006',
    content: `> api-gateway@1.4.2 test
> vitest run rateLimiter

 RUN  v4.1.10 /home/dev/projects/api-gateway

stdout | src/rateLimiter.test.ts
[vitest] preparing environment, mode=node, isolate=true, threads=4
[vitest] resolved config from vitest.config.ts: { environment: 'node', globals: false, testTimeout: 5000, hookTimeout: 10000 }
[vitest] loading setup files: none configured
[vitest] collecting test files matched by pattern "rateLimiter"
[vitest] matched files:
  - src/rateLimiter.test.ts
[vitest] transforming src/rateLimiter.test.ts via esbuild (target=node20, format=esm, sourcemap=inline)
[vitest] transform took 14ms, output size 2114 bytes
[vitest] resolving imports for src/rateLimiter.test.ts
[vitest]   -> ../src/rateLimiter (resolved to /home/dev/projects/api-gateway/src/rateLimiter.ts)
[vitest]   -> vitest (resolved to node_modules/vitest/dist/index.js)
[vitest] transforming src/rateLimiter.ts via esbuild (target=node20, format=esm, sourcemap=inline)
[vitest] transform took 6ms, output size 812 bytes
[vitest] starting worker pool with 4 threads (pool=threads, isolate=true)
[vitest] worker 0 booted in 41ms
[vitest] worker 0 executing suite "RateLimiter" (3 tests found)
[vitest]   test 1/3: "allows requests under the limit" -- scheduling
[vitest]   test 1/3: "allows requests under the limit" -- start
[vitest]   test 1/3: "allows requests under the limit" -- PASS (2ms)
[vitest]   test 2/3: "blocks requests over the limit within a window" -- scheduling
[vitest]   test 2/3: "blocks requests over the limit within a window" -- start
[vitest]   test 2/3: "blocks requests over the limit within a window" -- PASS (1ms)
[vitest]   test 3/3: "does not allow more than 2x the limit across a window boundary" -- scheduling
[vitest]   test 3/3: "does not allow more than 2x the limit across a window boundary" -- start
[vitest]   test 3/3: "does not allow more than 2x the limit across a window boundary" -- executing assertions
[vitest]     assertion 1/11: expect(limiter.allow('k', 59999)).toBe(true) -- PASS
[vitest]     assertion 2/11: expect(limiter.allow('k', 59999)).toBe(true) -- PASS
[vitest]     assertion 3/11: expect(limiter.allow('k', 59999)).toBe(true) -- PASS
[vitest]     assertion 4/11: expect(limiter.allow('k', 59999)).toBe(true) -- PASS
[vitest]     assertion 5/11: expect(limiter.allow('k', 59999)).toBe(true) -- PASS
[vitest]     assertion 6/11: expect(limiter.allow('k', 59999)).toBe(false) -- PASS
[vitest]     assertion 7/11: expect(limiter.allow('k', 60000)).toBe(true) -- FAIL

 FAIL  src/rateLimiter.test.ts > RateLimiter > does not allow more than 2x the limit across a window boundary
AssertionError: expected false to be true // Object.is equality

This assertion was inverted from what the test author intended while
drafting -- it actually demonstrates the bug (the call *does* return true,
proving the burst gets through), and the raw diagnostic trace below is kept
here only because the runner always dumps it, not because anyone needs to
read it: the fix is in the source, not the test.

 - Expected
 + Received

- true
+ false

  at /home/dev/projects/api-gateway/src/rateLimiter.test.ts:34:38
  at Proxy.<anonymous> (/home/dev/projects/api-gateway/node_modules/@vitest/runner/dist/index.js:158:17)
  at runTest (/home/dev/projects/api-gateway/node_modules/@vitest/runner/dist/index.js:938:17)
  at processTicksAndRejections (node:internal/process/task_queues:95:5)
  at runSuite (/home/dev/projects/api-gateway/node_modules/@vitest/runner/dist/index.js:1071:15)
  at runSuite (/home/dev/projects/api-gateway/node_modules/@vitest/runner/dist/index.js:1071:15)
  at runFiles (/home/dev/projects/api-gateway/node_modules/@vitest/runner/dist/index.js:1130:5)
  at startTests (/home/dev/projects/api-gateway/node_modules/@vitest/runner/dist/index.js:1149:3)
  at /home/dev/projects/api-gateway/node_modules/vitest/dist/chunks/runtime-runBaseTests.js:126:11
  at withEnv (/home/dev/projects/api-gateway/node_modules/vitest/dist/chunks/runtime-runBaseTests.js:79:5

[vitest] worker 0 finished suite "RateLimiter" in 19ms (2 passed, 1 failed)
[vitest] worker pool draining, 4 threads
[vitest] worker 0 exited cleanly
[vitest] worker 1 never received work, exiting idle
[vitest] worker 2 never received work, exiting idle
[vitest] worker 3 never received work, exiting idle
[vitest] coverage collection skipped (no --coverage flag)
[vitest] writing junit report skipped (no --reporter=junit)
[vitest] cache written to node_modules/.vite/vitest/results-v3.json (412 bytes)

 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
   Start at  14:03:15
   Duration  187ms (transform 20ms, setup 0ms, collect 41ms, tests 22ms, environment 0ms, prepare 83ms)

 ELIFECYCLE  Test failed. See above for more details.`,
    timestamp: '2026-07-10T14:03:15.900Z',
  },

  // --- 20: assistant skims the failure, doesn't quote the log --------------
  {
    type: 'assistant_message',
    role: 'assistant',
    content:
      "As expected, the third test fails: the boundary burst gets through (the assertion that it should be blocked returns true instead). That confirms the repro. Now let's look at how the server wires up the limiter before I touch the windowing logic, in case the fix needs a config change too.",
    timestamp: '2026-07-10T14:03:20.000Z',
  },

  // --- 21: superseded-read pair, the (later-stale) read of server.ts -------
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Read',
    toolUseId: 'tu_007',
    filePath: 'src/server.ts',
    timestamp: '2026-07-10T14:03:25.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Read',
    toolUseId: 'tu_007',
    filePath: 'src/server.ts',
    content:
      "import express from 'express';\nimport { RateLimiter } from './rateLimiter';\n\nconst app = express();\nconst limiter = new RateLimiter(100, 60_000);\n\napp.use((req, res, next) => {\n  const key = req.ip ?? 'unknown';\n  if (!limiter.allow(key)) {\n    res.status(429).json({ error: 'rate limit exceeded' });\n    return;\n  }\n  next();\n});\n\napp.listen(3000);\n",
    timestamp: '2026-07-10T14:03:25.400Z',
  },

  // --- 23: stale-todo-snapshot kind #2 of 3 (repro done, moving to fix) ----
  {
    type: 'system_reminder',
    role: 'system',
    content:
      '[{"content":"Reproduce the burst-at-window-boundary bug","status":"completed"},{"content":"Read rateLimiter.ts and understand the windowing logic","status":"completed"},{"content":"Fix the boundary bug","status":"in_progress"},{"content":"Add a regression test","status":"completed"}]',
    timestamp: '2026-07-10T14:03:30.000Z',
  },

  // --- 24: assistant explains and applies the fix --------------------------
  {
    type: 'assistant_message',
    role: 'assistant',
    content:
      "Config is fine, no changes needed there. I'll replace the fixed-bucket windowing with a true sliding window: instead of snapping to `Math.floor(now / windowMs) * windowMs`, keep a rolling log of hit timestamps per key and count only the ones within `windowMs` of `now`, regardless of bucket alignment.",
    timestamp: '2026-07-10T14:03:40.000Z',
  },
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Edit',
    toolUseId: 'tu_008',
    filePath: 'src/rateLimiter.ts',
    timestamp: '2026-07-10T14:03:45.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Edit',
    toolUseId: 'tu_008',
    filePath: 'src/rateLimiter.ts',
    content:
      "export class RateLimiter {\n  private hits = new Map<string, number[]>();\n  constructor(private readonly limit: number, private readonly windowMs: number) {}\n\n  allow(key: string, now: number = Date.now()): boolean {\n    const cutoff = now - this.windowMs;\n    const timestamps = this.hits.get(key) ?? [];\n    const inWindow = timestamps.filter((t) => t > cutoff);\n    if (inWindow.length >= this.limit) {\n      this.hits.set(key, inWindow);\n      return false;\n    }\n    inWindow.push(now);\n    this.hits.set(key, inWindow);\n    return true;\n  }\n}\n",
    timestamp: '2026-07-10T14:03:45.700Z',
  },

  // --- 27: user asks for confirmation the tests pass -----------------------
  {
    type: 'user_message',
    role: 'user',
    content: 'Nice, does the test suite pass now?',
    timestamp: '2026-07-10T14:04:00.000Z',
  },
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Bash',
    toolUseId: 'tu_009',
    content: 'npm test -- rateLimiter',
    timestamp: '2026-07-10T14:04:02.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Bash',
    toolUseId: 'tu_009',
    content:
      '> api-gateway@1.4.2 test\n> vitest run rateLimiter\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Start at  14:04:02\n   Duration  61ms',
    timestamp: '2026-07-10T14:04:02.400Z',
  },

  // --- 30: environment info kind #3 of 4 -----------------------------------
  {
    type: 'system_reminder',
    role: 'system',
    content:
      'Environment info (session snapshot): cwd is /home/dev/projects/api-gateway, git branch is main, 2 files modified (rateLimiter.ts, rateLimiter.test.ts).',
    timestamp: '2026-07-10T14:04:05.000Z',
  },

  // --- 31: assistant reports success, then goes back to server.ts ---------
  {
    type: 'assistant_message',
    role: 'assistant',
    content:
      "All 3 tests pass now. While I'm in here, let's also add a periodic sweep so `hits` doesn't grow unbounded for keys that stop making requests -- right now old timestamps for inactive keys just sit in the map forever.",
    timestamp: '2026-07-10T14:04:10.000Z',
  },
  {
    type: 'user_message',
    role: 'user',
    content: "Good idea. Also double check server.ts doesn't need updating for the new constructor signature.",
    timestamp: '2026-07-10T14:04:15.000Z',
  },

  // --- 33: the write that makes the earlier server.ts read stale -----------
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Edit',
    toolUseId: 'tu_010',
    filePath: 'src/server.ts',
    timestamp: '2026-07-10T14:04:20.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Edit',
    toolUseId: 'tu_010',
    filePath: 'src/server.ts',
    content:
      "import express from 'express';\nimport { RateLimiter } from './rateLimiter';\n\nconst app = express();\n// Constructor signature is unchanged (limit, windowMs); no call-site update needed.\nconst limiter = new RateLimiter(100, 60_000);\n\napp.use((req, res, next) => {\n  const key = req.ip ?? 'unknown';\n  if (!limiter.allow(key)) {\n    res.status(429).json({ error: 'rate limit exceeded' });\n    return;\n  }\n  next();\n});\n\napp.listen(3000);\n",
    timestamp: '2026-07-10T14:04:20.600Z',
  },

  // --- 35: assistant adds the sweep to rateLimiter.ts ----------------------
  {
    type: 'assistant_message',
    role: 'assistant',
    content:
      'Confirmed -- constructor signature is unchanged so server.ts only needed a clarifying comment. Now adding a `sweep()` method plus a `setInterval` hook so stale per-key entries get pruned periodically.',
    timestamp: '2026-07-10T14:04:30.000Z',
  },
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Edit',
    toolUseId: 'tu_011',
    filePath: 'src/rateLimiter.ts',
    timestamp: '2026-07-10T14:04:35.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Edit',
    toolUseId: 'tu_011',
    filePath: 'src/rateLimiter.ts',
    content:
      "  sweep(now: number = Date.now()): void {\n    const cutoff = now - this.windowMs;\n    for (const [key, timestamps] of this.hits) {\n      const remaining = timestamps.filter((t) => t > cutoff);\n      if (remaining.length === 0) this.hits.delete(key);\n      else this.hits.set(key, remaining);\n    }\n  }\n",
    timestamp: '2026-07-10T14:04:35.500Z',
  },

  // --- 38: run full suite once more to confirm everything is green --------
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Bash',
    toolUseId: 'tu_012',
    content: 'npm test',
    timestamp: '2026-07-10T14:04:40.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Bash',
    toolUseId: 'tu_012',
    content:
      '> api-gateway@1.4.2 test\n> vitest run\n\n Test Files  4 passed (4)\n      Tests  22 passed (22)\n   Start at  14:04:40\n   Duration  340ms',
    timestamp: '2026-07-10T14:04:40.500Z',
  },

  // --- 40: assistant updates README to document the sweep ------------------
  {
    type: 'assistant_message',
    role: 'assistant',
    content: "All green. Let me add a line to README.md documenting the sweep so it doesn't look like dead code later.",
    timestamp: '2026-07-10T14:04:45.000Z',
  },
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Read',
    toolUseId: 'tu_013',
    filePath: 'README.md',
    timestamp: '2026-07-10T14:04:46.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Read',
    toolUseId: 'tu_013',
    filePath: 'README.md',
    content:
      '# api-gateway\n\nA small Express gateway with per-IP rate limiting.\n\n## Rate limiting\n\n`RateLimiter(limit, windowMs)` allows up to `limit` requests per key in any\nrolling `windowMs` window.\n',
    timestamp: '2026-07-10T14:04:46.300Z',
  },
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Edit',
    toolUseId: 'tu_014',
    filePath: 'README.md',
    timestamp: '2026-07-10T14:04:48.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Edit',
    toolUseId: 'tu_014',
    filePath: 'README.md',
    content:
      '# api-gateway\n\nA small Express gateway with per-IP rate limiting.\n\n## Rate limiting\n\n`RateLimiter(limit, windowMs)` allows up to `limit` requests per key in any\nrolling `windowMs` window. Call `sweep()` periodically (e.g. from a\n`setInterval`) to prune stale per-key entries for keys that stopped sending\nrequests, so memory use stays bounded over long-running processes.\n',
    timestamp: '2026-07-10T14:04:48.400Z',
  },

  // --- 45: stale-todo-snapshot kind #3 of 3 (final, live) ------------------
  {
    type: 'system_reminder',
    role: 'system',
    content:
      '[{"content":"Reproduce the burst-at-window-boundary bug","status":"completed"},{"content":"Read rateLimiter.ts and understand the windowing logic","status":"completed"},{"content":"Fix the boundary bug","status":"completed"},{"content":"Add a regression test","status":"completed"},{"content":"Add a sweep() to bound memory for inactive keys","status":"completed"},{"content":"Document sweep() in README","status":"completed"}]',
    timestamp: '2026-07-10T14:04:50.000Z',
  },

  // --- 46: environment info kind #4 of 4 (final, live) ---------------------
  {
    type: 'system_reminder',
    role: 'system',
    content:
      'Environment info (session snapshot): cwd is /home/dev/projects/api-gateway, git branch is main, 3 files modified (rateLimiter.ts, rateLimiter.test.ts, server.ts), 1 file modified (README.md).',
    timestamp: '2026-07-10T14:04:51.000Z',
  },

  // --- 47: assistant wraps up ------------------------------------------------
  {
    type: 'assistant_message',
    role: 'assistant',
    content:
      "Summary: the rate limiter used fixed epoch-aligned buckets, so a client could burst up to 2x the limit across a bucket boundary. Switched to a true rolling window (filter by `now - windowMs` cutoff instead of bucket snapping), added a `sweep()` method to bound memory for inactive keys, added a regression test that pins the boundary behavior, and documented `sweep()` in the README. Full suite is green (22/22).",
    timestamp: '2026-07-10T14:04:55.000Z',
  },

  // --- 48: user asks one more thing -----------------------------------------
  {
    type: 'user_message',
    role: 'user',
    content: 'Perfect, thank you. One last thing -- can you check rateLimiter.test.ts has a test for the sweep() method too?',
    timestamp: '2026-07-10T14:05:00.000Z',
  },
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Grep',
    toolUseId: 'tu_015',
    filePath: 'sweep',
    timestamp: '2026-07-10T14:05:02.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Grep',
    toolUseId: 'tu_015',
    content: 'No matches found in src/rateLimiter.test.ts',
    timestamp: '2026-07-10T14:05:02.300Z',
  },
  {
    type: 'assistant_message',
    role: 'assistant',
    content: "Good catch, there isn't one yet. I'll add a test that ages out an inactive key and asserts sweep() removes it from the internal map size.",
    timestamp: '2026-07-10T14:05:05.000Z',
  },
  {
    type: 'tool_use',
    role: 'assistant',
    toolName: 'Edit',
    toolUseId: 'tu_016',
    filePath: 'src/rateLimiter.test.ts',
    timestamp: '2026-07-10T14:05:10.000Z',
  },
  {
    type: 'tool_result',
    role: 'tool',
    toolName: 'Edit',
    toolUseId: 'tu_016',
    filePath: 'src/rateLimiter.test.ts',
    content:
      "it('sweep() prunes entries for keys with no recent hits', () => {\n  const limiter = new RateLimiter(5, 1000);\n  limiter.allow('stale-key', 0);\n  limiter.sweep(5000);\n  expect(limiter.allow('stale-key', 5000)).toBe(true);\n});",
    timestamp: '2026-07-10T14:05:10.500Z',
  },
];
