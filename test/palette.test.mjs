import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { buildBundle } from '../tools/build.mjs';
import Version from '../src/version.js';

function classed(node, name) {
    return String(node.className || '').split(/\s+/).indexOf(name) !== -1;
}

function walk(node, visit) {
    visit(node);
    for (const child of node.children || []) {
        walk(child, visit);
    }
}

function find(root, predicate) {
    let found = null;
    walk(root, (node) => {
        if (!found && predicate(node)) {
            found = node;
        }
    });
    return found;
}

function findAll(root, predicate) {
    const out = [];
    walk(root, (node) => {
        if (predicate(node)) {
            out.push(node);
        }
    });
    return out;
}

function createDom() {
    const document = { head: null, body: null, activeElement: null };

    function makeNode(tag) {
        let text = '';
        const node = {
            tagName: String(tag).toUpperCase(),
            id: '',
            className: '',
            children: [],
            attributes: {},
            listeners: {},
            value: '',
            type: '',
            placeholder: '',
            checked: false,
            disabled: false,
            rows: 0,
            files: null,
            style: {},
            classList: {
                add(name) {
                    if (!classed(node, name)) {
                        node.className = (node.className + ' ' + name).trim();
                    }
                },
                remove(name) {
                    node.className = String(node.className)
                        .split(/\s+/)
                        .filter((entry) => entry !== '' && entry !== name)
                        .join(' ');
                },
                toggle(name, on) {
                    if (on) {
                        node.classList.add(name);
                    } else {
                        node.classList.remove(name);
                    }
                },
                contains(name) {
                    return classed(node, name);
                }
            },
            appendChild(child) {
                node.children.push(child);
                return child;
            },
            append() {
                for (const child of arguments) {
                    node.children.push(child);
                }
            },
            addEventListener(name, handler) {
                node.listeners[name] = node.listeners[name] || [];
                node.listeners[name].push(handler);
            },
            removeEventListener(name, handler) {
                const handlers = node.listeners[name] || [];
                const index = handlers.indexOf(handler);
                if (index >= 0) {
                    handlers.splice(index, 1);
                }
            },
            removeAttribute(name) {
                delete node.attributes[name];
            },
            remove() {
                node.removed = true;
            },
            focus() {
                document.activeElement = node;
            },
            select() {},
            setAttribute(name, value) {
                node.attributes[name] = String(value);
            },
            getAttribute(name) {
                return Object.prototype.hasOwnProperty.call(node.attributes, name) ? node.attributes[name] : null;
            },
            scrollIntoView() {},
            dispatch(name, event) {
                const payload = Object.assign({ preventDefault() {}, target: node }, event || {});
                (node.listeners[name] || []).slice().forEach((handler) => handler(payload));
            },
            click() {
                node.dispatch('click');
            }
        };
        Object.defineProperty(node, 'textContent', {
            get() {
                return text;
            },
            set(value) {
                text = String(value);
                node.children.length = 0;
            }
        });
        return node;
    }

    document.createElement = makeNode;
    document.head = makeNode('head');
    document.body = makeNode('body');
    document.getElementById = function (id) {
        let found = null;
        walk(document.head, (node) => {
            if (!found && node.id === id) {
                found = node;
            }
        });
        if (!found) {
            walk(document.body, (node) => {
                if (!found && node.id === id) {
                    found = node;
                }
            });
        }
        return found;
    };
    return document;
}

function note(spec) {
    const labels = spec.labels || {};
    return {
        noteId: spec.noteId,
        title: spec.title,
        type: spec.type || 'text',
        getLabelValue(name) {
            return Object.prototype.hasOwnProperty.call(labels, name) ? labels[name] : null;
        },
        hasLabel(name) {
            return Object.prototype.hasOwnProperty.call(labels, name);
        },
        async getChildNotes() {
            return spec.children || [];
        },
        async getContent() {
            return spec.content || '';
        },
        getParentNotes() {
            return spec.parents || [];
        },
        getBestNotePathString() {
            return 'root/' + spec.noteId;
        }
    };
}

