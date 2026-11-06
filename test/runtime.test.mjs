import test from 'node:test';
import assert from 'node:assert/strict';

import Runtime from '../src/runtime.js';

function commandNote(spec) {
    return {
        noteId: spec.noteId,
        title: spec.title,
        getLabelValue(name) {
            const labels = spec.labels || {};
            return Object.prototype.hasOwnProperty.call(labels, name) ? labels[name] : null;
        },
        async getChildNotes() {
            return spec.children || [];
        },
        async getContent() {
            return spec.content || '';
        }
    };
}

function installApi(notes) {
    globalThis.api = {
        async runOnBackend() {
            return {};
        },
        async searchForNotes() {
            return notes;
        },
        async searchForNote() {
            return null;
        }
    };
}

test('search matches a base string stored in note content', async () => {
    installApi([commandNote({ noteId: 'c1', title: 'My encode', content: 'ffmpeg -i "{{input}}"' })]);
    await Runtime.refresh();
    assert.equal(Runtime.search('ffmpeg').length, 1, 'base content is indexed');
    assert.equal(Runtime.search('encode').length, 1, 'title is still indexed');
    assert.equal(Runtime.search('docker').length, 0);
    globalThis.api = undefined;
});

test('#cmBase overrides the content for search', async () => {
    installApi([
        commandNote({
            noteId: 'c2',
            title: 'Rip',
            labels: { cmBase: 'ffmpeg -i {{src}}' },
            content: 'ignored'
        })
    ]);
    await Runtime.refresh();
    assert.equal(Runtime.search('ffmpeg').length, 1);
    assert.equal(Runtime.search('ignored').length, 0);
    globalThis.api = undefined;
});