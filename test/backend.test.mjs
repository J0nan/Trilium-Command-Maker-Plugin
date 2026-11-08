import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import Backend from '../src/backend.js';
import Model from '../src/model.js';
import Version from '../src/version.js';

let sequence = 0;

function makeNote(params) {
    const safe = params || {};
    const labels = {};
    const relations = {};
    const children = [];
    sequence += 1;
    let content = safe.content == null ? '' : String(safe.content);
    return {
        noteId: 'note' + sequence,
        title: safe.title,
        type: safe.type || 'text',
        mime: safe.mime || null,
        children,
        deleted: false,
        setLabel(name, value) {
            if (typeof name !== 'string' || name.trim() === '') {
                throw new Error('setLabel called with a missing label name');
            }
            labels[name] = value;
        },
        removeLabel(name) {
            delete labels[name];
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
        getRelationValue(name) {
            return Object.prototype.hasOwnProperty.call(relations, name) ? relations[name] : null;
        },
        setContent(value) {
            content = value == null ? '' : String(value);
        },
        getContent() {
            return content;
        },
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
    const today = makeNote({ title: 'Today' });
    notes.set(today.noteId, today);

    function createNewNote(params) {
        const note = makeNote(params);
        notes.set(note.noteId, note);
        const parent = notes.get(params.parentNoteId);
        if (parent) {
            parent.children.push(note);
        }
        return { note, branch: {} };
    }

    return {
        getNoteWithLabel(name) {
            if (typeof name !== 'string' || name.trim() === '') {
                throw new Error('getNoteWithLabel called with a missing label name');
            }
            for (const note of notes.values()) {
                if (note.hasLabel(name)) {
                    return note;
                }
            }
            return null;
        },
        getNotesWithLabel(name) {
            if (typeof name !== 'string' || name.trim() === '') {
                throw new Error('getNotesWithLabel called with a missing label name');
            }
            return Array.from(notes.values()).filter((note) => note.hasLabel(name));
        },
        getNote(noteId) {
            return notes.get(noteId) || null;
        },
        createNewNote,
        ensureNoteIsPresentInParent(noteId, parentNoteId) {
            const note = notes.get(noteId);
            const parent = notes.get(parentNoteId);
            if (!note || !parent) {
                throw new Error('ensureNoteIsPresentInParent with an unknown note');
            }
            if (parent.children.indexOf(note) === -1) {
                parent.children.push(note);
            }
            return { branch: {} };
        },
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

const labels = Model.LABELS;

function boot(api, beRun, extra) {
    return beRun(Object.assign({ action: 'bootstrap', labels }, extra || {}));
}

function findByTitle(note, title) {
    return note.getChildNotes().find((child) => child.title === title) || null;
}

function labelledChildren(note, label) {
    return note.getChildNotes().filter((child) => child.hasLabel(label));
}

function seedApi() {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const result = boot(api, beRun, {
        seed: true,
        seedTools: Model.seedTools(),
        newToolNotes: Model.newToolNotes(),
        icons: Model.ICONS,
        version: Version.VERSION
    });
    return { api, beRun, result };
}

test('beRun survives serialisation and bootstrap seeds the model tools', () => {
    const { api, beRun, result: seeded } = seedApi();

    assert.ok(seeded.rootId, 'bootstrap returns the settings root id');
    assert.ok(seeded.toolsRootId, 'bootstrap returns the Tools root id');
    assert.equal(seeded.seeded, true, 'bootstrap reports that it seeded');

    const root = api.getNote(seeded.rootId);
    assert.equal(root.title, 'Command Maker');
    assert.ok(root.hasLabel(labels.root));
    assert.equal(root.getLabelValue(labels.version), Version.VERSION);
    const today = api.getTodayNote();
    assert.ok(
        today.getChildNotes().some((child) => child.noteId === root.noteId),
        'the settings note lands under the today note when no parent is known'
    );

    const toolsRoot = api.getNote(seeded.toolsRootId);
    assert.equal(toolsRoot.title, 'Tools');
    assert.ok(toolsRoot.hasLabel(labels.tools));
    assert.ok(toolsRoot.hasLabel(labels.managed), 'the plugin-created Tools root is marked managed');
    assert.ok(toolsRoot.hasLabel(labels.seeded));
    assert.match(toolsRoot.getContent(), /tool/i, 'the Tools root explains itself');
    assert.deepEqual(
        toolsRoot.getChildNotes().map((child) => child.title),
        ['Version control', 'Network'],
        'one category folder per seeded category'
    );

    const seeds = Model.seedTools();
    assert.equal(api.getNotesWithLabel(labels.tool).length, seeds.length);
    for (let index = 0; index < seeds.length; index += 1) {
        const seed = seeds[index];
        const category = findByTitle(toolsRoot, seed.category);
        assert.ok(category.hasLabel(labels.category), 'category folders carry ' + labels.category);
        const tool = findByTitle(category, seed.title);
        assert.ok(tool.hasLabel(labels.tool));
        assert.equal(tool.getContent(), seed.content);
        assert.equal(tool.getLabelValue(labels.base), seed.base);
        assert.equal(tool.getLabelValue(labels.description), seed.description);

        const install = findByTitle(tool, 'Install');
        assert.ok(install.hasLabel(labels.install));
        assert.equal(install.type, 'text');
        assert.equal(install.getContent(), seed.install);
        assert.equal(install.getLabelValue(labels.icon), Model.ICONS.install);

        const usage = findByTitle(tool, 'Usage');
        assert.ok(usage.hasLabel(labels.usage));
        assert.equal(usage.type, 'text');
        assert.equal(usage.getContent(), seed.usage);
        assert.equal(usage.getLabelValue(labels.icon), Model.ICONS.usage);

        const help = findByTitle(tool, 'Help');
        assert.ok(help.hasLabel(labels.helpNote));
        assert.equal(help.type, 'code');
        assert.equal(help.mime, 'text/x-sh');
        assert.equal(help.getContent(), seed.help);
        assert.equal(help.getLabelValue(labels.icon), Model.ICONS.help);

        const folder = findByTitle(tool, 'Options');
        assert.ok(folder.hasLabel(labels.options));
        assert.equal(folder.getLabelValue(labels.icon), Model.ICONS.options);
        const presets = findByTitle(folder, 'Presets');
        assert.ok(presets.hasLabel(labels.presets));
        assert.equal(presets.type, 'code');
        assert.equal(presets.mime, 'application/json');
        assert.deepEqual(JSON.parse(presets.getContent()), { v: 1, presets: [] });

        assert.equal(
            labelledChildren(folder, labels.option).length,
            seed.options.length,
            'every seeded option became a note'
        );
    }

    const curl = findByTitle(findByTitle(toolsRoot, 'Network'), 'curl');
    const url = labelledChildren(findByTitle(curl, 'Options'), labels.option)
        .find((option) => option.title === 'URL');
    assert.ok(url, 'the seeded curl has a URL option');
    assert.equal(url.getLabelValue(labels.flag), null, 'the URL is positional');
    assert.equal(url.getLabelValue(labels.required), 'true');
    assert.equal(url.getLabelValue(labels.order), '100');
    assert.equal(url.getLabelValue(labels.placeholder), 'url');
    assert.equal(url.getLabelValue(labels.quote), 'double');

    // A second bootstrap with seed: true must not duplicate anything.
    const again = boot(api, beRun, { seed: true, seedTools: Model.seedTools() });
    assert.equal(again.rootId, seeded.rootId);
    assert.equal(again.toolsRootId, seeded.toolsRootId);
    assert.equal(again.seeded, false, 'seeding only happens once');
    assert.equal(api.getNotesWithLabel(labels.tool).length, seeds.length);
    assert.equal(api.getNotesWithLabel(labels.category).length, seeds.length);
});

test('bootstrap backfills icons on existing tools without overwriting a custom icon', () => {
    const { api, beRun, result } = seedApi();
    const toolsRoot = api.getNote(result.toolsRootId);
    const curl = findByTitle(findByTitle(toolsRoot, 'Network'), 'curl');
    const install = findByTitle(curl, 'Install');
    const usage = findByTitle(curl, 'Usage');
    const help = findByTitle(curl, 'Help');
    const options = findByTitle(curl, 'Options');

    install.removeLabel(labels.icon);
    usage.removeLabel(labels.icon);
    help.removeLabel(labels.icon);
    options.removeLabel(labels.icon);
    usage.setLabel(labels.icon, 'bx bx-star');

    beRun({ action: 'bootstrap', labels, icons: Model.ICONS });

    assert.equal(install.getLabelValue(labels.icon), Model.ICONS.install);
    assert.equal(usage.getLabelValue(labels.icon), 'bx bx-star', 'a user icon is preserved');
    assert.equal(help.getLabelValue(labels.icon), Model.ICONS.help);
    assert.equal(options.getLabelValue(labels.icon), Model.ICONS.options);
});

test('relocating the Tools folder never seeds the chosen note', () => {
    const { api, beRun, result } = seedApi();
    const userFolder = api.createNewNote({
        parentNoteId: api.getTodayNote().noteId,
        title: 'My tools',
        type: 'text',
        content: 'user data'
    }).note;
    beRun({ action: 'setToolsRoot', labels, noteId: userFolder.noteId });
    const before = api.getNotesWithLabel(labels.tool).length;
    const again = beRun({
        action: 'bootstrap',
        labels,
        seed: true,
        seedTools: Model.seedTools(),
        newToolNotes: Model.newToolNotes()
    });
    assert.equal(again.toolsRootId, userFolder.noteId);
    assert.equal(userFolder.getChildNotes().length, 0, 'the chosen folder is not seeded');
    assert.equal(api.getNotesWithLabel(labels.tool).length, before, 'the tool count is unchanged');
    assert.ok(userFolder.hasLabel(labels.seeded), 'the chosen folder is marked as seeded');
    assert.equal(api.getNote(result.toolsRootId).hasLabel(labels.tools), false, 'the old root lost the label');
});

test('setToolsRoot keeps the pointer when removing the old label fails', () => {
    const { api, beRun, result } = seedApi();
    const userFolder = api.createNewNote({
        parentNoteId: result.rootId,
        title: 'My tools',
        type: 'text',
        content: ''
    }).note;
    const old = api.getNote(result.toolsRootId);
    old.removeLabel = function () {
        throw new Error('label store is busy');
    };

    assert.throws(() => beRun({
        action: 'setToolsRoot',
        labels,
        noteId: userFolder.noteId
    }), 'the failure still surfaces to the caller');

    assert.ok(
        userFolder.hasLabel(labels.tools),
        'the new root holds the pointer even when the old label removal fails'
    );
});

test('createToolNote removes notes it already created when a later step throws', () => {
    const { api, beRun, result } = seedApi();
    const originalCreate = api.createNewNote;
    let createCount = 0;
    api.createNewNote = function (params) {
        createCount += 1;
        if (createCount === 3) {
            throw new Error('database is busy');
        }
        return originalCreate.call(api, params);
    };

    assert.throws(() => beRun({
        action: 'importTool',
        labels,
        toolsRootId: result.toolsRootId,
        newToolNotes: Model.newToolNotes(),
        tool: { title: 'partial', category: 'Partial cat', base: 'partial', options: [{ label: 'X', flag: '-x' }] }
    }), 'the import failure surfaces');
    api.createNewNote = originalCreate;

    // Mirror Trilium semantics: deleted (moved-to-trash) notes drop out of label queries.
    const aliveTools = api.getNotesWithLabel(labels.tool).filter((note) => !note.deleted);
    assert.equal(
        aliveTools.filter((note) => note.title === 'partial').length,
        0,
        'the half-created tool was cleaned up'
    );
    assert.equal(
        api.getNotesWithLabel(labels.category)
            .filter((entry) => entry.title === 'Partial cat' && !entry.deleted).length,
        0,
        'a category created for the failed tool is cleaned up too'
    );
    assert.equal(
        aliveTools.length,
        2,
        'the seeded tools survive untouched'
    );
});

test('bootstrap honours parentId and always ensures the Tools root', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const anchor = api.createNewNote({
        parentNoteId: api.getTodayNote().noteId,
        title: 'Anchor',
        type: 'text',
        content: ''
    }).note;

    const boot1 = boot(api, beRun, { parentId: anchor.noteId });
    assert.equal(anchor.getChildNotes().length, 1);
    assert.equal(anchor.getChildNotes()[0].noteId, boot1.rootId);
    assert.equal(boot1.seeded, false, 'no seeding unless asked');

    const toolsRoot = api.getNote(boot1.toolsRootId);
    assert.ok(toolsRoot.hasLabel(labels.tools));
    assert.equal(toolsRoot.getLabelValue(labels.seeded), null);
});

test('bootstrap keeps the settings note version current', () => {
    const { api, beRun, result } = seedApi();
    const root = api.getNote(result.rootId);
    root.setLabel(labels.version, '0.0.1');

    beRun({ action: 'bootstrap', labels, version: Version.VERSION });
    assert.equal(root.getLabelValue(labels.version), Version.VERSION);

    beRun({ action: 'bootstrap', labels });
    assert.equal(root.getLabelValue(labels.version), Version.VERSION, 'no version param leaves it alone');
});

test('tools created in one category reuse it, and an unknown Tools root is refused', () => {
    // The old createCategory backend action was unreachable production code;
    // category reuse is what callers actually depend on, so it is pinned here.
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);

    const before = api.getNotesWithLabel(labels.category).length;
    beRun({ action: 'createTool', labels, toolsRootId, category: 'Shell', title: 'ls', base: 'ls' });
    beRun({ action: 'createTool', labels, toolsRootId, category: 'Shell', title: 'cp', base: 'cp' });
    assert.equal(
        api.getNotesWithLabel(labels.category).length,
        before + 1,
        'the second tool reused the Shell category'
    );

    assert.throws(
        () => beRun({ action: 'createTool', labels, toolsRootId: 'missing', title: 'x' }),
        /Tools root not found/
    );
});

test('createTool returns ids and writes the exact H2 content and standard children', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const toolsRoot = api.getNote(toolsRootId);

    const content = [
        '<h2>What is?</h2>',
        '<p>tar bundles files into an archive.</p>',
        '<h2>Official links</h2>',
        '<p>https://www.gnu.org/software/tar/</p>',
        '<h2>Useful links</h2>',
        '<p>https://example.com/tar-cheatsheet</p>'
    ].join('\n');

    const created = beRun({
        action: 'createTool',
        labels,
        toolsRootId,
        category: 'Shell',
        title: 'tar',
        base: 'tar',
        description: 'Create archives.',
        content,
        install: 'winget install GnuWin32.Tar',
        usage: '<pre><code>tar -cf out.tar ./dir</code></pre>',
        help: 'Usage: tar [OPTIONS] [FILE]...',
        newToolNotes: Model.newToolNotes(),
        options: [
            { label: 'Create', flag: '-c', type: 'boolean', doc: 'Create a new archive.', order: 10 }
        ]
    });

    assert.ok(created.noteId, 'createTool returns the tool note id');
    assert.ok(created.optionsFolderId, 'createTool returns the Options folder id');
    assert.ok(created.presetsId, 'createTool returns the Presets note id');

    const tool = api.getNote(created.noteId);
    assert.equal(tool.getContent(), content, 'the passed H2 template is stored verbatim');
    assert.equal(tool.getLabelValue(labels.base), 'tar');
    assert.equal(tool.getLabelValue(labels.description), 'Create archives.');
    assert.equal(tool.getChildNotes()[0].title, 'Install');
    assert.equal(tool.getChildNotes()[1].title, 'Usage');
    assert.equal(tool.getChildNotes()[2].title, 'Help');
    assert.equal(tool.getChildNotes()[3].title, 'Options');

    assert.equal(findByTitle(tool, 'Install').getContent(), 'winget install GnuWin32.Tar');
    assert.equal(findByTitle(tool, 'Help').mime, 'text/x-sh');
    assert.equal(findByTitle(tool, 'Help').getContent(), 'Usage: tar [OPTIONS] [FILE]...');
    assert.equal(findByTitle(tool, 'Install').getLabelValue(labels.icon), Model.ICONS.install);
    assert.equal(findByTitle(tool, 'Usage').getLabelValue(labels.icon), Model.ICONS.usage);
    assert.equal(findByTitle(tool, 'Help').getLabelValue(labels.icon), Model.ICONS.help);
    assert.equal(findByTitle(tool, 'Options').getLabelValue(labels.icon), Model.ICONS.options);

    const folder = api.getNote(created.optionsFolderId);
    assert.ok(folder.hasLabel(labels.options));
    const presets = api.getNote(created.presetsId);
    assert.ok(presets.hasLabel(labels.presets));
    assert.equal(presets.getContent(), '{"v":1,"presets":[]}');

    const option = labelledChildren(folder, labels.option)[0];
    assert.equal(option.title, 'Create');
    assert.equal(option.getLabelValue(labels.flag), '-c');

    const category = findByTitle(toolsRoot, 'Shell');
    assert.ok(category.hasLabel(labels.category), 'the category folder was created on demand');

    // Omitted child content falls back to newToolNotes; missing category defaults.
    const minimal = beRun({
        action: 'createTool',
        labels,
        toolsRootId,
        title: 'zip',
        newToolNotes: Model.newToolNotes()
    });
    const zip = api.getNote(minimal.noteId);
    assert.equal(findByTitle(zip, 'Install').getContent(), Model.newToolNotes().install);
    assert.equal(findByTitle(zip, 'Help').getContent(), '');
    assert.equal(findByTitle(zip, 'Install').getLabelValue(labels.icon), Model.ICONS.install);
    assert.ok(findByTitle(toolsRoot, 'Uncategorized').hasLabel(labels.category));
    assert.equal(zip.hasLabel(labels.base), false, 'no base label when base is absent');
    assert.equal(zip.hasLabel(labels.description), false, 'no description label when absent');
});

test('addOption writes every option label including the help string', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const created = beRun({ action: 'createTool', labels, toolsRootId, title: 'curl', base: 'curl' });

    const option = beRun({
        action: 'addOption',
        labels,
        toolId: created.noteId,
        option: {
            label: 'Output file',
            flag: '-o',
            type: 'path',
            help: 'Write the response body to this file.',
            values: ['a', 'b'],
            default: 'out.bin',
            required: true,
            mode: 'inline',
            placeholder: 'output',
            order: 7,
            quote: 'single',
            separator: '=',
            content: 'Extra note body.'
        }
    });

    const note = api.getNote(option.noteId);
    const folder = api.getNote(created.optionsFolderId);
    assert.ok(folder.getChildNotes().some((child) => child.noteId === note.noteId));
    assert.equal(note.title, 'Output file');
    assert.equal(note.type, 'text');
    assert.equal(note.getContent(), 'Extra note body.');
    assert.equal(note.getLabelValue(labels.option), '');
    assert.equal(note.getLabelValue(labels.flag), '-o');
    assert.equal(note.getLabelValue(labels.doc), 'Write the response body to this file.');
    assert.equal(note.getLabelValue(labels.type), 'path');
    assert.equal(note.getLabelValue(labels.enumValues), 'a,b');
    assert.equal(note.getLabelValue(labels.defaultValue), 'out.bin');
    assert.equal(note.getLabelValue(labels.required), 'true');
    assert.equal(note.getLabelValue(labels.mode), 'inline');
    assert.equal(note.getLabelValue(labels.placeholder), 'output');
    assert.equal(note.getLabelValue(labels.order), '7');
    assert.equal(note.getLabelValue(labels.quote), 'single');
    assert.equal(note.getLabelValue(labels.separator), '=');

    // Only meaningful labels are written; boolean defaults become true/false.
    const plain = beRun({
        action: 'addOption',
        labels,
        toolId: created.noteId,
        option: { label: 'Silent', flag: '-s', type: 'boolean', default: false, doc: 'Quiet mode.' }
    });
    const plainNote = api.getNote(plain.noteId);
    assert.equal(plainNote.getLabelValue(labels.defaultValue), 'false');
    assert.equal(plainNote.getLabelValue(labels.doc), 'Quiet mode.');
    assert.equal(plainNote.hasLabel(labels.required), false);
    assert.equal(plainNote.hasLabel(labels.mode), false);
    assert.equal(plainNote.hasLabel(labels.enumValues), false);
    assert.equal(plainNote.hasLabel(labels.separator), false);
});

