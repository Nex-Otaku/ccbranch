import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
    getSessionCachePath,
    pruneStaleSessions,
    readCacheEntry,
    writeCacheEntry
} from '../src/cache.mjs';
import { findGitDir, worktreeName } from '../src/git.mjs';
import { formatStatusLine, getGitInfo } from '../src/statusline.mjs';

const BIN = fileURLToPath(new URL('../bin/ccbranch.mjs', import.meta.url));
const execFileAsync = promisify(execFile);

function git(cwd, ...args) {
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

let root;
let repo;
let cacheDir;

before(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccbranch-test-')));
    repo = path.join(root, 'repo');
    cacheDir = path.join(root, 'cache');
    fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
    git(repo, 'init', '-q');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(repo, 'branch', '-M', 'main');
    for (const name of ['wt-a', 'wt-b', 'wt-c']) {
        git(repo, 'worktree', 'add', '-q', '-b', `feat/${name}`, path.join(root, name));
    }
});

after(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('git dir lookup', () => {
    it('finds the git dir of main and linked worktrees on disk', () => {
        assert.equal(findGitDir(path.join(repo, 'sub')), path.join(repo, '.git'));
        assert.equal(findGitDir(path.join(root, 'wt-a')), path.join(repo, '.git', 'worktrees', 'wt-a'));
        assert.equal(findGitDir(cacheDir), null);
    });

    it('names worktrees by comparing git dir with the common dir', () => {
        assert.equal(worktreeName(path.join(repo, '.git'), path.join(repo, '.git')), 'main');
        assert.equal(worktreeName(path.join(repo, '.git', 'worktrees', 'wt-a'), path.join(repo, '.git')), 'wt-a');
        assert.equal(worktreeName('/r/bare.git/worktrees/feature', '/r/bare.git'), 'feature');
    });
});

describe('formatStatusLine', () => {
    it('renders worktree and branch', () => {
        assert.equal(
            formatStatusLine({ worktree: 'wt', branch: 'dev' }, { color: false }),
            '\x1b[0m⌂\u00A0wt\u00A0⎇\u00A0dev'
        );
    });

    it('renders nothing outside git', () => {
        assert.equal(formatStatusLine(null), '');
    });
});

describe('getGitInfo', () => {
    it('resolves main worktree, subdirectories and linked worktrees', () => {
        const opts = { cacheDir };
        assert.deepEqual(getGitInfo({ session_id: 'g1', cwd: repo }, opts), { worktree: 'main', branch: 'main' });
        assert.deepEqual(getGitInfo({ session_id: 'g1', cwd: path.join(repo, 'sub') }, opts), { worktree: 'main', branch: 'main' });
        assert.deepEqual(getGitInfo({ session_id: 'g1', cwd: path.join(root, 'wt-a') }, opts), { worktree: 'wt-a', branch: 'feat/wt-a' });
        assert.deepEqual(getGitInfo({ workspace: { current_dir: path.join(root, 'wt-b') } }, opts), { worktree: 'wt-b', branch: 'feat/wt-b' });
    });

    it('returns null outside a repository', () => {
        assert.equal(getGitInfo({ session_id: 'g2', cwd: cacheDir }, { cacheDir }), null);
        assert.equal(getGitInfo({ session_id: 'g2' }, { cacheDir }), null);
    });

    it('picks up a branch switch within the same session', () => {
        const wt = path.join(root, 'wt-c');
        const data = { session_id: 'g3', cwd: wt };
        assert.equal(getGitInfo(data, { cacheDir }).branch, 'feat/wt-c');
        git(wt, 'checkout', '-q', '-b', 'feat/renamed');
        assert.equal(getGitInfo(data, { cacheDir }).branch, 'feat/renamed');
    });

    it('shows the short sha for a detached HEAD', () => {
        const wt = path.join(root, 'wt-detached');
        git(repo, 'worktree', 'add', '-q', '--detach', wt);
        const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim();
        assert.deepEqual(getGitInfo({ session_id: 'g4', cwd: wt }, { cacheDir }), { worktree: 'wt-detached', branch: sha });
    });
});

describe('session cache', () => {
    const key = { cwd: '/a', gitDir: '/a/.git', headMtimeMs: 1, now: 1_000 };

    it('keeps sessions in separate files', () => {
        assert.notEqual(getSessionCachePath('s1', cacheDir), getSessionCachePath('s2', cacheDir));
    });

    it('trusts an entry only for the same cwd, git dir, HEAD and within TTL', () => {
        const file = getSessionCachePath('c1', cacheDir);
        const info = { worktree: 'main', branch: 'main' };
        writeCacheEntry(file, { ...key, info });

        assert.deepEqual(readCacheEntry(file, key), { info });
        assert.equal(readCacheEntry(file, { ...key, cwd: '/b' }), null);
        assert.equal(readCacheEntry(file, { ...key, gitDir: '/b/.git' }), null);
        assert.equal(readCacheEntry(file, { ...key, headMtimeMs: 2 }), null);
        assert.equal(readCacheEntry(file, { ...key, now: key.now + 60_000 }), null);
    });

    it('treats a corrupt file as a miss', () => {
        const file = getSessionCachePath('c2', cacheDir);
        fs.writeFileSync(file, '{"version":1,');
        assert.equal(readCacheEntry(file, key), null);
    });

    it('prunes only stale session files', () => {
        const dir = path.join(root, 'prune');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'old.json'), '{}');
        fs.writeFileSync(path.join(dir, 'fresh.json'), '{}');
        const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        fs.utimesSync(path.join(dir, 'old.json'), old, old);

        pruneStaleSessions(dir, Date.now());
        assert.deepEqual(fs.readdirSync(dir), ['fresh.json']);
    });
});

