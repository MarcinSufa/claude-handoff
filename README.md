# claude-handoff

> **Clean-context handoff for Claude Code.** Move the current session into a fresh-context session with zero information loss, in both the terminal CLI and the Cursor / VS Code extension.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Plugin](https://img.shields.io/badge/Claude%20Code-plugin-purple.svg)](https://docs.claude.com/en/docs/claude-code/plugins)
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macOS%20%7C%20linux-lightgrey.svg)](#limits)

Native `/compact` summarizes detail away and keeps the same polluted session. `/handoff` instead has the agent write a structured working-state document, opens a genuinely new session that resumes from it, wakes that session with a cross-session message, and names its tab after the topic. A `PostToolUse` hook watches your 5-hour rate-limit usage and nudges the agent to hand off before the limit hits.

## How it works

1. **Capture.** The agent authors nine fields (goal, specifics, state, next step, constraints, gotchas, open questions, keep-on-fail facts, verify commands) plus a short title. Secrets are redacted, then `tools/handoff.cjs` writes `.claude/handoff/HANDOFF.md` and an atomic single-shot marker next to it.
2. **Spawn.** In `auto` mode the glue first focuses the project window and opens the editor URI (`cursor://anthropic.claude-code/open`, scheme via `HANDOFF_URI_SCHEME`); if that throws it opens a new terminal running `claude`; if both fail it prints an instruction. Terminal users should set `HANDOFF_SPAWN=terminal`, because a URI open can report success without an editor present.
3. **Resume.** The fresh session's `SessionStart` hook finds the pending marker for that cwd, injects a pointer to `HANDOFF.md`, auto-sends the first message and consumes the marker. Sessions without a marker are untouched and the hook never re-fires.
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

Spawn knobs:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HANDOFF_SPAWN` | `auto` | `auto`, `uri` (extension only), `terminal` (CLI only) or `none` (print the instruction) |
| `HANDOFF_URI_SCHEME` | `cursor` | URI scheme used to open the extension (`vscode` for VS Code) |
| `HANDOFF_EDITOR_EXE` | auto-detected | editor binary used to focus the project window before the URI is dispatched |

## Limits

- **The old tab stays open.** No API closes the current session; you close it yourself after the handoff is ready.
- **The URI lands in the focused window.** The editor dispatches the extension URI to whichever window you have focused at that moment. Run `/handoff` from the project window and stay in it for about 20 seconds. If a tab still lands elsewhere, close it without submitting its prompt; the next tab you open in the project window resumes the handoff from the pending marker.
- **Extension plugin loading is not officially documented.** Path A is expected to work in the extension as it does in the CLI, but only path B (copy into `~/.claude/skills` plus `install.cjs`) has been verified there.
- **Same-window context reset is impossible** in the extension; this skill targets the new-session flow, which is the only thing the extension exposes.
- The handoff doc is the agent's own prior notes. It never auto-runs the `verify` or `nextStep` commands; verify against the live repo before destructive actions.
- The first message of the fresh session starts with the title stored in the local `.claude/handoff/handoff.pending.json` marker (sanitized to 60 characters of letters, digits, spaces and `._#-`). The marker is written by your own agent and `.claude/handoff/` is added to the project's `.gitignore`, so it never comes from a cloned repository.

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
  handoff.cjs                    entry: capture, redact, write, spawn
  capture.cjs / handoff-format.cjs / marker.cjs / redact.cjs / memory.cjs
  paths.cjs / spawn-tab.cjs / session-title.cjs
  usage-threshold.cjs / usage-flag.cjs   auto-trigger logic (pure) + state
  install.cjs                    fallback: wires both hooks into settings.json
  __tests__/                     node:test suite
```

## License

[MIT](LICENSE)