test('importOptions creates options and deleteOption removes one', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const created = beRun({ action: 'createTool', labels, toolsRootId, title: 'git', base: 'git' });

    const imported = beRun({
        action: 'importOptions',
        labels,
        toolId: created.noteId,
        options: [
            { label: 'Message', flag: '-m', type: 'string', doc: 'Commit message.' },
            { label: 'All', flag: '-a', type: 'boolean', doc: 'Stage tracked changes.' },
            { label: 'Amend', flag: '--amend', type: 'boolean', doc: 'Replace last commit.' }
        ]
    });

    assert.equal(imported.created, 3);
    assert.equal(imported.noteIds.length, 3);
    const folder = api.getNote(created.optionsFolderId);
    assert.equal(labelledChildren(folder, labels.option).length, 3);
    assert.equal(api.getNote(imported.noteIds[0]).getLabelValue(labels.doc), 'Commit message.');

    const deleted = beRun({ action: 'deleteOption', labels, noteId: imported.noteIds[1] });
    assert.equal(deleted.ok, true);
    assert.equal(api.getNote(imported.noteIds[1]).deleted, true);

    assert.throws(() => beRun({ action: 'deleteOption', labels, noteId: 'nope' }), /Option note not found/);
});

test('deleteOption refuses any note that is not an option', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId, rootId } = boot(api, beRun);
    const created = beRun({ action: 'createTool', labels, toolsRootId, title: 'git', base: 'git' });

    const category = api.getNote(toolsRootId).getChildNotes()[0];
    for (const noteId of [toolsRootId, created.noteId, category.noteId, rootId]) {
        assert.throws(
            () => beRun({ action: 'deleteOption', labels, noteId }),
            /not an option/,
            'a non-option note is protected'
        );
        assert.equal(api.getNote(noteId).deleted, false, 'the note is left untouched');
    }
});

