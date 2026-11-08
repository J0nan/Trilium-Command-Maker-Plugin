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
        content: '<p>Install on Windows:</p><pre><code>winget install Gyan.FFmpeg</code></pre>'
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
    const calls = { backend: [], copied: [], inserted: [], errors: [], activated: [], messages: [], tabbed: [] };
    const api = {
        startNote: { noteId: 'plugin-note' },
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
            if (params[0].action === 'ensureTab') {
                return { tabNoteId: 'tab-note', htmlNoteId: 'tab-html' };
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
        async waitUntilSynced() {},
        async openTabWithNote(noteId, activate) {
            calls.tabbed.push({ noteId, activate });
        },
        showError(message) {
            calls.errors.push(message);
        },
        showMessage(message) {
            calls.messages.push(message);
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
    assert.match(style.textContent, /\.cm-result-desc\{[^}]*min-width:0/);
    assert.match(style.textContent, /\.cm-result-desc\{[^}]*white-space:nowrap/);
    assert.match(style.textContent, /\.cm-result-desc\{[^}]*text-overflow:ellipsis/);
    assert.match(style.textContent, /\.cm-code-block:hover \.cm-code-copy/);
    assert.match(style.textContent, /\.cm-code-copy\{[^}]*z-index:1/);
    assert.match(style.textContent, /\.cm-detail\{[^}]*user-select:text/);
    assert.match(style.textContent, /\.cm-modal-body\{[^}]*user-select:text/);
    assert.match(style.textContent, /\.cm-install\{[^}]*user-select:text/);
    assert.match(style.textContent, /\.cm-field \.cm-control\{[^}]*width:100%/);
    assert.match(style.textContent, /\.cm-danger-armed\{[^}]*background:#dc2626/);
    assert.match(style.textContent, /\.cm-install pre\{[^}]*box-shadow:var\(--code-block-box-shadow/);
    assert.match(style.textContent, /@media \(hover:none\)\{\.cm-code-copy\{opacity:1;\}\}/);
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

    const detail = find(dom.body, (node) => classed(node, 'cm-detail'));
    const ordered = [];
    walk(detail, (node) => ordered.push(node));
    const presetIndex = ordered.findIndex((node) => classed(node, 'cm-presets'));
    const optionsIndex = ordered.findIndex((node) => {
        return classed(node, 'cm-section') && /^Options \(/.test(String(node.textContent || ''));
    });
    assert.ok(presetIndex >= 0, 'the preset block is rendered');
    assert.ok(optionsIndex >= 0, 'the options heading is rendered');
    assert.ok(presetIndex < optionsIndex, 'the preset selector comes before the options');

    const optionGroups = findAll(dom.body, (node) => classed(node, 'cm-option-group'));
    assert.equal(optionGroups.length, 2, 'required and optional groups render');
    assert.equal(find(optionGroups[0], (node) => classed(node, 'cm-option-group-title')).textContent, 'Required');
    assert.ok(
        find(optionGroups[0], (node) => classed(node, 'cm-opt-title') && node.textContent === 'Input file'),
        'the required option is in the Required group'
    );
    assert.equal(find(optionGroups[1], (node) => classed(node, 'cm-option-group-title')).textContent, 'Optional');
    assert.ok(
        find(optionGroups[1], (node) => classed(node, 'cm-opt-title') && node.textContent === 'Video codec'),
        'an optional option is in the Optional group'
    );
    assert.equal(find(dom.body, (node) => classed(node, 'cm-required-star')), null, 'no asterisk marker');
    assert.equal(find(dom.body, (node) => classed(node, 'cm-required-badge')), null, 'no badge');

    const example = find(dom.body, (node) => classed(node, 'cm-example-text'));
    assert.equal(example.textContent, 'ffmpeg -i in.mp4 out.mp4');

    const helpPre = findAll(dom.body, (node) => node.tagName === 'PRE').filter((node) => /Usage: ffmpeg/.test(node.textContent))[0];
    assert.ok(helpPre, 'help output is rendered in a pre block');
    const installBlock = find(dom.body, (node) => classed(node, 'cm-install'));
    assert.ok(installBlock, 'install steps are rendered with their note formatting');
    assert.match(installBlock.innerHTML, /winget install/);
    assert.match(installBlock.innerHTML, /class="cm-code-block"/, 'code blocks are wrapped');
    assert.match(installBlock.innerHTML, /class="cm-code-copy"/, 'code blocks get a copy control');

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

test('clicking a boolean option row toggles its checkbox', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');

    const row = find(dom.body, (node) => {
        return classed(node, 'cm-option') && find(node, (child) => {
            return classed(child, 'cm-opt-title') && child.textContent === 'Verbose';
        });
    });
    assert.ok(row, 'boolean row is rendered');
    const checkbox = find(row, (node) => node.tagName === 'INPUT' && node.type === 'checkbox');
    assert.ok(checkbox, 'boolean row has a checkbox');
    assert.equal(checkbox.checked, false);

    row.click();
    assert.equal(checkbox.checked, true, 'clicking the row checks the box');
    assert.match(find(dom.body, (node) => classed(node, 'cm-preview')).value, / -v$/);

    row.click();
    assert.equal(checkbox.checked, false, 'clicking the row again unchecks it');
    assert.equal(
        find(dom.body, (node) => classed(node, 'cm-preview')).value.includes(' -v'),
        false
    );
    assert.deepEqual(env.calls.errors, []);
});

test('editing an option after loading an example updates the command', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');

    findAll(dom.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Use')[0].click();
    await tick();
    assert.equal(find(dom.body, (node) => classed(node, 'cm-preview')).value, 'ffmpeg -i in.mp4 out.mp4');

    const input = findAll(dom.body, (node) => classed(node, 'cm-control') && node.placeholder === '-i')[0];
    input.value = 'changed.mp4';
    input.dispatch('input');
    await tick();
    assert.equal(
        find(dom.body, (node) => classed(node, 'cm-preview')).value,
        'ffmpeg -i changed.mp4',
        'the command regenerates from the form after an example edit'
    );
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
    const fields = findAll(modal, (node) => classed(node, 'cm-field'));
    assert.ok(fields.length >= 7, 'every add-option field stacks its label above a full-width control');
    assert.ok(fields.every((entry) => entry.children.length === 2), 'each field holds a label and a control');

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
    assert.ok(
        env.calls.messages.some((message) => /latest is v9\.9\.9/.test(message)),
        'the update status is also shown as a Trilium message'
    );
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
function buttonWithText(root, text) {
    return find(root, (node) => node.tagName === 'BUTTON' && node.textContent === text);
}

const portableTool = {
    kind: 'command-maker-tool',
    version: 1,
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
            { label: 'Ignore case', flag: '-i', help: 'Case insensitive.', type: 'boolean', order: 10 },
            { label: 'Pattern', flag: '', help: 'Regex to search for.', type: 'string', required: true, placeholder: 'pattern', order: 20 }
        ]
    }
};

test('Import tool parses a tool file, copies the AI prompt and imports the tool', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    buttonWithText(dom.body, 'Import tool').click();
    const modal = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-modal')), 'import tool modal');

    const area = find(modal, (node) => node.tagName === 'TEXTAREA');
    assert.ok(area, 'the import tool modal has a text area');

    area.value = 'Usage: rg [OPTIONS] PATTERN\n  -i, --ignore-case  case insensitive';
    buttonWithText(modal, 'Copy AI prompt').click();
    await waitFor(() => env.calls.copied.length > 0, 'AI prompt copy');
    assert.match(env.calls.copied[0], /command-maker-tool/);
    assert.match(env.calls.copied[0], /Usage: rg \[OPTIONS\] PATTERN/);
    assert.match(env.calls.copied[0], /--ignore-case/);
    await waitFor(() => env.calls.messages.length > 0, 'Trilium confirmation message');
    assert.ok(
        env.calls.messages.some((message) => /AI prompt copied/i.test(message)),
        'the copy confirmation reaches Trilium'
    );

    area.value = JSON.stringify(portableTool);
    buttonWithText(modal, 'Parse').click();
    await waitFor(() => {
        const status = find(dom.body, (node) => classed(node, 'cm-status'));
        return status && /Parsed tool "ripgrep"/.test(status.textContent);
    }, 'parse status');
    assert.ok(buttonWithText(modal, 'Import tool').disabled === false, 'the import action is enabled');
    assert.ok(
        env.calls.messages.some((message) => /Parsed tool "ripgrep"/.test(message)),
        'the parse status is also shown as a Trilium message'
    );

    buttonWithText(modal, 'Import tool').click();
    const call = await waitFor(() => {
        return env.calls.backend.filter((entry) => entry.action === 'importTool')[0];
    }, 'importTool backend call');
    assert.equal(call.tool.title, 'ripgrep');
    assert.equal(call.tool.options.length, 2);
    assert.equal(call.tool.options[1].flag, '', 'the positional option survives the import');
    await waitFor(() => {
        return env.calls.messages.some((message) => /Imported tool "ripgrep"/.test(message));
    }, 'import status toast');
});

test('errors are also shown as Trilium error messages', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    buttonWithText(dom.body, 'Import options').click();

    await waitFor(() => env.calls.errors.length > 0, 'Trilium error message');
    assert.equal(env.calls.errors.length, 1, 'the error is shown exactly once');
    assert.match(env.calls.errors[0], /Command Maker: Select a tool first\./);
});

test('Export tool shows the portable JSON and copies it', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');

    buttonWithText(dom.body, 'Export tool').click();
    const modal = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-modal')), 'export modal');
    const area = await waitFor(() => {
        return find(modal, (node) => node.tagName === 'TEXTAREA' && node.value.indexOf('command-maker-tool') !== -1);
    }, 'exported JSON');

    const file = JSON.parse(area.value);
    assert.equal(file.tool.title, 'ffmpeg');
    assert.equal(file.tool.category, 'Media');
    assert.equal(file.tool.options.length, 3);
    assert.equal(file.tool.options[0].flag, '-i');
    assert.match(file.tool.help, /Usage: ffmpeg/);
    assert.ok(find(modal, (node) => node.tagName === 'BUTTON' && node.textContent === 'Download .json'), 'download action exists');

    buttonWithText(modal, 'Copy JSON').click();
    await waitFor(() => env.calls.copied.length > 0, 'copied tool file');
    assert.match(env.calls.copied[0], /"kind": "command-maker-tool"/);
    assert.match(env.calls.copied[0], /"title": "ffmpeg"/);
});

test('the modal body can shrink and scroll instead of being clipped', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    const style = dom.getElementById('cm-palette-style');

    assert.match(style.textContent, /\.cm-modal-panel\{[^}]*max-height:100%/);
    assert.match(style.textContent, /\.cm-modal-body\{[^}]*min-height:0/);
    assert.match(style.textContent, /\.cm-modal-body\{[^}]*overflow-y:auto/);
    assert.match(style.textContent, /\.cm-modal-actions\{[^}]*flex:0 0 auto/);
});

test('modals render on the overlay, not inside the panel that shrinks on first open', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    buttonWithText(dom.body, 'Import tool').click();

    const overlay = find(dom.body, (node) => classed(node, 'cm-overlay'));
    const panel = find(overlay, (node) => classed(node, 'cm-panel'));
    const host = overlay.children.filter((node) => classed(node, 'cm-modal-host'))[0];

    assert.ok(host, 'the modal host is a direct child of the overlay');
    assert.equal(
        find(panel, (node) => classed(node, 'cm-modal-host')),
        null,
        'the modal host is not inside the panel that can shrink to its content'
    );
    assert.ok(find(host, (node) => classed(node, 'cm-modal')), 'the modal renders inside the overlay host');
});

