---
name: handoff
description: Hand off the current Claude Code session to a fresh-context session without losing state. Works in BOTH the terminal CLI and the Cursor/VS Code extension. Use when the context is getting full, when the user types /handoff, or asks to "hand off", "fresh session", "clean context", "continue in a new session", or "pass this to a new agent". Captures a structured working-state doc, opens a fresh session (new tab in the extension, new terminal in the CLI) that auto-resumes it, wakes it with a cross-session message, and names the new tab "<topic> #<generation>".
---

# /handoff: clean-context session handoff

Hand the current session to a fresh-context session with zero info loss. (Native `/compact` is lossy and keeps the same polluted session; this does NOT use it.)

When invoked:

1. **Author the working state** as JSON with exactly these keys (lists may be empty, but every key is required): `goal` (one sentence), `specifics` (files/symbols/branch/PR/URLs in play), `state` (what's done, past tense), `nextStep` (the ONE next action), `constraints`, `gotchas`, `openQuestions`, `keepOnFail` (irreducible facts), `verify` (exact build/lint/test commands). Optional `title`: the session topic in 2-4 words (defaults to the previous handoff's title, else the first words of `goal`). Optional `spawn`: `"same-window"` (default) | `"window"` | `"terminal"` | `"none"` | the legacy `"uri-target"`. Optional `callerCwd`: the CURRENT window's workspace root (defaults to `process.cwd()`; pass it explicitly when you have already run `EnterWorktree`, since the session's cwd is then the worktree, not the window folder). Reflect honestly on THIS conversation; be concrete.
2. **Refuse** if you cannot fill `goal` and `nextStep`: ask the user instead.
3. **Pick the spawn mode**: default to same-window and never ask. Only ask the user which mode they want when they say something like "in a separate window" or "in a terminal"; then set `spawn` accordingly.
4. **Run the glue once**, piping the JSON to it (use a heredoc):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/handoff}/tools/handoff.cjs" <<'JSON'
   {"title":"panel verdicts","goal":"...","specifics":["..."],"state":"...","nextStep":"...","constraints":["..."],"gotchas":["..."],"openQuestions":["..."],"keepOnFail":["..."],"verify":["..."],"callerCwd":"/path/to/current/window/root"}
   JSON
   ```

   `spawn` is optional (omit it for the same-window default) and `callerCwd` is set to the workspace root of the CURRENT window, not the target project the handoff is about.

   CLAUDE_PLUGIN_ROOT is set when the skill runs as a plugin; the default covers a copy in the user skills directory. If the skill lives elsewhere, substitute the directory containing this SKILL.md.

   The result carries `title` (e.g. `panel verdicts #3`), `generation`, `mode`, `sessionNamePrefix` (e.g. `agent-test-`) and `resumeMessage`.
5. If your Claude Code exposes the ListAgents and SendMessage tools: **Wake the fresh session** (extension and CLI alike; skip only when `spawn.mode` is `manual`):
   1. Wait about 15 s (`sleep 15`), then call `ListAgents` once. The fresh session is the row whose name starts with `sessionNamePrefix` and whose "started" age is the youngest (well under a minute). Confirm it before messaging: a transcript created after the spawn time must exist (`find ~/.claude/projects -maxdepth 2 -name '*.jsonl' -newermt '<spawn HH:MM:SS>'`; on Windows use Git Bash or skip this check) and its first message must start with the tab title. A row that is merely young can be one of the user's own tabs (observed 2026-09-02: a resume message went to a live user session by that mistake).
   2. `SendMessage` to that name with `message` = `resumeMessage` and `notify_when_idle: true`. A fresh session processes a cross-session message with no typing from the user (verified 2026-09-02: an idle tab with an unsubmitted prompt replied within seconds).
   3. If no such row appears, retry the listing once after another 15 s. If the youngest new row carries ANOTHER project's prefix, the tab landed in the window the user was clicking in: tell the user to close that tab without submitting its prompt (the prompt names the project root, so a submitted one stops itself). Then hand the work over anyway: either an idle session with the right prefix (an unused tab in the project window) gets the `resumeMessage` and you consume the marker by renaming `handoff.pending.json` to `handoff.consumed.json`, or the user opens a new tab in the project window and the SessionStart hook resumes it.
6. **Relay** the result, then tell the user: **"Handoff is ready in the fresh session `<title>`, close this one to finish."** (Closing the old session is the one manual step; nothing can close it automatically.) The idle notice from the fresh session arrives later on its own; do not poll for it.

Resume is automatic: the fresh session's `SessionStart` hook injects a pointer and auto-sends the first message. The URI prompt is a backstop for when the hook is unavailable; both start with the tab title.

**Same-window is the default, so there is nothing to stay put for.** The URI fires immediately, with no focus step and no delay, so it lands in whichever window you were already talking to; the new session starts there (`callerCwd`), not in the target project. That is why its first message tells it to `EnterWorktree` (with `path`, never `name`) into the target root before reading `HANDOFF.md`, and why the "wrong window" check accepts either `callerCwd` or `targetCwd` as correct. Ask for `spawn:"window"` or `spawn:"terminal"` only when the user asks for a separate window or a terminal; a genuinely parallel handoff (two spawns within about 20 s) can still land in the wrong tab, since spawns are not queued.