test('importOptions skips flags that already exist on the tool', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const created = beRun({ action: 'createTool', labels, toolsRootId, title: 'git', base: 'git' });
    const folder = api.getNote(created.optionsFolderId);

    const first = beRun({
        action: 'importOptions',
        labels,
        toolId: created.noteId,
        options: [{ label: 'Message', flag: '-m', type: 'string', doc: 'Commit message.' }]
    });
    assert.equal(first.created, 1);

    const second = beRun({
        action: 'importOptions',
        labels,
        toolId: created.noteId,
        options: [
            { label: 'Message again', flag: '-m', type: 'string', doc: 'Duplicate.' },
            { label: 'Verbose', flag: '-v', type: 'boolean', doc: 'Be verbose.' }
        ]
    });
    assert.equal(second.created, 1, 'only the new flag is created');
    assert.equal(second.skipped, 1, 'the duplicate flag is reported');
    assert.equal(labelledChildren(folder, labels.option).length, 2);
});

test('savePreset and deletePreset round-trip through the JSON note', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const created = beRun({ action: 'createTool', labels, toolsRootId, title: 'curl', base: 'curl' });
    const presets = api.getNote(created.presetsId);

    const saved = beRun({
        action: 'savePreset',
        labels,
        toolId: created.noteId,
        name: 'fast',
        values: { 'note:a': '1', 'ph:url': 'https://example.com' }
    });
    assert.equal(saved.noteId, presets.noteId, 'savePreset returns the Presets note id');
    assert.deepEqual(JSON.parse(presets.getContent()), {
        v: 1,
        presets: [{ name: 'fast', values: { 'note:a': '1', 'ph:url': 'https://example.com' } }]
    });

    beRun({ action: 'savePreset', labels, toolId: created.noteId, name: 'fast', values: { 'note:a': '2' } });
    beRun({ action: 'savePreset', labels, toolId: created.noteId, name: 'safe', values: {} });
    assert.deepEqual(JSON.parse(presets.getContent()).presets, [
        { name: 'fast', values: { 'note:a': '2' } },
        { name: 'safe', values: {} }
    ]);

    const deleted = beRun({ action: 'deletePreset', labels, toolId: created.noteId, name: 'fast' });
    assert.equal(deleted.ok, true);
    assert.deepEqual(JSON.parse(presets.getContent()), { v: 1, presets: [{ name: 'safe', values: {} }] });

    beRun({ action: 'deletePreset', labels, toolId: created.noteId, name: 'ghost' });
    assert.deepEqual(JSON.parse(presets.getContent()).presets, [{ name: 'safe', values: {} }]);

    // Invalid JSON content is refused instead of silently wiping the note.
    presets.setContent('this is not json');
    assert.throws(function () {
        beRun({ action: 'savePreset', labels, toolId: created.noteId, name: 'recovered', values: { x: 1 } });
    }, /not valid JSON/);
    assert.equal(presets.getContent(), 'this is not json', 'the malformed note is left untouched');
    assert.throws(function () {
        beRun({ action: 'deletePreset', labels, toolId: created.noteId, name: 'safe' });
    }, /not valid JSON/);
    assert.equal(presets.getContent(), 'this is not json');
});

