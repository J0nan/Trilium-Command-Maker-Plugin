import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { buildBundle, buildInstaller } from '../tools/build.mjs';

const INSTALLER = buildInstaller(buildBundle());
const LAUNCHER_NOTE_ID = 'al_commandmaker';

function createApi() {
    let sequence = 0;
    const notes = new Map();
    const launcherCalls = [];
    const created = [];

    function makeNote(title, noteId) {
        const labels = {};
        const children = [];
        sequence += 1;
        const note = {
            noteId: noteId || 'n' + sequence,
            title,
            children,
            content: '',
            getChildNotes() {
                return children;
            },
            getLabelValue(name) {
                return Object.prototype.hasOwnProperty.call(labels, name) ? labels[name] : null;
            },
            hasLabel(name) {
                return Object.prototype.hasOwnProperty.call(labels, name);
            },
            setLabel(name, value) {
                if (typeof name !== 'string' || name.trim() === '') {
                    throw new Error('setLabel with a missing label name');
                }
                labels[name] = value;
            },
            removeLabel(name) {
                delete labels[name];
            },
            setContent(value) {
                note.content = value;
            },
            getContent() {
                return note.content;
            }
        };
        notes.set(note.noteId, note);
        return note;
    }

    function addNote(parentNoteId, title, noteId) {
        const note = makeNote(title, noteId);
        const parent = notes.get(parentNoteId);
        if (parent) {
            parent.children.push(note);
        }
        return note;
    }

    makeNote('Today');
    makeNote('Parent');

    const api = {
        currentNote: { getParentNotes: () => [notes.get('n2')] },
        getTodayNote: () => notes.get('n1'),
        getNoteWithLabel(name) {
            if (typeof name !== 'string' || name.trim() === '') {
                throw new Error('getNoteWithLabel with a missing name');
            }
            for (const note of notes.values()) {
                if (note.hasLabel(name)) {
                    return note;
                }
            }
            return null;
        },
        getNote(noteId) {
            return notes.get(noteId) || null;
        },
        createNewNote(params) {
            created.push(params);
            return { note: addNote(params.parentNoteId, params.title, params.noteId), branch: {} };
        },
        createOrUpdateLauncher(opts) {
            launcherCalls.push(Object.assign({}, opts));
            let launcher = notes.get(LAUNCHER_NOTE_ID);
            if (!launcher) {
                launcher = addNote('_lbVisibleLaunchers', opts.title, LAUNCHER_NOTE_ID);
            }
            if (opts.keyboardShortcut) {
                launcher.setLabel('keyboardShortcut', opts.keyboardShortcut);
            } else {
                launcher.removeLabel('keyboardShortcut');
            }
            return { note: launcher };
        },
        log() {},
        // test helpers
        calls: launcherCalls,
        created,
        notes,
        seedLauncher(shortcut) {
            const launcher = addNote('_lbVisibleLaunchers', 'Command Maker', LAUNCHER_NOTE_ID);
            launcher.setLabel('keyboardShortcut', shortcut);
            return launcher;
        },
        seedRoot(labels) {
            const root = addNote('n2', 'Command Maker');
            Object.keys(labels || {}).forEach((name) => root.setLabel(name, labels[name]));
            return root;
        }
    };

    return api;
}

function run(api) {
    vm.runInContext(INSTALLER, vm.createContext({ api, console }));
}

function lastCall(api) {
    return api.calls[api.calls.length - 1];
}

test('a fresh install registers the launcher with ctrl+shift+space', () => {
    const api = createApi();
    run(api);

    assert.equal(lastCall(api).keyboardShortcut, 'ctrl+shift+space');
    assert.equal(lastCall(api).id, 'commandmaker');
    assert.equal(lastCall(api).type, 'script');
    assert.equal(lastCall(api).isVisible, true);

    const plugin = api.created.filter((params) => params.title === 'Command Maker.js')[0];
    assert.ok(plugin, 'plugin note was created');
    assert.equal(plugin.mime, 'application/javascript;env=frontend');
    assert.ok(plugin.content.length > 1000, 'plugin note contains the bundle');
});

test('a fresh install creates the settings note and the Tools folder', () => {
    const api = createApi();
    run(api);

    const roots = Array.from(api.notes.values()).filter((note) => note.hasLabel('cmRoot'));
    assert.equal(roots.length, 1, 'one settings note');
    const tools = Array.from(api.notes.values()).filter((note) => note.hasLabel('cmTools'));
    assert.equal(tools.length, 1, 'one Tools folder');
    assert.equal(tools[0].title, 'Tools');
    assert.ok(tools[0].hasLabel('cmManaged'), 'the plugin marks its own Tools folder');
});

test('re-running the installer preserves a shortcut changed on the launcher', () => {
    const api = createApi();
    api.seedLauncher('ctrl+alt+k');

    run(api);

    assert.equal(lastCall(api).keyboardShortcut, 'ctrl+alt+k');
});

test('#cmShortcut on the root note wins over the launcher', () => {
    const api = createApi();
    api.seedRoot({ cmRoot: '', cmShortcut: 'alt+shift+k' });
    api.seedLauncher('ctrl+alt+k');

    run(api);

    assert.equal(lastCall(api).keyboardShortcut, 'alt+shift+k');
});

test('an empty #cmShortcut removes the hotkey but keeps the launcher', () => {
    const api = createApi();
    api.seedRoot({ cmRoot: '', cmShortcut: '' });

    run(api);

    assert.equal(lastCall(api).keyboardShortcut, '');
    assert.ok(api.notes.get(LAUNCHER_NOTE_ID), 'launcher note still exists');
    assert.equal(api.notes.get(LAUNCHER_NOTE_ID).getLabelValue('keyboardShortcut'), null);
});

test('running twice creates a single root and updates the plugin note', () => {
    const api = createApi();
    run(api);
    run(api);

    const roots = Array.from(api.notes.values()).filter((note) => note.hasLabel('cmRoot'));
    assert.equal(roots.length, 1);

    const toolRoots = Array.from(api.notes.values()).filter((note) => note.hasLabel('cmTools'));
    assert.equal(toolRoots.length, 1, 'one Tools folder after two runs');

    const pluginNotes = Array.from(api.notes.values()).filter((note) => note.hasLabel('cmPlugin'));
    assert.equal(pluginNotes.length, 1);
    assert.equal(api.calls.length, 2);
    assert.equal(lastCall(api).keyboardShortcut, 'ctrl+shift+space');
});