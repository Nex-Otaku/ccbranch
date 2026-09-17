# ccbranch

Claude Code plugin that shows the current git worktree and branch in the status line:

```
⌂ main ⎇ main
⌂ feature-x ⎇ feat/feature-x
```

Inspired by the Git Worktree and Git Branch widgets of
[ccstatusline](https://github.com/sirmalloc/ccstatusline), without a configurator
or widget system. No dependencies, Node.js ≥ 18.

## Install

```
/plugin marketplace add Nex-Otaku/ccbranch
/plugin install ccbranch@ccbranch
/ccbranch:setup
```

`/ccbranch:setup` writes `statusLine` into `~/.claude/settings.json` (it asks before
replacing an existing status line). `/ccbranch:setup uninstall` removes it.

A plugin cannot set `statusLine` on its own, and the plugin's install path changes on
every update, so the status line runs a small shim in `${CLAUDE_PLUGIN_DATA}`. A
SessionStart hook re-points that shim at the installed plugin version.

## Output

- Worktree: `main` for the main worktree, otherwise the linked worktree's name
  (the directory name under `.git/worktrees/`).
- Branch: the checked-out branch, or the short commit sha on a detached HEAD.
- Nothing is printed outside a git work tree. `NO_COLOR` disables colors.

## Documentation

- [Parallel sessions](docs/parallel-sessions.md)
- [Development](docs/development.md)
- [Release](docs/release.md)
