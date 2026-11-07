import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareVersions, isValidVersion, setVersion } from '../tools/bump-version.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github', 'workflows', 'release.yml');

test('the release workflow is manual and publishes both artifacts', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /version:/);
    assert.match(workflow, /contents: write/);
    assert.match(workflow, /node tools\/bump-version\.mjs/);
    assert.match(workflow, /npm run check/);
    assert.match(workflow, /softprops\/action-gh-release@v2/);
    assert.match(workflow, /dist\/command-maker\.js/);
    assert.match(workflow, /dist\/install\.js/);
    assert.match(workflow, /git tag "v\$\{\{ inputs\.version \}\}"/);
});

test('release versions are validated and ordered', () => {
    assert.equal(isValidVersion('0.1'), true);
    assert.equal(isValidVersion('0.2'), true);
    assert.equal(isValidVersion('1.10'), true);
    assert.equal(isValidVersion('1.2.3'), false, 'only two components are allowed');
    assert.equal(isValidVersion('v1.2'), false);
    assert.equal(isValidVersion('1'), false);
    assert.equal(isValidVersion(''), false);
    assert.ok(compareVersions('0.10', '0.9') > 0);
    assert.ok(compareVersions('0.2', '0.1') > 0);
    assert.equal(compareVersions('0.1', '0.1'), 0);
});

test('setVersion updates package.json and src/version.js together', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-bump-'));
    try {
        fs.mkdirSync(path.join(temp, 'src'), { recursive: true });
        fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'demo', version: '0.1' }, null, 2) + '\n');
        fs.writeFileSync(path.join(temp, 'src', 'version.js'), "'use strict';\nconst VERSION = '0.1';\nmodule.exports = { VERSION };\n");

        assert.equal(setVersion('0.2', temp), '0.2');
        assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'package.json'), 'utf8')).version, '0.2');
        assert.match(fs.readFileSync(path.join(temp, 'src', 'version.js'), 'utf8'), /const VERSION = '0\.2';/);

        assert.throws(() => setVersion('0.2', temp), /already set/);
        assert.throws(() => setVersion('0.1', temp), /must be greater/);
        assert.throws(() => setVersion('0.2.0', temp), /Invalid version/);
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
});