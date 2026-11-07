'use strict';

/**
 * Palette UI. Plain DOM on purpose: no JSX compile step, no Preact version
 * coupling, and it keeps the installed note to a single script.
 *
 * The UI is driven by a controller (see runtime.js):
 *   refresh(): Promise<void>
 *   search(query): Array<{ noteId, title, category, description, base }>
 *   load(noteId): Promise<{ definition, presets, whatIs, links, usageExamples,
 *                            helpText, installText, ... }>
 *   copy(text): Promise<boolean>
 *   insert(text): void
 *   categories(): string[]
 *   createTool(spec): Promise<{ noteId }>
 *   importTool(tool): Promise<{ noteId }>
 *   exportTool(noteId): Promise<{ kind, version, tool }>
 *   importOptions(toolId, options): Promise<{ created }>
 *   savePreset(toolId, name, values): Promise<void>
 *   deletePreset(toolId, name): Promise<void>
 *   setToolBase(toolId, base): Promise<void>
 *   currentToolsRoot(): Promise<{ noteId, title } | null>
 *   setToolsRoot(noteId): Promise<void>
 *   useActiveNoteAsToolsRoot(): Promise<void>
 *   activeNoteText(): Promise<{ noteId, title, text }>
 *   openNote(noteId): Promise<void>
 */

const Model = require('./model');
const Render = require('./render');
const Parse = require('./parse');
const ToolFile = require('./toolfile');
const Prompt = require('./prompt');

const STYLE_ID = 'cm-palette-style';