Same-window still works when the current window's folder is not a git repository (`EnterWorktree` needs one): the message instead tells the fresh session to work on absolute paths under the target root, `cd`-ing into it for every shell command instead of entering a worktree.

**First-time setup:** none when installed as a plugin. The plugin install wires **both** hooks (the `SessionStart` resume hook and the `PostToolUse` auto-trigger) through `hooks/hooks.json`; restart Claude Code once after installing so they activate. Run `node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/handoff}/tools/install.cjs"` only when you installed by copying this directory into `~/.claude/skills` and the hooks do not fire: it merges both hooks into `~/.claude/settings.json` (secret-safe, idempotent, preserves existing hooks), then restart Claude Code.

## Session naming
- Tabs are titled after their first prompt unless a custom title exists. A handed-off session is therefore named `<title> #<generation>` automatically: the hook puts it at the front of the first message and writes the custom-title sidecar next to the transcript.
- To name the CURRENT session once its topic is clear: `node "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/handoff}/tools/session-title.cjs" "<topic in 2-4 words>"` (reads `CLAUDE_CODE_SESSION_ID`, writes the sidecar only, never touches the transcript). The open tab may keep its old label until it is reopened; the session picker shows the new one. Do not append `#n` by hand: the handoff glue owns the generation counter.

## How it works
- `tools/handoff.cjs` captures the 9 fields (+ title), redacts secrets, writes `.claude/handoff/HANDOFF.md` (frontmatter carries `title` and `generation`, bumped from the previous doc) plus an atomic single-shot marker in the TARGET project, then dispatches `tools/spawn-tab.cjs` per the chosen mode and, for every mode but `none`, writes a registry entry under `~/.claude/handoff/pending/` so the hook can find the marker even from a different window.
- `tools/spawn-tab.cjs` runs every editor launch WITHOUT `ELECTRON_RUN_AS_NODE`: a session started by the Cursor extension inherits that variable, and with it the editor binary boots as plain node and rejects `--open-url`, so the URI used to be a silent no-op (root cause found 2026-09-02).
- `hooks/sessionstart-handoff.cjs` runs on the fresh session: first checks for a local pending marker at this cwd (the `window`/`terminal`/`uri-target` case); if none, and the session just started, scans the registry for an entry matching this cwd as either `callerCwd` or `targetCwd` (the `same-window` case), sweeping stale or invalid entries as it goes. Either way it injects the pointer, auto-sends the resume message, names the tab, and consumes the marker (so normal sessions are untouched and it never re-fires).
- `hooks/usage-monitor.cjs` (`PostToolUse` auto-trigger) reads `rate_limits.five_hour.used_percentage` from the hook payload and, when 5-hour usage crosses a threshold, injects an `additionalContext` nudge telling you (the agent) to run `/handoff` before the limit is hit. It is a **tripwire, not a capture**: a `PostToolUse` hook can't author the working state, so it asks the agent to. Fires each level at most once per session (`.claude/handoff/.last-warned.json`).

## Auto-trigger (enabled by default)
- **Thresholds:** `90%` gentle nudge; `95%` urgent nudge. Single-shot per session+level (no per-tool-call spam).
- **Retune / disable** via env: `HANDOFF_AUTO_SAVE_PERCENT` and `HANDOFF_URGENT_PERCENT` accept a number (e.g. `85`) or `disabled`.
- **Defensive:** `rate_limits` is exposed to hook stdin only on newer Claude Code for Pro/Max; where it's absent the hook silently no-ops. It never blocks a tool call (fail-open).
- **Nudge-only by design:** at 95% it still only nudges (it does not auto-author a degraded handoff). Durable memory is the independent safety net, and a real handoff stays agent-authored and high-fidelity.

## Notes
- Path anchor is **cwd to nearest `.git`** (never `CLAUDE_PROJECT_DIR`), so the write-path and read-path can't diverge.
- Secrets (DB URLs with passwords, API keys, tokens) are redacted before any write.
- The handoff doc is your own prior notes: verify against the live repo before destructive actions; the skill never auto-runs its `verify`/`nextStep` commands.
- Env knobs: `HANDOFF_SPAWN` (`same-window` | `window` | `terminal` | `none` | `uri-target`, legacy `auto`/`uri` map to `uri-target`), `HANDOFF_URI_SCHEME` (default `cursor`), `HANDOFF_EDITOR_EXE` (editor binary used to focus or open the project window), `HANDOFF_TERMINAL_EXE` (terminal binary for `terminal` mode, default `wt.exe` from WindowsApps when present), `HANDOFF_HOME` (registry root, default `~/.claude/handoff`).
- A stale pending marker is consumed by the NEXT session that starts in that project, whoever opens it. If a spawn ever fails, the next tab you open there will resume the handoff.
- Two handoffs fired within about 20 s of each other can still land in the wrong tab: spawns are not queued.
