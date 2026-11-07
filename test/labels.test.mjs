import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Model from '../src/model.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('cmRoot is part of the label schema', () => {
    assert.equal(Model.LABELS.root, 'cmRoot');
});

/**
 * `labels.foo` where foo is missing yields undefined, and Trilium's
 * setLabel(undefined) throws inside isAttributeDangerous() as
 * "Cannot read properties of undefined (reading 'trim')".
 */
test('every label key referenced by the sources exists in Model.LABELS', () => {
    const files = ['backend.js', 'model.js', 'runtime.js', 'ui.js'];
    const referenced = new Map();

    for (const file of files) {
        const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
        for (const match of source.matchAll(/\blabels\.([A-Za-z0-9_]+)/g)) {
            if (!referenced.has(match[1])) {
                referenced.set(match[1], file);
            }
        }
        for (const match of source.matchAll(/Model\.LABELS\.([A-Za-z0-9_]+)/g)) {
            if (!referenced.has(match[1])) {
                referenced.set(match[1], file);
            }
        }
    }

    const missing = Array.from(referenced.entries())
        .filter(([key]) => !Object.prototype.hasOwnProperty.call(Model.LABELS, key))
        .map(([key, file]) => key + ' (' + file + ')');

    assert.deepEqual(missing, [], 'unknown label keys referenced by the sources');
});