test('setToolBase sets and clears the base label', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const created = beRun({
        action: 'createTool',
        labels,
        toolsRootId,
        title: 'tar',
        base: 'tar',
        content: 'original'
    });
    const tool = api.getNote(created.noteId);
    assert.equal(tool.getLabelValue(labels.base), 'tar');

    const set = beRun({ action: 'setToolBase', labels, toolId: created.noteId, base: 'bsdtar' });
    assert.equal(set.ok, true);
    assert.equal(tool.getLabelValue(labels.base), 'bsdtar');

    const cleared = beRun({ action: 'setToolBase', labels, toolId: created.noteId, base: '' });
    assert.equal(cleared.ok, true);
    assert.equal(tool.hasLabel(labels.base), false, 'an empty base removes the label');

    assert.equal(tool.getContent(), 'original', 'clearing the base never rewrites content');
    assert.throws(
        () => beRun({ action: 'setToolBase', labels, toolId: 'nope', base: 'x' }),
        /Tool note not found/
    );
});

test('setToolsRoot moves the Tools label and clears the old root', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const elsewhere = api.createNewNote({
        parentNoteId: api.getTodayNote().noteId,
        title: 'Elsewhere',
        type: 'text',
        content: ''
    }).note;

    const moved = beRun({
        action: 'setToolsRoot',
        labels,
        noteId: elsewhere.noteId
    });
    assert.equal(moved.ok, true);
    assert.equal(api.getNoteWithLabel(labels.tools).noteId, elsewhere.noteId);
    assert.equal(elsewhere.hasLabel(labels.tools), true);
    assert.equal(api.getNote(toolsRootId).hasLabel(labels.tools), false, 'the old root is cleared');

    assert.throws(() => beRun({ action: 'setToolsRoot', labels, noteId: 'nope' }), /Note not found/);
});

