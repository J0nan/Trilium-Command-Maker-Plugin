import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import Backend from '../src/backend.js';
import Model from '../src/model.js';

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
        newToolNotes: Model.newToolNotes()
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
        ['Media', 'Version control', 'Network'],
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

        const usage = findByTitle(tool, 'Usage');
        assert.ok(usage.hasLabel(labels.usage));
        assert.equal(usage.type, 'text');
        assert.equal(usage.getContent(), seed.usage);

        const help = findByTitle(tool, 'Help');
        assert.ok(help.hasLabel(labels.helpNote));
        assert.equal(help.type, 'code');
        assert.equal(help.mime, 'text/x-sh');
        assert.equal(help.getContent(), seed.help);

        const folder = findByTitle(tool, 'Options');
        assert.ok(folder.hasLabel(labels.options));
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

    const ffmpeg = findByTitle(findByTitle(toolsRoot, 'Media'), 'ffmpeg');
    const codec = labelledChildren(findByTitle(ffmpeg, 'Options'), labels.option)
        .find((option) => option.getLabelValue(labels.flag) === '-c:v');
    assert.equal(codec.title, 'Video codec');
    assert.equal(codec.getLabelValue(labels.type), 'enum');
    assert.equal(codec.getLabelValue(labels.enumValues), 'libx264,libx265,libvpx-vp9');
    assert.equal(codec.getLabelValue(labels.defaultValue), 'libx264');
    assert.equal(codec.getLabelValue(labels.doc), 'Video encoder to use.');
    assert.equal(codec.getLabelValue(labels.order), '20');

    // A second bootstrap with seed: true must not duplicate anything.
    const again = boot(api, beRun, { seed: true, seedTools: Model.seedTools() });
    assert.equal(again.rootId, seeded.rootId);
    assert.equal(again.toolsRootId, seeded.toolsRootId);
    assert.equal(again.seeded, false, 'seeding only happens once');
    assert.equal(api.getNotesWithLabel(labels.tool).length, seeds.length);
    assert.equal(api.getNotesWithLabel(labels.category).length, seeds.length);
});

test('relocating the Tools folder never seeds the chosen note', () => {
    const { api, beRun, result } = seedApi();
    const userFolder = api.createNewNote({
        parentNoteId: api.getTodayNote().noteId,
        title: 'My tools',
        type: 'text',
        content: 'user data'
    }).note;
    beRun({ action: 'setToolsRoot', labels, noteId: userFolder.noteId, oldToolsRootId: result.toolsRootId });
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

test('createCategory is idempotent and validates the Tools root', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const { toolsRootId } = boot(api, beRun);

    const first = beRun({ action: 'createCategory', labels, toolsRootId, name: 'Shell' });
    const second = beRun({ action: 'createCategory', labels, toolsRootId, name: 'Shell' });
    assert.equal(first.noteId, second.noteId, 'the same category is reused');
    const category = api.getNote(first.noteId);
    assert.equal(category.title, 'Shell');
    assert.ok(category.hasLabel(labels.category));

    assert.throws(
        () => beRun({ action: 'createCategory', labels, toolsRootId: 'missing', name: 'Shell' }),
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
        noteId: elsewhere.noteId,
        oldToolsRootId: toolsRootId
    });
    assert.equal(moved.ok, true);
    assert.equal(api.getNoteWithLabel(labels.tools).noteId, elsewhere.noteId);
    assert.equal(elsewhere.hasLabel(labels.tools), true);
    assert.equal(api.getNote(toolsRootId).hasLabel(labels.tools), false, 'the old root is cleared');

    assert.throws(() => beRun({ action: 'setToolsRoot', labels, noteId: 'nope' }), /Note not found/);
});