function tick() {
    return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate, label) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
        const value = predicate();
        if (value) {
            return value;
        }
        await tick();
    }
    throw new Error('timed out waiting for ' + (label || 'condition'));
}

function buildFixture() {
    const media = note({ noteId: 'cat-media', title: 'Media' });
    const vcs = note({ noteId: 'cat-vcs', title: 'Version control' });

    const input = note({
        noteId: 'o1',
        title: 'Input file',
        labels: { cmOption: '', cmFlag: '-i', cmType: 'path', cmDoc: 'Input file to read.', cmDefault: 'in.mp4', cmOrder: '10', cmRequired: 'true' }
    });
    const codec = note({
        noteId: 'o2',
        title: 'Video codec',
        labels: { cmOption: '', cmFlag: '-c:v', cmType: 'enum', cmValues: 'libx264,libx265', cmDoc: 'Video encoder.', cmDefault: 'libx264', cmOrder: '20' }
    });
    const verbose = note({
        noteId: 'o3',
        title: 'Verbose',
        labels: { cmOption: '', cmFlag: '-v', cmType: 'boolean', cmDoc: 'Print more details.', cmOrder: '30' }
    });
    const presets = note({
        noteId: 'presets1',
        title: 'Presets',
        type: 'code',
        labels: { cmPresets: '' },
        content: JSON.stringify({ v: 1, presets: [{ name: 'web', values: { 'note:o1': 'web.mp4' } }] })
    });
    const options = note({
        noteId: 'opts1',
        title: 'Options',
        labels: { cmOptions: '' },
        children: [input, codec, verbose, presets]
    });
    const install = note({
        noteId: 'i1',
        title: 'Install',
        labels: { cmInstall: '' },
        content: '<p>winget install Gyan.FFmpeg</p>'
    });
    const usage = note({
        noteId: 'u1',
        title: 'Usage',
        labels: { cmUsage: '' },
        content: '<p>Compress a video:</p><pre><code>ffmpeg -i in.mp4 out.mp4</code></pre>'
    });
    const help = note({
        noteId: 'h1',
        title: 'Help',
        type: 'code',
        labels: { cmHelpNote: '' },
        content: 'Usage: ffmpeg [options] ...\n  -i input  input file'
    });
    const ffmpeg = note({
        noteId: 't1',
        title: 'ffmpeg',
        labels: { cmTool: '', cmBase: 'ffmpeg', cmDesc: 'Media toolkit' },
        content: [
            '<h2>What is?</h2><p>Encode and process video.</p>',
            '<h2>Official links</h2><ul><li><a href="https://ffmpeg.org">ffmpeg.org</a></li></ul>',
            '<h2>Useful links</h2><ul><li><a href="https://ffmpeg.org/ffmpeg.html">Reference</a></li></ul>'
        ].join(''),
        children: [install, usage, help, options],
        parents: [media]
    });

    const message = note({
        noteId: 'g1',
        title: 'Message',
        labels: { cmOption: '', cmFlag: '-m', cmType: 'string', cmDoc: 'Commit message.', cmOrder: '10' }
    });
    const gitOptions = note({
        noteId: 'opts2',
        title: 'Options',
        labels: { cmOptions: '' },
        children: [message, presets]
    });
    const git = note({
        noteId: 't2',
        title: 'git commit',
        labels: { cmTool: '', cmBase: 'git commit', cmDesc: 'Record changes' },
        content: '<h2>What is?</h2><p>Record staged changes.</p>',
        children: [gitOptions],
        parents: [vcs]
    });

    return { tools: [ffmpeg, git], ffmpeg: ffmpeg, git: git, media: media, vcs: vcs };
}

