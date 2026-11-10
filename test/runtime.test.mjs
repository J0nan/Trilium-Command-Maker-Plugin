import test from 'node:test';
import assert from 'node:assert/strict';

import Runtime from '../src/runtime.js';
import Version from '../src/version.js';

function makeNote(spec) {
    const labels = spec.labels || {};
    const children = spec.children || [];
    return {
        noteId: spec.noteId,
        title: spec.title,
        type: spec.type || 'text',
        content: spec.content || '',
        children: children,
        getLabelValue(name) {
            return Object.prototype.hasOwnProperty.call(labels, name) ? labels[name] : null;
        },
        hasLabel(name) {
            return Object.prototype.hasOwnProperty.call(labels, name);
        },
        getChildNotes() {
            return Promise.resolve(children);
        },
        getContent() {
            return Promise.resolve(spec.content || '');
        },
        getParentNotes() {
            return spec.parents || [];
        },
        getBestNotePathString() {
            return 'root/' + spec.noteId;
        }
    };
}

function installApi(tool, extraNotes) {
    const notes = new Map();
    notes.set(tool.noteId, tool);
    Object.keys(extraNotes || {}).forEach((id) => {
        notes.set(id, extraNotes[id]);
    });
    const calls = [];
    globalThis.api = {
        async runOnBackend(fn, params) {
            calls.push(params[0]);
            if (params[0].action === 'bootstrap') {
                return { rootId: 'root', toolsRootId: 'tools' };
            }
            if (params[0].action === 'ensureTab') {
                return { tabNoteId: 'tab-note' };
            }
            return {};
        },
        async searchForNote(query) {
            return query === '#cmTools' ? { noteId: 'tools', title: 'Tools' } : null;
        },
        async searchForNotes(query) {
            return query === '#cmTool' ? [tool] : [];
        },
        async getNote(noteId) {
            return notes.get(noteId) || null;
        },
        getActiveContextNote() {
            return null;
        }
    };
    return calls;
}

function makeTool() {
    const category = makeNote({ noteId: 'cat1', title: 'Media' });
    const input = makeNote({
        noteId: 'o1',
        title: 'Input file',
        labels: { cmOption: '', cmFlag: '-i', cmType: 'path', cmDoc: 'Input file to read.', cmDefault: 'in.mp4' },
        content: '<p>Read the input file.</p>'
    });
    const codec = makeNote({
        noteId: 'o2',
        title: 'Video codec',
        labels: { cmOption: '', cmFlag: '-c:v', cmType: 'enum', cmValues: 'libx264,libx265', cmDoc: 'Video encoder.', cmDefault: 'libx264' }
    });
    const options = makeNote({
        noteId: 'opts',
        title: 'Options',
        labels: { cmOptions: '' },
        children: [input, codec]
    });
    const presets = makeNote({
        noteId: 'presets',
        title: 'Presets',
        type: 'code',
        labels: { cmPresets: '' },
        content: JSON.stringify({ v: 1, presets: [{ name: 'web', values: { 'note:o1': 'web.mp4' } }] })
    });
    options.children.push(presets);
    const install = makeNote({
        noteId: 'install',
        title: 'Install',
        labels: { cmInstall: '' },
        content: '<p>winget install ffmpeg</p>'
    });
    const usage = makeNote({
        noteId: 'usage',
        title: 'Usage',
        labels: { cmUsage: '' },
        content: '<p>Compress a video:</p><pre><code>ffmpeg -i in.mp4 out.mp4</code></pre>'
    });
    const help = makeNote({
        noteId: 'help',
        title: 'Help',
        type: 'code',
        labels: { cmHelpNote: '' },
        content: 'Usage: ffmpeg [options] ...\n  -i input  input file'
    });
    const tool = makeNote({
        noteId: 't1',
        title: 'ffmpeg',
        labels: { cmTool: '', cmBase: 'ffmpeg', cmDesc: 'Media toolkit', cmTags: 'video, media' },
        content: [
            '<h2>What is?</h2><p>Encode and process video.</p>',
            '<h2>Official links</h2><ul><li><a href="https://ffmpeg.org">ffmpeg.org</a></li></ul>',
            '<h2>Useful links</h2><ul><li><a href="https://ffmpeg.org/ffmpeg.html">Reference</a></li></ul>'
        ].join(''),
        children: [install, usage, help, options],
        parents: [category]
    });
    return { tool: tool, install: install, usage: usage, help: help, options: options, presets: presets };
}

