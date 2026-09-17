import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    getCacheDir,
    getSessionCachePath,
    pruneStaleSessions,
    readCacheEntry,
    writeCacheEntry
} from './cache.mjs';
import {
    existingDirectory,
    findGitDir,
    mtimeOrNull,
    pickCwd,
    readGitInfo
} from './git.mjs';

const WORKTREE_SYMBOL = '⌂';
const BRANCH_SYMBOL = '⎇';
const RESET = '\x1b[0m';

/** Looks up { worktree, branch } for the session's cwd, using the session's own cache. */
export function getGitInfo(data, { cacheDir = getCacheDir(), now = Date.now() } = {}) {
    const rawCwd = pickCwd(data);
    const cwd = rawCwd ? existingDirectory(rawCwd) : null;
    if (!cwd) {
        return null;
    }

    const gitDir = findGitDir(cwd);
    if (!gitDir) {
        return null;
    }

    const sessionId = typeof data?.session_id === 'string' && data.session_id.length > 0
        ? data.session_id
        : null;
    if (!sessionId) {
        return readGitInfo(cwd);
    }

    const cachePath = getSessionCachePath(sessionId, cacheDir);
    const key = { cwd, gitDir, headMtimeMs: mtimeOrNull(path.join(gitDir, 'HEAD')), now };
    const cached = readCacheEntry(cachePath, key);
    if (cached) {
        return cached.info;
    }

    const isNewSession = !fs.existsSync(cachePath);
    const info = readGitInfo(cwd);
    writeCacheEntry(cachePath, { ...key, info });
    if (isNewSession) {
        pruneStaleSessions(cacheDir, now);
    }

    return info;
}

export function formatStatusLine(info) {
    const parts = [];
    if (info?.worktree) {
        parts.push(`${WORKTREE_SYMBOL} ${info.worktree}`);
    }
    if (info?.branch) {
        parts.push(`${BRANCH_SYMBOL} ${info.branch}`);
    }
    if (parts.length === 0) {
        return '';
    }

    // Claude Code renders status line output dimmed: resetting attributes first
    // shows the text in the terminal's regular foreground color. Spaces become
    // U+00A0 so editor terminals that collapse or trim whitespace keep the layout.
    return RESET + parts.join(' ').replace(/ /g, ' ');
}