test('deleting a preset needs a second click and arms the red button', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');

    const presets = find(dom.body, (node) => classed(node, 'cm-presets'));
    const select = find(presets, (node) => node.tagName === 'SELECT');
    select.value = 'web';
    const deleteButton = find(presets, (node) => node.tagName === 'BUTTON' && node.textContent === 'Delete');
    assert.ok(deleteButton, 'the preset delete button is present');

    deleteButton.click();
    assert.equal(deleteButton.textContent, 'Confirm delete');
    assert.ok(classed(deleteButton, 'cm-danger-armed'), 'the armed button uses the solid red style');
    assert.equal(
        env.calls.backend.filter((entry) => entry.action === 'deletePreset').length,
        0,
        'the first click only arms the delete'
    );

    select.dispatch('change');
    assert.equal(deleteButton.textContent, 'Delete', 'changing the preset disarms the delete');
    assert.equal(classed(deleteButton, 'cm-danger-armed'), false);

    deleteButton.click();
    assert.equal(deleteButton.textContent, 'Confirm delete');
    deleteButton.click();

    const call = await waitFor(() => {
        return env.calls.backend.filter((entry) => entry.action === 'deletePreset')[0];
    }, 'delete preset backend call');
    assert.equal(call.name, 'web');
});

test('Open in tab creates the tab note and closes the overlay', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    const overlay = find(dom.body, (node) => classed(node, 'cm-overlay'));
    const openTab = find(dom.body, (node) => classed(node, 'cm-open-tab'));
    assert.ok(openTab, 'the overlay has an Open in tab button');
    assert.equal(openTab.textContent, 'Open in tab');

    openTab.click();
    const tabbed = await waitFor(() => env.calls.tabbed[0], 'open tab call');
    assert.equal(tabbed.noteId, 'tab-note');
    assert.equal(tabbed.activate, true);

    const ensure = env.calls.backend.filter((entry) => entry.action === 'ensureTab')[0];
    assert.ok(ensure, 'the tab structure is ensured before opening it');
    assert.equal(ensure.rootId, 'root');
    assert.equal(ensure.scriptNoteId, 'plugin-note');
    assert.equal(overlay.removed, true, 'the overlay closes once the tab is open');
    assert.deepEqual(env.calls.errors, []);
});