test('refresh indexes tool title, category, base, option help and What is? text', async () => {
    const built = makeTool();
    const calls = installApi(built.tool, {});
    await Runtime.refresh();

    assert.equal(calls[0].action, 'bootstrap');
    assert.equal(calls[0].version, Version.VERSION, 'bootstrap records the installed version');
    assert.equal(Runtime.search('ffmpeg').length, 1, 'base is indexed');
    assert.equal(Runtime.search('media').length, 1, 'category is indexed');
    assert.equal(Runtime.search('input').length, 1, 'option title is indexed');
    assert.equal(Runtime.search('encoder').length, 1, 'option help is indexed');
    assert.equal(Runtime.search('process video').length, 1, 'What is? text is indexed');
    assert.equal(Runtime.search('docker').length, 0);
    globalThis.api = undefined;
});

test('updateOption applies the backend snapshot without waiting for a refresh', async () => {
    const built = makeTool();
    const calls = installApi(built.tool, {});
    await Runtime.refresh();

    const api = globalThis.api;
    const originalRun = api.runOnBackend;
    api.runOnBackend = async function (fn, params) {
        calls.push(params[0]);
        if (params[0].action === 'updateOption') {
            return {
                noteId: 'o1',
                title: 'Source file',
                labels: {
                    cmOption: '',
                    cmFlag: '--src',
                    cmType: 'string',
                    cmDoc: 'Where to read.',
                    cmDefault: 'in.mp4',
                    cmOrder: '5'
                }
            };
        }
        return originalRun(fn, params);
    };

    await Runtime.controller().updateOption('o1', { label: 'Source file', flag: '--src', type: 'string' });
    const loaded = await Runtime.load('t1');
    const option = loaded.definition.options.filter((entry) => entry.noteId === 'o1')[0];
    assert.equal(option.title, 'Source file');
    assert.equal(option.flag, '--src');
    assert.equal(option.help, 'Where to read.');
    assert.equal(option.order, 5);
    assert.equal(Runtime.search('where to read').length, 1, 'the edited help is searchable immediately');
    assert.equal(Runtime.search('input file to read').length, 0, 'the old help is not searchable');
    globalThis.api = undefined;
});

test('a tool nested under two folders exposes its whole category path', async () => {
    const built = makeTool();
    const outer = makeNote({ noteId: 'cat-outer', title: 'Infrastructure' });
    const inner = makeNote({ noteId: 'cat-inner', title: 'Wifi', parents: [outer] });
    built.tool.getParentNotes = function () {
        return [inner];
    };
    installApi(built.tool, {});
    await Runtime.refresh();

    const item = Runtime.search('wifi')[0];
    assert.equal(item.category, 'Wifi', 'the immediate folder stays the category');
    assert.equal(item.categoryLabel, 'Infrastructure / Wifi');
    assert.deepEqual(item.categoryPath, ['Infrastructure', 'Wifi']);
    assert.equal(Runtime.search('infrastructure').length, 1, 'the outer folder is searchable');

    const loaded = await Runtime.load('t1');
    assert.equal(loaded.definition.category, 'Wifi');
    assert.equal(loaded.definition.categoryLabel, 'Infrastructure / Wifi');
    assert.deepEqual(loaded.definition.categoryPath, ['Infrastructure', 'Wifi']);
    globalThis.api = undefined;
});

test('load returns options with help, examples, links, help output, install and presets', async () => {
    const built = makeTool();
    installApi(built.tool, {});
    await Runtime.refresh();

    const loaded = await Runtime.load('t1');
    assert.equal(loaded.definition.title, 'ffmpeg');
    assert.equal(loaded.definition.base, 'ffmpeg');
    assert.equal(loaded.definition.category, 'Media');
    assert.equal(loaded.definition.options.length, 2);
    assert.equal(loaded.definition.options[0].help, 'Input file to read.');
    assert.match(loaded.whatIs, /Encode and process video/);
    assert.deepEqual(loaded.links.map((link) => link.href), ['https://ffmpeg.org', 'https://ffmpeg.org/ffmpeg.html']);
    assert.deepEqual(loaded.usageExamples, ['ffmpeg -i in.mp4 out.mp4']);
    assert.match(loaded.helpText, /Usage: ffmpeg/);
    assert.match(loaded.installText, /winget install ffmpeg/);
    assert.equal(loaded.installHtml, '<p>winget install ffmpeg</p>', 'the raw Install HTML is available');
    assert.equal(loaded.installIsCode, false);
    assert.equal(loaded.presets.length, 1);
    assert.equal(loaded.presets[0].name, 'web');
    globalThis.api = undefined;
});

