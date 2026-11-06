'use strict';

/**
 * Palette UI. Plain DOM on purpose: no JSX compile step, no Preact version
 * coupling, and it keeps the installed note to a single script.
 *
 * The UI is driven by a controller (see runtime.js):
 *   refresh(): Promise<void>
 *   search(query): Promise<Array<{ noteId, title, description }>>
 *   load(noteId): Promise<{ definition, presets }>
 *   copy(text): Promise<boolean>
 *   insert(text): void
 *   createCommand(title): Promise<{ noteId }>
 *   addOption(commandId, option): Promise<void>
 *   savePreset(commandId, name, values): Promise<void>
 *   deletePreset(noteId): Promise<void>
 */

const Model = require('./model');
const Render = require('./render');

const STYLE_ID = 'cm-palette-style';

const CSS = [
    '.cm-overlay{position:fixed;inset:0;z-index:99999;display:flex;justify-content:center;align-items:flex-start;padding:7vh 16px;background:rgba(0,0,0,.45);}',
    '.cm-panel{display:flex;flex-direction:column;width:min(960px,100%);max-height:86vh;border-radius:10px;overflow:hidden;background:var(--main-background-color,#fff);color:var(--main-text-color,#222);box-shadow:0 24px 64px rgba(0,0,0,.4);font-size:14px;}',
    '.cm-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--main-border-color,#ddd);}',
    '.cm-search{flex:1;padding:8px 10px;border:1px solid var(--main-border-color,#ccc);border-radius:6px;background:var(--input-background-color,#fafafa);color:inherit;font-size:15px;}',
    '.cm-close{border:0;background:transparent;color:inherit;font-size:16px;cursor:pointer;padding:4px 8px;}',
    '.cm-body{display:flex;min-height:0;flex:1;}',
    '.cm-list{width:280px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--main-border-color,#ddd);padding:6px;}',
    '.cm-result{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;}',
    '.cm-result:hover,.cm-result.is-active{background:var(--accented-background-color,#eef2ff);}',
    '.cm-result-title{font-weight:600;}',
    '.cm-result-desc{opacity:.7;font-size:12px;margin-top:2px;}',
    '.cm-detail{flex:1;min-width:0;overflow-y:auto;padding:14px 16px;}',
    '.cm-title{margin:0 0 4px;font-size:17px;}',
    '.cm-subtitle{margin:0 0 12px;opacity:.7;}',
    '.cm-form{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;}',
    '.cm-row{display:flex;align-items:center;gap:8px;}',
    '.cm-row-label{flex:0 0 180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.cm-row .cm-control{flex:1;}',
    '.cm-control{padding:6px 8px;border:1px solid var(--main-border-color,#ccc);border-radius:6px;background:var(--input-background-color,#fafafa);color:inherit;font:inherit;}',
    '.cm-preview{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid var(--main-border-color,#ccc);background:var(--code-background-color,#f4f4f4);color:inherit;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;resize:vertical;}',
    '.cm-warnings{display:flex;flex-direction:column;gap:4px;margin-top:6px;}',
    '.cm-warning{color:#b45309;font-size:12px;}',
    '.cm-actions{display:flex;gap:8px;margin:12px 0;}',
    '.cm-button{padding:6px 12px;border:1px solid var(--main-border-color,#ccc);border-radius:6px;background:var(--button-background-color,#fff);color:inherit;cursor:pointer;font:inherit;}',
    '.cm-button:hover{background:var(--accented-background-color,#eef2ff);}',
    '.cm-danger{color:#b91c1c;}',
    '.cm-presets{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--main-border-color,#ddd);padding-top:10px;}',
    '.cm-section{margin:8px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;opacity:.6;}',
    '.cm-empty{opacity:.6;padding:8px;}',
    '.cm-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-top:1px solid var(--main-border-color,#ddd);}',
    '.cm-inline{display:flex;gap:6px;align-items:center;flex:1;min-width:220px;}',
    '.cm-status{margin-left:auto;font-size:12px;opacity:.75;}',
    '.cm-status.is-error{color:#b91c1c;opacity:1;}',
    '.cm-badge{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--accented-background-color,#eef2ff);opacity:.8;}',
    '@media (max-width:720px){.cm-body{flex-direction:column;}.cm-list{width:auto;max-height:180px;border-right:0;border-bottom:1px solid var(--main-border-color,#ddd);}.cm-row-label{flex-basis:120px;}}'
].join('\n');

