#!/usr/bin/env node
// Usage: npm run release -- <version> [--no-push]
//
// Bumps the version in .claude-plugin/plugin.json (the one Claude Code reads)
// and package.json, runs tests and `claude plugin validate`, then commits,
// creates an annotated tag v<version> and pushes both.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION_FILES = ['.claude-plugin/plugin.json', 'package.json'];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function fail(message) {
    console.error(`release: ${message}`);
    process.exit(1);
}

function run(command, args, { capture = false } = {}) {
    console.log(`$ ${command} ${args.join(' ')}`);
    return execFileSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
    });
}

function git(...args) {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function tryGit(...args) {
    try {
        return git(...args);
    } catch {
        return null;
    }
}

function compareVersions(a, b) {
    const [coreA, preA] = a.split('-');
    const [coreB, preB] = b.split('-');
    const partsA = coreA.split('.').map(Number);
    const partsB = coreB.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (partsA[i] !== partsB[i]) {
            return partsA[i] - partsB[i];
        }
    }
    if (preA === preB) {
        return 0;
    }
    if (preA === undefined) {
        return 1;
    }
    if (preB === undefined) {
        return -1;
    }
    return preA < preB ? -1 : 1;
}

const args = process.argv.slice(2);
const version = args.find(arg => !arg.startsWith('--'))?.replace(/^v/, '');
const push = !args.includes('--no-push');

if (!version || !SEMVER.test(version)) {
    fail('usage: npm run release -- <version> [--no-push], e.g. npm run release -- 0.2.0');
}

const tag = `v${version}`;
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const current = readJson(VERSION_FILES[0]).version;

if (compareVersions(version, current) <= 0) {
    fail(`new version ${version} must be greater than the current ${current}`);
}
if (git('status', '--porcelain') !== '') {
    fail('working tree is not clean; commit or stash changes first');
}
if (tryGit('rev-parse', '-q', '--verify', `refs/tags/${tag}`)) {
    fail(`tag ${tag} already exists`);
}
const branch = tryGit('symbolic-ref', '--short', '-q', 'HEAD');
if (!branch) {
    fail('HEAD is detached; check out a branch first');
}
if (push && !tryGit('rev-parse', '--abbrev-ref', '@{upstream}')) {
    fail(`branch ${branch} has no upstream; push it first or use --no-push`);
}

for (const file of VERSION_FILES) {
    const data = readJson(file);
    data.version = version;
    fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`Version ${current} -> ${version}`);

try {
    run('npm', ['test']);
    const validation = run('claude', ['plugin', 'validate', '.'], { capture: true });
    process.stdout.write(validation);
    if (/warning/i.test(validation)) {
        throw new Error('plugin validation reported warnings');
    }
} catch (error) {
    git('checkout', '--', ...VERSION_FILES);
    fail(`checks failed, version change reverted (${error.message.split('\n')[0]})`);
}

run('git', ['commit', '-q', '-m', `Release ${tag}`, '--', ...VERSION_FILES]);
run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);

if (push) {
    const remote = git('config', `branch.${branch}.remote`);
    run('git', ['push', '--atomic', remote, `HEAD:refs/heads/${branch}`, `refs/tags/${tag}`]);
    console.log(`Released ${tag}. Users update with: /plugin marketplace update ccbranch, then /plugin update ccbranch@ccbranch`);
} else {
    console.log(`Created commit and tag ${tag} locally. Push with: git push --atomic origin ${branch} ${tag}`);
}