test('setToolsRoot sweeps extra #cmTools labels, including hand-placed ones', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const today = api.getTodayNote().noteId;
    const handPlaced = api.createNewNote({
        parentNoteId: today,
        title: 'Hand-placed root',
        type: 'text',
        content: ''
    }).note;
    handPlaced.setLabel(labels.tools, '');
    const target = api.createNewNote({
        parentNoteId: today,
        title: 'Target',
        type: 'text',
        content: ''
    }).note;

    beRun({ action: 'setToolsRoot', labels, noteId: target.noteId });

    assert.equal(api.getNoteWithLabel(labels.tools).noteId, target.noteId, 'the target holds the pointer');
    assert.equal(api.getNote(toolsRootId).hasLabel(labels.tools), false, 'the old root is cleared');
    assert.equal(handPlaced.hasLabel(labels.tools), false, 'a hand-placed second root loses the pointer');
});

test('importOptions caps a hostile option list at the per-import limit', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);
    const tool = beRun({ action: 'createTool', labels, toolsRootId, title: 'cap', base: 'cap' });
    const specs = [];
    for (let index = 0; index < 205; index += 1) {
        specs.push({ label: 'o' + index, flag: '--o' + index });
    }

    const result = beRun({ action: 'importOptions', labels, toolId: tool.noteId, options: specs });
    assert.equal(result.created, 200, 'one action never creates thousands of notes');
    assert.equal(result.capped, 5, 'the excess is reported, not silently dropped');
});

