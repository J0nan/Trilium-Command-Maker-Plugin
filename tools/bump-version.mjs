import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function isValidVersion(version) {
    return /^\d+\.\d+$/.test(String(version == null ? '' : version));
}

function numericParts(version) {
    return String(version)
        .split('-')[0]
        .split('.')
        .map(function (part) {
            return parseInt(part, 10) || 0;
        });
}

export function compareVersions(left, right) {
    const a = numericParts(left);
    const b = numericParts(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const delta = (a[index] || 0) - (b[index] || 0);
        if (delta !== 0) {
            return delta;
        }
    }
    return 0;
}

/**
 * Update package.json and src/version.js together. The build asserts that the two
 * files agree, so they must never be bumped separately.
 */
export function setVersion(version, rootDir) {
    const base = rootDir || root;
    if (!isValidVersion(version)) {
        throw new Error('Invalid version "' + version + '". Use x.y (for example 0.2).');
    }

    const pkgPath = path.join(base, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version === version) {
        throw new Error('Version ' + version + ' is already set.');
    }
    if (compareVersions(version, pkg.version) <= 0) {
        throw new Error('New version ' + version + ' must be greater than ' + pkg.version + '.');
    }
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

    const versionPath = path.join(base, 'src', 'version.js');
    const source = fs.readFileSync(versionPath, 'utf8');
    if (!/const VERSION = '[^']+';/.test(source)) {
        throw new Error('src/version.js has no VERSION declaration.');
    }
    fs.writeFileSync(
        versionPath,
        source.replace(/const VERSION = '[^']+';/, "const VERSION = '" + version + "';")
    );
    return version;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
    try {
        const version = process.argv[2];
        if (!version) {
            throw new Error('Usage: node tools/bump-version.mjs <version>');
        }
        setVersion(version);
        console.log(version);
    } catch (error) {
        console.error('bump-version: ' + error.message);
        process.exit(1);
    }
}