'use strict';

/**
 * Palette UI. Plain DOM on purpose: no JSX compile step, no Preact version
 * coupling, and it keeps the installed note to a single script.
 *
 * The UI is driven by a controller (see runtime.js):
 *   refresh(): Promise<void>
 *   search(query): Array<{ noteId, title, category, categoryLabel, description, base }>
 *   load(noteId): Promise<{ definition, presets, whatIs, links, usageExamples,
 *                            helpText, installText, ... }>
 *   copy(text): Promise<boolean>
 *   insert(text): void
 *   message(text): void            show a non-blocking Trilium message
 *   error(text): void              show a Trilium error message
 *   categories(): Array<{ label, path }>  // label = "Infrastructure / Wifi"
 *   createTool(spec): Promise<{ noteId }>
 *   importTool(tool): Promise<{ noteId }>
 *   exportTool(noteId): Promise<{ kind, version, tool }>
 *   importOptions(toolId, options): Promise<{ created, skipped, capped }>
 *   savePreset(toolId, name, values): Promise<void>
 *   deletePreset(toolId, name): Promise<void>
 *   addOption(toolId, option): Promise<void>
 *   setToolBase(toolId, base): Promise<void>
 *   currentToolsRoot(): Promise<{ noteId, title } | null>
 *   setToolsRoot(noteId): Promise<void>
 *   useActiveNoteAsToolsRoot(): Promise<void>
 *   activeNoteText(): Promise<{ noteId, title, text }>
 *   openNote(noteId): Promise<void>
 *   openInTab(): Promise<string>
 *   version(): string
 *   repository(): string
 *   checkLatestVersion(): Promise<{ current, latest, outdated, error }>
 *
 * This module never touches the Trilium `api` global: everything goes through
 * the controller, which keeps the DOM code testable with a plain DOM.
 */

const Model = require('./model');
const Render = require('./render');
const Parse = require('./parse');
const Sections = require('./sections');
const ToolFile = require('./toolfile');
const Prompt = require('./prompt');
const Dom = require('./dom');
const Styles = require('./styles');
const SourcePicker = require('./sourcePicker');
const I18n = require('./i18n');

/** Copy icon and control injected into every code block of the Install note. */
const CODE_COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2H10c-1.103 0-2 .897-2 2v4H4c-1.103 0-2 .897-2 2v10c0 1.103.897 2 2 2h10c1.103 0 2-.897 2-2v-4h4c1.103 0 2-.897 2-2V4c0-1.103-.897-2-2-2zM4 20V10h10l.002 10H4zm16-6h-4v-4c0-1.103-.897-2-2-2h-4V4h10v10z"></path></svg>';

function codeCopyButton() {
    const label = Sections.escapeHtml(I18n.t('ui.copy'));
    return '<button type="button" class="cm-code-copy" title="' + label + '" aria-label="' + label + '">' + CODE_COPY_ICON + '</button>';
}

const NEW_CATEGORY = '__new__';

/** Category line of the import preview: the whole folder path when there is one. */
function categoryPreview(tool) {
    const safe = tool || {};
    if (Array.isArray(safe.categoryPath) && safe.categoryPath.length) {
        return safe.categoryPath.join(' / ');
    }
    return safe.category || I18n.t('importTool.uncategorized');
}

let instance = null;

/** "Infrastructure / Wifi" -> ['Infrastructure', 'Wifi']; blank segments drop. */
function parseCategoryPath(value) {
    return String(value == null ? '' : value)
        .split('/')
        .map(function (part) {
            return part.trim();
        })
        .filter(function (part) {
            return part !== '';
        });
}

/**
 * Resolve after the handler, so a rejected promise becomes a status message.
 * While an async handler is in flight the originating button is disabled and
 * further clicks are ignored, so one double click cannot issue the backend
 * write twice (the palette's only idempotency guard for note-creating calls).
 */
function guarded(handler, onError) {
    return function (event) {
        const target = event && (event.currentTarget || event.target);
        const origin = this && typeof this.disabled === 'boolean'
            ? this
            : target && typeof target.disabled === 'boolean' ? target : null;
        if (origin && origin.disabled) {
            return;
        }
        try {
            const result = handler(event);
            if (result && typeof result.then === 'function') {
                if (origin) {
                    origin.disabled = true;
                }
                result.then(
                    function () {
                        if (origin) {
                            origin.disabled = false;
                        }
                    },
                    function (error) {
                        if (origin) {
                            origin.disabled = false;
                        }
                        onError(error);
                    }
                );
            }
        } catch (error) {
            onError(error);
        }
    };
}

