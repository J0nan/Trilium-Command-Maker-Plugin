import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertInstallerLabels } from '../tools/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('build produces a valid bundle and installer', () => {
    execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs')], {
        cwd: root,
        stdio: 'pipe'
    });

    const bundle = fs.readFileSync(path.join(root, 'dist', 'command-maker.js'), 'utf8');
    const installer = fs.readFileSync(path.join(root, 'dist', 'install.js'), 'utf8');

    assert.ok(bundle.includes('__def("render"'), 'render module is registered');
    assert.ok(bundle.includes('__def("parse"'), 'parse module is registered');
    assert.ok(bundle.includes('__def("sections"'), 'sections module is registered');
    assert.ok(bundle.includes('__def("runtime"'), 'runtime module is registered');
    assert.ok(bundle.includes('__require("runtime")'), 'entry requires runtime');
    assert.ok(installer.includes('createOrUpdateLauncher'), 'installer registers a launcher');
    assert.ok(installer.includes('application/javascript;env=frontend'), 'installer uses the frontend mime');
    assert.equal(installer.includes('__BUNDLE__'), false, 'installer placeholder is replaced');

    assert.doesNotThrow(() => new Function(bundle), 'bundle parses');
    assert.doesNotThrow(() => new Function(installer), 'installer parses');
});

test('the installer only hard-codes labels the model defines', () => {
    assert.doesNotThrow(() => assertInstallerLabels("var ROOT_LABEL = 'cmRoot';\nvar PLUGIN_LABEL = 'cmPlugin';"));
    assert.throws(
        () => assertInstallerLabels("var ROOT_LABEL = 'cmR00t';"),
        /which src\/model\.js does not define/,
        'a drifted label fails the build instead of creating a second root'
    );
});

test('every src module is reachable from the entry point', () => {
    const bundle = fs.readFileSync(path.join(root, 'dist', 'command-maker.js'), 'utf8');
    for (const name of ['render', 'parse', 'sections', 'toolfile', 'prompt', 'model', 'version',
        'styles', 'dom', 'sourcePicker', 'backend', 'ui', 'runtime']) {
        assert.ok(bundle.includes('__def("' + name + '"'), name + ' is bundled');
    }
});