function makeApi(fixture) {
    const calls = { backend: [], copied: [], inserted: [], errors: [], activated: [] };
    const api = {
        async runOnBackend(fn, params) {
            calls.backend.push(params[0]);
            if (params[0].action === 'bootstrap') {
                return { rootId: 'root', toolsRootId: 'tools', seeded: true };
            }
            if (params[0].action === 'createTool') {
                return { noteId: 'new-tool' };
            }
            if (params[0].action === 'importOptions') {
                return { created: (params[0].options || []).length };
            }
            return {};
        },
        async searchForNote(query) {
            if (query === '#cmTools') {
                return { noteId: 'tools', title: 'Tools' };
            }
            return null;
        },
        async searchForNotes(query) {
            return query === '#cmTool' ? fixture.tools : [];
        },
        async getNote(noteId) {
            return fixture.tools.filter((entry) => entry.noteId === noteId)[0] || null;
        },
        getActiveContextNote() {
            return { noteId: 'active', title: 'Active note' };
        },
        addTextToActiveContextEditor(text) {
            calls.inserted.push(text);
        },
        activateNote(path) {
            calls.activated.push(path);
        },
        showError(message) {
            calls.errors.push(message);
        }
    };
    const navigator = {
        clipboard: {
            async writeText(text) {
                calls.copied.push(text);
            }
        }
    };
    return { api: api, calls: calls, navigator: navigator };
}