function openPalette(controller, options) {
    const container = options && options.container ? options.container : null;
    const embedded = Boolean(container);

    // Only the overlay is a singleton. The tab renderer is rendered by Trilium
    // next to a possibly open overlay, so it always mounts its own instance.
    // The module-level `instance` dies with a bundle re-evaluation (Trilium
    // re-runs this script when the plugin note is saved, in the same window).
    // The window global is what lets the NEW module instance reuse the
    // overlay the OLD one mounted, instead of stacking a second one.
    if (!embedded) {
        if (instance) {
            instance.focus();
            return instance;
        }
        if (typeof window !== 'undefined' && window.__cmPaletteInstance) {
            window.__cmPaletteInstance.focus();
            return window.__cmPaletteInstance;
        }
    }

    Dom.ensureStyle(Styles.STYLE_ID, Styles.CSS);

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
        importParsed: null,
        importRows: [],
        importToolParsed: null
    };

    const overlay = embedded ? null : Dom.el('div', 'cm-overlay');
    const shell = embedded ? Dom.el('div', 'cm-tab-view') : overlay;
    const panel = Dom.el('div', 'cm-panel');

    const head = Dom.el('div', 'cm-head');
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'cm-search';
    searchInput.placeholder = I18n.t('ui.searchPlaceholder');
    searchInput.setAttribute('aria-label', I18n.t('ui.searchLabel'));
    const openTabButton = embedded ? null : Dom.el('button', 'cm-open-tab', I18n.t('ui.openInTab'));
    if (openTabButton) {
        openTabButton.type = 'button';
        openTabButton.title = I18n.t('ui.openInTabTitle');
    }
    const closeButton = Dom.el('button', 'cm-close', '✕');
    closeButton.type = 'button';
    closeButton.title = I18n.t('ui.closeTitle');
    closeButton.setAttribute('aria-label', I18n.t('ui.closeLabel'));
    head.appendChild(searchInput);
    if (openTabButton) {
        head.appendChild(openTabButton);
    }
    if (!embedded) {
        head.appendChild(closeButton);
    }

    const body = Dom.el('div', 'cm-body');
    const list = Dom.el('div', 'cm-list');
    const detail = Dom.el('div', 'cm-detail');
    body.appendChild(list);
    body.appendChild(detail);

    const footer = Dom.el('div', 'cm-foot');
    const newToolButton = Dom.el('button', 'cm-button', I18n.t('ui.newTool'));
    newToolButton.type = 'button';
    const importToolButton = Dom.el('button', 'cm-button', I18n.t('ui.importTool'));
    importToolButton.type = 'button';
    const exportToolButton = Dom.el('button', 'cm-button', I18n.t('ui.exportTool'));
    exportToolButton.type = 'button';
    const importButton = Dom.el('button', 'cm-button', I18n.t('ui.importOptions'));
    importButton.type = 'button';
    const addOptionButton = Dom.el('button', 'cm-button', I18n.t('ui.addOption'));
    addOptionButton.type = 'button';
    const toolsButton = Dom.el('button', 'cm-button', I18n.t('ui.toolsFolder'));
    toolsButton.type = 'button';
    const statusEl = Dom.el('span', 'cm-status', '');
    statusEl.setAttribute('role', 'status');
    const menuHost = Dom.el('span', 'cm-menu-host');
    const versionButton = Dom.el('button', 'cm-version');
    versionButton.type = 'button';
    versionButton.title = I18n.t('ui.versionMenu');
    versionButton.setAttribute('aria-label', I18n.t('ui.versionMenu'));
    versionButton.setAttribute('aria-haspopup', 'menu');
    versionButton.setAttribute('aria-expanded', 'false');
    const versionLabel = Dom.el('span', 'cm-version-text', 'v' + controller.version());
    const versionChevron = Dom.el('span', 'cm-version-chevron', '▾');
    versionChevron.setAttribute('aria-hidden', 'true');
    versionButton.appendChild(versionLabel);
    versionButton.appendChild(versionChevron);
    menuHost.appendChild(versionButton);
    const repoLink = document.createElement('a');
    repoLink.className = 'cm-version-link';
    repoLink.textContent = I18n.t('ui.repository');
    repoLink.href = controller.repository();
    repoLink.target = '_blank';
    repoLink.rel = 'noopener noreferrer';
    footer.appendChild(newToolButton);
    footer.appendChild(importToolButton);
    footer.appendChild(importButton);
    footer.appendChild(addOptionButton);
    footer.appendChild(exportToolButton);
    footer.appendChild(toolsButton);
    footer.appendChild(statusEl);
    footer.appendChild(menuHost);
    footer.appendChild(repoLink);

    const modalHost = Dom.el('div', 'cm-modal-host');

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(footer);
    if (embedded) {
        Dom.clearEmbeddedView(container, 'cm-tab-view');
        shell.appendChild(panel);
        // The modal lives on the shell, not inside the panel: the panel shrinks
        // to its content when no tool is selected, which used to clip the modal.
        shell.appendChild(modalHost);
        container.appendChild(shell);
    } else {
        overlay.appendChild(panel);
        // The modal lives on the overlay, not inside the panel: the panel shrinks
        // to its content when no tool is selected, which used to clip the modal.
        overlay.appendChild(modalHost);
        document.body.appendChild(overlay);
    }

    let searchTimer = null;
    let menuEl = null;

    /** Closes the version menu if it is open; safe to call at any time. */
    function closeMenu() {
        if (!menuEl) {
            return;
        }
        if (typeof document.removeEventListener === 'function') {
            document.removeEventListener('click', onDocumentClick, true);
        }
        menuEl.remove();
        menuEl = null;
        versionButton.setAttribute('aria-expanded', 'false');
    }

    function onDocumentClick(event) {
        const target = event && event.target;
        if (target && typeof menuHost.contains === 'function' && menuHost.contains(target)) {
            return;
        }
        closeMenu();
    }

    /**
     * The footer's version pill opens this menu: the update check and the
     * language live here, so neither takes permanent footer space. Built on
     * every open, so the check mark and the labels follow the active locale.
     */
    function openMenu() {
        if (menuEl) {
            return;
        }
        const menu = Dom.el('div', 'cm-menu');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', I18n.t('ui.versionMenu'));

        const updates = Dom.el('button', 'cm-menu-item', I18n.t('ui.checkUpdates'));
        updates.type = 'button';
        updates.setAttribute('role', 'menuitem');
        updates.addEventListener('click', function (event) {
            event.preventDefault();
            closeMenu();
            checkForUpdates().catch(notify);
        });
        menu.appendChild(updates);

        menu.appendChild(Dom.el('div', 'cm-menu-sep'));
        menu.appendChild(Dom.el('div', 'cm-menu-title', I18n.t('ui.language')));

        // Driven by the active catalog: adding a language never needs a UI edit.
        I18n.LOCALES.forEach(function (code) {
            const active = I18n.getLocale() === code;
            const item = Dom.el('button', 'cm-menu-item cm-menu-radio' + (active ? ' is-checked' : ''), I18n.t('lang.' + code));
            item.type = 'button';
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', active ? 'true' : 'false');
            const check = Dom.el('span', 'cm-menu-check', active ? '✓' : '');
            check.setAttribute('aria-hidden', 'true');
            // CSS `order` puts the check first; the label stays the button text.
            item.appendChild(check);
            item.addEventListener('click', guarded(async function () {
                if (typeof controller.setLanguage !== 'function') {
                    closeMenu();
                    return;
                }
                await controller.setLanguage(code);
                remount();
            }, notify));
            menu.appendChild(item);
        });

        menuHost.appendChild(menu);
        menuEl = menu;
        versionButton.setAttribute('aria-expanded', 'true');
        // A click on the trigger is already past the capture phase, so this
        // listener cannot swallow the click that opened the menu.
        if (typeof document.addEventListener === 'function') {
            document.addEventListener('click', onDocumentClick, true);
        }
        const first = menu.children[0];
        if (first && typeof first.focus === 'function') {
            first.focus();
        }
    }

    function toggleMenu() {
        if (menuEl) {
            closeMenu();
            return;
        }
        openMenu();
    }

    /** Update the footer and surface the same text as a Trilium message. */
    function setStatus(message, isError) {
        const value = message === undefined || message === null ? '' : String(message);
        statusEl.textContent = value;
        statusEl.classList.toggle('is-error', Boolean(isError));
        if (value.trim() === '') {
            return;
        }
        if (isError) {
            controller.error(value);
        } else {
            controller.message(value);
        }
    }

    function notify(error) {
        setStatus(error && error.message ? error.message : String(error), true);
    }

    async function checkForUpdates() {
        if (typeof controller.checkLatestVersion !== 'function') {
            setStatus(I18n.t('status.updateUnavailable'), true);
            return;
        }
        setStatus(I18n.t('status.checkingUpdates'));
        const info = await controller.checkLatestVersion();
        if (info.error) {
            setStatus(I18n.t('status.updateError', { version: info.current, error: info.error }), true);
            return;
        }
        if (info.outdated && info.latest) {
            versionLabel.textContent = 'v' + info.current + ' → v' + info.latest;
            versionButton.title = I18n.t('status.installedLatest', { current: info.current, latest: info.latest });
        }

        if (info.latest && info.latest === info.current) {
            setStatus(I18n.t('status.latest', { version: info.current }));
        } else if (info.outdated) {
            setStatus(I18n.t('status.outdated', { current: info.current, latest: info.latest }));
        } else if (info.latest) {
            setStatus(I18n.t('status.ahead', { current: info.current, latest: info.latest }));
        } else {
            setStatus(I18n.t('status.noPublished', { version: info.current }));
        }
    }

    function button(label, handler, className) {
        const node = Dom.el('button', 'cm-button' + (className ? ' ' + className : ''), label);
        node.type = 'button';
        const listener = guarded(handler, notify);
        node.addEventListener('click', function (event) {
            event.preventDefault();
            listener.call(node, event);
        });
        return node;
    }

    function closeModal() {
        if (!state.modal) {
            return;
        }
        state.modal.remove();
        state.modal = null;
        state.importParsed = null;
        state.importRows = [];
        state.importToolParsed = null;
    }

    function close() {
        closeMenu();
        closeModal();
        if (searchTimer) {
            clearTimeout(searchTimer);
            searchTimer = null;
        }
        if (shell) {
            shell.removeEventListener('keydown', onKeyDown);
        }
        if (embedded) {
            if (shell && shell.parentNode && typeof shell.parentNode.removeChild === 'function') {
                shell.parentNode.removeChild(shell);
            } else if (shell) {
                shell.remove();
            }
            return;
        }
        overlay.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        if (typeof window !== 'undefined' && window.__cmPaletteInstance === instance) {
            window.__cmPaletteInstance = null;
        }
        instance = null;
    }

    /**
     * Rebuild the palette in place after a language change. Closing first
     * releases the overlay singleton; a tab view re-mounts into its container.
     */
    function remount() {
        const container = options && options.container ? options.container : null;
        close();
        openPalette(controller, container ? { container: container } : undefined);
    }

    function onKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (menuEl) {
                closeMenu();
                versionButton.focus();
            } else if (state.modal) {
                closeModal();
            } else if (!embedded) {
                close();
            }
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            copy().catch(notify);
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
            list.appendChild(Dom.el('div', 'cm-empty', I18n.t('ui.noToolsMatch')));
            return;
        }
        state.items.forEach(function (item, index) {
            const row = Dom.el('button', 'cm-result' + (index === state.active ? ' is-active' : ''));
            row.type = 'button';
            row.appendChild(Dom.el('div', 'cm-result-title', item.title));
            const meta = Dom.el('div', 'cm-result-meta');
            const categoryLabel = item.categoryLabel || item.category;
            if (categoryLabel) {
                meta.appendChild(Dom.el('span', 'cm-cat', categoryLabel));
            }
            if (item.description) {
                meta.appendChild(Dom.el('div', 'cm-result-desc', item.description));
            }
            if (meta.children.length) {
                row.appendChild(meta);
            }
            row.addEventListener('click', guarded(function () {
                return selectItem(item);
            }, notify));
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
        const items = await Promise.resolve(controller.search(searchInput.value));
        state.items = Array.isArray(items) ? items : [];
        state.active = -1;
        renderList();
    }

    function onSearchInput() {
        if (searchTimer) {
            clearTimeout(searchTimer);
        }
        searchTimer = setTimeout(function () {
            searchTimer = null;
            runSearch().catch(notify);
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

    // Every selection bumps this; load results from older selections are
    // discarded so a slow backend cannot render (or keep alive) a stale tool.
    let selectionGeneration = 0;

    async function selectItem(item, selectOptions) {
        const preserve = Boolean(selectOptions && selectOptions.preserveValues);
        const previousValues = preserve ? state.values : null;
        const previousEdited = preserve ? state.edited : false;
        const previousPreview = preserve && state.previewEl ? state.previewEl.value : '';
        const generation = ++selectionGeneration;
        state.current = item;
        state.edited = false;
        state.exampleLoaded = false;
        // The list highlights the new tool right away; keep showing the old
        // one until the load finishes and write on click would hit the tool
        // the user no longer points at. Clear the pane instead: while a load
        // is in flight it belongs to no tool.
        state.loaded = null;
        state.definition = null;
        renderDetail();
        markActive(item);
        try {
            const loaded = await controller.load(item.noteId);
            if (generation !== selectionGeneration) {
                return;
            }
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
            if (generation !== selectionGeneration) {
                return;
            }
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
            empty.textContent = '-';
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
        const row = Dom.el('div', 'cm-option' + (inferred ? ' cm-option-inferred' : ''));
        const main = Dom.el('div', 'cm-opt-main');
        const headRow = Dom.el('div', 'cm-opt-head');
        headRow.appendChild(Dom.el('span', 'cm-opt-title', option.title));
        if (option.flag) {
            headRow.appendChild(Dom.el('code', 'cm-opt-flag', option.flag));
        }
        if (inferred) {
            headRow.appendChild(Dom.el('span', 'cm-badge', I18n.t('ui.inferred')));
        }
        main.appendChild(headRow);
        if (option.help) {
            main.appendChild(Dom.el('div', 'cm-opt-help', option.help));
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
        state.optionRows.push({
            node: row,
            search: [
                option.title,
                option.flag,
                option.help,
                (option.enumValues || []).join(' ')
            ].join(' ').toLowerCase()
        });
        return row;
    }

    function renderWarnings(warnings) {
        if (!state.warningsEl) {
            return;
        }
        state.warningsEl.textContent = '';
        const definitionWarnings = state.definition && state.definition.warnings ? state.definition.warnings : [];
        definitionWarnings.concat(warnings || []).forEach(function (warning) {
            state.warningsEl.appendChild(Dom.el('div', 'cm-warning', warning.message));
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
            broken.textContent = I18n.t('ui.presetsBroken');
            state.presetSelect.appendChild(broken);
            return;
        }
        if (!state.presets.length) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = I18n.t('ui.noPresets');
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
            notify(new Error(I18n.t('status.nothingToCopy')));
            return;
        }
        const ok = await controller.copy(text);
        if (ok) {
            setStatus(message || I18n.t('status.copied'));
        } else {
            notify(new Error(I18n.t('status.clipboardFailed')));
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
            setStatus(I18n.t('status.inserted'));
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
            notify(new Error(I18n.t('status.pickPreset')));
            return;
        }
        state.values = Object.assign(Model.defaultValueMap(state.definition), preset.values || {});
        state.edited = false;
        state.exampleLoaded = false;
        renderDetail();
        setStatus(I18n.t('status.presetLoaded'));
    }

    async function savePreset() {
        const definition = state.definition;
        if (!definition) {
            return;
        }
        const name = (state.presetName ? state.presetName.value : '').trim();
        if (!name) {
            notify(new Error(I18n.t('status.presetNameRequired')));
            return;
        }
        await controller.savePreset(definition.noteId, name, state.values);
        // The pane may have moved to another tool while the write ran: a
        // reload issued for the old tool would paint its help block and
        // preset list onto the newer selection (same race S2 pins for the
        // selection itself).
        if (state.definition !== definition) {
            return;
        }
        const loaded = await controller.load(definition.noteId);
        if (state.definition !== definition) {
            return;
        }
        state.loaded = loaded;
        state.presets = loaded.presets || [];
        renderDetail();
        setStatus(I18n.t('status.presetSaved'));
    }

    async function deletePreset() {
        const definition = state.definition;
        const name = state.presetSelect ? state.presetSelect.value : '';
        if (!definition || !name) {
            notify(new Error(I18n.t('status.pickPreset')));
            return;
        }
        await controller.deletePreset(definition.noteId, name);
        if (state.definition !== definition) {
            return;
        }
        const loaded = await controller.load(definition.noteId);
        if (state.definition !== definition) {
            return;
        }
        state.loaded = loaded;
        state.presets = loaded.presets || [];
        renderDetail();
        setStatus(I18n.t('status.presetDeleted'));
    }

    function presetBlock() {
        const block = Dom.el('div', 'cm-presets');
        block.appendChild(Dom.el('div', 'cm-section', I18n.t('ui.presets')));
        if (state.loaded && state.loaded.presetsInvalid) {
            block.appendChild(Dom.el('div', 'cm-warning', I18n.t('warn.presetsInvalid')));
        }

        const row = Dom.el('div', 'cm-row');
        const select = document.createElement('select');
        select.className = 'cm-control cm-select';
        select.setAttribute('aria-label', I18n.t('ui.preset'));
        state.presetSelect = select;
        row.appendChild(select);
        row.appendChild(button(I18n.t('ui.load'), loadPreset));

        const deleteButton = Dom.el('button', 'cm-button cm-danger', I18n.t('ui.delete'));
        deleteButton.type = 'button';
        let deleteArmed = false;
        let deleteTimer = null;
        let deleteRunning = false;
        function disarmDelete() {
            deleteArmed = false;
            deleteButton.textContent = I18n.t('ui.delete');
            deleteButton.classList.remove('cm-danger-armed');
            if (deleteTimer) {
                clearTimeout(deleteTimer);
                deleteTimer = null;
            }
        }
        deleteButton.addEventListener('click', function (event) {
            event.preventDefault();
            if (deleteRunning) {
                return;
            }
            const name = state.presetSelect ? state.presetSelect.value : '';
            if (!name) {
                notify(new Error(I18n.t('status.pickPreset')));
                return;
            }
            if (!deleteArmed) {
                deleteArmed = true;
                deleteButton.textContent = I18n.t('ui.confirmDelete');
                deleteButton.classList.add('cm-danger-armed');
                setStatus(I18n.t('status.confirmDelete', { name: name }));
                deleteTimer = setTimeout(disarmDelete, 5000);
                return;
            }
            disarmDelete();
            // Same in-flight rule as the modal actions: one confirmed click
            // issues exactly one deletePreset write.
            deleteRunning = true;
            deleteButton.disabled = true;
            deletePreset()
                .catch(notify)
                .then(function () {
                    deleteRunning = false;
                    deleteButton.disabled = false;
                });
        });
        select.addEventListener('change', disarmDelete);
        row.appendChild(deleteButton);
        block.appendChild(row);

        const saveRow = Dom.el('div', 'cm-row');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'cm-control';
        nameInput.placeholder = I18n.t('ui.presetName');
        nameInput.setAttribute('aria-label', I18n.t('ui.presetName'));
        state.presetName = nameInput;
        saveRow.appendChild(nameInput);
        saveRow.appendChild(button(I18n.t('ui.savePreset'), savePreset));
        block.appendChild(saveRow);

        renderPresets();
        return block;
    }

    function examplesBlock() {
        if (!state.loaded || !(state.loaded.usageExamples || []).length) {
            return null;
        }
        const block = Dom.el('div', 'cm-examples');
        block.appendChild(Dom.el('div', 'cm-section', I18n.t('ui.examples')));
        state.loaded.usageExamples.forEach(function (example) {
            const row = Dom.el('div', 'cm-example');
            row.appendChild(Dom.el('code', 'cm-example-text', example));
            row.appendChild(button(I18n.t('ui.use'), function () {
                state.values = Model.valuesFromExample(state.definition, example);
                state.edited = false;
                state.exampleLoaded = false;
                renderDetail();
                if (state.previewEl) {
                    state.previewEl.value = example;
                    state.edited = true;
                    state.exampleLoaded = true;
                }
                setStatus(I18n.t('status.exampleLoaded'));
            }));
            row.appendChild(button(I18n.t('ui.copy'), function () {
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
        const block = Dom.el('div', 'cm-links');
        state.loaded.links.forEach(function (link) {
            const anchor = document.createElement('a');
            anchor.className = 'cm-link';
            anchor.textContent = link.text;
            anchor.href = link.href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
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
        const pre = Dom.el('pre', 'cm-pre' + (className ? ' ' + className : ''), text);
        details.appendChild(pre);
        return details;
    }

    /** Same fold, but the body keeps the formatting of a rich-text note. */
    function foldHtmlBlock(title, html) {
        if (!html) {
            return null;
        }
        const details = document.createElement('details');
        details.className = 'cm-fold-block';
        const summary = document.createElement('summary');
        summary.textContent = title;
        details.appendChild(summary);
        const box = Dom.el('div', 'cm-install');
        // Only allowlisted tags and attributes reach the DOM; the copy control is
        // our own trusted markup.
        box.innerHTML = Sections.wrapCodeBlocks(Sections.sanitizeNoteHtml(html), codeCopyButton());
        box.addEventListener('click', function (event) {
            const target = event.target;
            if (!target || typeof target.closest !== 'function') {
                return;
            }
            const control = target.closest('.cm-code-copy');
            if (!control) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const wrapper = control.parentNode;
            const pre = wrapper && typeof wrapper.querySelector === 'function'
                ? wrapper.querySelector('pre')
                : null;
            copyTextToClipboard(pre ? pre.textContent : '', I18n.t('status.codeCopied')).catch(notify);
        });
        details.appendChild(box);
        return details;
    }

    function baseRow() {
        const row = Dom.el('div', 'cm-base-row');
        row.appendChild(Dom.el('span', 'cm-base-label', I18n.t('ui.baseCommand')));
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cm-control';
        input.value = state.definition.base;
        input.setAttribute('aria-label', I18n.t('ui.baseCommand'));
        input.addEventListener('change', function () {
            if (input.disabled || !state.definition) {
                return;
            }
            const definition = state.definition;
            const value = String(input.value || '').trim();
            input.disabled = true;
            (async function () {
                try {
                    await controller.setToolBase(definition.noteId, value);
                } catch (error) {
                    notify(error);
                    if (state.definition === definition) {
                        // Success renders a fresh input; only a failed write
                        // must hand this one back to the user.
                        input.disabled = false;
                    }
                    return;
                }
                // A newer selection may own the pane by now; stamping the
                // finished write onto its definition would corrupt it. On
                // success the (still current) pane is re-rendered fresh.
                if (state.definition !== definition) {
                    return;
                }
                definition.base = value || Model.deriveBase(definition.title);
                state.values = Object.assign(Model.defaultValueMap(definition), state.values);
                state.exampleLoaded = false;
                renderDetail();
                setStatus(I18n.t('status.baseUpdated'));
            })();
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
            detail.appendChild(Dom.el('div', 'cm-empty', I18n.t('ui.pickTool')));
            return;
        }

        const definition = state.definition;
        const header = Dom.el('div', 'cm-detail-head');
        const title = Dom.el('h2', 'cm-title');
        title.appendChild(Dom.el('span', '', definition.title));
        const categoryLabel = definition.categoryLabel || definition.category;
        if (categoryLabel) {
            title.appendChild(Dom.el('span', 'cm-cat', categoryLabel));
        }
        header.appendChild(title);
        if (definition.description) {
            header.appendChild(Dom.el('p', 'cm-subtitle', definition.description));
        }
        detail.appendChild(header);

        if (state.loaded && state.loaded.whatIs) {
            detail.appendChild(Dom.el('div', 'cm-section', I18n.t('ui.whatIs')));
            detail.appendChild(Dom.el('p', 'cm-what', state.loaded.whatIs));
        }

        const links = linksBlock();
        if (links) {
            detail.appendChild(links);
        }

        detail.appendChild(baseRow());
        detail.appendChild(presetBlock());

        detail.appendChild(Dom.el('div', 'cm-section', I18n.t('ui.optionsCount', { count: definition.options.length })));
        const filter = document.createElement('input');
        filter.type = 'search';
        filter.className = 'cm-control cm-filter';
        filter.placeholder = I18n.t('ui.filterPlaceholder');
        filter.setAttribute('aria-label', I18n.t('ui.filterLabel'));
        filter.addEventListener('input', function () {
            const needle = String(filter.value || '').trim().toLowerCase();
            state.optionRows.forEach(function (entry) {
                const match = needle === '' || entry.search.indexOf(needle) !== -1;
                entry.node.style.display = match ? '' : 'none';
            });
            state.optionGroups.forEach(function (group) {
                const visible = group.rows.some(function (row) {
                    return row.style.display !== 'none';
                });
                group.node.style.display = visible ? '' : 'none';
            });
        });
        detail.appendChild(filter);

        const form = Dom.el('div', 'cm-form');
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
            const group = Dom.el('div', 'cm-option-group');
            group.appendChild(Dom.el('div', 'cm-option-group-title', title));
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
            form.appendChild(Dom.el('div', 'cm-empty', I18n.t('ui.noOptions')));
        }
        optionGroup(I18n.t('ui.required'), requiredOptions);
        optionGroup(I18n.t('ui.optional'), optionalOptions);
        detail.appendChild(form);

        detail.appendChild(Dom.el('div', 'cm-section', I18n.t('ui.extraArgs')));
        const extra = document.createElement('input');
        extra.type = 'text';
        extra.className = 'cm-control';
        extra.placeholder = I18n.t('ui.extraPlaceholder');
        extra.setAttribute('aria-label', I18n.t('ui.extraArgs'));
        extra.value = state.values[Render.EXTRA_KEY] === undefined ? '' : String(state.values[Render.EXTRA_KEY]);
        extra.addEventListener('input', function () {
            setValue(Render.EXTRA_KEY, extra.value);
        });
        detail.appendChild(extra);

        detail.appendChild(Dom.el('div', 'cm-section', I18n.t('ui.command')));
        const preview = document.createElement('textarea');
        preview.className = 'cm-preview';
        preview.spellcheck = false;
        preview.rows = 3;
        preview.setAttribute('aria-label', I18n.t('ui.commandPreview'));
        const codeTheme = Dom.codeBlockTheme();
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

        state.warningsEl = Dom.el('div', 'cm-warnings');
        detail.appendChild(state.warningsEl);

        const actions = Dom.el('div', 'cm-actions');
        actions.appendChild(button(I18n.t('ui.copy'), copy));
        actions.appendChild(button(I18n.t('ui.insert'), insert));
        actions.appendChild(button(I18n.t('ui.regenerate'), function () {
            state.edited = false;
            state.exampleLoaded = false;
            updatePreview(true);
        }));
        actions.appendChild(button(I18n.t('ui.openNote'), function () {
            return controller.openNote(definition.noteId);
        }));
        detail.appendChild(actions);

        const examples = examplesBlock();
        if (examples) {
            detail.appendChild(examples);
        }

        const help = foldBlock(I18n.t('ui.helpOutput'), state.loaded ? state.loaded.helpText : '');
        if (help) {
            detail.appendChild(help);
        }
        let install = null;
        if (state.loaded && state.loaded.installHtml) {
            install = state.loaded.installIsCode
                ? foldHtmlBlock(I18n.t('ui.install'), '<pre><code>' + Sections.escapeHtml(state.loaded.installHtml) + '</code></pre>')
                : foldHtmlBlock(I18n.t('ui.install'), state.loaded.installHtml);
        } else if (state.loaded) {
            install = foldBlock(I18n.t('ui.install'), state.loaded.installText);
        }
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
        const row = Dom.el('div', 'cm-inline');
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'cm-control';
        titleInput.placeholder = I18n.t('ui.toolNamePlaceholder');
        titleInput.setAttribute('aria-label', I18n.t('ui.toolName'));

        const categorySelect = document.createElement('select');
        categorySelect.className = 'cm-control cm-select';
        categorySelect.setAttribute('aria-label', I18n.t('ui.category'));
        const categories = controller.categories();
        const categoryPaths = [];
        categories.forEach(function (entry) {
            const option = document.createElement('option');
            option.value = String(categoryPaths.length);
            option.textContent = entry.label;
            categorySelect.appendChild(option);
            categoryPaths.push(entry.path);
        });
        const newCategoryOption = document.createElement('option');
        newCategoryOption.value = NEW_CATEGORY;
        newCategoryOption.textContent = I18n.t('ui.newCategory');
        categorySelect.appendChild(newCategoryOption);
        if (!categories.length) {
            categorySelect.value = NEW_CATEGORY;
        }

        const newCategoryInput = document.createElement('input');
        newCategoryInput.type = 'text';
        newCategoryInput.className = 'cm-control';
        newCategoryInput.placeholder = I18n.t('ui.newCategoryPlaceholder');
        newCategoryInput.setAttribute('aria-label', I18n.t('ui.newCategoryPlaceholder'));
        newCategoryInput.style.display = categorySelect.value === NEW_CATEGORY ? '' : 'none';
        categorySelect.addEventListener('change', function () {
            newCategoryInput.style.display = categorySelect.value === NEW_CATEGORY ? '' : 'none';
        });

        const baseInput = document.createElement('input');
        baseInput.type = 'text';
        baseInput.className = 'cm-control';
        baseInput.placeholder = I18n.t('ui.baseOptional');
        baseInput.setAttribute('aria-label', I18n.t('ui.baseCommand'));

        const create = button(I18n.t('ui.create'), async function () {
            const title = titleInput.value.trim();
            if (!title) {
                notify(new Error(I18n.t('status.toolNameRequired')));
                return;
            }
            const isNewCategory = categorySelect.value === NEW_CATEGORY;
            const categoryPath = isNewCategory
                ? parseCategoryPath(newCategoryInput.value)
                : (categoryPaths[Number(categorySelect.value)] || []).slice();
            if (!categoryPath.length) {
                notify(new Error(I18n.t('status.categoryRequired')));
                return;
            }
            const created = await controller.createTool({
                title: title,
                category: categoryPath[categoryPath.length - 1],
                categoryPath: categoryPath,
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
            setStatus(I18n.t('status.toolCreated'));
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

    function modalShell(title, bodyNode, actionsNode) {
        closeModal();
        const modal = Dom.el('div', 'cm-modal');
        const modalPanel = Dom.el('div', 'cm-modal-panel');
        modalPanel.setAttribute('role', 'dialog');
        modalPanel.setAttribute('aria-modal', 'true');
        modalPanel.setAttribute('aria-label', title);
        const modalHead = Dom.el('div', 'cm-modal-head');
        modalHead.appendChild(Dom.el('span', 'cm-modal-title', title));
        const closeModalButton = Dom.el('button', 'cm-close', '✕');
        closeModalButton.type = 'button';
        closeModalButton.setAttribute('aria-label', I18n.t('ui.closeDialog'));
        closeModalButton.addEventListener('click', closeModal);
        modalHead.appendChild(closeModalButton);
        const modalBody = Dom.el('div', 'cm-modal-body');
        modalBody.appendChild(bodyNode);
        const modalActions = Dom.el('div', 'cm-modal-actions');
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

    /** The Close action shared by every palette modal. */
    function modalCloseButton() {
        const node = Dom.el('button', 'cm-button', I18n.t('ui.close'));
        node.type = 'button';
        node.addEventListener('click', closeModal);
        return node;
    }

    function openImport() {
        if (!state.current) {
            notify(new Error(I18n.t('status.selectToolFirst')));
            return;
        }
        const tool = state.current;
        const picker = SourcePicker.createSourcePicker({
            controller: controller,
            hint: I18n.t('import.hint'),
            placeholder: I18n.t('import.placeholder'),
            accept: '.txt,.json,.md,.markdown,.log,.help,.text',
            onStatus: setStatus,
            onError: notify
        });

        const parseButton = Dom.el('button', 'cm-button', I18n.t('ui.parse'));
        parseButton.type = 'button';
        const importSelected = Dom.el('button', 'cm-button', I18n.t('ui.importSelected'));
        importSelected.type = 'button';
        importSelected.disabled = true;
        const closeButton2 = modalCloseButton();

        const warnings = Dom.el('div', 'cm-warnings', '');
        const previewList = Dom.el('div', 'cm-import-list', '');
        let statusMessage = '';

        function renderImportPreview() {
            warnings.textContent = '';
            previewList.textContent = '';
            state.importRows = [];
            importSelected.disabled = true;
            if (!state.importParsed) {
                return;
            }
            (state.importParsed.warnings || []).forEach(function (warning) {
                warnings.appendChild(Dom.el('div', 'cm-warning', warning.message || warning.code));
            });
            const options = state.importParsed.options || [];
            if (!options.length) {
                previewList.appendChild(Dom.el('div', 'cm-empty', I18n.t('import.noOptions')));
                return;
            }
            options.forEach(function (option, index) {
                const row = Dom.el('div', 'cm-import-row');
                const selectLabel = Dom.el('label', 'cm-import-select');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true;
                checkbox.setAttribute('aria-label', I18n.t('import.selectOption', { name: option.flag || option.label }));
                checkbox.addEventListener('change', function () {
                    state.importRows[index].checked = checkbox.checked;
                    importSelected.disabled = !state.importRows.some(function (entry) {
                        return entry.checked;
                    });
                });
                selectLabel.appendChild(checkbox);
                row.appendChild(selectLabel);
                const main = Dom.el('div', 'cm-import-main');
                main.appendChild(Dom.el('div', 'cm-import-flag', option.flag + (option.type ? '  (' + option.type + ')' : '')));
                if (option.help) {
                    main.appendChild(Dom.el('div', 'cm-import-help', option.help));
                }
                row.appendChild(main);
                const requiredLabel = Dom.el('label', 'cm-import-required');
                const requiredBox = document.createElement('input');
                requiredBox.type = 'checkbox';
                requiredBox.checked = Boolean(option.required);
                requiredBox.setAttribute('aria-label', I18n.t('import.required'));
                requiredBox.addEventListener('change', function () {
                    state.importRows[index].required = requiredBox.checked;
                });
                requiredLabel.appendChild(requiredBox);
                requiredLabel.appendChild(Dom.el('span', '', I18n.t('import.required')));
                row.appendChild(requiredLabel);
                previewList.appendChild(row);
                state.importRows.push({ option: option, checked: true, required: Boolean(option.required) });
            });
            importSelected.disabled = false;
        }

        parseButton.addEventListener('click', guarded(function () {
            const text = picker.getText();
            if (!String(text || '').trim()) {
                notify(new Error(I18n.t('import.nothingToParse')));
                return;
            }
            state.importParsed = Parse.parseImport(text);
            renderImportPreview();
            setStatus(I18n.t('import.parsed', { count: (state.importParsed.options || []).length }));
        }, notify));

        importSelected.addEventListener('click', guarded(async function () {
            const selected = state.importRows
                .filter(function (entry) {
                    return entry.checked;
                })
                .map(function (entry) {
                    return Object.assign({}, entry.option, { required: entry.required });
                });
            if (!selected.length) {
                throw new Error(I18n.t('import.selectOne'));
            }
            const result = await controller.importOptions(tool.noteId, selected);
            closeModal();
            const created = result && typeof result.created === 'number' ? result.created : 0;
            statusMessage = I18n.t('import.imported', {
                created: created,
                skipped: result && result.skipped ? result.skipped : 0,
                capped: result && result.capped ? result.capped : 0
            });
            await controller.refresh();
            await runSearch();
            await selectItem(tool, { preserveValues: true });
            setStatus(statusMessage);
        }, notify));

        const bodyNode = Dom.el('div', '');
        bodyNode.appendChild(picker.node);
        bodyNode.appendChild(warnings);
        bodyNode.appendChild(previewList);

        const actionsNode = Dom.el('div', 'cm-inline');
        actionsNode.appendChild(parseButton);
        actionsNode.appendChild(importSelected);
        actionsNode.appendChild(closeButton2);

        modalShell(I18n.t('import.title', { title: tool.title }), bodyNode, actionsNode);
    }

    function openImportTool() {
        const picker = SourcePicker.createSourcePicker({
            controller: controller,
            hint: I18n.t('importTool.hint'),
            placeholder: I18n.t('importTool.placeholder'),
            accept: '.json,.txt,.text',
            onStatus: setStatus,
            onError: notify
        });

        const promptButton = Dom.el('button', 'cm-button', I18n.t('importTool.copyPrompt'));
        promptButton.type = 'button';
        promptButton.title = I18n.t('importTool.copyPromptTitle');
        const parseButton = Dom.el('button', 'cm-button', I18n.t('ui.parse'));
        parseButton.type = 'button';
        const importSelected = Dom.el('button', 'cm-button', I18n.t('ui.importTool'));
        importSelected.type = 'button';
        importSelected.disabled = true;
        const closeButton2 = modalCloseButton();

        const warnings = Dom.el('div', 'cm-warnings', '');
        const previewList = Dom.el('div', 'cm-import-list', '');
        let statusMessage = '';

        function renderToolPreview() {
            warnings.textContent = '';
            previewList.textContent = '';
            importSelected.disabled = true;
            const parsed = state.importToolParsed;
            if (!parsed) {
                return;
            }
            (parsed.warnings || []).forEach(function (warning) {
                warnings.appendChild(Dom.el('div', 'cm-warning', warning.message || warning.code));
            });
            const tool = parsed.tool;
            if (!tool) {
                return;
            }
            [
                [I18n.t('importTool.fieldTitle'), tool.title],
                [I18n.t('importTool.fieldCategory'), categoryPreview(tool)],
                [I18n.t('importTool.fieldBase'), tool.base || Model.deriveBase(tool.title)]
            ].forEach(function (line) {
                previewList.appendChild(Dom.el('div', 'cm-import-flag', line[0] + ': ' + line[1]));
            });
            if (tool.description) {
                previewList.appendChild(Dom.el('div', 'cm-note', tool.description));
            }
            if (!tool.options.length) {
                previewList.appendChild(Dom.el('div', 'cm-empty', I18n.t('importTool.noOptions')));
            }
            tool.options.forEach(function (option) {
                const row = Dom.el('div', 'cm-import-row');
                const main = Dom.el('div', 'cm-import-main');
                const flag = option.flag || I18n.t('importTool.positional');
                main.appendChild(Dom.el('div', 'cm-import-flag', flag + '  (' + option.type + ')  ' + option.label));
                if (option.help) {
                    main.appendChild(Dom.el('div', 'cm-import-help', option.help));
                }
                row.appendChild(main);
                previewList.appendChild(row);
            });
            importSelected.disabled = false;
        }

        promptButton.addEventListener('click', function () {
            const pasted = picker.getText();
            const looksJson = /^\s*[{[]/.test(String(pasted || ''));
            copyTextToClipboard(Prompt.buildToolPrompt({
                helpText: looksJson ? '' : pasted
            }), I18n.t('status.promptCopied')).catch(notify);
        });

        parseButton.addEventListener('click', guarded(function () {
            const text = picker.getText();
            if (!String(text || '').trim()) {
                notify(new Error(I18n.t('importTool.nothingToParse')));
                return;
            }
            state.importToolParsed = ToolFile.parseToolFile(text);
            renderToolPreview();
            const tool = state.importToolParsed.tool;
            setStatus(tool
                ? I18n.t('importTool.parsed', { title: tool.title })
                : I18n.t('importTool.parseFailed'));
        }, notify));

        importSelected.addEventListener('click', guarded(async function () {
            const parsed = state.importToolParsed;
            if (!parsed || !parsed.tool) {
                notify(new Error(I18n.t('importTool.parseFirst')));
                return;
            }
            const created = await controller.importTool(parsed.tool);
            closeModal();
            statusMessage = I18n.t('importTool.imported', { title: parsed.tool.title });
            await controller.refresh();
            await runSearch();
            const item = created
                ? state.items.filter(function (entry) {
                    return entry.noteId === created.noteId;
                })[0]
                : null;
            if (item) {
                await selectItem(item);
            }
            setStatus(statusMessage);
        }, notify));

        const bodyNode = Dom.el('div', '');
        bodyNode.appendChild(picker.node);
        bodyNode.appendChild(warnings);
        bodyNode.appendChild(previewList);

        const actionsNode = Dom.el('div', 'cm-inline');
        actionsNode.appendChild(promptButton);
        actionsNode.appendChild(parseButton);
        actionsNode.appendChild(importSelected);
        actionsNode.appendChild(closeButton2);

        modalShell(I18n.t('importTool.title'), bodyNode, actionsNode);
    }

    async function openExportTool() {
        if (!state.current) {
            notify(new Error(I18n.t('status.selectToolFirst')));
            return;
        }
        const file = await controller.exportTool(state.current.noteId);
        const json = JSON.stringify(file, null, 2);
        const filename = (Render.slugify(file.tool.title) || 'tool') + '.tool.json';

        const bodyNode = Dom.el('div', '');
        bodyNode.appendChild(Dom.el('div', 'cm-note', I18n.t('export.note')));
        const area = document.createElement('textarea');
        area.className = 'cm-control cm-preview';
        area.rows = 18;
        area.readOnly = true;
        area.value = json;
        bodyNode.appendChild(area);
        bodyNode.appendChild(Dom.el('div', 'cm-note', I18n.t('export.filename', { name: filename })));

        const copyButton = Dom.el('button', 'cm-button', I18n.t('export.copyJson'));
        copyButton.type = 'button';
        copyButton.addEventListener('click', function () {
            copyTextToClipboard(json, I18n.t('status.toolFileCopied')).catch(notify);
        });

        const downloadButton = Dom.el('button', 'cm-button', I18n.t('export.download'));
        downloadButton.type = 'button';
        downloadButton.addEventListener('click', guarded(function () {
            Dom.downloadText(filename, json);
            setStatus(I18n.t('status.downloaded', { name: filename }));
        }, notify));

        const closeButton2 = modalCloseButton();

        const actionsNode = Dom.el('div', 'cm-inline');
        actionsNode.appendChild(copyButton);
        actionsNode.appendChild(downloadButton);
        actionsNode.appendChild(closeButton2);

        modalShell(I18n.t('export.title', { title: file.tool.title }), bodyNode, actionsNode);
    }

    function openAddOption() {
        if (!state.current) {
            notify(new Error(I18n.t('status.selectToolFirst')));
            return;
        }
        const tool = state.current;

        function field(labelText, control) {
            const wrapper = Dom.el('label', 'cm-field');
            wrapper.appendChild(Dom.el('span', 'cm-field-label', labelText));
            control.className = 'cm-control' + (control.tagName === 'SELECT' ? ' cm-select' : '');
            wrapper.appendChild(control);
            return wrapper;
        }

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.placeholder = I18n.t('addOption.labelPlaceholder');

        const flagInput = document.createElement('input');
        flagInput.type = 'text';
        flagInput.placeholder = I18n.t('addOption.flagPlaceholder');

        const helpInput = document.createElement('input');
        helpInput.type = 'text';
        helpInput.placeholder = I18n.t('addOption.helpPlaceholder');

        const typeSelect = document.createElement('select');
        Model.TYPES.forEach(function (type) {
            const entry = document.createElement('option');
            entry.value = type;
            entry.textContent = I18n.t('type.' + type);
            typeSelect.appendChild(entry);
        });

        const defaultInput = document.createElement('input');
        defaultInput.type = 'text';
        defaultInput.placeholder = I18n.t('addOption.defaultPlaceholder');

        const valuesInput = document.createElement('input');
        valuesInput.type = 'text';
        valuesInput.placeholder = I18n.t('addOption.valuesPlaceholder');

        const orderInput = document.createElement('input');
        orderInput.type = 'number';
        orderInput.placeholder = '100';
        orderInput.value = '100';

        const requiredInput = document.createElement('input');
        requiredInput.type = 'checkbox';
        const requiredRow = Dom.el('label', 'cm-row');
        requiredRow.appendChild(Dom.el('span', 'cm-base-label', I18n.t('ui.required')));
        requiredRow.appendChild(requiredInput);

        const add = Dom.el('button', 'cm-button', I18n.t('ui.add'));
        add.type = 'button';
        add.addEventListener('click', guarded(async function () {
            const label = labelInput.value.trim();
            if (!label) {
                throw new Error(I18n.t('status.optionLabelRequired'));
            }
            const values = valuesInput.value.split(',')
                .map(function (entry) {
                    return entry.trim();
                })
                .filter(function (entry) {
                    return entry !== '';
                });
            const order = Number(orderInput.value);
            await controller.addOption(tool.noteId, {
                label: label,
                flag: flagInput.value.trim(),
                help: helpInput.value.trim(),
                type: typeSelect.value,
                values: values,
                defaultValue: defaultInput.value,
                required: Boolean(requiredInput.checked),
                order: isFinite(order) ? order : 100
            });
            closeModal();
            await controller.refresh();
            await runSearch();
            await selectItem(tool, { preserveValues: true });
            setStatus(I18n.t('status.optionAdded'));
        }, notify));

        const closeButton2 = modalCloseButton();

        const bodyNode = Dom.el('div', '');
        bodyNode.appendChild(Dom.el('div', 'cm-note', I18n.t('addOption.note')));
        bodyNode.appendChild(field(I18n.t('addOption.fieldLabel'), labelInput));
        bodyNode.appendChild(field(I18n.t('addOption.fieldFlag'), flagInput));
        bodyNode.appendChild(field(I18n.t('addOption.fieldHelp'), helpInput));
        bodyNode.appendChild(field(I18n.t('addOption.fieldType'), typeSelect));
        bodyNode.appendChild(field(I18n.t('addOption.fieldDefault'), defaultInput));
        bodyNode.appendChild(field(I18n.t('addOption.fieldValues'), valuesInput));
        bodyNode.appendChild(field(I18n.t('addOption.fieldOrder'), orderInput));
        bodyNode.appendChild(requiredRow);
        bodyNode.appendChild(Dom.el('div', 'cm-note', I18n.t('addOption.requiredNote')));

        const actionsNode = Dom.el('div', 'cm-inline');
        actionsNode.appendChild(add);
        actionsNode.appendChild(closeButton2);

        modalShell(I18n.t('addOption.title', { title: tool.title }), bodyNode, actionsNode);
        labelInput.focus();
    }

    function openToolsFolder() {
        const bodyNode = Dom.el('div', '');
        const info = Dom.el('div', 'cm-note', I18n.t('ui.loading'));
        bodyNode.appendChild(info);

        const active = Dom.el('button', 'cm-button', I18n.t('toolsFolder.useActive'));
        active.type = 'button';
        const openFolder = Dom.el('button', 'cm-button', I18n.t('toolsFolder.open'));
        openFolder.type = 'button';
        openFolder.disabled = true;

        const idRow = Dom.el('div', 'cm-row');
        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.className = 'cm-control';
        idInput.placeholder = I18n.t('toolsFolder.idPlaceholder');
        idInput.setAttribute('aria-label', I18n.t('toolsFolder.idPlaceholder'));
        const useId = Dom.el('button', 'cm-button', I18n.t('toolsFolder.useId'));
        useId.type = 'button';
        idRow.appendChild(idInput);
        idRow.appendChild(useId);
        bodyNode.appendChild(idRow);

        let root = null;
        controller.currentToolsRoot().then(function (value) {
            root = value;
            info.textContent = root
                ? I18n.t('toolsFolder.current', { title: root.title, id: root.noteId })
                : I18n.t('toolsFolder.none');
            openFolder.disabled = !root;
        }, notify);

        active.addEventListener('click', guarded(async function () {
            await controller.useActiveNoteAsToolsRoot();
            closeModal();
            setStatus(I18n.t('status.toolsRootActive'));
            await runSearch();
        }, notify));

        openFolder.addEventListener('click', function () {
            if (!root) {
                return;
            }
            controller.openNote(root.noteId).catch(notify);
        });

        useId.addEventListener('click', guarded(async function () {
            const noteId = idInput.value.trim();
            if (!noteId) {
                throw new Error(I18n.t('status.enterNoteId'));
            }
            await controller.setToolsRoot(noteId);
            closeModal();
            setStatus(I18n.t('status.toolsRootUpdated'));
            await runSearch();
        }, notify));

        const actionsNode = Dom.el('div', 'cm-inline');
        actionsNode.appendChild(active);
        actionsNode.appendChild(openFolder);
        const closeButton2 = modalCloseButton();
        actionsNode.appendChild(closeButton2);

        modalShell(I18n.t('ui.toolsFolder'), bodyNode, actionsNode);
    }

    searchInput.addEventListener('input', onSearchInput);
    if (!embedded) {
        closeButton.addEventListener('click', close);
    }
    if (openTabButton) {
        openTabButton.addEventListener('click', guarded(async function () {
            openTabButton.disabled = true;
            try {
                await controller.openInTab();
                close();
            } catch (error) {
                openTabButton.disabled = false;
                throw error;
            }
        }, notify));
    }
    versionButton.addEventListener('click', function (event) {
        event.preventDefault();
        toggleMenu();
    });
    newToolButton.addEventListener('click', toggleNewTool);
    importToolButton.addEventListener('click', openImportTool);
    exportToolButton.addEventListener('click', guarded(openExportTool, notify));
    importButton.addEventListener('click', openImport);
    addOptionButton.addEventListener('click', openAddOption);
    toolsButton.addEventListener('click', openToolsFolder);
    if (embedded) {
        shell.addEventListener('keydown', onKeyDown);
    } else {
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) {
                close();
            }
        });
        overlay.addEventListener('keydown', onKeyDown);
    }

    const handle = {
        focus() {
            searchInput.focus();
            searchInput.select();
        },
        close,
        element: panel
    };
    if (!embedded) {
        instance = handle;
        if (typeof window !== 'undefined') {
            window.__cmPaletteInstance = handle;
        }
    }

    searchInput.focus();

    guarded(async function () {
        await controller.refresh();
        await runSearch();
    }, notify)();

    return handle;
}

module.exports = { openPalette };