test('importTool creates a tool note with its category, children and options', () => {
    const { api, beRun, result } = seedApi();
    const created = beRun({
        action: 'importTool',
        labels,
        toolsRootId: result.toolsRootId,
        newToolNotes: Model.newToolNotes(),
        tool: {
            title: 'ripgrep',
            category: 'Search',
            base: 'rg',
            description: 'Search text recursively.',
            content: '<h2>What is?</h2><p>Fast search.</p><h2>Official links</h2><ul></ul><h2>Useful links</h2><ul></ul>',
            install: '<p>cargo install ripgrep</p>',
            usage: '<pre><code>rg pattern</code></pre>',
            help: 'Usage: rg [OPTIONS] PATTERN\n  -i, --ignore-case  case insensitive',
            options: [
                { label: 'Ignore case', flag: '-i', help: 'Case insensitive.', type: 'boolean' },
                { label: 'Pattern', flag: '', help: 'Regex to search for.', type: 'string', required: true, placeholder: 'pattern', order: 20 }
            ]
        }
    });

    assert.ok(created.noteId);
    const toolsRoot = api.getNote(result.toolsRootId);
    const category = toolsRoot.getChildNotes().filter((child) => {
        return child.title === 'Search' && child.hasLabel(labels.category);
    })[0];
    assert.ok(category, 'the imported tool creates its category');
    assert.ok(category.getChildNotes().some((child) => child.noteId === created.noteId));

    const tool = api.getNote(created.noteId);
    assert.equal(tool.title, 'ripgrep');
    assert.ok(tool.hasLabel(labels.tool));
    assert.equal(tool.getLabelValue(labels.base), 'rg');
    assert.equal(tool.getLabelValue(labels.description), 'Search text recursively.');
    assert.match(tool.getContent(), /Fast search/);

    const install = findByTitle(tool, 'Install');
    const usage = findByTitle(tool, 'Usage');
    const help = findByTitle(tool, 'Help');
    assert.match(install.getContent(), /cargo install ripgrep/);
    assert.match(usage.getContent(), /rg pattern/);
    assert.match(help.getContent(), /ignore-case/);

    const options = labelledChildren(findByTitle(tool, 'Options'), labels.option);
    assert.equal(options.length, 2);
    assert.equal(options[0].getLabelValue(labels.flag), '-i');
    assert.equal(options[0].getLabelValue(labels.type), 'boolean');
    assert.equal(options[1].getLabelValue(labels.flag), null, 'positional options have no flag label');
    assert.equal(options[1].getLabelValue(labels.required), 'true');
    assert.equal(options[1].getLabelValue(labels.placeholder), 'pattern');
});

