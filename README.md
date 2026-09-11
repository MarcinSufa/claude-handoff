# claude-handoff

> **Clean-context handoff for Claude Code.** Move the current session into a fresh-context session with zero information loss, in both the terminal CLI and the Cursor / VS Code extension.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Plugin](https://img.shields.io/badge/Claude%20Code-plugin-purple.svg)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macOS%20%7C%20linux-lightgrey.svg)](#limits)

Native `/compact` summarizes detail away and keeps the same polluted session. `/handoff` instead has the agent write a structured working-state document, opens a genuinely new session that resumes from it, wakes that session with a cross-session message, and names its tab after the topic. A `PostToolUse` hook watches your 5-hour rate-limit usage and nudges the agent to hand off before the limit hits.

## How it works

1. **Capture.** The agent authors nine fields (goal, specifics, state, next step, constraints, gotchas, open questions, keep-on-fail facts, verify commands) plus a short title. Secrets are redacted, then `tools/handoff.cjs` writes `.claude/handoff/HANDOFF.md` and an atomic single-shot marker next to it, in the TARGET project.
2. **Spawn.** Default mode `same-window` fires the editor URI (`cursor://anthropic.claude-code/open`, scheme via `HANDOFF_URI_SCHEME`) immediately, no window focus, no delay, so it lands in whichever window the user is already talking to; the new session starts there and is told to `EnterWorktree` into the target before reading the handoff. `window` opens the target in a new editor window and waits (poll, up to ~15 s on Windows) for it to become the foreground window before firing the URI. `terminal` opens a new terminal running `claude` in the target. `uri-target` keeps the old focus-then-URI behavior. `none` just prints an instruction. Every mode but `none` also writes an entry to the pending registry (`~/.claude/handoff/pending/`) so the resume hook can find the marker from whichever window the new session actually starts in.
3. **Resume.** The fresh session's `SessionStart` hook first checks for a local pending marker at its own cwd; if there isn't one, it looks itself up in the registry by cwd. Either way it injects a pointer to `HANDOFF.md`, auto-sends the first message and consumes the marker. Sessions without a marker or a matching registry entry are untouched and the hook never re-fires.
4. **Wake.** The old session locates the fresh one by its name prefix, sends it the resume message, and tells you to close the old tab.
5. **Name.** The new tab is titled `<topic> #<n>`, where `n` is a generation counter bumped from the previous handoff in that project.

## Install

**A. As a plugin (recommended)**

```bash
claude plugin marketplace add MarcinSufa/claude-handoff
claude plugin install handoff@claude-handoff
```

Restart Claude Code. The plugin's `hooks/hooks.json` wires both hooks (`SessionStart` resume and `PostToolUse` auto-trigger); nothing else to configure.

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

Type `/handoff` (or "hand off", "fresh session", "clean context", "continue in a new session") when the context is getting full. The agent authors the working state, refuses if it cannot name a goal and a next step, runs the glue, wakes the fresh session and tells you: **"Handoff is ready in the fresh session `<title>`, close this one to finish."** Closing the old session is the one manual step.

Name the current session as soon as its topic is clear, so the tab is findable among many:

```bash
node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/handoff}/tools/session-title.cjs" "<topic in 2-4 words>"
```

Do not append `#n` by hand; the handoff glue owns the generation counter.

## Auto-trigger

Enabled by default. The `PostToolUse` hook reads `rate_limits.five_hour.used_percentage` from the hook payload and nudges the agent once per level per session.

| Variable | Default | Accepts |
| --- | --- | --- |
| `HANDOFF_AUTO_SAVE_PERCENT` | `90` | a number (e.g. `85`) or `disabled` |
| `HANDOFF_URGENT_PERCENT` | `95` | a number or `disabled` |

It is a tripwire, not a capture: a `PostToolUse` hook cannot author the working state, so it asks the agent to run `/handoff`. Where `rate_limits` is absent from the payload (older Claude Code, non Pro/Max plans) the hook silently no-ops. It never blocks a tool call.

Spawn modes (input JSON field `spawn`, overrides `HANDOFF_SPAWN`):

| Mode | Default | New session starts in | Behavior |
| --- | --- | --- | --- |
| `same-window` | yes | caller window's folder (`callerCwd`) | Fires the URI immediately: no focus, no delay. Lands in whatever window the user is talking to. The first message tells the session to `EnterWorktree` into the target, then read the handoff. |
| `window` | | target folder | Opens the target in a new editor window (`<editor> -n <targetCwd>`), waits for it to become the foreground window (poll, ~15 s timeout on Windows; fires the URI regardless and reports `focused: false` on timeout), then fires the URI. |
| `terminal` | | target folder | Opens a new terminal running `claude` in the target. |
| `none` | | (nothing spawned) | Prints an instruction; no registry entry is written. |
| `uri-target` | | last-focused editor window | Legacy behavior: focuses the target folder, waits, then fires the URI. `HANDOFF_SPAWN=auto` and `=uri` are old names that map onto this mode. |

| Variable | Default | Meaning |
| --- | --- | --- |
| `HANDOFF_SPAWN` | `same-window` | see the modes table above |
| `HANDOFF_URI_SCHEME` | `cursor` | URI scheme used to open the extension (`vscode` for VS Code) |
| `HANDOFF_EDITOR_EXE` | auto-detected | editor binary used to focus or open the project window |
| `HANDOFF_TERMINAL_EXE` | auto-detected (win32: `%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe` when it exists, else `wt.exe`) | terminal binary used by `terminal` mode |
| `HANDOFF_HOME` | `~/.claude/handoff` | root of the pending registry (`<HANDOFF_HOME>/pending/<sha1 of the target folder>.json`) that lets the resume hook find a same-window handoff's marker from the caller window |

## Limits

- **The old tab stays open.** No API closes the current session; you close it yourself after the handoff is ready.
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
  hooks.json                     plugin hook wiring (SessionStart + PostToolUse)
  sessionstart-handoff.cjs       fresh-session resume hook
  usage-monitor.cjs              PostToolUse rate-limit auto-trigger
tools/
  handoff.cjs                    entry: capture, redact, write, spawn, --respawn
  capture.cjs / handoff-format.cjs / marker.cjs / redact.cjs / memory.cjs
  paths.cjs / spawn-tab.cjs / session-title.cjs
  registry.cjs                   pending registry (~/.claude/handoff/pending/)
  handoff-messages.cjs           resume message + URI prompt text, per spawn mode
  usage-threshold.cjs / usage-flag.cjs   auto-trigger logic (pure) + state
  install.cjs                    fallback: wires both hooks into settings.json
  __tests__/                     node:test suite
```

## License

[MIT](LICENSE)
