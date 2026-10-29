# Changelog

## 1.2.1

- CLI rotation on Linux and macOS without herdr now fails with `halt:launch_failed no_terminal`; run inside herdr or rotate by hand with `/handoff`.

## 1.2.0

- **herdr spawn mode.** Inside a herdr terminal workspace (`HERDR_ENV=1`) the default spawn opens a new herdr tab in the target, starts `claude` with the resume prompt, answers the folder-trust dialog when it is on screen, and counts as launched only once herdr reports the agent working. Inside herdr, `terminal` and the `same-window` fallback use a herdr tab first, and `tools/rotate.cjs` opens a herdr tab for the `cli` host instead of a foreground `claude` with no terminal.
- **Honest result.** `tools/handoff.cjs` adds `launched` (`spawn.ok`); `closeOld` is the manual instruction when nothing was opened, and SKILL.md step 6 no longer says "ready" in that case.
- **Resume text.** One rule everywhere: continue from "Next step" and ask only before a destructive or irreversible step (it used to say both "continue" and "do not run it without confirming"). A same-window handoff whose caller folder is the target no longer gets `EnterWorktree` or "neither X nor X".
- **Rate-limit nudge** asks for a checkpoint (`spawn: "none"`) to resume after the 5-hour limit resets, since a fresh session spends the same quota.
- **Handoff log** moved from `~/.claude/handoffs/index.jsonl` to `<HANDOFF_HOME>/index.jsonl` (default `~/.claude/handoff/index.jsonl`), so tests and `HANDOFF_HOME` isolate it.
- **Hooks** have timeouts (SessionStart 10 s, PostToolUse 5 s) in `hooks/hooks.json` and in the installer, which also adds them to an older install.
- **Description** names the openers it really has and triggers on explicit intent (English and Polish); a full context alone is not a trigger while exo-compact is active.
- Fixes: the win32 `wt.exe` path is built with `path.win32` on any host; the Linux and macOS terminal openers quote the folder; `resolveProjectRoot` honors `GIT_CEILING_DIRECTORIES`, which keeps the tests green on a host with a stray `/tmp/.git`.

## 1.1.1

Skip transcript usage lines without a matching `sessionId` when a session filter is set. Transcripts whose lines lack a `sessionId` now yield no usage when a session filter is passed; without a filter nothing changes.

## 1.1.0

This release adds the rotation actuator in `tools/rotate.cjs`, fixes the `childEnv` deny-list, and graduates the two usage modules `tools/context-tokens.cjs` and `tools/transcript-tail.cjs`, including the D1 byte-offset convention. Rotation is opt-in on the exo-vault side through `EXOVAULT_ROTATION=1`, but every spawned child now loses `CLAUDE_CODE_*`, `CLAUDECODE`, and `ELECTRON_RUN_AS_NODE`, including ordinary handoffs with rotation off.