test('importTool restores tags, option content and presets from a v2 tool file', () => {
    const { api, beRun, result } = seedApi();
    const presetValues = { 'note:x': 'y', deep: {} };
    Object.defineProperty(presetValues, '__proto__', { value: 'nope', enumerable: true });
    const created = beRun({
        action: 'importTool',
        labels,
        toolsRootId: result.toolsRootId,
        newToolNotes: Model.newToolNotes(),
        tool: {
            title: 'rg2',
            category: 'Search',
            base: 'rg',
            tags: 'search, cli',
            options: [{ label: 'Ignore case', flag: '-i', type: 'boolean', content: '<p>Long explanation.</p>' }],
            presets: [
                { name: 'web', values: presetValues },
                { value: 1 }
            ]
        }
    });

    const tool = api.getNote(created.noteId);
    assert.equal(tool.getLabelValue(labels.tags), 'search, cli', 'tags land on the tool note');

    const options = labelledChildren(findByTitle(tool, 'Options'), labels.option);
    assert.match(options[0].getContent(), /Long explanation/, 'the option note body survives the import');

    const presetsNote = findByTitle(findByTitle(tool, 'Options'), 'Presets');
    const saved = JSON.parse(presetsNote.getContent());
    assert.equal(saved.v, 1);
    assert.deepEqual(
        saved.presets,
        [{ name: 'web', values: { 'note:x': 'y' } }],
        'magic and object values are filtered and nameless entries dropped'
    );
});

