# Release

```
npm run release -- 0.2.0
```

Bumps `version` in `.claude-plugin/plugin.json` (the field Claude Code uses to detect
updates) and `package.json`, runs tests and `claude plugin validate`, then commits,
tags `v0.2.0` and pushes both. The version must be greater than the current one and the
working tree clean; if a check fails, the version change is reverted. `--no-push` stops
after the local commit and tag.

Users pick up the release with `/plugin marketplace update ccbranch` and
`/plugin update ccbranch@ccbranch`; the status line switches to it on the next session start.