function run(dom, api, navigator, extra) {
    const context = vm.createContext(Object.assign({
        api,
        window: {},
        document: dom,
        navigator,
        console,
        setTimeout,
        clearTimeout,
        setImmediate,
        getComputedStyle(node) {
            if (classed(node, 'hljs')) {
                return { backgroundColor: 'rgb(30, 30, 30)', color: 'rgb(212, 212, 212)' };
            }
            return { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(200, 200, 200)' };
        }
    }, extra || {}));
    vm.runInContext(buildBundle(), context);
}

test('palette lists tools, shows option help, examples, help, copy/insert and presets', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    const row = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    assert.equal(row.children[0].textContent, 'ffmpeg');
    assert.equal(find(dom.body, (node) => classed(node, 'cm-cat')).textContent, 'Media');
    assert.equal(env.calls.backend[0].action, 'bootstrap');

    const style = dom.getElementById('cm-palette-style');
    assert.ok(style, 'palette stylesheet is injected');
    assert.match(style.textContent, /:root \.cm-preview:hover/);
    assert.match(style.textContent, /\.cm-opt-help/);
    assert.equal(style.textContent.includes('#f4f4f4'), false, 'no hard-coded light code background');

    const versionButton = find(dom.body, (node) => classed(node, 'cm-version'));
    assert.ok(versionButton, 'the palette footer shows the version');
    assert.equal(versionButton.textContent, 'v' + Version.VERSION);

    const overlay = find(dom.body, (node) => classed(node, 'cm-overlay'));
    overlay.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(
        find(dom.body, (node) => classed(node, 'is-active')).children[0].textContent,
        'ffmpeg'
    );
    overlay.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(
        find(dom.body, (node) => classed(node, 'is-active')).children[0].textContent,
        'git commit'
    );
    overlay.dispatch('keydown', { key: 'ArrowUp' });
    assert.equal(
        find(dom.body, (node) => classed(node, 'is-active')).children[0].textContent,
        'ffmpeg'
    );

    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    const preview = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');
    assert.equal(preview.value, 'ffmpeg -i in.mp4 -c:v libx264');
    assert.equal(preview.style.background, 'rgb(30, 30, 30)');
    assert.equal(preview.style.color, 'rgb(212, 212, 212)');

    const helpTexts = findAll(dom.body, (node) => classed(node, 'cm-opt-help')).map((node) => node.textContent);
    assert.ok(helpTexts.indexOf('Input file to read.') !== -1, 'option help string is rendered');
    assert.ok(helpTexts.indexOf('Video encoder.') !== -1, 'enum help string is rendered');

    const requiredBadge = find(dom.body, (node) => classed(node, 'cm-required-badge'));
    assert.ok(requiredBadge, 'a required option shows a badge');
    assert.equal(requiredBadge.textContent, 'Required');
    assert.ok(find(dom.body, (node) => classed(node, 'cm-option-required')), 'the required row is marked');
    assert.match(find(dom.body, (node) => classed(node, 'cm-required-hint')).textContent, /1 required/);

    const example = find(dom.body, (node) => classed(node, 'cm-example-text'));
    assert.equal(example.textContent, 'ffmpeg -i in.mp4 out.mp4');

    const helpPre = findAll(dom.body, (node) => node.tagName === 'PRE').filter((node) => /Usage: ffmpeg/.test(node.textContent))[0];
    assert.ok(helpPre, 'help output is rendered in a pre block');
    const installPre = findAll(dom.body, (node) => node.tagName === 'PRE').filter((node) => /winget install/.test(node.textContent))[0];
    assert.ok(installPre, 'install steps are rendered');

    const links = findAll(dom.body, (node) => node.tagName === 'A' && classed(node, 'cm-link')).map((node) => node.textContent);
    assert.deepEqual(links, ['ffmpeg.org', 'Reference']);

    const inputControl = findAll(dom.body, (node) => classed(node, 'cm-control') && node.placeholder === '-i')[0];
    assert.ok(inputControl, 'path option renders a text control');
    inputControl.value = 'in file.mp4';
    inputControl.dispatch('input');
    await tick();
    assert.equal(preview.value, 'ffmpeg -i in file.mp4 -c:v libx264');

    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Copy')[0].click();
    await waitFor(() => env.calls.copied.length > 0, 'clipboard write');
    assert.equal(env.calls.copied[0], 'ffmpeg -i in file.mp4 -c:v libx264');

    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Insert')[0].click();
    await waitFor(() => env.calls.inserted.length > 0, 'editor insert');
    assert.equal(env.calls.inserted[0], 'ffmpeg -i in file.mp4 -c:v libx264');

    const useButton = findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Use')[0];
    useButton.click();
    await tick();
    const examplePreview = find(dom.body, (node) => classed(node, 'cm-preview'));
    assert.equal(examplePreview.value, 'ffmpeg -i in.mp4 out.mp4', 'the example is shown verbatim');

    const exampleInput = findAll(dom.body, (node) => classed(node, 'cm-control') && node.placeholder === '-i')[0];
    assert.equal(exampleInput.value, 'in.mp4', 'the example updates the option control');
    const exampleCodec = findAll(dom.body, (node) => {
        return node.tagName === 'SELECT' && node.children.some((child) => child.value === 'libx264');
    })[0];
    assert.equal(exampleCodec.value, '', 'an option omitted by the example is cleared');
    const exampleBoolean = findAll(dom.body, (node) => node.tagName === 'INPUT' && node.type === 'checkbox')[0];
    assert.equal(exampleBoolean.checked, false, 'an omitted boolean is unchecked');

    // Regenerate rebuilds from the form values the example set.
    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Regenerate')[0].click();
    await tick();
    assert.equal(find(dom.body, (node) => classed(node, 'cm-preview')).value, 'ffmpeg -i in.mp4');

    // Presets load the saved value map into the controls and the preview.
    const presetSelect = findAll(dom.body, (node) => {
        return node.tagName === 'SELECT' && node.children.some((child) => child.value === 'web');
    })[0];
    presetSelect.value = 'web';
    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Load')[0].click();
    await tick();
    const reloadedPreview = find(dom.body, (node) => classed(node, 'cm-preview'));
    assert.equal(reloadedPreview.value, 'ffmpeg -i web.mp4 -c:v libx264');
    const reloadedInput = findAll(dom.body, (node) => classed(node, 'cm-control') && node.placeholder === '-i')[0];
    assert.equal(reloadedInput.value, 'web.mp4', 'the preset updates the option control');

    assert.deepEqual(env.calls.errors, []);
});

