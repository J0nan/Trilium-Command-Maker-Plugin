import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { buildBundle } from '../tools/build.mjs';

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
            listeners: {},
            value: '',
            type: '',
            placeholder: '',
            checked: false,
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
                }
            },
            appendChild(child) {
                node.children.push(child);
                return child;
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
            remove() {
                node.removed = true;
            },
            focus() {
                document.activeElement = node;
            },
            select() {},
            setAttribute() {},
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

function tick() {
    return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate, label) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
        const value = predicate();
        if (value) {
            return value;
        }
        await tick();
    }
    throw new Error('timed out waiting for ' + (label || 'condition'));
}

test('palette searches, renders, copies and inserts a command', async () => {
    const document = createDom();

    const templateNote = note({ noteId: 'tpl', title: 'Command Template' });
    const inputOption = note({
        noteId: 'o1',
        title: 'Input file',
        labels: { cmFlag: '-i', cmType: 'path', cmPlaceholder: 'input', cmQuote: 'double' }
    });
    const codecOption = note({
        noteId: 'o2',
        title: 'Codec',
        labels: { cmFlag: '-c:v', cmType: 'enum', cmValues: 'libx264,libx265', cmDefault: 'libx264' }
    });
    const optionsFolder = note({
        noteId: 'options',
        title: 'Options',
        labels: { cmOptions: '' },
        children: [inputOption, codecOption]
    });
    const presetsFolder = note({
        noteId: 'presets',
        title: 'Presets',
        labels: { cmPresets: '' },
        children: []
    });
    const commandNote = note({
        noteId: 'cmd1',
        title: 'ffmpeg compress',
        labels: { cmDesc: 'Encode a video' },
        content: 'ffmpeg -i "{{input}}"',
        children: [optionsFolder, presetsFolder]
    });

    const calls = { backend: [], copied: [], inserted: [], errors: [] };
    const api = {
        async runOnBackend(fn, params) {
            calls.backend.push(params[0]);
            return {};
        },
        async searchForNotes() {
            return [commandNote, templateNote];
        },
        async searchForNote() {
            return templateNote;
        },
        addTextToActiveContextEditor(text) {
            calls.inserted.push(text);
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
    const window = {};

    const context = vm.createContext({
        api,
        window,
        document,
        navigator,
        console,
        setTimeout,
        clearTimeout,
        setImmediate
    });
    vm.runInContext(buildBundle(), context);

    const row = await waitFor(() => find(document.body, (node) => classed(node, 'cm-result')), 'search results');
    assert.equal(row.children[0].textContent, 'ffmpeg compress');
    assert.equal(calls.backend.length, 1);
    assert.equal(calls.backend[0].action, 'bootstrap');

    row.click();
    const preview = await waitFor(() => find(document.body, (node) => classed(node, 'cm-preview')), 'preview');
    assert.equal(preview.value, 'ffmpeg -i "" -c:v libx264');

    const inputControl = findAll(document.body, (node) => classed(node, 'cm-control') && node.placeholder === '-i')[0];
    assert.ok(inputControl, 'path option renders a text control');
    inputControl.value = 'in file.mp4';
    inputControl.dispatch('input');
    await tick();
    assert.equal(preview.value, 'ffmpeg -i "in file.mp4" -c:v libx264');

    const copyButton = findAll(document.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Copy')[0];
    copyButton.click();
    await waitFor(() => calls.copied.length > 0, 'clipboard write');
    assert.equal(calls.copied[0], 'ffmpeg -i "in file.mp4" -c:v libx264');

    const insertButton = findAll(document.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Insert')[0];
    insertButton.click();
    await waitFor(() => calls.inserted.length > 0, 'editor insert');
    assert.equal(calls.inserted[0], 'ffmpeg -i "in file.mp4" -c:v libx264');

    assert.deepEqual(calls.errors, []);
});

test('a second open reuses the existing palette instead of stacking overlays', async () => {
    const document = createDom();
    const api = {
        async runOnBackend() {
            return {};
        },
        async searchForNotes() {
            return [];
        },
        async searchForNote() {
            return null;
        },
        showError() {}
    };
    const context = vm.createContext({
        api,
        window: {},
        document,
        navigator: { clipboard: { async writeText() {} } },
        console,
        setTimeout,
        clearTimeout,
        setImmediate
    });
    const bundle = buildBundle();
    vm.runInContext(bundle, context);
    vm.runInContext(bundle, context);

    await waitFor(() => find(document.body, (node) => classed(node, 'cm-overlay')), 'overlay');
    const overlays = findAll(document.body, (node) => classed(node, 'cm-overlay'));
    assert.equal(overlays.length, 1);
});