test('importTool without tags or presets keeps the empty-presets default', () => {
    const { api, beRun, result } = seedApi();
    const created = beRun({
        action: 'importTool',
        labels,
        toolsRootId: result.toolsRootId,
        newToolNotes: Model.newToolNotes(),
        tool: { title: 'plain', category: 'Misc', options: [{ label: 'Fast', flag: '-f', type: 'boolean' }] }
    });
    const tool = api.getNote(created.noteId);
    assert.equal(tool.getLabelValue(labels.tags), null, 'no tags label is invented');
    const option = labelledChildren(findByTitle(tool, 'Options'), labels.option)[0];
    assert.equal(option.getContent(), '', 'options without content stay empty');
    const presetsNote = findByTitle(findByTitle(tool, 'Options'), 'Presets');
    assert.deepEqual(JSON.parse(presetsNote.getContent()), { v: 1, presets: [] });
});

test('importTool falls back to the content template passed by the frontend', () => {
    const { api, beRun, result } = seedApi();
    const created = beRun({
        action: 'importTool',
        labels,
        toolsRootId: result.toolsRootId,
        newToolNotes: Model.newToolNotes(),
        tool: { title: 'bare tool', category: 'Misc' }
    });

    const content = api.getNote(created.noteId).getContent();
    assert.equal(content, Model.newToolNotes().content, 'the model owns the single template');
    assert.match(content, /<h2>What is\?<\/h2>/);
    assert.match(content, /<h2>Official links<\/h2>/);
    assert.match(content, /<h2>Useful links<\/h2>/);
});

test('ensureTab creates one render note, one HTML wrapper and one plugin clone', () => {
    const { api, beRun, result } = seedApi();
    const plugin = api.createNewNote({
        parentNoteId: result.rootId,
        title: 'Command Maker.js',
        type: 'code',
        mime: 'application/javascript;env=frontend',
        content: 'bundle'
    }).note;

    const first = beRun({
        action: 'ensureTab',
        labels: labels,
        rootId: result.rootId,
        scriptNoteId: plugin.noteId
    });
    assert.ok(first.tabNoteId);

    const root = api.getNote(result.rootId);
    const tabs = root.getChildNotes().filter((child) => child.hasLabel(labels.tab));
    const htmls = root.getChildNotes().filter((child) => child.hasLabel(labels.tabHtml));
    assert.equal(tabs.length, 1, 'one render note');
    assert.equal(htmls.length, 1, 'one HTML wrapper');
    assert.equal(tabs[0].type, 'render');
    assert.equal(tabs[0].getRelationValue('renderNote'), htmls[0].noteId);
    assert.equal(htmls[0].type, 'code');
    assert.equal(htmls[0].mime, 'text/html');
    assert.match(htmls[0].getContent(), /cm-tab-root/);
    assert.ok(
        htmls[0].getChildNotes().some((child) => child.noteId === plugin.noteId),
        'the plugin script is cloned under the HTML wrapper'
    );

    const second = beRun({
        action: 'ensureTab',
        labels: labels,
        rootId: result.rootId,
        scriptNoteId: plugin.noteId
    });
    assert.equal(second.tabNoteId, first.tabNoteId, 'reusing an existing tab note');
    assert.equal(root.getChildNotes().filter((child) => child.hasLabel(labels.tab)).length, 1);
    assert.equal(
        htmls[0].getChildNotes().filter((child) => child.noteId === plugin.noteId).length,
        1,
        'the plugin clone is not duplicated'
    );
});

test('unknown actions throw', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    assert.throws(() => beRun({ action: 'teleport', labels }), /Unknown action: teleport/);
    assert.throws(() => beRun({ labels }), /Unknown action: undefined/);
});

test('beRun body references no module-scope constants', () => {
    assert.equal(Backend.beRun.toString().indexOf('ACTIONS'), -1);
});