test('import dialog parses pasted help output and imports the selected options', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');

    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Import options')[0].click();
    const modal = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-modal')), 'import modal');
    assert.ok(modal);

    const textArea = find(modal, (node) => node.tagName === 'TEXTAREA' && String(node.placeholder || '').indexOf('--help') !== -1);
    textArea.value = 'Usage: demo\n\n  -a, --all        include everything\n  --tag <name>     add a tag (default: latest)\n';
    findAll(modal, (node) => node.tagName === 'BUTTON' && node.textContent === 'Parse')[0].click();
    await waitFor(() => findAll(modal, (node) => classed(node, 'cm-import-row')).length === 2, 'parsed options');

    const importCheckboxes = findAll(modal, (node) => node.tagName === 'INPUT' && node.type === 'checkbox');
    assert.equal(importCheckboxes.length, 4, 'each row has a select and a required checkbox');
    importCheckboxes[1].checked = true;
    importCheckboxes[1].dispatch('change');

    findAll(modal, (node) => node.tagName === 'BUTTON' && node.textContent === 'Import selected')[0].click();
    await waitFor(() => env.calls.backend.filter((call) => call.action === 'importOptions').length > 0, 'import action');
    const call = env.calls.backend.filter((entry) => entry.action === 'importOptions')[0];
    assert.equal(call.toolId, 't1');
    assert.equal(call.options.length, 2);
    assert.equal(call.options[0].flag, '--all');
    assert.equal(call.options[0].required, true, 'the required checkbox is imported');
    assert.equal(call.options[1].flag, '--tag');
    assert.equal(call.options[1].required, false);
    assert.deepEqual(env.calls.errors, []);
});

test('new tool form creates a tool with a category and the three-H2 content', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'New tool')[0].click();

    const titleInput = find(dom.body, (node) => node.placeholder === 'Tool name (e.g. docker)');
    assert.ok(titleInput);
    titleInput.value = 'docker';
    const categorySelect = find(dom.body, (node) => {
        return node.tagName === 'SELECT' && node.children.some((child) => child.value === '__new__');
    });
    assert.ok(categorySelect, 'category select offers a new category');
    categorySelect.value = '__new__';
    categorySelect.dispatch('change');
    const categoryInput = find(dom.body, (node) => node.placeholder === 'New category name');
    categoryInput.value = 'Containers';
    const baseInput = find(dom.body, (node) => String(node.placeholder || '').indexOf('Base command') !== -1);
    baseInput.value = 'docker';

    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Create')[0].click();
    await waitFor(() => env.calls.backend.filter((call) => call.action === 'createTool').length > 0, 'create tool');
    const call = env.calls.backend.filter((entry) => entry.action === 'createTool')[0];
    assert.equal(call.title, 'docker');
    assert.equal(call.category, 'Containers');
    assert.equal(call.base, 'docker');
    assert.match(call.content, /<h2>What is\?<\/h2>/);
    assert.match(call.content, /<h2>Official links<\/h2>/);
    assert.match(call.content, /<h2>Useful links<\/h2>/);
    assert.deepEqual(env.calls.errors, []);
});

test('Enter opens the first result even though no row starts selected', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    assert.equal(find(dom.body, (node) => classed(node, 'is-active')), null);

    const overlay = find(dom.body, (node) => classed(node, 'cm-overlay'));
    overlay.dispatch('keydown', { key: 'Enter' });

    const preview = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');
    assert.equal(preview.value, 'ffmpeg -i in.mp4 -c:v libx264');
    assert.equal(
        find(dom.body, (node) => classed(node, 'is-active')).children[0].textContent,
        'ffmpeg'
    );
});

test('a second open reuses the existing palette instead of stacking overlays', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    const context = vm.createContext({
        api: env.api,
        window: {},
        document: dom,
        navigator: env.navigator,
        console,
        setTimeout,
        clearTimeout,
        setImmediate
    });
    const bundle = buildBundle();
    vm.runInContext(bundle, context);
    vm.runInContext(bundle, context);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-overlay')), 'overlay');
    const overlays = findAll(dom.body, (node) => classed(node, 'cm-overlay'));
    assert.equal(overlays.length, 1);
});