test('a render-note host mounts the palette inside its tab container', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    const marker = dom.createElement('div');
    marker.className = 'cm-tab-root';
    env.api.$container = {
        0: marker,
        length: 1,
        find(selector) {
            return selector === '.cm-tab-root' ? { 0: marker, length: 1 } : { length: 0 };
        },
        get(index) {
            return index === 0 ? marker : null;
        }
    };
    run(dom, env.api, env.navigator);

    await waitFor(() => find(marker, (node) => classed(node, 'cm-result')), 'embedded search results');
    assert.equal(find(dom.body, (node) => classed(node, 'cm-overlay')), null, 'no overlay is created');
    assert.ok(find(marker, (node) => classed(node, 'cm-tab-view')), 'the tab view wraps the panel');
    assert.ok(find(marker, (node) => classed(node, 'cm-panel')), 'the palette panel is inside the tab');
    assert.equal(find(marker, (node) => classed(node, 'cm-open-tab')), null, 'no Open in tab button inside a tab');
    assert.equal(find(marker, (node) => classed(node, 'cm-close')), null, 'no overlay close button inside a tab');

    const style = dom.getElementById('cm-palette-style');
    assert.match(style.textContent, /\.cm-tab-view\{[^}]*position:relative/);
    assert.match(style.textContent, /\.cm-tab-view \.cm-panel\{[^}]*height:100%/);
});

