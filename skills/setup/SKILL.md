---
name: setup
description: Enable or remove the ccbranch status line (git worktree + branch) in the user's Claude Code settings.
disable-model-invocation: true
argument-hint: "[uninstall]"
---

Configure the ccbranch status line. Arguments: `$ARGUMENTS`

If the arguments contain `uninstall` (or `remove`), run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" uninstall
```

Otherwise run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" install "${CLAUDE_PLUGIN_DATA}"
```

If it exits with code 2 (`CONFLICT`), show the user the existing `statusLine` and ask whether to replace it. Only after they agree, re-run the same command with `--force` appended. Never pass `--force` without asking.

Report the script's output to the user in one or two sentences. The status line appears after the next assistant message; no restart is needed.
