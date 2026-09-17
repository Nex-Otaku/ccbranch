# Parallel sessions

Each render is a separate process, and results are cached on disk for up to 5 seconds.
The cache cannot leak between sessions running at the same time from different
worktrees:

- every session has its own file, `~/.cache/ccbranch/sessions/<sha256(session_id)>.json`
  (respects `XDG_CACHE_HOME`);
- an entry is used only if cwd, git dir and `HEAD` mtime all match, so switching
  branch or entering a worktree mid-session updates the line right away;
- writes go through a unique temp file plus an atomic rename, so overlapping renders never
  produce a torn file;
- files of sessions idle for 24 h are pruned.
