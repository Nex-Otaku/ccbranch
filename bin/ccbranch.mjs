#!/usr/bin/env node
import * as fs from 'node:fs';

import { formatStatusLine, getGitInfo } from '../src/statusline.mjs';

let data;
try {
    data = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (error) {
    console.error(`ccbranch: expected Claude Code status JSON on stdin (${error.message})`);
    process.exit(1);
}

let line = '';
try {
    line = formatStatusLine(getGitInfo(data), { color: !process.env.NO_COLOR });
} catch {
    // An unreadable directory or .git file leaves the status line empty rather than erroring.
}
if (line) {
    process.stdout.write(`${line}\n`);
}
