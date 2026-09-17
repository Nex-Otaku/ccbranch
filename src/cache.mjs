// Persistent render cache, isolated per Claude Code session.
//
// Every session owns its file (keyed by session_id), writes go through a unique
// temp file plus an atomic rename, and an entry is only trusted when cwd, git
// dir and HEAD mtime all still match - so a stale or foreign entry is at worst
// a cache miss.
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const CACHE_TTL_MS = 5_000;
export const STALE_SESSION_MS = 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 1;

export function getCacheDir(env = process.env) {
    const base = env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME)
        ? env.XDG_CACHE_HOME
        : path.join(os.homedir(), '.cache');

    return path.join(base, 'ccbranch', 'sessions');
}

export function getSessionCachePath(sessionId, cacheDir = getCacheDir()) {
    const key = createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
    return path.join(cacheDir, `${key}.json`);
}

function isInfo(value) {
    if (value === null) {
        return true;
    }

    return typeof value === 'object'
        && (typeof value.worktree === 'string' || value.worktree === null)
        && (typeof value.branch === 'string' || value.branch === null);
}

/**
 * Returns the cached { info } when the entry still describes the same cwd, git dir
 * and HEAD, and is younger than ttlMs; otherwise null.
 */
export function readCacheEntry(cachePath, { cwd, gitDir, headMtimeMs, now, ttlMs = CACHE_TTL_MS }) {
    let entry;
    try {
        entry = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    } catch {
        return null;
    }

    if (
        typeof entry !== 'object' || entry === null
        || entry.version !== SCHEMA_VERSION
        || entry.cwd !== cwd
        || entry.gitDir !== gitDir
        || entry.headMtimeMs !== headMtimeMs
        || typeof entry.createdAt !== 'number'
        || now - entry.createdAt > ttlMs
        || now < entry.createdAt
        || !isInfo(entry.info)
    ) {
        return null;
    }

    return { info: entry.info };
}

export function writeCacheEntry(cachePath, { cwd, gitDir, headMtimeMs, now, info }) {
    const entry = { version: SCHEMA_VERSION, cwd, gitDir, headMtimeMs, createdAt: now, info };
    // Unique temp name: overlapping renders of the same session must not write
    // into one temp file. rename() atomically replaces the target on POSIX.
    const tempPath = `${cachePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;

    try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(tempPath, JSON.stringify(entry), 'utf-8');
        fs.renameSync(tempPath, cachePath);
    } catch {
        // Best-effort cache; rendering must never fail because of it.
        try {
            fs.unlinkSync(tempPath);
        } catch { /* ignore */ }
    }
}

/** Removes cache files of sessions that have not rendered for maxAgeMs. */
export function pruneStaleSessions(cacheDir, now, maxAgeMs = STALE_SESSION_MS) {
    let names;
    try {
        names = fs.readdirSync(cacheDir);
    } catch {
        return;
    }

    for (const name of names) {
        const filePath = path.join(cacheDir, name);
        try {
            if (now - fs.statSync(filePath).mtimeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
            }
        } catch { /* another session may have removed it already */ }
    }
}
