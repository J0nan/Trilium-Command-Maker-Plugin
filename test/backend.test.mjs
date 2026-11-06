import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import Backend from '../src/backend.js';
import Model from '../src/model.js';

let sequence = 0;

function makeNote(title) {
    const labels = {};
    const relations = {};
    const children = [];
    sequence += 1;
    return {
        noteId: 'note' + sequence,
        title,
        children,
        deleted: false,
        setLabel(name, value) {
            labels[name] = value;
        },
        getLabelValue(name) {
            return Object.prototype.hasOwnProperty.call(labels, name) ? labels[name] : null;
        },
        hasLabel(name) {
            return Object.prototype.hasOwnProperty.call(labels, name);
        },
        setRelation(name, noteId) {
            relations[name] = noteId;
        },
        hasRelation(name) {
            return Object.prototype.hasOwnProperty.call(relations, name);
        },
        setContent() {},
        getChildNotes() {
            return children;
        },
        deleteNote() {
            this.deleted = true;
        }
    };
}

function createApi() {
    const notes = new Map();
    const today = makeNote('Today');
    notes.set(today.noteId, today);

    function createNewNote(params) {
        const note = makeNote(params.title);
        notes.set(note.noteId, note);
        const parent = notes.get(params.parentNoteId);
        if (parent) {
            parent.children.push(note);
        }
        return { note, branch: {} };
    }

    return {
        getNoteWithLabel(name) {
            for (const note of notes.values()) {
                if (note.hasLabel(name)) {
                    return note;
                }
            }
            return null;
        },
        getNotesWithLabel(name) {
            return Array.from(notes.values()).filter((note) => note.hasLabel(name));
        },
        getNote(noteId) {
            return notes.get(noteId) || null;
        },
        createNewNote,
        currentNote: { getParentNotes: () => [] },
        getTodayNote: () => today,
        log() {}
    };
}

/**
 * Trilium's api.runOnBackend ships the function source to the backend, where
 * module-scope bindings do not exist. Evaluating the serialised source in a
 * fresh context reproduces that failure mode exactly.
 */
function serialise(fn, api) {
    const context = vm.createContext({ api, console });
    return vm.runInContext('(' + fn.toString() + ')', context);
}

test('beRun survives runOnBackend serialisation and dispatches every action', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const labels = Model.LABELS;

    const boot = beRun({ action: 'bootstrap', labels });
    assert.ok(boot.rootId, 'bootstrap returns the root id');
    assert.ok(boot.templateId, 'bootstrap returns the template id');
    assert.ok(boot.optionTemplateId, 'bootstrap returns the option template id');

    const created = beRun({ action: 'createCommand', labels, title: 'docker run', base: 'docker run {{image}}' });
    assert.ok(created.noteId, 'createCommand returns a note id');

    const option = beRun({
        action: 'addOption',
        labels,
        commandId: created.noteId,
        option: { label: 'Image', type: 'string' }
    });
    assert.ok(option.noteId, 'addOption returns a note id');

    const preset = beRun({
        action: 'savePreset',
        labels,
        commandId: created.noteId,
        name: 'web',
        values: { 'ph:image': 'nginx' }
    });
    assert.ok(preset.noteId, 'savePreset returns a note id');

    const deleted = beRun({ action: 'deletePreset', labels, noteId: preset.noteId });
    assert.equal(deleted.ok, true);
    assert.equal(api.getNote(preset.noteId).deleted, true);

    assert.throws(() => beRun({ action: 'bogus', labels }), /Unknown action/);
});

test('beRun body references no module-scope constants', () => {
    assert.equal(Backend.beRun.toString().indexOf('ACTIONS'), -1);
});