test('importLegacy converts legacy command notes exactly once', () => {
    const api = createApi();
    const beRun = serialise(Backend.beRun, api);
    const root = boot(api, beRun);
    const today = api.getTodayNote();

    const command = api.createNewNote({
        parentNoteId: today.noteId,
        title: 'docker run',
        type: 'code',
        content: 'docker run --rm {{image}}'
    }).note;
    command.setLabel(labels.legacyCommand, '');
    command.setLabel(labels.base, 'docker run --rm');
    command.setLabel(labels.description, 'Run a container.');
    const folder = api.createNewNote({
        parentNoteId: command.noteId,
        title: 'Options',
        type: 'text',
        content: ''
    }).note;
    folder.setLabel(labels.options, '');
    const template = api.createNewNote({
        parentNoteId: folder.noteId,
        title: 'Option Template',
        type: 'text',
        content: ''
    }).note;
    template.setLabel(labels.legacyOptionTemplate, '');
    const remove = api.createNewNote({
        parentNoteId: folder.noteId,
        title: 'Remove after exit',
        type: 'text',
        content: ''
    }).note;
    remove.setLabel(labels.flag, '--rm');
    remove.setLabel(labels.type, 'boolean');
    remove.setLabel(labels.order, '10');
    remove.setLabel(labels.required, 'true');
    const image = api.createNewNote({
        parentNoteId: folder.noteId,
        title: 'Image',
        type: 'text',
        content: ''
    }).note;
    image.setLabel(labels.flag, '{{image}}');
    image.setLabel(labels.type, 'enum');
    image.setLabel(labels.enumValues, 'nginx,alpine');
    image.setLabel(labels.defaultValue, 'nginx');
    image.setLabel(labels.quote, 'single');
    image.setLabel(labels.separator, '=');
    image.setLabel(labels.placeholder, 'image');

    // A second command without cmBase falls back to its content as the base.
    const compose = api.createNewNote({
        parentNoteId: today.noteId,
        title: 'docker compose',
        type: 'code',
        content: 'docker compose up'
    }).note;
    compose.setLabel(labels.legacyCommand, '');

    // Template notes carrying cmCommand must never be imported.
    const legacyTemplate = api.createNewNote({
        parentNoteId: today.noteId,
        title: 'Legacy Template',
        type: 'code',
        content: 'command goes here'
    }).note;
    legacyTemplate.setLabel(labels.legacyCommand, '');
    legacyTemplate.setLabel(labels.legacyTemplate, '');

    const imported = beRun({
        action: 'importLegacy',
        labels,
        toolsRootId: root.toolsRootId,
        newToolNotes: Model.newToolNotes()
    });
    assert.equal(imported.created, 2, 'both legacy commands were converted');
    assert.equal(imported.skipped, undefined);

    const toolsRoot = api.getNote(root.toolsRootId);
    const category = findByTitle(toolsRoot, 'Imported');
    assert.ok(category.hasLabel(labels.category));
    assert.deepEqual(category.getChildNotes().map((child) => child.title), ['docker run', 'docker compose']);

    const tool = findByTitle(category, 'docker run');
    assert.ok(tool.hasLabel(labels.tool));
    assert.equal(tool.getLabelValue(labels.base), 'docker run --rm');
    assert.equal(tool.getLabelValue(labels.description), 'Run a container.');
    const h2s = tool.getContent().match(/<h2>([^<]*)<\/h2>/g) || [];
    assert.deepEqual(h2s, ['<h2>What is?</h2>', '<h2>Official links</h2>', '<h2>Useful links</h2>']);
    assert.equal(findByTitle(tool, 'Install').getContent(), Model.newToolNotes().install);
    assert.equal(findByTitle(tool, 'Usage').getContent(), Model.newToolNotes().usage);
    assert.equal(findByTitle(tool, 'Help').mime, 'text/x-sh');

    const optionsFolder = findByTitle(tool, 'Options');
    const converted = labelledChildren(optionsFolder, labels.option);
    assert.equal(converted.length, 2, 'the legacy option template was skipped');
    const removeNote = converted.find((child) => child.title === 'Remove after exit');
    assert.equal(removeNote.getLabelValue(labels.flag), '--rm');
    assert.equal(removeNote.getLabelValue(labels.type), 'boolean');
    assert.equal(removeNote.getLabelValue(labels.order), '10');
    assert.equal(removeNote.getLabelValue(labels.required), 'true');
    const imageNote = converted.find((child) => child.title === 'Image');
    assert.equal(imageNote.getLabelValue(labels.enumValues), 'nginx,alpine');
    assert.equal(imageNote.getLabelValue(labels.defaultValue), 'nginx');
    assert.equal(imageNote.getLabelValue(labels.quote), 'single');
    assert.equal(imageNote.getLabelValue(labels.separator), '=');
    assert.equal(imageNote.getLabelValue(labels.placeholder), 'image');

    const composeTool = findByTitle(category, 'docker compose');
    assert.equal(composeTool.getLabelValue(labels.base), 'docker compose up', 'base falls back to content');

    assert.equal(api.getNote(root.rootId).getLabelValue(labels.migrated), '');

    const second = beRun({ action: 'importLegacy', labels, toolsRootId: root.toolsRootId });
    assert.equal(second.created, 0);
    assert.equal(second.skipped, true);
    assert.equal(api.getNotesWithLabel(labels.tool).length, 2, 'nothing was imported twice');
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
