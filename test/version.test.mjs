import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Version from '../src/version.js';
import { buildBundle, buildInstaller } from '../tools/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('src/version.js and package.json agree', () => {
    assert.equal(Version.VERSION, pkg.version);
});

test('version metadata points at the repository', () => {
    assert.match(Version.REPOSITORY, /^https:\/\//);
    assert.ok(pkg.repository && pkg.repository.url.indexOf('Trilium-command-maker') !== -1);
    assert.ok(Version.LATEST_TAG_API.indexOf(Version.REPOSITORY) === 0);
    assert.ok(Version.LATEST_RAW.indexOf(Version.REPOSITORY) === 0);
});

test('the bundle and installer carry the current version', () => {
    const bundle = buildBundle();
    const installer = buildInstaller(bundle);
    assert.ok(bundle.includes("const VERSION = '" + pkg.version + "';"), 'bundle declares the version');
    assert.ok(installer.includes("var VERSION = '" + pkg.version + "';"), 'installer declares the version');
    assert.ok(installer.includes("VERSION_LABEL = 'cmVersion'"), 'installer writes the version label');
    assert.equal(installer.includes('__VERSION__'), false, 'installer placeholder is replaced');
});