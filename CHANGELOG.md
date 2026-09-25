# Changelog

## 1.1.1

Skip transcript usage lines without a matching `sessionId` when a session filter is set.

## 1.1.0

This release adds the rotation actuator in `tools/rotate.cjs`, fixes the `childEnv` deny-list, and graduates the two usage modules `tools/context-tokens.cjs` and `tools/transcript-tail.cjs`, including the D1 byte-offset convention. Rotation is opt-in on the exo-vault side through `EXOVAULT_ROTATION=1`, but every spawned child now loses `CLAUDE_CODE_*`, `CLAUDECODE`, and `ELECTRON_RUN_AS_NODE`, including ordinary handoffs with rotation off.