test('double-clicking Import tool while the import is in flight creates one tool, not two', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    let releaseImport;
    const gate = new Promise((resolve) => {
        releaseImport = resolve;
    });
    const originalRun = env.api.runOnBackend.bind(env.api);
    env.api.runOnBackend = function (fn, params) {
        const result = originalRun(fn, params);
        if (params[0].action === 'importTool') {
            return gate.then(() => ({ noteId: 'new-tool' }));
        }
        return result;
    };
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    buttonWithText(dom.body, 'Import tool').click();
    const modal = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-modal')), 'import tool modal');
    const area = find(modal, (node) => node.tagName === 'TEXTAREA');
    area.value = JSON.stringify(portableTool);
    buttonWithText(modal, 'Parse').click();
    await waitFor(() => buttonWithText(modal, 'Import tool').disabled === false, 'parsed import action enabled');

    const importButton = buttonWithText(modal, 'Import tool');
    importButton.click();
    assert.equal(importButton.disabled, true, 'the action button disables itself while the backend call runs');
    importButton.click();
    releaseImport();

    await waitFor(() => {
        return env.calls.messages.some((message) => /Imported tool "ripgrep"/.test(message));
    }, 'import status toast');
    assert.equal(
        env.calls.backend.filter((entry) => entry.action === 'importTool').length,
        1,
        'a double click issues exactly one importTool backend call'
    );
    assert.deepEqual(env.calls.errors, []);
});

