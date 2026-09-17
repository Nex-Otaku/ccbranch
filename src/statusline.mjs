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
const LIGHT_BLUE = '\x1b[38;2;135;206;250m'; // #87CEFA
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

export function formatStatusLine(info, { color = true } = {}) {
    if (!info) {
        return '';
    }

    const paint = (code, text) => (color ? `${code}${text}${RESET}` : text);
    const parts = [];
    if (info.worktree) {
        parts.push(paint(LIGHT_BLUE, `${WORKTREE_SYMBOL} ${info.worktree}`));
    }
    if (info.branch) {
        parts.push(paint(LIGHT_BLUE, `${BRANCH_SYMBOL} ${info.branch}`));
    }
    if (parts.length === 0) {
        return '';
    }

    // Claude Code renders status line output dimmed: resetting attributes first
    // keeps the colors bright. Spaces become U+00A0 so editor terminals that
    // collapse or trim whitespace keep the layout intact.
    return RESET + parts.join(' ').replace(/ /g, ' ');
}