describe('concurrent sessions', () => {
    it('never shows another session\'s worktree or branch', async () => {
        const sharedCache = path.join(root, 'concurrent-cache');
        const sessions = [
            { cwd: repo, expected: '⌂\u00A0main\u00A0⎇\u00A0main' },
            { cwd: path.join(repo, 'sub'), expected: '⌂\u00A0main\u00A0⎇\u00A0main' },
            { cwd: path.join(root, 'wt-a'), expected: '⌂\u00A0wt-a\u00A0⎇\u00A0feat/wt-a' },
            { cwd: path.join(root, 'wt-b'), expected: '⌂\u00A0wt-b\u00A0⎇\u00A0feat/wt-b' }
        ];

        const runs = [];
        for (let round = 0; round < 6; round++) {
            sessions.forEach((session, index) => {
                const child = execFileAsync(process.execPath, [BIN], {
                    env: { ...process.env, XDG_CACHE_HOME: sharedCache, NO_COLOR: '1' }
                });
                child.child.stdin.end(JSON.stringify({ session_id: `session-${index}`, cwd: session.cwd }));
                runs.push(child.then(({ stdout }) => assert.equal(stdout, `\x1b[0m${session.expected}\n`)));
            });
        }
        await Promise.all(runs);

        const files = fs.readdirSync(path.join(sharedCache, 'ccbranch', 'sessions'));
        assert.equal(files.length, sessions.length);
        assert.ok(files.every(name => name.endsWith('.json')), `leftover temp files: ${files}`);
    });
});

describe('status line install', () => {
    const SETUP = fileURLToPath(new URL('../bin/setup.mjs', import.meta.url));
    const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

    function runSetup(configDir, args, env = {}) {
        try {
            const stdout = execFileSync(process.execPath, [SETUP, ...args], {
                encoding: 'utf8',
                env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env }
            });
            return { code: 0, stdout };
        } catch (error) {
            return { code: error.status, stdout: error.stdout };
        }
    }

    it('installs a working status line and removes it again', () => {
        const configDir = path.join(root, 'claude-config');
        const dataDir = path.join(configDir, 'plugins', 'data', 'ccbranch-ccbranch');
        const settingsPath = path.join(configDir, 'settings.json');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }));

        assert.equal(runSetup(configDir, ['install', dataDir]).code, 0);
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        assert.equal(settings.theme, 'dark');
        assert.equal(settings.statusLine.type, 'command');
        assert.equal(runSetup(configDir, ['install', dataDir]).stdout.includes('already configured'), true);

        // Run the configured command exactly as Claude Code would.
        const stdout = execFileSync(settings.statusLine.command, {
            shell: true,
            encoding: 'utf8',
            input: JSON.stringify({ session_id: 'install', cwd: path.join(root, 'wt-a') }),
            env: { ...process.env, XDG_CACHE_HOME: path.join(root, 'install-cache'), NO_COLOR: '1' }
        });
        assert.equal(stdout, '\x1b[0m⌂ wt-a ⎇ feat/wt-a\n');

        assert.equal(runSetup(configDir, ['uninstall']).code, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { theme: 'dark' });
    });

    it('does not replace a foreign status line without --force', () => {
        const configDir = path.join(root, 'claude-config-foreign');
        const dataDir = path.join(configDir, 'plugins', 'data', 'ccbranch-ccbranch');
        const settingsPath = path.join(configDir, 'settings.json');
        const foreign = { statusLine: { type: 'command', command: '~/.claude/statusline.sh' } };
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(foreign));

        assert.equal(runSetup(configDir, ['install', dataDir]).code, 2);
        assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), foreign);
        assert.equal(runSetup(configDir, ['uninstall']).code, 0);
        assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), foreign);

        assert.equal(runSetup(configDir, ['install', dataDir, '--force']).code, 0);
        assert.match(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).statusLine.command, /statusline\.mjs/);
    });

    it('re-points the shim at a new plugin version on session start', () => {
        const dataDir = path.join(root, 'shim-data');
        const newRoot = path.join(root, 'plugin-v2');
        fs.cpSync(PLUGIN_ROOT, newRoot, { recursive: true, filter: src => !src.includes(`${path.sep}.git`) });

        runSetup(root, ['refresh-shim'], { CLAUDE_PLUGIN_DATA: dataDir });
        assert.match(fs.readFileSync(path.join(dataDir, 'statusline.mjs'), 'utf8'), /ccbranch\.mjs/);
        runSetup(root, ['refresh-shim'], { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_PLUGIN_ROOT: newRoot });
        assert.ok(fs.readFileSync(path.join(dataDir, 'statusline.mjs'), 'utf8').includes('plugin-v2'));
    });
});