let instance = null;

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined && text !== null) {
        node.textContent = String(text);
    }
    return node;
}

function openPalette(controller) {
    if (instance) {
        instance.focus();
        return instance;
    }
    if (typeof window !== 'undefined' && window.__cmPaletteInstance) {
        window.__cmPaletteInstance.focus();
        return window.__cmPaletteInstance;
    }

    ensureStyle();

    const state = {
        items: [],
        active: -1,
        current: null,
        definition: null,
        presets: [],
        values: {},
        edited: false,
        previewEl: null,
        warningsEl: null,
        presetSelect: null,
        presetName: null
    };

    const overlay = el('div', 'cm-overlay');
    const panel = el('div', 'cm-panel');

    const head = el('div', 'cm-head');
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'cm-search';
    searchInput.placeholder = 'Search commands…';
    const closeButton = el('button', 'cm-close', '✕');
    closeButton.type = 'button';
    closeButton.title = 'Close (Esc)';
    head.appendChild(searchInput);
    head.appendChild(closeButton);

    const body = el('div', 'cm-body');
    const list = el('div', 'cm-list');
    const detail = el('div', 'cm-detail');
    body.appendChild(list);
    body.appendChild(detail);

    const footer = el('div', 'cm-foot');
    const newCommandButton = el('button', 'cm-button', 'New command');
    newCommandButton.type = 'button';
    const addOptionButton = el('button', 'cm-button', 'Add option');
    addOptionButton.type = 'button';
    const statusEl = el('span', 'cm-status', '');
    footer.appendChild(newCommandButton);
    footer.appendChild(addOptionButton);
    footer.appendChild(statusEl);

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let searchTimer = null;
    let newCommandRow = null;
    let addOptionRow = null;

    function setStatus(message, isError) {
        statusEl.textContent = message || '';
        statusEl.classList.toggle('is-error', Boolean(isError));
    }

    function notify(error) {
        const message = error && error.message ? error.message : String(error);
        setStatus(message, true);
        try {
            if (typeof api !== 'undefined' && typeof api.showError === 'function') {
                api.showError('Command Maker: ' + message);
            }
        } catch (ignored) {
            // showing the message in the footer is enough
        }
    }

    function button(label, handler, className) {
        const node = el('button', 'cm-button' + (className ? ' ' + className : ''), label);
        node.type = 'button';
        node.addEventListener('click', function (event) {
            event.preventDefault();
            Promise.resolve()
                .then(handler)
                .catch(notify);
        });
        return node;
    }

    function close() {
        if (searchTimer) {
            clearTimeout(searchTimer);
            searchTimer = null;
        }
        overlay.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        if (typeof window !== 'undefined' && window.__cmPaletteInstance === instance) {
            window.__cmPaletteInstance = null;
        }
        instance = null;
    }

    function onKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            copy();
            return;
        }
        if (document.activeElement !== searchInput) {
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveActive(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveActive(-1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            pickActive();
        }
    }

    function renderList() {
        list.textContent = '';
        if (!state.items.length) {
            list.appendChild(el('div', 'cm-empty', 'No commands match.'));
            return;
        }
        state.items.forEach(function (item, index) {
            const row = el('button', 'cm-result' + (index === state.active ? ' is-active' : ''));
            row.type = 'button';
            row.appendChild(el('div', 'cm-result-title', item.title));
            if (item.description) {
                row.appendChild(el('div', 'cm-result-desc', item.description));
            }
            row.addEventListener('click', function () {
                selectItem(item).catch(notify);
            });
            list.appendChild(row);
        });
    }

    function moveActive(delta) {
        if (!state.items.length) {
            return;
        }
        state.active = (state.active + delta + state.items.length) % state.items.length;
        renderList();
        const activeRow = list.children[state.active];
        if (activeRow && typeof activeRow.scrollIntoView === 'function') {
            activeRow.scrollIntoView({ block: 'nearest' });
        }
    }

    function pickActive() {
        if (state.active < 0 || !state.items[state.active]) {
            return;
        }
        selectItem(state.items[state.active]).catch(notify);
    }

    async function runSearch() {
        try {
            const items = await Promise.resolve(controller.search(searchInput.value));
            state.items = Array.isArray(items) ? items : [];
            state.active = state.items.length ? 0 : -1;
            renderList();
        } catch (error) {
            notify(error);
        }
    }

    function onSearchInput() {
        if (searchTimer) {
            clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(function () {
            searchTimer = null;
            runSearch();
        }, 120);
    }

    async function selectItem(item) {
        state.current = item;
        state.edited = false;
        try {
            const loaded = await controller.load(item.noteId);
            state.definition = loaded.definition;
            state.presets = loaded.presets || [];
            state.values = Model.defaultValueMap(state.definition);
            renderDetail();
            setStatus('');
        } catch (error) {
            state.definition = null;
            renderDetail();
            notify(error);
        }
    }

    function optionRow(option, inferred) {
        const row = el('label', 'cm-row' + (inferred ? ' cm-row-inferred' : ''));
        const key = Render.valueKey(option);
        row.appendChild(el('span', 'cm-row-label', option.title + (option.required ? ' *' : '')));

        let control;
        if (option.type === 'boolean') {
            control = document.createElement('input');
            control.type = 'checkbox';
            control.checked = Render.isTruthyFlag(state.values[key]);
            control.addEventListener('change', function () {
                setValue(key, control.checked);
            });
        } else if (option.type === 'enum') {
            control = document.createElement('select');
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '—';
            control.appendChild(empty);
            option.enumValues.forEach(function (value) {
                const entry = document.createElement('option');
                entry.value = value;
                entry.textContent = value;
                control.appendChild(entry);
            });
            control.value = state.values[key] === undefined ? '' : String(state.values[key]);
            control.addEventListener('change', function () {
                setValue(key, control.value);
            });
        } else {
            control = document.createElement('input');
            control.type = option.type === 'number' ? 'number' : 'text';
            control.placeholder = option.flag || '{{' + option.placeholder + '}}';
            control.value = state.values[key] === undefined ? '' : String(state.values[key]);
            control.addEventListener('input', function () {
                setValue(key, control.value);
            });
        }

        control.className = option.type === 'boolean' ? '' : 'cm-control';
        row.appendChild(control);
        if (inferred) {
            row.appendChild(el('span', 'cm-badge', 'inferred'));
        }
        return row;
    }

    function setValue(key, value) {
        state.values[key] = value;
        updatePreview(false);
    }

    function renderWarnings(warnings) {
        if (!state.warningsEl) {
            return;
        }
        state.warningsEl.textContent = '';
        (warnings || []).forEach(function (warning) {
            state.warningsEl.appendChild(el('div', 'cm-warning', warning.message));
        });
    }

    function updatePreview(force) {
        if (!state.definition || !state.previewEl) {
            return;
        }
        const result = Render.renderCommand(state.definition, state.values);
        if (force || !state.edited) {
            state.previewEl.value = result.command;
            state.edited = false;
        }
        renderWarnings(result.warnings);
    }

    function renderPresets() {
        if (!state.presetSelect) {
            return;
        }
        state.presetSelect.textContent = '';
        if (!state.presets.length) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = 'No presets yet';
            state.presetSelect.appendChild(empty);
        }
        state.presets.forEach(function (preset) {
            const entry = document.createElement('option');
            entry.value = preset.noteId;
            entry.textContent = preset.title;
            state.presetSelect.appendChild(entry);
        });
    }

    async function copy() {
        if (!state.previewEl) {
            return;
        }
        const text = state.previewEl.value;
        if (!text.trim()) {
            notify(new Error('Nothing to copy.'));
            return;
        }
        const ok = await controller.copy(text);
        if (ok) {
            setStatus('Copied to the clipboard.');
        } else {
            notify(new Error('Could not write to the clipboard.'));
        }
    }

    function insert() {
        if (!state.previewEl) {
            return;
        }
        try {
            controller.insert(state.previewEl.value);
            setStatus('Inserted into the active note.');
        } catch (error) {
            notify(error);
        }
    }

    async function loadPreset() {
        const noteId = state.presetSelect ? state.presetSelect.value : '';
        const preset = state.presets.filter(function (entry) {
            return entry.noteId === noteId;
        })[0];
        if (!preset) {
            notify(new Error('Pick a preset first.'));
            return;
        }
        state.values = Object.assign(Model.defaultValueMap(state.definition), preset.values || {});
        state.edited = false;
        renderDetail();
        setStatus('Preset loaded.');
    }

    async function savePreset() {
        if (!state.definition) {
            return;
        }
        const name = (state.presetName ? state.presetName.value : '').trim();
        if (!name) {
            notify(new Error('Preset name is required.'));
            return;
        }
        await controller.savePreset(state.definition.noteId, name, state.values);
        const loaded = await controller.load(state.definition.noteId);
        state.presets = loaded.presets || [];
        renderDetail();
        setStatus('Preset saved.');
    }

    async function deletePreset() {
        const noteId = state.presetSelect ? state.presetSelect.value : '';
        if (!noteId) {
            notify(new Error('Pick a preset first.'));
            return;
        }
        await controller.deletePreset(noteId);
        const loaded = await controller.load(state.definition.noteId);
        state.presets = loaded.presets || [];
        renderDetail();
        setStatus('Preset deleted.');
    }

    function presetBlock() {
        const block = el('div', 'cm-presets');
        block.appendChild(el('div', 'cm-section', 'Presets'));

        const row = el('div', 'cm-row');
        const select = document.createElement('select');
        select.className = 'cm-control';
        state.presetSelect = select;
        row.appendChild(select);
        row.appendChild(button('Load', loadPreset));
        row.appendChild(button('Delete', deletePreset, 'cm-danger'));
        block.appendChild(row);

        const saveRow = el('div', 'cm-row');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'cm-control';
        nameInput.placeholder = 'Preset name';
        state.presetName = nameInput;
        saveRow.appendChild(nameInput);
        saveRow.appendChild(button('Save preset', savePreset));
        block.appendChild(saveRow);

        renderPresets();
        return block;
    }

    function renderDetail() {
        detail.textContent = '';
        state.previewEl = null;
        state.warningsEl = null;
        state.presetSelect = null;
        state.presetName = null;

        if (!state.definition) {
            detail.appendChild(el('div', 'cm-empty', 'Pick a command from the list.'));
            return;
        }

        const definition = state.definition;
        const header = el('div', 'cm-detail-head');
        header.appendChild(el('h2', 'cm-title', definition.title));
        if (definition.description) {
            header.appendChild(el('p', 'cm-subtitle', definition.description));
        }
        detail.appendChild(header);

        const form = el('div', 'cm-form');
        if (!definition.options.length && !definition.inferred.length) {
            form.appendChild(el('div', 'cm-empty', 'This command has no options yet. Use "Add option".'));
        }
        definition.options.forEach(function (option) {
            form.appendChild(optionRow(option, false));
        });
        if (definition.inferred.length) {
            form.appendChild(el('div', 'cm-section', 'Placeholders without an option'));
            definition.inferred.forEach(function (option) {
                form.appendChild(optionRow(option, true));
            });
        }
        detail.appendChild(form);

        detail.appendChild(el('div', 'cm-section', 'Command'));
        const preview = document.createElement('textarea');
        preview.className = 'cm-preview';
        preview.spellcheck = false;
        preview.rows = 4;
        preview.addEventListener('input', function () {
            state.edited = true;
        });
        state.previewEl = preview;
        detail.appendChild(preview);

        state.warningsEl = el('div', 'cm-warnings');
        detail.appendChild(state.warningsEl);

        const actions = el('div', 'cm-actions');
        actions.appendChild(button('Copy', copy));
        actions.appendChild(button('Insert', insert));
        actions.appendChild(button('Regenerate', function () {
            state.edited = false;
            updatePreview(true);
        }));
        detail.appendChild(actions);

        detail.appendChild(presetBlock());
        updatePreview(true);
    }

    function toggleNewCommand() {
        if (newCommandRow) {
            newCommandRow.remove();
            newCommandRow = null;
            return;
        }
        const row = el('div', 'cm-inline');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cm-control';
        input.placeholder = 'New command name (e.g. docker run)';
        const create = button('Create', async function () {
            const title = input.value.trim();
            if (!title) {
                notify(new Error('Command name is required.'));
                return;
            }
            const created = await controller.createCommand(title);
            if (newCommandRow) {
                newCommandRow.remove();
                newCommandRow = null;
            }
            await controller.refresh();
            await runSearch();
            const item = state.items.filter(function (entry) {
                return entry.noteId === created.noteId;
            })[0];
            if (item) {
                await selectItem(item);
            }
            setStatus('Command created.');
        });
        row.appendChild(input);
        row.appendChild(create);
        footer.appendChild(row);
        newCommandRow = row;
        input.focus();
    }

    function toggleAddOption() {
        if (!state.definition) {
            notify(new Error('Select a command first.'));
            return;
        }
        if (addOptionRow) {
            addOptionRow.remove();
            addOptionRow = null;
            return;
        }
        const row = el('div', 'cm-inline');
        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'cm-control';
        labelInput.placeholder = 'Option label';

        const flagInput = document.createElement('input');
        flagInput.type = 'text';
        flagInput.className = 'cm-control';
        flagInput.placeholder = '--flag (empty = positional)';

        const typeSelect = document.createElement('select');
        typeSelect.className = 'cm-control';
        Model.TYPES.forEach(function (type) {
            const entry = document.createElement('option');
            entry.value = type;
            entry.textContent = type;
            typeSelect.appendChild(entry);
        });

        const add = button('Add', async function () {
            const label = labelInput.value.trim();
            if (!label) {
                notify(new Error('Option label is required.'));
                return;
            }
            await controller.addOption(state.definition.noteId, {
                label: label,
                flag: flagInput.value.trim(),
                type: typeSelect.value
            });
            if (addOptionRow) {
                addOptionRow.remove();
                addOptionRow = null;
            }
            if (state.current) {
                await selectItem(state.current);
            }
            setStatus('Option added. Edit its attributes to set enum values, defaults and order.');
        });

        row.appendChild(labelInput);
        row.appendChild(flagInput);
        row.appendChild(typeSelect);
        row.appendChild(add);
        footer.appendChild(row);
        addOptionRow = row;
        labelInput.focus();
    }

    searchInput.addEventListener('input', onSearchInput);
    closeButton.addEventListener('click', close);
    newCommandButton.addEventListener('click', toggleNewCommand);
    addOptionButton.addEventListener('click', toggleAddOption);
    overlay.addEventListener('click', function (event) {
        if (event.target === overlay) {
            close();
        }
    });
    overlay.addEventListener('keydown', onKeyDown);

    instance = {
        focus() {
            searchInput.focus();
            searchInput.select();
        },
        close,
        element: panel
    };
    if (typeof window !== 'undefined') {
        window.__cmPaletteInstance = instance;
    }

    searchInput.focus();

    Promise.resolve()
        .then(function () {
            return controller.refresh();
        })
        .then(runSearch)
        .catch(notify);

    return instance;
}

module.exports = { openPalette };