test('a preset value map cannot smuggle keys into Object.prototype', async () => {
    const built = makeTool();
    const hostileContent = JSON.stringify({
        v: 1,
        presets: [{
            name: 'hostile',
            values: {
                '__proto__': { polluted: true },
                'constructor': 'x',
                'note:o1': 'web.mp4',
                'note:o2': { nested: true }
            }
        }]
    });
    built.presets.getContent = function () {
        return Promise.resolve(hostileContent);
    };
    installApi(built.tool, {});
    await Runtime.refresh();

    const loaded = await Runtime.load('t1');
    const preset = loaded.presets.filter((entry) => entry.name === 'hostile')[0];
    assert.ok(preset, 'the preset is still listed');
    assert.deepEqual(Object.keys(preset.values), ['note:o1'], 'only plain string values survive');
    assert.equal({}.polluted, undefined, 'Object.prototype is untouched');
    assert.equal(Object.getPrototypeOf(preset.values), Object.prototype, 'the value map keeps its prototype');
    globalThis.api = undefined;
});

test('refresh falls back to #cmBase when present and to the title otherwise', async () => {
    const built = makeTool();
    installApi(built.tool, {});
    await Runtime.refresh();
    assert.equal(Runtime.search('ffmpeg').length, 1);

    built.tool.getLabelValue = function (name) {
        if (name === 'cmBase') {
            return 'ffmpeg -hide_banner';
        }
        return null;
    };
    await Runtime.refresh();
    assert.equal(Runtime.search('hide_banner').length, 1);
    globalThis.api = undefined;
});

test('exportTool builds a portable file with raw contents and every option', async () => {
    const built = makeTool();
    installApi(built.tool, {});
    await Runtime.refresh();
    const controller = Runtime.controller();

    const file = await controller.exportTool('t1');
    assert.equal(file.kind, 'command-maker-tool');
    assert.equal(file.version, 2, 'exports use the lossless v2 format');
    assert.equal(file.tool.title, 'ffmpeg');
    assert.equal(file.tool.category, 'Media');
    assert.deepEqual(file.tool.categoryPath, ['Media'], 'a flat folder exports as a one-entry path');
    assert.equal(file.tool.base, 'ffmpeg');
    assert.equal(file.tool.description, 'Media toolkit');
    assert.equal(file.tool.tags, 'video, media', 'the backup carries the tool tags');
    assert.match(file.tool.content, /<h2>What is\?<\/h2>/);
    assert.match(file.tool.install, /<p>winget install ffmpeg<\/p>/, 'install keeps its HTML');
    assert.match(file.tool.usage, /<pre><code>ffmpeg -i in.mp4 out.mp4<\/code><\/pre>/);
    assert.match(file.tool.help, /Usage: ffmpeg/);
    assert.equal(file.tool.options.length, 2);
    assert.equal(file.tool.options[0].label, 'Input file');
    assert.equal(file.tool.options[0].flag, '-i');
    assert.equal(file.tool.options[0].type, 'path');
    assert.equal(file.tool.options[0].content, '<p>Read the input file.</p>', 'option note bodies are in the backup');
    assert.equal(file.tool.options[1].content, '', 'options without a body export as empty, not undefined');
    assert.deepEqual(file.tool.options[1].values, ['libx264', 'libx265']);
    assert.deepEqual(
        file.tool.presets,
        [{ name: 'web', values: { 'note:o1': 'web.mp4' } }],
        'the presets JSON survives the export'
    );

    globalThis.api = undefined;
});

test('load reports a tool note that was deleted externally instead of rendering it empty', async () => {
    const built = makeTool();
    installApi(built.tool, {});
    await Runtime.refresh();
    const controller = Runtime.controller();

    built.tool.getContent = () => Promise.reject(new Error('note deleted'));
    await assert.rejects(
        () => controller.load('t1'),
        /could not be read/,
        'a vanished tool note surfaces as a readable error, not a silent empty pane'
    );

    globalThis.api = undefined;
});

