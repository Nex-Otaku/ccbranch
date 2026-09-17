#!/usr/bin/env node
// Usage:
//   setup.mjs refresh-shim                       (SessionStart hook)
//   setup.mjs install <plugin-data-dir> [--force]
//   setup.mjs uninstall
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ensureShim,
    getUserSettingsPath,
    installStatusLine,
    uninstallStatusLine
} from '../src/install.mjs';

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [mode, ...rest] = process.argv.slice(2);
const settingsPath = getUserSettingsPath();

function fail(message) {
    console.error(`ccbranch: ${message}`);
    process.exit(1);
}

switch (mode) {
    case 'refresh-shim': {
        // Hook mode: never break session start.
        const dataDir = process.env.CLAUDE_PLUGIN_DATA;
        if (dataDir) {
            try {
                ensureShim(pluginRoot, dataDir);
            } catch { /* ignore */ }
        }
        break;
    }
    case 'install': {
        const dataDir = rest.find(arg => !arg.startsWith('--')) || process.env.CLAUDE_PLUGIN_DATA;
        if (!dataDir || !path.isAbsolute(dataDir)) {
            fail('install needs the absolute plugin data directory as an argument');
        }

        const shimPath = ensureShim(pluginRoot, dataDir);
        const result = installStatusLine(settingsPath, shimPath, { force: rest.includes('--force') });
        if (result.status === 'conflict') {
            console.log(`CONFLICT: ${settingsPath} already has a different statusLine:`);
            console.log(JSON.stringify(result.previous, null, 2));
            console.log('Re-run with --force to replace it.');
            process.exit(2);
        }

        console.log(result.status === 'unchanged'
            ? `ccbranch status line is already configured in ${settingsPath}`
            : `ccbranch status line installed in ${settingsPath}`);
        if (result.status === 'installed' && result.previous !== undefined) {
            console.log(`Replaced previous statusLine: ${JSON.stringify(result.previous)}`);
        }
        break;
    }
    case 'uninstall':
        console.log(uninstallStatusLine(settingsPath)
            ? `ccbranch status line removed from ${settingsPath}`
            : `No ccbranch status line in ${settingsPath}; nothing changed`);
        break;
    default:
        fail('usage: setup.mjs refresh-shim | install <plugin-data-dir> [--force] | uninstall');
}