test('double-clicking Create, Add option and Import selected issues one backend call each', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    // The mock DOM leaves removed nodes reachable, so the newest modal is the
    // last cm-modal in document order, not the first.
    const topModal = () => findAll(dom.body, (node) => classed(node, 'cm-modal')).pop();
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');

    buttonWithText(dom.body, 'New tool').click();
    const titleInput = find(dom.body, (node) => node.placeholder === 'Tool name (e.g. docker)');
    titleInput.value = 'docker';
    const createButton = buttonWithText(dom.body, 'Create');
    createButton.click();
    createButton.click();
    await waitFor(() => {
        return env.calls.messages.some((message) => /Tool created\./.test(message));
    }, 'create tool completion');
    assert.equal(
        env.calls.backend.filter((entry) => entry.action === 'createTool').length,
        1,
        'a double click creates exactly one tool'
    );

    findAll(dom.body, (node) => classed(node, 'cm-result'))[0].click();
    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'preview');
    buttonWithText(dom.body, 'Add option').click();
    const addModal = await waitFor(topModal, 'add option modal');
    find(addModal, (node) => node.placeholder === 'Option label, e.g. Output file').value = 'Output file';
    const addButton = buttonWithText(addModal, 'Add');
    addButton.click();
    addButton.click();
    await waitFor(() => {
        return env.calls.messages.some((message) => /Option added\./.test(message));
    }, 'add option completion');
    assert.equal(
        env.calls.backend.filter((entry) => entry.action === 'addOption').length,
        1,
        'a double click adds exactly one option'
    );

    buttonWithText(dom.body, 'Import options').click();
    const importModal = await waitFor(topModal, 'import options modal');
    const helpArea = find(importModal, (node) => node.tagName === 'TEXTAREA');
    helpArea.value = 'Usage: demo\n\n  -a, --all        include everything\n';
    buttonWithText(importModal, 'Parse').click();
    await waitFor(() => buttonWithText(importModal, 'Import selected').disabled === false, 'parsed import action enabled');
    const importSelected = buttonWithText(importModal, 'Import selected');
    importSelected.click();
    importSelected.click();
    await waitFor(() => {
        return env.calls.messages.some((message) => /Imported 1 option\(s\)\./.test(message));
    }, 'import options completion');
    assert.equal(
        env.calls.backend.filter((entry) => entry.action === 'importOptions').length,
        1,
        'a double click imports the options exactly once'
    );
    assert.deepEqual(env.calls.errors, []);
});

test('a slow tool load cannot hijack the detail pane of a newer selection', async () => {
    const dom = createDom();
    const fixture = buildFixture();
    const env = makeApi(fixture);
    const originalContent = fixture.ffmpeg.getContent.bind(fixture.ffmpeg);
    let releaseSlowLoad;
    const slowGate = new Promise((resolve) => {
        releaseSlowLoad = resolve;
    });
    let ffmpegContentReads = 0;
    fixture.ffmpeg.getContent = async function () {
        ffmpegContentReads += 1;
        // Boot refresh reads the note once; the gated selection load is held.
        if (ffmpegContentReads > 1) {
            await slowGate;
        }
        return originalContent();
    };
    run(dom, env.api, env.navigator);

    await waitFor(() => find(dom.body, (node) => classed(node, 'cm-result')), 'search results');
    const rows = findAll(dom.body, (node) => classed(node, 'cm-result'));
    rows[0].click();
    await new Promise((resolve) => setImmediate(resolve));
    rows[1].click();

    const preview = await waitFor(() => find(dom.body, (node) => classed(node, 'cm-preview')), 'git preview');
    assert.ok(String(preview.value).startsWith('git commit'), 'the newest selection renders first');

    // Let the older ffmpeg load finish; its result must not replace the pane.
    releaseSlowLoad();
    for (let turn = 0; turn < 60; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }

    const livePreview = find(dom.body, (node) => classed(node, 'cm-preview'));
    assert.ok(
        String(livePreview.value).startsWith('git commit'),
        'the preview keeps the newest selection after the older load resolves: ' + livePreview.value
    );
    const activeRow = find(dom.body, (node) => classed(node, 'is-active'));
    assert.equal(activeRow.children[0].textContent, 'git commit', 'the highlight follows the newest selection');
    assert.deepEqual(env.calls.errors, []);
});