test('importTool posts the portable spec to the backend', async () => {
    const built = makeTool();
    const calls = installApi(built.tool, {});
    await Runtime.refresh();
    const controller = Runtime.controller();

    await controller.importTool({
        title: 'ripgrep',
        category: 'Search',
        base: 'rg',
        options: [{ label: 'Pattern', flag: '', type: 'string', required: true }]
    });

    const call = calls.filter((entry) => entry.action === 'importTool')[0];
    assert.ok(call, 'importTool backend action was called');
    assert.equal(call.toolsRootId, 'tools');
    assert.equal(call.tool.title, 'ripgrep');
    assert.equal(call.tool.options.length, 1);

    globalThis.api = undefined;
});

test('createTool sends the three-H2 template and the standard child content', async () => {
    const built = makeTool();
    const calls = installApi(built.tool, {});
    await Runtime.refresh();
    const controller = Runtime.controller();

    await controller.createTool({ title: 'docker', category: 'Containers', base: 'docker', description: '' });
    const create = calls.filter((call) => call.action === 'createTool')[0];
    assert.ok(create, 'createTool backend action was called');
    assert.match(create.content, /<h2>What is\?<\/h2>/);
    assert.match(create.content, /<h2>Official links<\/h2>/);
    assert.match(create.content, /<h2>Useful links<\/h2>/);
    assert.match(create.install, /installation/i);
    assert.match(create.usage, /examples/i);
    assert.equal(create.title, 'docker');
    assert.equal(create.category, 'Containers');
    globalThis.api = undefined;
});

test('createTool forwards a nested category path and categories lists whole paths', async () => {
    const built = makeTool();
    const outer = makeNote({ noteId: 'cat-outer', title: 'Infrastructure' });
    const inner = makeNote({ noteId: 'cat-inner', title: 'Wifi', parents: [outer] });
    built.tool.getParentNotes = function () {
        return [inner];
    };
    const calls = installApi(built.tool, {});
    await Runtime.refresh();
    const controller = Runtime.controller();

    assert.deepEqual(controller.categories(), [
        { path: ['Infrastructure', 'Wifi'], label: 'Infrastructure / Wifi' }
    ]);

    await controller.createTool({
        title: 'iwconfig',
        categoryPath: ['Infrastructure', 'Wifi'],
        base: 'iwconfig',
        description: ''
    });
    const create = calls.filter((call) => call.action === 'createTool')[0];
    assert.deepEqual(create.categoryPath, ['Infrastructure', 'Wifi']);
    assert.equal(create.category, 'Wifi', 'the leaf is derived from the path');
    globalThis.api = undefined;
});

test('setToolBase forwards the tool id and the new base', async () => {
    const built = makeTool();
    const calls = installApi(built.tool, {});
    await Runtime.refresh();
    const controller = Runtime.controller();

    await controller.setToolBase('t1', 'ffmpeg -hide_banner');
    const call = calls.filter((entry) => entry.action === 'setToolBase')[0];
    assert.ok(call);
    assert.equal(call.toolId, 't1');
    assert.equal(call.base, 'ffmpeg -hide_banner');
    globalThis.api = undefined;
});

test('openInTab ensures the tab structure and opens the render note', async () => {
    const built = makeTool();
    const calls = installApi(built.tool, {});
    await Runtime.refresh();

    const opened = [];
    let synced = false;
    globalThis.api.startNote = { noteId: 'plugin-note' };
    globalThis.api.waitUntilSynced = async function () {
        synced = true;
    };
    globalThis.api.openTabWithNote = async function (noteId, activate) {
        opened.push({ noteId: noteId, activate: activate });
    };

    const controller = Runtime.controller();
    const tabNoteId = await controller.openInTab();

    assert.equal(tabNoteId, 'tab-note');
    const ensure = calls.filter((entry) => entry.action === 'ensureTab')[0];
    assert.ok(ensure, 'ensureTab reaches the backend');
    assert.equal(ensure.rootId, 'root');
    assert.equal(ensure.scriptNoteId, 'plugin-note');
    assert.equal(synced, true, 'the new notes are synced before the tab opens');
    assert.deepEqual(opened, [{ noteId: 'tab-note', activate: true }]);

    globalThis.api = undefined;
});