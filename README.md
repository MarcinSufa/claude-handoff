# claude-handoff

> **Clean-context handoff for Claude Code.** Move the current session into a fresh-context session with zero information loss, in both the terminal CLI and the Cursor / VS Code extension.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Plugin](https://img.shields.io/badge/Claude%20Code-plugin-purple.svg)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macOS%20%7C%20linux-lightgrey.svg)](#limits)

Native `/compact` summarizes detail away. This plugin makes the context self-managing instead: when a session grows past the save threshold, a `Stop` hook refuses to end the turn until the agent has written a structured working-state document; a `PreCompact` hook lets auto-compaction through only once that document is fresh; and after the compaction the `SessionStart` hook re-seeds the session from the document, which outranks the lossy summary. No typing from you. `/handoff` remains the manual path: the agent writes the same document, then asks you to type `/clear` (same session, clean context) or, on request, opens a genuinely new session, wakes it with a cross-session message, and names its tab after the topic. A `PostToolUse` hook watches your context size and your 5-hour rate-limit usage as the early signal.

## How it works

**Automatic flow (default, no typing):**

1. **Stop guard.** At the end of every turn `hooks/stop-context-guard.cjs` reads the newest assistant `usage` line of this session from the transcript. Above the save threshold (`150000` tokens) with no fresh snapshot for this session, it returns `{"decision":"block"}` with the token count and the instruction to save; the agent cannot end the turn until it has. Two blocks per session and compaction epoch at most (45 s floor), then it fails open so a session is never stranded.
2. **Save.** The agent authors nine fields (goal, specifics, state, next step, constraints, gotchas, open questions, keep-on-fail facts, verify commands) plus a short title and pipes them to `tools/handoff.cjs` with `spawn: "compact"`. Secrets are redacted, then the document goes to `.claude/handoff/auto/<session id>/HANDOFF.md` with an atomic marker beside it (`resumeMode: "compact"`, session id, compaction epoch, `tokensAtSave`). Nothing is spawned, no registry entry, and the agent simply continues: "State saved to <doc>. Compaction will reset the context; continue."
3. **Auto-compact.** `hooks/precompact-guard.cjs` lets compaction (auto or manual) through only when that marker exists for this session and epoch and is not stale (`tokensNow - tokensAtSave <= 40000`); otherwise it exits 2 asking to save or refresh the state. Refusals are capped at two per epoch; the third logs `fallback:native-compaction` and passes.
4. **Re-seed.** After the compaction the `SessionStart` hook (`startup_reason`/`source` `compact`) bumps the per-session baseline, then, if the marker is owned by this session and fresh, injects a pointer saying the summary above is lossy and `auto/<session id>/HANDOFF.md` is authoritative, auto-sends the first message ("read it now, continue from Next step within the authorization you already had"), and consumes the marker. A marker of another session, or a stale one, is left alone.

**Manual flow (`/handoff`):**

1. **Capture.** Same nine fields; `tools/handoff.cjs` writes `.claude/handoff/HANDOFF.md` and an atomic single-shot marker next to it, in the TARGET project.
2. **Clear.** With `spawn: "clear"` the marker carries `resumeMode: "clear"` and the session id, nothing is spawned, and the agent relays "State saved to <doc>. Type /clear; I will continue from Next step." When you type `/clear`, the `SessionStart` hook (source `clear`) consumes that marker, injects a "same session, context was cleared" pointer, and auto-sends the first message naming `HANDOFF.md`. A startup, fork, compaction or another tab never consumes a clear-mode marker.
3. **Spawn (opt-in).** Mode `same-window` fires the editor URI (`cursor://anthropic.claude-code/open`, scheme via `HANDOFF_URI_SCHEME`) immediately, no window focus, no delay, so it lands in whichever window the user is already talking to; the new session starts there and is told to `EnterWorktree` into the target before reading the handoff (or, when the current window's folder is not a git repository, to work on absolute paths under the target root instead). `window` opens the target in a new editor window and waits (poll, up to ~15 s on Windows) for it to become the foreground window before firing the URI. `terminal` opens a new terminal running `claude` in the target. `uri-target` keeps the old focus-then-URI behavior. `none` just prints an instruction. Every mode but `none` also writes an entry to the pending registry (`~/.claude/handoff/pending/`) so the resume hook can find the marker from whichever window the new session actually starts in.
4. **Resume.** The fresh session's `SessionStart` hook first checks for a local pending marker at its own cwd; if there isn't one, it looks itself up in the registry by cwd. Either way it injects a pointer to `HANDOFF.md`, auto-sends the first message and consumes the marker. Sessions without a marker or a matching registry entry are untouched and the hook never re-fires.
5. **Wake.** The old session locates the fresh one by its name prefix, sends it the resume message, and tells you to close the old tab.
6. **Name.** The new tab is titled `<topic> #<n>`, where `n` is a generation counter bumped from the previous handoff in that project.

## Install

**A. As a plugin (recommended)**

```bash
claude plugin marketplace add MarcinSufa/claude-handoff
claude plugin install handoff@claude-handoff
```

Restart Claude Code. The plugin's `hooks/hooks.json` wires all four hooks (`SessionStart` resume, `PostToolUse` auto-trigger, `Stop` guard, `PreCompact` interlock). Recommended: `"autoCompactWindow": 200000` in `~/.claude/settings.json`, so that the save threshold (`150000`) sits at or below 0.75 × the window and the state is saved before Claude Code compacts. The plugin never writes that setting; set `HANDOFF_AUTOCOMPACT_WINDOW` to the same value and the Stop guard warns on stderr when the threshold leaves no headroom.

**B. As a plain skill**

```bash
git clone https://github.com/MarcinSufa/claude-handoff ~/.claude/skills/handoff
```

Restart Claude Code. If the hooks do not fire in your setup, wire them into `~/.claude/settings.json` once:

```bash
node ~/.claude/skills/handoff/tools/install.cjs
```

The installer is idempotent, keeps a temporary backup of `settings.json` (file mode 0600 on POSIX; plain file on Windows) that is deleted on success and preserves any existing hooks, so it works alongside other `SessionStart` hooks. Restart Claude Code afterwards.

## Usage

Nothing, by default. The Stop guard makes the agent save its state once the context passes the save threshold, auto-compaction resets the context, and the session continues from the saved document. You will see "State saved to `<doc>`. Compaction will reset the context; continue." and, after the compaction, the agent reading `auto/<session id>/HANDOFF.md` and carrying on.

Type `/handoff` (or "hand off", "fresh session", "clean context", "continue in a new session") to take the manual path instead, for instance when a compaction summary looks wrong or you want a clean start now. The agent authors the working state, refuses if it cannot name a goal and a next step, runs the glue and tells you: **"State saved to `<doc>`. Type /clear; I will continue from Next step."** Typing `/clear` is the one manual step; the same session resumes from the document.

Ask for "a new tab", "a separate window" or "a terminal" to get a fresh session instead: the agent then wakes it and tells you **"Handoff is ready in the fresh session `<title>`, close this one to finish."**

Name the current session as soon as its topic is clear, so the tab is findable among many:

```bash
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/handoff}/tools/session-title.cjs" "<topic in 2-4 words>"
```

Do not append `#n` by hand; the handoff glue owns the generation counter.

## Auto-trigger

Enabled by default. The context size is measured from the newest assistant `usage` line of this session in `transcript_path` (`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`), read from the file tail with a growing window (64 KB to 4 MB cap), skipping sidechain lines and other sessions. Usage written before the last `/clear` or compaction is ignored (`.claude/handoff/.context-baseline.<session id>.json`, one epoch per reset).

- **`Stop` guard** (`hooks/stop-context-guard.cjs`): above the save threshold with no fresh snapshot, blocks the end of the turn with the save instruction; with a snapshot older than `HANDOFF_STALE_TOKENS` it asks for a refresh. Two blocks per session and epoch, 45 s floor, then fail-open. Honours `stop_hook_active`, ignores every other hook event, and stays silent on a missing transcript or malformed input.
- **`PreCompact` interlock** (`hooks/precompact-guard.cjs`): exits 0 with a fresh snapshot for this session and epoch (or `HANDOFF_ALLOW_COMPACT=1`), else exits 2 with the save/refresh instruction on stderr, for `auto` and `manual` alike. Two refusals per epoch; the third appends `fallback:native-compaction` to the context log and passes. Malformed input exits 0.
- **`PostToolUse` tripwire** (`hooks/usage-monitor.cjs`): the early signal. Nudges once per level, per session and per epoch on two independent signals: the context size at the save (`150000`) and urgent (`180000`) thresholds, and the 5-hour rate limit (`rate_limits.five_hour.used_percentage`). It cannot author the state, so it tells the agent to run `tools/handoff.cjs` with `spawn: "compact"`. It also appends one line per new usage offset to `.claude/handoff/context-log.ndjson` (`ts, sid, epoch, offset, tokens, cacheRead, cacheCreation, event`; capped at 5 MB) for the live acceptance trace. Where `rate_limits` is absent (older Claude Code, non Pro/Max plans) or `transcript_path` is unreadable, that signal silently no-ops. It never blocks a tool call.

| Variable | Default | Accepts |
| --- | --- | --- |
| `HANDOFF_CONTEXT_SAVE_TOKENS` | `150000` | a number or `disabled`; the Stop guard and the tripwire's save level |
| `HANDOFF_CONTEXT_URGENT_TOKENS` | `180000` | a number or `disabled`; the tripwire's urgent level |
| `HANDOFF_STALE_TOKENS` | `40000` | how far past `tokensAtSave` a snapshot still counts as fresh |
| `HANDOFF_AUTOCOMPACT_WINDOW` | unset | your `autoCompactWindow`; the Stop guard warns on stderr when the save threshold exceeds 0.75 × it |
| `HANDOFF_ALLOW_COMPACT` | unset | `1` lets the `PreCompact` interlock through for that session |
| `HANDOFF_AUTO_SAVE_PERCENT` | `90` | a number (e.g. `85`) or `disabled` |
| `HANDOFF_URGENT_PERCENT` | `95` | a number or `disabled` |

**Thin coordinator.** The reset is the safety net, not the plan. A driving session that bulk-reads and delegates to workers stays small and rarely reaches the threshold; a session that does the reading and the editing itself will reach it every hour, and each save costs a turn. Keep the driver thin; let the guard catch the exceptions.

Spawn modes (input JSON field `spawn`, overrides `HANDOFF_SPAWN`; the skill passes `compact` on the automatic path, `clear` for a manual `/handoff`, and a spawning mode only when you ask for a new session; the glue's own fallback is `same-window`):

| Mode | Default | New session starts in | Behavior |
| --- | --- | --- | --- |
| `compact` | automatic path | (same session, after auto-compaction) | Writes `.claude/handoff/auto/<session id>/HANDOFF.md` and a `resumeMode: "compact"` marker beside it (session id, epoch, `tokensAtSave` from `CLAUDE_CODE_TRANSCRIPT_PATH` or the input field `transcriptPath`), spawns nothing, writes no registry entry, returns "State saved to <doc>. Compaction will reset the context; continue." The `SessionStart` hook re-seeds on `compact` only, for that session only. |
| `clear` | manual `/handoff` | (same session) | Writes the doc and a `resumeMode: "clear"` marker, spawns nothing, writes no registry entry, returns "State saved to <doc>. Type /clear; I will continue from Next step." The `SessionStart` hook resumes on `source: "clear"` only. |
| `same-window` | glue | caller window's folder (`callerCwd`) | Fires the URI immediately: no focus, no delay. Lands in whatever window the user is talking to. The first message tells the session to `EnterWorktree` into the target, then read the handoff. |
| `window` | | target folder | Opens the target in a new editor window (`<editor> -n <targetCwd>`), waits for it to become the foreground window (poll, ~15 s timeout on Windows; fires the URI regardless and reports `focused: false` on timeout), then fires the URI. |
| `terminal` | | target folder | Opens a new terminal running `claude` in the target (win32: `wt.exe -d <targetCwd> claude`, required to report a process id). |
| `none` | | (nothing spawned) | Prints an instruction; no registry entry is written. |
| `uri-target` | | last-focused editor window | Legacy behavior: focuses the target folder, waits, then fires the URI. `HANDOFF_SPAWN=auto` and `=uri` are old names that map onto this mode. |

| Variable | Default | Meaning |
| --- | --- | --- |
| `HANDOFF_SPAWN` | `same-window` | see the modes table above (`compact` and `clear` included) |
| `HANDOFF_URI_SCHEME` | `cursor` | URI scheme used to open the extension (`vscode` for VS Code) |
| `HANDOFF_EDITOR_EXE` | auto-detected | editor binary used to focus or open the project window |
| `HANDOFF_TERMINAL_EXE` | auto-detected (win32: `%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe` when it exists, else `wt.exe`) | terminal binary used by `terminal` mode |
| `HANDOFF_HOME` | `~/.claude/handoff` | root of the pending registry (`<HANDOFF_HOME>/pending/<sha1 of the target folder>.json`) that lets the resume hook find a same-window handoff's marker from the caller window |

## Verified live

Unit tests cover the openers; these runs cover the parts only a real desktop can show.

| Mode | Date | Result |
| --- | --- | --- |
| `same-window` | 2026-09-11 | 3 of 3 handoffs landed in the calling window and resumed from the local marker. |
| `window` | 2026-09-12 | 6 sequential handoffs from one window; each opened its own editor window on its own target folder and resumed there. |
| `terminal` | 2026-09-12 | `wt.exe` opened with `claude` running and the workspace reported as `targetCwd`. The run stopped at Claude Code's folder-trust prompt, so the hook leg was not exercised in this mode. |

The resume hook reads only the target's local marker and the pending registry, so it behaves the same whichever mode launched the session.

## Limits

- **A target folder Claude Code does not already trust stops `terminal` mode at the trust prompt.** The terminal opens in the right folder and `claude` starts, then waits for a person to accept the folder before any session, and therefore any hook, begins. Handing off inside a project you already work in is unaffected; a brand new worktree needs that one answer.

- **The Stop guard fires at the end of a turn.** A long tool loop can cross the auto-compact window before any turn ends; the `PreCompact` interlock then refuses twice and passes on the third attempt, so a compaction can still happen without a save. Keep the save threshold at or below 0.75 × `autoCompactWindow` (the guard warns otherwise) and keep the coordinator thin.
- **On the manual path `/clear` is typed by you.** No API clears a session from a hook; the agent saves and asks. In the spawning modes the old tab likewise stays open until you close it.
- **Two sessions in one repository keep separate automatic snapshots** (`auto/<session id>/`), but share the manual `.claude/handoff/HANDOFF.md`.
- **Two handoffs within about 20 seconds of each other can still land in the wrong tab.** Spawns are not queued, by design; if that happens, the next tab you open in the target project resumes the handoff from the pending marker regardless.
- **Extension plugin loading is not officially documented.** Path A is expected to work in the extension as it does in the CLI, but only path B (copy into `~/.claude/skills` plus `install.cjs`) has been verified there.
- The handoff doc is the agent's own prior notes. It never auto-runs the `verify` or `nextStep` commands; verify against the live repo before destructive actions.
- The first message of the fresh session starts with the title stored in the pending marker (sanitized to 60 characters of letters, digits, spaces and `._#-`). The marker is written by your own agent, `.claude/handoff/` is added to the project's `.gitignore` so it never comes from a cloned repository, and registry entries under `HANDOFF_HOME` carry no secrets, only paths and the title.

## Development

Zero runtime dependencies; tests use the built-in `node:test` runner.

```bash
node --test tools/__tests__/*.test.cjs
```

On Node 24, `node --test <dir>` mis-resolves; always pass the glob as shown.

```
SKILL.md                         skill definition (root-level single skill)
.claude-plugin/                  plugin.json + marketplace.json
hooks/
  hooks.json                     plugin hook wiring (SessionStart + PostToolUse + Stop + PreCompact)
  sessionstart-handoff.cjs       resume hook (baseline on clear/compact, compact re-seed, clear-mode and legacy markers, registry)
  usage-monitor.cjs              PostToolUse tripwire (context size + rate limit) and context log
  stop-context-guard.cjs         Stop guard (block above the save threshold until a fresh snapshot exists)
  precompact-guard.cjs           PreCompact interlock (pass only with a fresh snapshot or HANDOFF_ALLOW_COMPACT=1)
tools/
  handoff.cjs                    entry: capture, redact, write, spawn, --respawn
  capture.cjs / handoff-format.cjs / marker.cjs / redact.cjs / memory.cjs
  paths.cjs / spawn-tab.cjs / session-title.cjs
  registry.cjs                   pending registry (~/.claude/handoff/pending/)
  handoff-messages.cjs           resume message + URI prompt text, per spawn mode
  usage-threshold.cjs / usage-flag.cjs   auto-trigger logic (pure) + per-session flag, baseline and deny counter
  context-tokens.cjs / transcript-tail.cjs / context-state.cjs   context size from the transcript (pure sum, bounded tail read, epoch-aware reading)
  compact-marker.cjs / context-log.cjs   auto snapshot ownership + freshness, save instruction; NDJSON context log
  install.cjs                    fallback: wires the SessionStart and PostToolUse hooks into settings.json
  __tests__/                     node:test suite
```

## License

[MIT](LICENSE)