test('palette can add a single option with a help string', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');

    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Add option')[0].click();
    const modal = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-modal')), 'add option modal');

    find(modal, (node) => node.placeholder === 'Option label, e.g. Output file').value = 'Output file';
    find(modal, (node) => String(node.placeholder || '').indexOf('Flag, e.g.') === 0).value = '-o';
    find(modal, (node) => node.placeholder === 'What is this option for?').value = 'Write output to a file.';
    find(modal, (node) => node.tagName === 'SELECT').value = 'path';
    find(modal, (node) => node.placeholder === 'Default value (optional)').value = 'out.mp4';
    find(modal, (node) => node.tagName === 'INPUT' && node.type === 'number').value = '70';

    findAll(modal, (node) => node.tagName === 'BUTTON' && node.textContent === 'Add')[0].click();
    await waitFor(() => env.calls.backend.filter((call) => call.action === 'addOption').length > 0, 'add option action');
    const call = env.calls.backend.filter((entry) => entry.action === 'addOption')[0];
    assert.equal(call.toolId, 't1');
    assert.equal(call.option.label, 'Output file');
    assert.equal(call.option.flag, '-o');
    assert.equal(call.option.help, 'Write output to a file.');
    assert.equal(call.option.type, 'path');
    assert.equal(call.option.defaultValue, 'out.mp4');
    assert.equal(call.option.order, 70);
    assert.deepEqual(env.calls.errors, []);
});

test('importing options preserves the values already entered', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');

    const input = findAll(dom.body, (node) => classed(node, 'cm-control') && node.placeholder === '-i')[0];
    input.value = 'kept.mp4';
    input.dispatch('input');
    await tick();
    assert.equal(find(dom.body, (node) => classed(node, 'cm-preview')).value, 'ffmpeg -i kept.mp4 -c:v libx264');

    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Import options')[0].click();
    const modal = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-modal')), 'import modal');
    const textArea = find(modal, (node) => node.tagName === 'TEXTAREA' && String(node.placeholder || '').indexOf('--help') !== -1);
    textArea.value = '  -p PORT  listen port';
    findAll(modal, (node) => node.tagName === 'BUTTON' && node.textContent === 'Parse')[0].click();
    await waitFor(() => findAll(modal, (node) => classed(node, 'cm-import-row')).length === 1, 'parsed option');
    findAll(modal, (node) => node.tagName === 'BUTTON' && node.textContent === 'Import selected')[0].click();
    await waitFor(() => env.calls.backend.filter((call) => call.action === 'importOptions').length > 0, 'import action');

    await waitFor(() => {
        const again = findAll(dom.body, (node) => classed(node, 'cm-control') && node.placeholder === '-i')[0];
        return again && again.value === 'kept.mp4';
    }, 'preserved option value');
    assert.deepEqual(env.calls.errors, []);
});

test('the version button checks the latest GitHub release', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    const fetchCalls = [];
    const fakeFetch = async function (url) {
        fetchCalls.push(url);
        if (url.indexOf('/releases/latest') !== -1) {
            return {
                ok: true,
                async json() {
                    return { tag_name: 'v9.9.9' };
                },
                async text() {
                    return '';
                }
            };
        }
        return {
            ok: true,
            async json() {
                return [{ name: 'v1.2.0' }, { name: 'v9.9.9' }, { name: 'v1.10.0' }];
            },
            async text() {
                return '';
            }
        };
    };
    run(dom, env.api, env.navigator, { fetch: fakeFetch });

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-version')), 'version button');
    find(dom.body, (node) => classed(node, 'cm-version')).click();
    await waitFor(() => {
        const status = find(dom.body, (node) => classed(node, 'cm-status'));
        return status && /latest is v9\.9\.9/.test(status.textContent);
    }, 'update status');

    assert.equal(fetchCalls[0], Version.LATEST_RELEASE_API);
    assert.equal(
        find(dom.body, (node) => classed(node, 'cm-version')).textContent,
        'v' + Version.VERSION + ' → v9.9.9',
        'the footer shows the installed and latest versions'
    );
    assert.deepEqual(env.calls.errors, []);
});

test('dropdowns hide the native arrow and keep a single themed arrow', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');

    const selects = findAll(dom.body, (node) => node.tagName === 'SELECT');
    assert.ok(selects.length >= 2, 'enum and preset selects render');
    assert.ok(
        selects.every((node) => classed(node, 'cm-select')),
        'every select opts into the single-arrow style'
    );

    const style = dom.getElementById('cm-palette-style');
    assert.match(style.textContent, /\.cm-control\.cm-select\{[^}]*appearance:none/);
    assert.match(style.textContent, /\.cm-control\.cm-select\{[^}]*background-image:var\(--select-arrow-svg/);
});