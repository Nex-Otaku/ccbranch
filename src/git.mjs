import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Working directory reported by Claude Code, or undefined when the payload has none. */
export function pickCwd(data) {
    for (const value of [data?.workspace?.current_dir, data?.cwd, data?.workspace?.project_dir]) {
        if (typeof value === 'string' && value.trim() !== '') {
            return value;
        }
    }
    return undefined;
}

function statOrNull(p) {
    return fs.statSync(p, { throwIfNoEntry: false }) ?? null;
}

/** Absolute directory for dir, or null when it does not exist. */
export function existingDirectory(dir) {
    const absolute = path.resolve(dir);
    const stats = statOrNull(absolute);
    if (!stats) {
        return null;
    }
    return stats.isDirectory() ? absolute : path.dirname(absolute);
}

/**
 * Git dir of the work tree containing dir, found on disk without running git.
 * A linked worktree has a `.git` file pointing at `<common>/worktrees/<name>`.
 */
export function findGitDir(dir) {
    const { root } = path.parse(dir);
    for (let current = dir; ; current = path.dirname(current)) {
        const candidate = path.join(current, '.git');
        const stats = statOrNull(candidate);
        if (stats?.isDirectory()) {
            return candidate;
        }
        if (stats?.isFile()) {
            const pointer = fs.readFileSync(candidate, 'utf-8').match(/^gitdir: *(.+?)\s*$/m);
            return pointer ? path.resolve(current, pointer[1]) : null;
        }
        if (current === root) {
            return null;
        }
    }
}

export function mtimeOrNull(file) {
    return statOrNull(file)?.mtimeMs ?? null;
}

/** Runs git read-only in cwd; stdout without the trailing newline, or null on failure. */
export function git(cwd, args) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        // Don't take .git/index.lock just to refresh the index for a status line.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    });
    if (result.status !== 0) {
        return null;
    }
    const output = result.stdout.replace(/\r?\n$/, '');
    return output === '' ? null : output;
}

function realpathOrSelf(p) {
    try {
        return fs.realpathSync(p);
    } catch {
        return p;
    }
}

/**
 * 'main' when gitDir is the repository's own git dir, otherwise the linked
 * worktree's name, i.e. its admin directory under `<commonDir>/worktrees/`.
 */
export function worktreeName(gitDir, commonDir) {
    if (realpathOrSelf(gitDir) === realpathOrSelf(commonDir)) {
        return 'main';
    }
    return path.basename(gitDir);
}

/** { worktree, branch } for cwd, or null when cwd is not inside a work tree. */
export function readGitInfo(cwd) {
    const lines = git(cwd, ['rev-parse', '--is-inside-work-tree', '--git-dir', '--git-common-dir'])?.split(/\r?\n/);
    if (lines?.length !== 3 || lines[0] !== 'true') {
        return null;
    }

    const [gitDir, commonDir] = lines.slice(1).map(p => path.resolve(cwd, p));
    // symbolic-ref also covers a branch without commits; a detached HEAD has no
    // branch name, so show the abbreviated commit instead.
    const branch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
        ?? git(cwd, ['rev-parse', '--short', 'HEAD']);

    return { worktree: worktreeName(gitDir, commonDir), branch };
}
