// Wiring the plugin into Claude Code's status line.
//
// A plugin cannot set `statusLine` itself, and ${CLAUDE_PLUGIN_ROOT} is neither
// expanded in user settings nor stable across plugin updates. So the status line
// points at a shim in ${CLAUDE_PLUGIN_DATA} (stable, survives updates), and a
// SessionStart hook re-points that shim at the currently installed version.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SHIM_NAME = 'statusline.mjs';
const SHIM_MARKER = 'ccbranch status line shim';

function writeFileAtomic(filePath, content) {
    const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(tempPath, content, 'utf-8');
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        try {
            fs.unlinkSync(tempPath);
        } catch { /* ignore */ }
        throw error;
    }
}

export function shimContent(pluginRoot) {
    const entry = pathToFileURL(path.join(pluginRoot, 'bin', 'ccbranch.mjs')).href;
    return `// ${SHIM_MARKER}, regenerated on SessionStart. Do not edit.\nimport ${JSON.stringify(entry)};\n`;
}

/** Writes the shim unless it already points at pluginRoot. Returns the shim path. */
export function ensureShim(pluginRoot, dataDir) {
    const shimPath = path.join(dataDir, SHIM_NAME);
    const content = shimContent(path.resolve(pluginRoot));

    try {
        if (fs.readFileSync(shimPath, 'utf-8') === content) {
            return shimPath;
        }
    } catch { /* missing - write it */ }

    fs.mkdirSync(dataDir, { recursive: true });
    writeFileAtomic(shimPath, content);
    return shimPath;
}

export function statusLineCommand(shimPath) {
    return `node ${JSON.stringify(shimPath)}`;
}

export function isOurStatusLine(statusLine) {
    return typeof statusLine?.command === 'string'
        && statusLine.command.includes('ccbranch')
        && statusLine.command.includes(SHIM_NAME);
}

export function getUserSettingsPath(env = process.env) {
    const configDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    return path.join(configDir, 'settings.json');
}

function readSettings(settingsPath) {
    let raw;
    try {
        raw = fs.readFileSync(settingsPath, 'utf-8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        throw error;
    }

    const parsed = raw.trim() === '' ? {} : JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${settingsPath} does not contain a JSON object`);
    }
    return parsed;
}

/**
 * Points `statusLine` in settings at the shim.
 * Returns { status: 'installed' | 'unchanged' | 'conflict', previous }.
 * A foreign status line is only replaced with force.
 */
export function installStatusLine(settingsPath, shimPath, { force = false } = {}) {
    const settings = readSettings(settingsPath);
    const previous = settings.statusLine;
    const command = statusLineCommand(shimPath);

    if (previous?.type === 'command' && previous.command === command) {
        return { status: 'unchanged', previous };
    }
    if (previous !== undefined && !isOurStatusLine(previous) && !force) {
        return { status: 'conflict', previous };
    }

    settings.statusLine = { type: 'command', command, padding: 0 };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    return { status: 'installed', previous };
}

/** Removes `statusLine` from settings if it is ours. Returns true when removed. */
export function uninstallStatusLine(settingsPath) {
    const settings = readSettings(settingsPath);
    if (!isOurStatusLine(settings.statusLine)) {
        return false;
    }

    delete settings.statusLine;
    writeFileAtomic(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    return true;
}