const CSS = [
    '.cm-overlay{position:fixed;inset:0;z-index:99999;display:flex;justify-content:center;align-items:flex-start;padding:7vh 16px;background:rgba(0,0,0,.45);}',
    '.cm-panel{position:relative;display:flex;flex-direction:column;width:min(1040px,100%);max-height:86vh;border-radius:10px;overflow:hidden;background:var(--main-background-color,#fff);color:var(--main-text-color,#222);box-shadow:0 24px 64px rgba(0,0,0,.4);font-size:14px;}',
    '.cm-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--main-border-color,#ddd);}',
    '.cm-search{flex:1;padding:8px 10px;border:1px solid var(--main-border-color,#ccc);border-radius:6px;background:var(--input-background-color,#fafafa);color:inherit;font-size:15px;}',
    '.cm-close{border:0;background:transparent;color:inherit;font-size:16px;cursor:pointer;padding:4px 8px;}',
    '.cm-body{display:flex;min-height:0;flex:1;}',
    '.cm-list{width:300px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--main-border-color,#ddd);padding:6px;}',
    '.cm-result{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;}',
    '.cm-result:hover{background:var(--hover-item-background-color,#0000001a);color:var(--hover-item-text-color,inherit);}',
    '.cm-result.is-active{background:var(--accented-background-color,#eef2ff);box-shadow:inset 3px 0 0 var(--link-color,#4f8cff);}',
    '.cm-result-title{font-weight:600;}',
    '.cm-result-meta{display:flex;gap:6px;align-items:center;margin-top:2px;}',
    '.cm-result-desc{opacity:.7;font-size:12px;flex:1;}',
    '.cm-cat{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--accented-background-color,#eef2ff);opacity:.85;white-space:nowrap;}',
    '.cm-detail{flex:1;min-width:0;overflow-y:auto;padding:14px 16px;}',
    '.cm-detail-head{margin:0 0 8px;}',
    '.cm-title{margin:0 0 4px;font-size:18px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    '.cm-subtitle{margin:0 0 4px;opacity:.75;}',
    '.cm-section{margin:14px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;opacity:.6;}',
    '.cm-what{white-space:pre-wrap;margin:0 0 4px;line-height:1.5;}',
    '.cm-links{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 4px;}',
    '.cm-link{color:var(--link-color,#4f8cff);text-decoration:none;}',
    '.cm-link:hover{text-decoration:underline;}',
    '.cm-base-row{display:flex;gap:6px;align-items:center;margin:0 0 4px;}',
    '.cm-base-label{flex:0 0 110px;opacity:.75;}',
    '.cm-option{display:flex;align-items:flex-start;gap:12px;padding:6px 8px;border-radius:6px;}',
    '.cm-option.cm-option-bool{cursor:pointer;}',
    '.cm-option-group{display:flex;flex-direction:column;gap:2px;margin-bottom:8px;}',
    '.cm-option-group-title{font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.65;margin:4px 0 2px;}',
    '.cm-option:hover{background:var(--hover-item-background-color,#00000010);}',
    '.cm-opt-main{flex:1;min-width:0;}',
    '.cm-opt-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    '.cm-opt-title{font-weight:600;}',
    '.cm-opt-flag{font-family:var(--monospace-font-family,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;opacity:.8;background:var(--accented-background-color,#eef2ff);padding:0 5px;border-radius:4px;}',
    '.cm-opt-help{font-size:12px;opacity:.7;margin-top:2px;line-height:1.4;}',
    '.cm-opt-control{flex:0 0 210px;max-width:45%;}',
    '.cm-opt-check{flex:0 0 auto;margin-left:auto;align-self:center;}',
    '.cm-filter{width:100%;box-sizing:border-box;margin-bottom:4px;}',
    '.cm-form{display:flex;flex-direction:column;gap:6px;margin-bottom:10px;}',
    '.cm-control{padding:6px 8px;border:1px solid var(--main-border-color,#ccc);border-radius:6px;background:var(--input-background-color,#fafafa);color:inherit;font:inherit;box-sizing:border-box;}',
    ':root .cm-control.cm-select{appearance:none;-webkit-appearance:none;background-color:var(--input-background-color);background-image:var(--select-arrow-svg,url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="none" stroke="%23888888" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m2 5 6 6 6-6"/></svg>\'));background-position:right 0.75rem center;background-size:15px 20px;background-repeat:no-repeat;padding-inline-end:calc(15px + 1.5rem);}',
    ':root .cm-control.cm-select:hover{background-color:var(--input-hover-background);color:var(--input-hover-color,inherit);}',
    ':root .cm-control.cm-select:focus{background-color:var(--select-focus-background);color:var(--select-focus-text-color,inherit);}',
    ':root .cm-preview{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid var(--main-border-color,#ccc);background:var(--input-background-color);color:inherit;font-family:var(--monospace-font-family,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:13px;resize:vertical;}',
    ':root .cm-preview:hover,:root .cm-preview:focus{background:var(--input-background-color);color:inherit;}',
    '.cm-warnings{display:flex;flex-direction:column;gap:4px;margin-top:6px;}',
    '.cm-warning{color:#b45309;font-size:12px;}',
    '.cm-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;}',
    '.cm-button{padding:6px 12px;border:1px solid var(--main-border-color,#ccc);border-radius:6px;background:var(--button-background-color,#fff);color:inherit;cursor:pointer;font:inherit;}',
    '.cm-button:hover{background:var(--accented-background-color,#eef2ff);}',
    '.cm-button:disabled{opacity:.5;cursor:default;}',
    '.cm-danger{color:#b91c1c;}',
    '.cm-presets,.cm-examples,.cm-fold-block{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--main-border-color,#ddd);padding-top:10px;margin-top:12px;}',
    '.cm-row{display:flex;align-items:center;gap:8px;}',
    '.cm-empty{opacity:.6;padding:8px;}',
    '.cm-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;border-top:1px solid var(--main-border-color,#ddd);}',
    '.cm-inline{display:flex;flex-wrap:wrap;gap:6px;align-items:center;width:100%;}',
    '.cm-inline .cm-control{flex:1;min-width:120px;}',
    '.cm-status{margin-left:auto;font-size:12px;opacity:.75;max-width:420px;overflow-wrap:anywhere;}',
    '.cm-status.is-error{color:#b91c1c;opacity:1;}',
    '.cm-version{font-size:12px;opacity:.7;border:0;background:transparent;color:inherit;cursor:pointer;padding:2px 6px;font:inherit;}',
    '.cm-version:hover{opacity:1;text-decoration:underline;}',
    '.cm-version-link{font-size:11px;opacity:.6;color:inherit;text-decoration:none;padding:2px 4px;}',
    '.cm-version-link:hover{opacity:1;text-decoration:underline;}',
    '.cm-badge{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--accented-background-color,#eef2ff);opacity:.8;}',
    '.cm-example{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;}',
    '.cm-example:hover{background:var(--hover-item-background-color,#00000010);}',
    '.cm-example-text{flex:1;min-width:0;font-family:var(--monospace-font-family,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;overflow-wrap:anywhere;}',
    '.cm-fold summary{cursor:pointer;font-size:12px;text-transform:uppercase;letter-spacing:.06em;opacity:.7;}',
    '.cm-pre{margin:8px 0 0;padding:10px;border-radius:8px;background:var(--input-background-color,#fafafa);border:1px solid var(--main-border-color,#ddd);font-family:var(--monospace-font-family,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;white-space:pre-wrap;overflow-x:auto;}',
    '.cm-modal{position:absolute;inset:0;display:flex;justify-content:center;align-items:flex-start;padding:4vh 16px;background:rgba(0,0,0,.45);z-index:2;}',
    '.cm-modal-panel{display:flex;flex-direction:column;width:min(760px,100%);max-height:100%;border-radius:10px;overflow:hidden;background:var(--main-background-color,#fff);color:inherit;box-shadow:0 20px 48px rgba(0,0,0,.4);}',
    '.cm-modal-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--main-border-color,#ddd);flex:0 0 auto;}',
    '.cm-modal-title{flex:1;font-weight:600;}',
    '.cm-modal-body{overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:0;flex:1 1 auto;}',
    '.cm-modal-actions{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;border-top:1px solid var(--main-border-color,#ddd);flex:0 0 auto;}',
    '.cm-tabs{display:flex;gap:6px;flex-wrap:wrap;}',
    '.cm-tab{padding:4px 10px;border-radius:999px;border:1px solid var(--main-border-color,#ccc);background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px;}',
    '.cm-tab.is-active{background:var(--accented-background-color,#eef2ff);border-color:var(--link-color,#4f8cff);}',
    '.cm-import-list{display:flex;flex-direction:column;gap:2px;max-height:36vh;overflow-y:auto;border:1px solid var(--main-border-color,#ddd);border-radius:8px;padding:6px;}',
    '.cm-import-row{display:flex;gap:8px;align-items:flex-start;padding:4px 6px;border-radius:6px;}',
    '.cm-import-row:hover{background:var(--hover-item-background-color,#00000010);}',
    '.cm-import-select{display:flex;align-items:center;}',
    '.cm-import-required{display:flex;align-items:center;gap:4px;font-size:11px;opacity:.8;white-space:nowrap;}',
    '.cm-import-main{flex:1;min-width:0;}',
    '.cm-import-flag{font-family:var(--monospace-font-family,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;}',
    '.cm-import-help{font-size:12px;opacity:.7;}',
    '.cm-note{font-size:12px;opacity:.7;}',
    '@media (max-width:720px){.cm-body{flex-direction:column;}.cm-list{width:auto;max-height:180px;border-right:0;border-bottom:1px solid var(--main-border-color,#ddd);}.cm-opt-control{flex-basis:150px;}}'
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

function codeBlockTheme() {
    let resolveStyle = null;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        resolveStyle = function (node) {
            return window.getComputedStyle(node);
        };
    } else if (typeof getComputedStyle === 'function') {
        resolveStyle = function (node) {
            return getComputedStyle(node);
        };
    }
    if (!resolveStyle || typeof document === 'undefined' || !document.body) {
        return null;
    }

    let probe = null;
    try {
        probe = document.createElement('code');
        probe.className = 'hljs';
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        document.body.appendChild(probe);
        const computed = resolveStyle(probe);
        const background = computed ? String(computed.backgroundColor || '') : '';
        const color = computed ? String(computed.color || '') : '';
        if (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)') {
            return null;
        }
        return { background: background, color: color };
    } catch (ignored) {
        return null;
    } finally {
        if (probe && typeof probe.remove === 'function') {
            probe.remove();
        }
    }
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
        loaded: null,
        definition: null,
        presets: [],
        values: {},
        edited: false,
        exampleLoaded: false,
        optionRows: [],
        optionGroups: [],
        previewEl: null,
        warningsEl: null,
        presetSelect: null,
        presetName: null,
        footerRow: null,
        modal: null,
        modalKind: '',
        importSource: 'paste',
        importText: '',
        importParsed: null,
        importRows: [],
        importNoteTitle: '',
        importStatus: '',
        importToolParsed: null
    };

    const overlay = el('div', 'cm-overlay');
    const panel = el('div', 'cm-panel');

    const head = el('div', 'cm-head');
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'cm-search';
    searchInput.placeholder = 'Search tools…';
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
    const newToolButton = el('button', 'cm-button', 'New tool');
    newToolButton.type = 'button';
    const importToolButton = el('button', 'cm-button', 'Import tool');
    importToolButton.type = 'button';
    const exportToolButton = el('button', 'cm-button', 'Export tool');
    exportToolButton.type = 'button';
    const importButton = el('button', 'cm-button', 'Import options');
    importButton.type = 'button';
    const addOptionButton = el('button', 'cm-button', 'Add option');
    addOptionButton.type = 'button';
    const toolsButton = el('button', 'cm-button', 'Tools folder');
    toolsButton.type = 'button';
    const statusEl = el('span', 'cm-status', '');
    const versionButton = el('button', 'cm-version', 'v' + controller.version());
    versionButton.type = 'button';
    versionButton.title = 'Check for updates';
    const repoLink = document.createElement('a');
    repoLink.className = 'cm-version-link';
    repoLink.textContent = 'Repository';
    repoLink.href = controller.repository();
    repoLink.target = '_blank';
    repoLink.rel = 'noreferrer';
    footer.appendChild(newToolButton);
    footer.appendChild(importToolButton);
    footer.appendChild(importButton);
    footer.appendChild(addOptionButton);
    footer.appendChild(exportToolButton);
    footer.appendChild(toolsButton);
    footer.appendChild(statusEl);
    footer.appendChild(versionButton);
    footer.appendChild(repoLink);

    const modalHost = el('div', 'cm-modal-host');

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    // The modal lives on the overlay, not inside the panel: the panel shrinks to
    // its content when no tool is selected, which used to clip the modal.
    overlay.appendChild(modalHost);
    document.body.appendChild(overlay);

    let searchTimer = null;

    /** Update the footer and always surface the same text as a Trilium message. */
    function setStatus(message, isError) {
        const value = message === undefined || message === null ? '' : String(message);
        statusEl.textContent = value;
        statusEl.classList.toggle('is-error', Boolean(isError));
        if (value.trim() === '') {
            return;
        }
        try {
            if (typeof api === 'undefined') {
                return;
            }
            if (isError) {
                if (typeof api.showError === 'function') {
                    api.showError('Command Maker: ' + value);
                }
            } else if (typeof api.showMessage === 'function') {
                api.showMessage(value);
            }
        } catch (ignored) {
            // the footer status is the fallback
        }
    }

    function notify(error) {
        const message = error && error.message ? error.message : String(error);
        setStatus(message, true);
    }

    async function checkForUpdates() {
        if (typeof controller.checkLatestVersion !== 'function') {
            setStatus('Update check is unavailable.', true);
            return;
        }
        setStatus('Checking for updates…');
        try {
            const info = await controller.checkLatestVersion();
            if (info.error) {
                setStatus('v' + info.current + ' — ' + info.error + ' See the Repository link.', true);
                return;
            }
            if (info.latest && info.latest !== info.current) {
                versionButton.textContent = 'v' + info.current + ' → v' + info.latest;
                versionButton.title = 'Installed v' + info.current + '; latest v' + info.latest + '. Click to check again.';
            }

            if (info.latest && info.latest === info.current) {
                setStatus('v' + info.current + ' is the latest version.');
            } else if (info.outdated) {
                setStatus('v' + info.current + ' installed · latest is v' + info.latest + '.');
            } else if (info.latest) {
                setStatus('v' + info.current + ' is newer than the latest published tag (v' + info.latest + ').');
            } else {
                setStatus('v' + info.current + ' — no published version found.');
            }
        } catch (error) {
            notify(error);
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

    function closeModal() {
        if (!state.modal) {
            return;
        }
        state.modal.remove();
        state.modal = null;
        state.modalKind = '';
        state.importParsed = null;
        state.importRows = [];
        state.importToolParsed = null;
    }

    function close() {
        closeModal();
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
            if (state.modal) {
                closeModal();
            } else {
                close();
            }
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
            list.appendChild(el('div', 'cm-empty', 'No tools match.'));
            return;
        }
        state.items.forEach(function (item, index) {
            const row = el('button', 'cm-result' + (index === state.active ? ' is-active' : ''));
            row.type = 'button';
            row.appendChild(el('div', 'cm-result-title', item.title));
            const meta = el('div', 'cm-result-meta');
            if (item.category) {
                meta.appendChild(el('span', 'cm-cat', item.category));
            }
            if (item.description) {
                meta.appendChild(el('div', 'cm-result-desc', item.description));
            }
            if (meta.children.length) {
                row.appendChild(meta);
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
        if (state.active < 0) {
            state.active = delta > 0 ? 0 : state.items.length - 1;
        } else {
            state.active = (state.active + delta + state.items.length) % state.items.length;
        }
        renderList();
        const activeRow = list.children[state.active];
        if (activeRow && typeof activeRow.scrollIntoView === 'function') {
            activeRow.scrollIntoView({ block: 'nearest' });
        }
    }

    function pickActive() {
        const index = state.active >= 0 ? state.active : (state.items.length ? 0 : -1);
        if (index < 0 || !state.items[index]) {
            return;
        }
        selectItem(state.items[index]).catch(notify);
    }

    async function runSearch() {
        try {
            const items = await Promise.resolve(controller.search(searchInput.value));
            state.items = Array.isArray(items) ? items : [];
            state.active = -1;
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

    function markActive(item) {
        const index = state.items.findIndex(function (entry) {
            return entry.noteId === item.noteId;
        });
        if (index >= 0 && index !== state.active) {
            state.active = index;
            renderList();
        }
    }

    async function selectItem(item, options) {
        const preserve = Boolean(options && options.preserveValues);
        const previousValues = preserve ? state.values : null;
        const previousEdited = preserve ? state.edited : false;
        const previousPreview = preserve && state.previewEl ? state.previewEl.value : '';
        state.current = item;
        state.edited = false;
        state.exampleLoaded = false;
        markActive(item);
        try {
            const loaded = await controller.load(item.noteId);
            state.loaded = loaded;
            state.definition = loaded.definition;
            state.presets = loaded.presets || [];
            state.values = Model.defaultValueMap(state.definition);
            if (previousValues) {
                state.values = Object.assign(state.values, previousValues);
            }
            renderDetail();
            if (previousEdited && state.previewEl) {
                state.previewEl.value = previousPreview;
                state.edited = true;
            }
            setStatus('');
        } catch (error) {
            state.loaded = null;
            state.definition = null;
            renderDetail();
            notify(error);
        }
    }

    function setValue(key, value) {
        state.values[key] = value;
        if (state.exampleLoaded) {
            state.edited = false;
            state.exampleLoaded = false;
        }
        updatePreview(false);
    }

    function optionControl(option) {
        const key = Render.valueKey(option);
        let control;
        if (option.type === 'boolean') {
            control = document.createElement('input');
            control.type = 'checkbox';
            control.checked = Render.isTruthyFlag(state.values[key]);
            control.addEventListener('change', function () {
                setValue(key, control.checked);
            });
            control.className = 'cm-opt-check';
        } else if (option.type === 'enum') {
            control = document.createElement('select');
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '—';
            control.appendChild(empty);
            (option.enumValues || []).forEach(function (value) {
                const entry = document.createElement('option');
                entry.value = value;
                entry.textContent = value;
                control.appendChild(entry);
            });
            control.value = state.values[key] === undefined ? '' : String(state.values[key]);
            control.addEventListener('change', function () {
                setValue(key, control.value);
            });
            control.className = 'cm-control cm-select cm-opt-control';
        } else {
            control = document.createElement('input');
            control.type = option.type === 'number' ? 'number' : 'text';
            control.placeholder = option.flag || '{{' + option.placeholder + '}}';
            control.value = state.values[key] === undefined ? '' : String(state.values[key]);
            control.addEventListener('input', function () {
                setValue(key, control.value);
            });
            control.className = 'cm-control cm-opt-control';
        }
        control.setAttribute('aria-label', option.title);
        return control;
    }

    function optionRow(option, inferred) {
        const row = el('div', 'cm-option' + (inferred ? ' cm-option-inferred' : ''));
        const main = el('div', 'cm-opt-main');
        const headRow = el('div', 'cm-opt-head');
        headRow.appendChild(el('span', 'cm-opt-title', option.title));
        if (option.flag) {
            headRow.appendChild(el('code', 'cm-opt-flag', option.flag));
        }
        if (inferred) {
            headRow.appendChild(el('span', 'cm-badge', 'inferred'));
        }
        main.appendChild(headRow);
        if (option.help) {
            main.appendChild(el('div', 'cm-opt-help', option.help));
        }
        row.appendChild(main);
        const control = optionControl(option);
        row.appendChild(control);
        if (option.type === 'boolean') {
            row.classList.add('cm-option-bool');
            row.addEventListener('click', function (event) {
                if (event.target === control) {
                    return;
                }
                control.checked = !control.checked;
                setValue(Render.valueKey(option), control.checked);
            });
        }
        row.__cmSearch = [
            option.title,
            option.flag,
            option.help,
            (option.enumValues || []).join(' ')
        ].join(' ').toLowerCase();
        state.optionRows.push(row);
        return row;
    }

    function renderWarnings(warnings) {
        if (!state.warningsEl) {
            return;
        }
        state.warningsEl.textContent = '';
        const definitionWarnings = state.definition && state.definition.warnings ? state.definition.warnings : [];
        definitionWarnings.concat(warnings || []).forEach(function (warning) {
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
        if (state.loaded && state.loaded.presetsInvalid) {
            const broken = document.createElement('option');
            broken.value = '';
            broken.textContent = 'Presets note needs fixing';
            state.presetSelect.appendChild(broken);
            return;
        }
        if (!state.presets.length) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = 'No presets yet';
            state.presetSelect.appendChild(empty);
        }
        state.presets.forEach(function (preset) {
            const entry = document.createElement('option');
            entry.value = preset.name;
            entry.textContent = preset.name;
            state.presetSelect.appendChild(entry);
        });
    }

    async function copyTextToClipboard(text, message) {
        if (!String(text || '').trim()) {
            notify(new Error('Nothing to copy.'));
            return;
        }
        const ok = await controller.copy(text);
        if (ok) {
            setStatus(message || 'Copied to the clipboard.');
        } else {
            notify(new Error('Could not write to the clipboard.'));
        }
    }

    async function copy() {
        if (!state.previewEl) {
            return;
        }
        await copyTextToClipboard(state.previewEl.value);
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

    function loadPreset() {
        const name = state.presetSelect ? state.presetSelect.value : '';
        const preset = state.presets.filter(function (entry) {
            return entry.name === name;
        })[0];
        if (!preset) {
            notify(new Error('Pick a preset first.'));
            return;
        }
        state.values = Object.assign(Model.defaultValueMap(state.definition), preset.values || {});
        state.edited = false;
        state.exampleLoaded = false;
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
        state.loaded = loaded;
        state.presets = loaded.presets || [];
        renderDetail();
        setStatus('Preset saved.');
    }

    async function deletePreset() {
        const name = state.presetSelect ? state.presetSelect.value : '';
        if (!name) {
            notify(new Error('Pick a preset first.'));
            return;
        }
        await controller.deletePreset(state.definition.noteId, name);
        const loaded = await controller.load(state.definition.noteId);
        state.loaded = loaded;
        state.presets = loaded.presets || [];
        renderDetail();
        setStatus('Preset deleted.');
    }

    function presetBlock() {
        const block = el('div', 'cm-presets');
        block.appendChild(el('div', 'cm-section', 'Presets'));
        if (state.loaded && state.loaded.presetsInvalid) {
            block.appendChild(el('div', 'cm-warning', 'The Presets note is not valid JSON. Fix or delete it before saving a preset.'));
        }

        const row = el('div', 'cm-row');
        const select = document.createElement('select');
        select.className = 'cm-control cm-select';
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

    function examplesBlock() {
        if (!state.loaded || !(state.loaded.usageExamples || []).length) {
            return null;
        }
        const block = el('div', 'cm-examples');
        block.appendChild(el('div', 'cm-section', 'Examples'));
        state.loaded.usageExamples.forEach(function (example) {
            const row = el('div', 'cm-example');
            row.appendChild(el('code', 'cm-example-text', example));
            row.appendChild(button('Use', function () {
                state.values = Model.valuesFromExample(state.definition, example);
                state.edited = false;
                state.exampleLoaded = false;
                renderDetail();
                if (state.previewEl) {
                    state.previewEl.value = example;
                    state.edited = true;
                    state.exampleLoaded = true;
                }
                setStatus('Example loaded into the form.');
            }));
            row.appendChild(button('Copy', function () {
                return copyTextToClipboard(example);
            }));
            block.appendChild(row);
        });
        return block;
    }

    function linksBlock() {
        if (!state.loaded || !state.loaded.links.length) {
            return null;
        }
        const block = el('div', 'cm-links');
        state.loaded.links.forEach(function (link) {
            const anchor = document.createElement('a');
            anchor.className = 'cm-link';
            anchor.textContent = link.text;
            anchor.href = link.href;
            anchor.target = '_blank';
            anchor.rel = 'noreferrer';
            block.appendChild(anchor);
        });
        return block;
    }

    function foldBlock(title, text, className) {
        if (!text) {
            return null;
        }
        const details = document.createElement('details');
        details.className = 'cm-fold-block';
        const summary = document.createElement('summary');
        summary.textContent = title;
        details.appendChild(summary);
        const pre = el('pre', 'cm-pre' + (className ? ' ' + className : ''), text);
        details.appendChild(pre);
        return details;
    }

    function baseRow() {
        const row = el('div', 'cm-base-row');
        row.appendChild(el('span', 'cm-base-label', 'Base command'));
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cm-control';
        input.value = state.definition.base;
        input.setAttribute('aria-label', 'Base command');
        input.addEventListener('change', function () {
            const value = input.value.trim();
            Promise.resolve()
                .then(function () {
                    return controller.setToolBase(state.definition.noteId, value);
                })
                .then(function () {
                    state.definition.base = value || Model.deriveBase(state.definition.title);
                    state.values = Object.assign(Model.defaultValueMap(state.definition), state.values);
                    state.exampleLoaded = false;
                    renderDetail();
                    setStatus('Base command updated.');
                })
                .catch(notify);
        });
        row.appendChild(input);
        return row;
    }

    function renderDetail() {
        detail.textContent = '';
        state.previewEl = null;
        state.warningsEl = null;
        state.presetSelect = null;
        state.presetName = null;
        state.optionRows = [];
        state.optionGroups = [];

        if (!state.definition) {
            detail.appendChild(el('div', 'cm-empty', 'Pick a tool from the list.'));
            return;
        }

        const definition = state.definition;
        const header = el('div', 'cm-detail-head');
        const title = el('h2', 'cm-title');
        title.appendChild(el('span', '', definition.title));
        if (definition.category) {
            title.appendChild(el('span', 'cm-cat', definition.category));
        }
        header.appendChild(title);
        if (definition.description) {
            header.appendChild(el('p', 'cm-subtitle', definition.description));
        }
        detail.appendChild(header);

        if (state.loaded && state.loaded.whatIs) {
            detail.appendChild(el('div', 'cm-section', 'What is?'));
            detail.appendChild(el('p', 'cm-what', state.loaded.whatIs));
        }

        const links = linksBlock();
        if (links) {
            detail.appendChild(links);
        }

        detail.appendChild(baseRow());
        detail.appendChild(presetBlock());

        detail.appendChild(el('div', 'cm-section', 'Options (' + definition.options.length + ')'));
        const filter = document.createElement('input');
        filter.type = 'search';
        filter.className = 'cm-control cm-filter';
        filter.placeholder = 'Filter options…';
        filter.addEventListener('input', function () {
            const needle = String(filter.value || '').trim().toLowerCase();
            state.optionRows.forEach(function (row) {
                const match = needle === '' || String(row.__cmSearch || '').indexOf(needle) !== -1;
                row.style.display = match ? '' : 'none';
            });
            state.optionGroups.forEach(function (group) {
                const visible = group.rows.some(function (row) {
                    return row.style.display !== 'none';
                });
                group.node.style.display = visible ? '' : 'none';
            });
        });
        detail.appendChild(filter);

        const form = el('div', 'cm-form');
        const requiredOptions = definition.options
            .filter(function (option) {
                return option.required;
            })
            .concat(definition.inferred);
        const optionalOptions = definition.options.filter(function (option) {
            return !option.required;
        });

        function optionGroup(title, options) {
            if (!options.length) {
                return;
            }
            const group = el('div', 'cm-option-group');
            group.appendChild(el('div', 'cm-option-group-title', title));
            const rows = [];
            options.forEach(function (option) {
                const row = optionRow(option, Boolean(option.inferred));
                rows.push(row);
                group.appendChild(row);
            });
            form.appendChild(group);
            state.optionGroups.push({ node: group, rows: rows });
        }

        if (!requiredOptions.length && !optionalOptions.length) {
            form.appendChild(el('div', 'cm-empty', 'This tool has no options yet. Use "Import options" or add option notes under Options.'));
        }
        optionGroup('Required', requiredOptions);
        optionGroup('Optional', optionalOptions);
        detail.appendChild(form);

        detail.appendChild(el('div', 'cm-section', 'Extra arguments'));
        const extra = document.createElement('input');
        extra.type = 'text';
        extra.className = 'cm-control';
        extra.placeholder = 'Positional arguments or subcommands, inserted after the base';
        extra.value = state.values[Render.EXTRA_KEY] === undefined ? '' : String(state.values[Render.EXTRA_KEY]);
        extra.addEventListener('input', function () {
            setValue(Render.EXTRA_KEY, extra.value);
        });
        detail.appendChild(extra);

        detail.appendChild(el('div', 'cm-section', 'Command'));
        const preview = document.createElement('textarea');
        preview.className = 'cm-preview';
        preview.spellcheck = false;
        preview.rows = 3;
        const codeTheme = codeBlockTheme();
        if (codeTheme) {
            preview.style.background = codeTheme.background;
            if (codeTheme.color) {
                preview.style.color = codeTheme.color;
            }
        }
        preview.addEventListener('input', function () {
            state.edited = true;
            state.exampleLoaded = false;
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
            state.exampleLoaded = false;
            updatePreview(true);
        }));
        actions.appendChild(button('Open note', function () {
            return controller.openNote(definition.noteId);
        }));
        detail.appendChild(actions);

        const examples = examplesBlock();
        if (examples) {
            detail.appendChild(examples);
        }

        const help = foldBlock('Help output', state.loaded ? state.loaded.helpText : '');
        if (help) {
            detail.appendChild(help);
        }
        const install = foldBlock('Install', state.loaded ? state.loaded.installText : '');
        if (install) {
            detail.appendChild(install);
        }

        updatePreview(true);
    }

    function clearFooterRow() {
        if (state.footerRow) {
            state.footerRow.remove();
            state.footerRow = null;
        }
    }

    function toggleNewTool() {
        if (state.footerRow) {
            clearFooterRow();
            return;
        }
        const row = el('div', 'cm-inline');
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'cm-control';
        titleInput.placeholder = 'Tool name (e.g. docker)';

        const categorySelect = document.createElement('select');
        categorySelect.className = 'cm-control cm-select';
        const categories = controller.categories();
        categories.forEach(function (name) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            categorySelect.appendChild(option);
        });
        const newCategoryOption = document.createElement('option');
        newCategoryOption.value = '__new__';
        newCategoryOption.textContent = 'New category…';
        categorySelect.appendChild(newCategoryOption);
        if (!categories.length) {
            categorySelect.value = '__new__';
        }

        const newCategoryInput = document.createElement('input');
        newCategoryInput.type = 'text';
        newCategoryInput.className = 'cm-control';
        newCategoryInput.placeholder = 'New category name';
        newCategoryInput.style.display = categorySelect.value === '__new__' ? '' : 'none';
        categorySelect.addEventListener('change', function () {
            newCategoryInput.style.display = categorySelect.value === '__new__' ? '' : 'none';
        });

        const baseInput = document.createElement('input');
        baseInput.type = 'text';
        baseInput.className = 'cm-control';
        baseInput.placeholder = 'Base command (optional, defaults to the name)';

        const create = button('Create', async function () {
            const title = titleInput.value.trim();
            if (!title) {
                notify(new Error('Tool name is required.'));
                return;
            }
            let category = categorySelect.value === '__new__' ? newCategoryInput.value.trim() : categorySelect.value;
            if (categorySelect.value === '__new__' && !category) {
                notify(new Error('Category name is required.'));
                return;
            }
            const created = await controller.createTool({
                title: title,
                category: category,
                base: baseInput.value.trim(),
                description: ''
            });
            clearFooterRow();
            await runSearch();
            const item = state.items.filter(function (entry) {
                return entry.noteId === created.noteId;
            })[0];
            if (item) {
                await selectItem(item);
            }
            setStatus('Tool created.');
        });

        row.appendChild(titleInput);
        row.appendChild(categorySelect);
        row.appendChild(newCategoryInput);
        row.appendChild(baseInput);
        row.appendChild(create);
        footer.appendChild(row);
        state.footerRow = row;
        titleInput.focus();
    }

    function readFileText(file) {
        if (file && typeof file.text === 'function') {
            return Promise.resolve(file.text());
        }
        return new Promise(function (resolve, reject) {
            if (typeof FileReader === 'undefined') {
                reject(new Error('This browser cannot read local files.'));
                return;
            }
            const reader = new FileReader();
            reader.onload = function () {
                resolve(String(reader.result || ''));
            };
            reader.onerror = function () {
                reject(new Error('Could not read the selected file.'));
            };
            reader.readAsText(file);
        });
    }

    /** Save text as a local file. Throws when the runtime has no Blob/URL support. */
    function downloadText(filename, value) {
        if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            throw new Error('This environment cannot download files. Copy the text instead.');
        }
        const blob = new Blob([value], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 0);
    }

    function modalShell(title, bodyNode, actionsNode) {
        closeModal();
        const modal = el('div', 'cm-modal');
        const modalPanel = el('div', 'cm-modal-panel');
        const modalHead = el('div', 'cm-modal-head');
        modalHead.appendChild(el('span', 'cm-modal-title', title));
        const closeModalButton = el('button', 'cm-close', '✕');
        closeModalButton.type = 'button';
        closeModalButton.addEventListener('click', closeModal);
        modalHead.appendChild(closeModalButton);
        const modalBody = el('div', 'cm-modal-body');
        modalBody.appendChild(bodyNode);
        const modalActions = el('div', 'cm-modal-actions');
        modalActions.appendChild(actionsNode);
        modalPanel.appendChild(modalHead);
        modalPanel.appendChild(modalBody);
        modalPanel.appendChild(modalActions);
        modal.appendChild(modalPanel);
        modal.addEventListener('click', function (event) {
            if (event.target === modal) {
                closeModal();
            }
        });
        modalHost.appendChild(modal);
        state.modal = modal;
        return { modal: modal, body: modalBody, actions: modalActions };
    }

    function openImport() {
        if (!state.current) {
            notify(new Error('Select a tool first.'));
            return;
        }
        const sourceRow = el('div', 'cm-tabs');
        const tabPaste = el('button', 'cm-tab is-active', 'Paste text');
        const tabNote = el('button', 'cm-tab', 'Active note');
        const tabFile = el('button', 'cm-tab', 'File');
        [tabPaste, tabNote, tabFile].forEach(function (tab) {
            tab.type = 'button';
        });
        sourceRow.appendChild(tabPaste);
        sourceRow.appendChild(tabNote);
        sourceRow.appendChild(tabFile);

        const hint = el('div', 'cm-note', 'Paste "--help" output, a JSON options file, or a markdown table. Nothing is written until you import.');

        const textArea = document.createElement('textarea');
        textArea.className = 'cm-control cm-preview';
        textArea.rows = 12;
        textArea.placeholder = '--help output, JSON or a markdown table…';

        const notePreview = document.createElement('div', 'cm-note', '');
        const readNoteButton = el('button', 'cm-button', 'Read active note');
        readNoteButton.type = 'button';
        readNoteButton.style.display = 'none';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.className = 'cm-control';
        fileInput.accept = '.txt,.json,.md,.markdown,.log,.help,.text';
        fileInput.style.display = 'none';

        const parseButton = el('button', 'cm-button', 'Parse');
        parseButton.type = 'button';
        const importSelected = el('button', 'cm-button', 'Import selected');
        importSelected.type = 'button';
        importSelected.disabled = true;
        const closeButton2 = el('button', 'cm-button', 'Close');
        closeButton2.type = 'button';
        closeButton2.addEventListener('click', closeModal);

        const warnings = el('div', 'cm-warnings', '');
        const previewList = el('div', 'cm-import-list', '');

        function setSource(source) {
            state.importSource = source;
            tabPaste.classList.toggle('is-active', source === 'paste');
            tabNote.classList.toggle('is-active', source === 'note');
            tabFile.classList.toggle('is-active', source === 'file');
            textArea.style.display = source === 'paste' ? '' : 'none';
            readNoteButton.style.display = source === 'note' ? '' : 'none';
            notePreview.style.display = source === 'note' && notePreview.textContent ? '' : 'none';
            fileInput.style.display = source === 'file' ? '' : 'none';
        }

        tabPaste.addEventListener('click', function () { setSource('paste'); });
        tabNote.addEventListener('click', function () { setSource('note'); });
        tabFile.addEventListener('click', function () { setSource('file'); });

        readNoteButton.addEventListener('click', function () {
            Promise.resolve()
                .then(function () {
                    return controller.activeNoteText();
                })
                .then(function (note) {
                    state.importText = note.text;
                    notePreview.textContent = 'Read "' + note.title + '" (' + note.text.length + ' characters).';
                    notePreview.style.display = '';
                    setStatus('Note read.');
                })
                .catch(notify);
        });

        fileInput.addEventListener('change', function () {
            const file = fileInput.files && fileInput.files[0];
            if (!file) {
                return;
            }
            Promise.resolve()
                .then(function () {
                    return readFileText(file);
                })
                .then(function (text) {
                    state.importText = text;
                    notePreview.textContent = 'Read "' + (file.name || 'file') + '" (' + text.length + ' characters).';
                    notePreview.style.display = '';
                    setStatus('File read.');
                })
                .catch(notify);
        });

        function collectText() {
            if (state.importSource === 'paste') {
                return textArea.value;
            }
            return state.importText;
        }

        function renderImportPreview() {
            warnings.textContent = '';
            previewList.textContent = '';
            state.importRows = [];
            if (!state.importParsed) {
                importSelected.disabled = true;
                return;
            }
            (state.importParsed.warnings || []).forEach(function (warning) {
                warnings.appendChild(el('div', 'cm-warning', warning.message || warning.code));
            });
            const options = state.importParsed.options || [];
            if (!options.length) {
                previewList.appendChild(el('div', 'cm-empty', 'No options found. Check the format and try again.'));
                importSelected.disabled = true;
                return;
            }
            options.forEach(function (option, index) {
                const row = el('div', 'cm-import-row');
                const selectLabel = el('label', 'cm-import-select');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true;
                checkbox.addEventListener('change', function () {
                    state.importRows[index].checked = checkbox.checked;
                    importSelected.disabled = !state.importRows.some(function (entry) {
                        return entry.checked;
                    });
                });
                selectLabel.appendChild(checkbox);
                row.appendChild(selectLabel);
                const main = el('div', 'cm-import-main');
                const flag = el('div', 'cm-import-flag', option.flag + (option.type ? '  (' + option.type + ')' : ''));
                main.appendChild(flag);
                if (option.help) {
                    main.appendChild(el('div', 'cm-import-help', option.help));
                }
                row.appendChild(main);
                const requiredLabel = el('label', 'cm-import-required');
                const requiredBox = document.createElement('input');
                requiredBox.type = 'checkbox';
                requiredBox.checked = Boolean(option.required);
                requiredBox.addEventListener('change', function () {
                    state.importRows[index].required = requiredBox.checked;
                });
                requiredLabel.appendChild(requiredBox);
                requiredLabel.appendChild(el('span', '', 'Required'));
                row.appendChild(requiredLabel);
                previewList.appendChild(row);
                state.importRows.push({ option: option, checked: true, required: Boolean(option.required) });
            });
            importSelected.disabled = false;
        }

        parseButton.addEventListener('click', function () {
            const text = collectText();
            if (!String(text || '').trim()) {
                notify(new Error('Nothing to parse. Paste help output, read the active note or choose a file.'));
                return;
            }
            try {
                state.importParsed = Parse.parseImport(text);
                renderImportPreview();
                setStatus('Parsed ' + (state.importParsed.options || []).length + ' option(s).');
            } catch (error) {
                notify(error);
            }
        });

        importSelected.addEventListener('click', function () {
            Promise.resolve()
                .then(function () {
                    const selected = state.importRows
                        .filter(function (entry) { return entry.checked; })
                        .map(function (entry) {
                            return Object.assign({}, entry.option, { required: entry.required });
                        });
                    if (!selected.length) {
                        throw new Error('Select at least one option.');
                    }
                    return controller.importOptions(state.current.noteId, selected);
                })
                .then(function (result) {
                    closeModal();
                    const created = result && typeof result.created === 'number' ? result.created : 'the selected';
                    const skipped = result && result.skipped ? ' Skipped ' + result.skipped + ' duplicate(s).' : '';
                    state.importStatus = 'Imported ' + created + ' option(s).' + skipped;
                    return controller.refresh();
                })
                .then(runSearch)
                .then(function () {
                    return selectItem(state.current, { preserveValues: true });
                })
                .then(function () {
                    setStatus(state.importStatus || '');
                })
                .catch(notify);
        });

        const bodyNode = el('div', '');
        bodyNode.appendChild(sourceRow);
        bodyNode.appendChild(hint);
        bodyNode.appendChild(textArea);
        bodyNode.appendChild(readNoteButton);
        bodyNode.appendChild(notePreview);
        bodyNode.appendChild(fileInput);
        bodyNode.appendChild(warnings);
        bodyNode.appendChild(previewList);

        const actionsNode = el('div', 'cm-inline');
        actionsNode.appendChild(parseButton);
        actionsNode.appendChild(importSelected);
        actionsNode.appendChild(closeButton2);

        modalShell('Import options into "' + state.current.title + '"', bodyNode, actionsNode);
        state.modalKind = 'import';
        setSource('paste');
    }

    function openImportTool() {
        const sourceRow = el('div', 'cm-tabs');
        const tabPaste = el('button', 'cm-tab is-active', 'Paste text');
        const tabNote = el('button', 'cm-tab', 'Active note');
        const tabFile = el('button', 'cm-tab', 'File');
        [tabPaste, tabNote, tabFile].forEach(function (tab) {
            tab.type = 'button';
        });
        sourceRow.appendChild(tabPaste);
        sourceRow.appendChild(tabNote);
        sourceRow.appendChild(tabFile);

        const hint = el('div', 'cm-note', 'Paste a tool file (JSON) exported from another tool, or one generated with "Copy AI prompt". Nothing is written until you import.');

        const textArea = document.createElement('textarea');
        textArea.className = 'cm-control cm-preview';
        textArea.rows = 12;
        textArea.placeholder = 'Tool file JSON, or the output of the tool\'s --help command…';

        const notePreview = el('div', 'cm-note', '');
        const readNoteButton = el('button', 'cm-button', 'Read active note');
        readNoteButton.type = 'button';
        readNoteButton.style.display = 'none';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.className = 'cm-control';
        fileInput.accept = '.json,.txt,.text';
        fileInput.style.display = 'none';

        const promptButton = el('button', 'cm-button', 'Copy AI prompt');
        promptButton.type = 'button';
        promptButton.title = 'Copy a prompt for any AI model, including the pasted --help output';
        const parseButton = el('button', 'cm-button', 'Parse');
        parseButton.type = 'button';
        const importSelected = el('button', 'cm-button', 'Import tool');
        importSelected.type = 'button';
        importSelected.disabled = true;
        const closeButton2 = el('button', 'cm-button', 'Close');
        closeButton2.type = 'button';
        closeButton2.addEventListener('click', closeModal);

        const warnings = el('div', 'cm-warnings', '');
        const previewList = el('div', 'cm-import-list', '');

        let source = 'paste';
        let sourceText = '';

        function setSource(next) {
            source = next;
            tabPaste.classList.toggle('is-active', next === 'paste');
            tabNote.classList.toggle('is-active', next === 'note');
            tabFile.classList.toggle('is-active', next === 'file');
            textArea.style.display = next === 'paste' ? '' : 'none';
            readNoteButton.style.display = next === 'note' ? '' : 'none';
            notePreview.style.display = next === 'note' && notePreview.textContent ? '' : 'none';
            fileInput.style.display = next === 'file' ? '' : 'none';
        }

        tabPaste.addEventListener('click', function () { setSource('paste'); });
        tabNote.addEventListener('click', function () { setSource('note'); });
        tabFile.addEventListener('click', function () { setSource('file'); });

        readNoteButton.addEventListener('click', function () {
            Promise.resolve()
                .then(function () {
                    return controller.activeNoteText();
                })
                .then(function (note) {
                    sourceText = note.text;
                    notePreview.textContent = 'Read "' + note.title + '" (' + note.text.length + ' characters).';
                    notePreview.style.display = '';
                    setStatus('Note read.');
                })
                .catch(notify);
        });

        fileInput.addEventListener('change', function () {
            const file = fileInput.files && fileInput.files[0];
            if (!file) {
                return;
            }
            Promise.resolve()
                .then(function () {
                    return readFileText(file);
                })
                .then(function (value) {
                    sourceText = value;
                    notePreview.textContent = 'Read "' + (file.name || 'file') + '" (' + value.length + ' characters).';
                    notePreview.style.display = '';
                    setStatus('File read.');
                })
                .catch(notify);
        });

        function collectText() {
            return source === 'paste' ? textArea.value : sourceText;
        }

        function renderToolPreview() {
            warnings.textContent = '';
            previewList.textContent = '';
            importSelected.disabled = true;
            const parsed = state.importToolParsed;
            if (!parsed) {
                return;
            }
            (parsed.warnings || []).forEach(function (warning) {
                warnings.appendChild(el('div', 'cm-warning', warning.message || warning.code));
            });
            const tool = parsed.tool;
            if (!tool) {
                return;
            }
            [
                ['Title', tool.title],
                ['Category', tool.category || 'Uncategorized'],
                ['Base command', tool.base || Model.deriveBase(tool.title)]
            ].forEach(function (line) {
                previewList.appendChild(el('div', 'cm-import-flag', line[0] + ': ' + line[1]));
            });
            if (tool.description) {
                previewList.appendChild(el('div', 'cm-note', tool.description));
            }
            if (!tool.options.length) {
                previewList.appendChild(el('div', 'cm-empty', 'This tool file has no options.'));
            }
            tool.options.forEach(function (option) {
                const row = el('div', 'cm-import-row');
                const main = el('div', 'cm-import-main');
                const flag = option.flag || '(positional)';
                main.appendChild(el('div', 'cm-import-flag', flag + '  (' + option.type + ')  ' + option.label));
                if (option.help) {
                    main.appendChild(el('div', 'cm-import-help', option.help));
                }
                row.appendChild(main);
                previewList.appendChild(row);
            });
            importSelected.disabled = false;
        }

        promptButton.addEventListener('click', function () {
            Promise.resolve()
                .then(function () {
                    const pasted = collectText();
                    const looksJson = /^\s*[{[]/.test(String(pasted || ''));
                    return copyTextToClipboard(Prompt.buildToolPrompt({
                        helpText: looksJson ? '' : pasted
                    }), 'AI prompt copied to the clipboard.');
                })
                .catch(notify);
        });

        parseButton.addEventListener('click', function () {
            const text = collectText();
            if (!String(text || '').trim()) {
                notify(new Error('Nothing to parse. Paste a tool file, read the active note or choose a file.'));
                return;
            }
            try {
                state.importToolParsed = ToolFile.parseToolFile(text);
                renderToolPreview();
                const tool = state.importToolParsed.tool;
                setStatus(tool ? 'Parsed tool "' + tool.title + '".' : 'The tool file could not be parsed.');
            } catch (error) {
                notify(error);
            }
        });

        importSelected.addEventListener('click', function () {
            const parsed = state.importToolParsed;
            if (!parsed || !parsed.tool) {
                notify(new Error('Parse a tool file first.'));
                return;
            }
            let created = null;
            Promise.resolve()
                .then(function () {
                    return controller.importTool(parsed.tool);
                })
                .then(function (result) {
                    created = result;
                    closeModal();
                    state.importStatus = 'Imported tool "' + parsed.tool.title + '".';
                    return controller.refresh();
                })
                .then(runSearch)
                .then(function () {
                    const item = created
                        ? state.items.filter(function (entry) { return entry.noteId === created.noteId; })[0]
                        : null;
                    return item ? selectItem(item) : undefined;
                })
                .then(function () {
                    setStatus(state.importStatus || '');
                })
                .catch(notify);
        });

        const bodyNode = el('div', '');
        bodyNode.appendChild(sourceRow);
        bodyNode.appendChild(hint);
        bodyNode.appendChild(textArea);
        bodyNode.appendChild(readNoteButton);
        bodyNode.appendChild(notePreview);
        bodyNode.appendChild(fileInput);
        bodyNode.appendChild(warnings);
        bodyNode.appendChild(previewList);

        const actionsNode = el('div', 'cm-inline');
        actionsNode.appendChild(promptButton);
        actionsNode.appendChild(parseButton);
        actionsNode.appendChild(importSelected);
        actionsNode.appendChild(closeButton2);

        modalShell('Import a tool', bodyNode, actionsNode);
        state.modalKind = 'tool';
        setSource('paste');
    }

    function openExportTool() {
        if (!state.current) {
            notify(new Error('Select a tool first.'));
            return;
        }
        Promise.resolve()
            .then(function () {
                return controller.exportTool(state.current.noteId);
            })
            .then(function (file) {
                const json = JSON.stringify(file, null, 2);
                const filename = (Render.slugify(file.tool.title) || 'tool') + '.tool.json';

                const bodyNode = el('div', '');
                bodyNode.appendChild(el('div', 'cm-note', 'This plain-JSON file can be imported here, kept as a backup, or shared.'));
                const area = document.createElement('textarea');
                area.className = 'cm-control cm-preview';
                area.rows = 18;
                area.readOnly = true;
                area.value = json;
                bodyNode.appendChild(area);
                bodyNode.appendChild(el('div', 'cm-note', 'Suggested file name: ' + filename));

                const copyButton = el('button', 'cm-button', 'Copy JSON');
                copyButton.type = 'button';
                copyButton.addEventListener('click', function () {
                    copyTextToClipboard(json, 'Tool file copied to the clipboard.')
                        .catch(notify);
                });

                const downloadButton = el('button', 'cm-button', 'Download .json');
                downloadButton.type = 'button';
                downloadButton.addEventListener('click', function () {
                    Promise.resolve()
                        .then(function () {
                            downloadText(filename, json);
                        })
                        .then(function () {
                            setStatus('Downloaded ' + filename + '.');
                        })
                        .catch(notify);
                });

                const closeButton2 = el('button', 'cm-button', 'Close');
                closeButton2.type = 'button';
                closeButton2.addEventListener('click', closeModal);

                const actionsNode = el('div', 'cm-inline');
                actionsNode.appendChild(copyButton);
                actionsNode.appendChild(downloadButton);
                actionsNode.appendChild(closeButton2);

                modalShell('Export "' + file.tool.title + '"', bodyNode, actionsNode);
                state.modalKind = 'export';
            })
            .catch(notify);
    }

    function openAddOption() {
        if (!state.current) {
            notify(new Error('Select a tool first.'));
            return;
        }

        function field(labelText, control) {
            const row = el('label', 'cm-row');
            row.appendChild(el('span', 'cm-base-label', labelText));
            control.className = 'cm-control' + (control.tagName === 'SELECT' ? ' cm-select' : '');
            row.appendChild(control);
            return row;
        }

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.placeholder = 'Option label, e.g. Output file';

        const flagInput = document.createElement('input');
        flagInput.type = 'text';
        flagInput.placeholder = 'Flag, e.g. --output (empty = positional)';

        const helpInput = document.createElement('input');
        helpInput.type = 'text';
        helpInput.placeholder = 'What is this option for?';

        const typeSelect = document.createElement('select');
        Model.TYPES.forEach(function (type) {
            const entry = document.createElement('option');
            entry.value = type;
            entry.textContent = type;
            typeSelect.appendChild(entry);
        });

        const defaultInput = document.createElement('input');
        defaultInput.type = 'text';
        defaultInput.placeholder = 'Default value (optional)';

        const valuesInput = document.createElement('input');
        valuesInput.type = 'text';
        valuesInput.placeholder = 'Enum values, comma separated (optional)';

        const orderInput = document.createElement('input');
        orderInput.type = 'number';
        orderInput.placeholder = '100';
        orderInput.value = '100';

        const requiredInput = document.createElement('input');
        requiredInput.type = 'checkbox';
        const requiredRow = el('label', 'cm-row');
        requiredRow.appendChild(el('span', 'cm-base-label', 'Required'));
        requiredRow.appendChild(requiredInput);

        const add = el('button', 'cm-button', 'Add');
        add.type = 'button';
        add.addEventListener('click', function () {
            Promise.resolve()
                .then(function () {
                    const label = labelInput.value.trim();
                    if (!label) {
                        throw new Error('Option label is required.');
                    }
                    const values = valuesInput.value.split(',')
                        .map(function (entry) { return entry.trim(); })
                        .filter(function (entry) { return entry !== ''; });
                    const order = Number(orderInput.value);
                    return controller.addOption(state.current.noteId, {
                        label: label,
                        flag: flagInput.value.trim(),
                        help: helpInput.value.trim(),
                        type: typeSelect.value,
                        values: values,
                        defaultValue: defaultInput.value,
                        required: Boolean(requiredInput.checked),
                        order: isFinite(order) ? order : 100
                    });
                })
                .then(function () {
                    closeModal();
                    return controller.refresh();
                })
                .then(runSearch)
                .then(function () {
                    return selectItem(state.current, { preserveValues: true });
                })
                .then(function () {
                    setStatus('Option added.');
                })
                .catch(notify);
        });

        const closeButton2 = el('button', 'cm-button', 'Close');
        closeButton2.type = 'button';
        closeButton2.addEventListener('click', closeModal);

        const bodyNode = el('div', '');
        bodyNode.appendChild(el('div', 'cm-note', 'The option is stored as a note under the tool\'s Options folder.'));
        bodyNode.appendChild(field('Label', labelInput));
        bodyNode.appendChild(field('Flag', flagInput));
        bodyNode.appendChild(field('Help', helpInput));
        bodyNode.appendChild(field('Type', typeSelect));
        bodyNode.appendChild(field('Default', defaultInput));
        bodyNode.appendChild(field('Values', valuesInput));
        bodyNode.appendChild(field('Order', orderInput));
        bodyNode.appendChild(requiredRow);
        bodyNode.appendChild(el('div', 'cm-note', 'Required options are grouped first under Required in the palette.'));

        const actionsNode = el('div', 'cm-inline');
        actionsNode.appendChild(add);
        actionsNode.appendChild(closeButton2);

        modalShell('Add an option to "' + state.current.title + '"', bodyNode, actionsNode);
        state.modalKind = 'option';
        labelInput.focus();
    }

    function openToolsFolder() {
        const bodyNode = el('div', '');
        const info = el('div', 'cm-note', 'Loading…');
        bodyNode.appendChild(info);

        const active = el('button', 'cm-button', 'Use the active note');
        active.type = 'button';
        const openFolder = el('button', 'cm-button', 'Open Tools folder');
        openFolder.type = 'button';
        openFolder.disabled = true;

        const idRow = el('div', 'cm-row');
        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.className = 'cm-control';
        idInput.placeholder = 'Note ID of an existing folder';
        const useId = el('button', 'cm-button', 'Use this note ID');
        useId.type = 'button';
        idRow.appendChild(idInput);
        idRow.appendChild(useId);
        bodyNode.appendChild(idRow);

        let root = null;
        Promise.resolve()
            .then(function () {
                return controller.currentToolsRoot();
            })
            .then(function (found) {
                root = found;
                info.textContent = found
                    ? 'Current Tools folder: "' + found.title + '" (' + found.noteId + ').'
                    : 'No Tools folder yet.';
                openFolder.disabled = !found;
            })
            .catch(notify);

        active.addEventListener('click', function () {
            Promise.resolve()
                .then(function () {
                    return controller.useActiveNoteAsToolsRoot();
                })
                .then(function () {
                    closeModal();
                    setStatus('Tools folder updated to the active note.');
                })
                .then(runSearch)
                .catch(notify);
        });

        openFolder.addEventListener('click', function () {
            if (!root) {
                return;
            }
            Promise.resolve()
                .then(function () {
                    return controller.openNote(root.noteId);
                })
                .catch(notify);
        });

        useId.addEventListener('click', function () {
            const noteId = idInput.value.trim();
            if (!noteId) {
                notify(new Error('Enter a note ID.'));
                return;
            }
            Promise.resolve()
                .then(function () {
                    return controller.setToolsRoot(noteId);
                })
                .then(function () {
                    closeModal();
                    setStatus('Tools folder updated.');
                })
                .then(runSearch)
                .catch(notify);
        });

        const actionsNode = el('div', 'cm-inline');
        actionsNode.appendChild(active);
        actionsNode.appendChild(openFolder);
        const closeButton2 = el('button', 'cm-button', 'Close');
        closeButton2.type = 'button';
        closeButton2.addEventListener('click', closeModal);
        actionsNode.appendChild(closeButton2);

        modalShell('Tools folder', bodyNode, actionsNode);
        state.modalKind = 'tools';
    }

    searchInput.addEventListener('input', onSearchInput);
    closeButton.addEventListener('click', close);
    versionButton.addEventListener('click', function (event) {
        event.preventDefault();
        Promise.resolve().then(checkForUpdates).catch(notify);
    });
    newToolButton.addEventListener('click', toggleNewTool);
    importToolButton.addEventListener('click', openImportTool);
    exportToolButton.addEventListener('click', openExportTool);
    importButton.addEventListener('click', openImport);
    addOptionButton.addEventListener('click', openAddOption);
    toolsButton.addEventListener('click', openToolsFolder);
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