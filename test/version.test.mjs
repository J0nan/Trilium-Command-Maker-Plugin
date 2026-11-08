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
    assert.match(pkg.version, /^\d+\.\d+$/, 'versions use major.minor only');
    assert.equal(Version.VERSION, pkg.version);
});

test('version metadata points at the repository', () => {
    assert.ok(pkg.repository && pkg.repository.url, 'package.json declares a repository');
    const slug = new URL(pkg.repository.url).pathname.replace(/^\/|\/$/g, '').replace(/\.git$/, '');
    assert.ok(slug.length > 0, 'the repository URL names an owner and repository');
    assert.ok(
        Version.REPOSITORY.endsWith('/' + slug),
        'the in-app Repository link matches package.json: ' + Version.REPOSITORY
    );
    for (const endpoint of [Version.LATEST_RELEASE_API, Version.LATEST_TAGS_API, Version.LATEST_RAW]) {
        assert.ok(
            endpoint.indexOf('/' + slug) !== -1,
            'the update check reads the same repository the link opens: ' + endpoint
        );
    }
});

test('the bundle and installer carry the current version', () => {
    const bundle = buildBundle();
    const installer = buildInstaller(bundle);
    assert.ok(bundle.includes("const VERSION = '" + pkg.version + "';"), 'bundle declares the version');
    assert.ok(installer.includes("var VERSION = '" + pkg.version + "';"), 'installer declares the version');
    assert.ok(installer.includes("VERSION_LABEL = 'cmVersion'"), 'installer writes the version label');
    assert.equal(installer.includes('__VERSION__'), false, 'installer placeholder is replaced');
});