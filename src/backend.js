'use strict';

/**
 * Backend operations for the tools registry.
 *
 * Everything runs through a single `beRun(params)` function because Trilium's
 * `api.runOnBackend` serialises the function by source: inner helpers travel
 * with it, outer helpers would not. `params.labels` carries the attribute
 * names from Model.LABELS so the label schema lives in one place instead of
 * being duplicated here. Consequently `beRun` must never reference a
 * module-scope binding and dispatches on literal action strings only.
 *
 * Actions: bootstrap | setLanguage | createTool | importTool | addOption |
 * importOptions | deleteOption | setToolBase | setToolsRoot | savePreset |
 * deletePreset | ensureTab
 */

function beRun(params) {
    const options = params || {};
    const labels = options.labels || {};
    const icons = options.icons || {
        install: 'bx bx-download',
        usage: 'bx bx-terminal',
        help: 'bx bx-help-circle',
        options: 'bx bx-cog'
    };
    // Localized titles and messages travel in the action options: this
    // function is serialized to the backend and cannot require src/i18n.js.
    const strings = options.strings || {};

    function text(key, fallback) {
        const value = strings[key];
        return value === undefined || value === null ? fallback : String(value);
    }

    function nonEmpty(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function hasLabel(note, name) {
        if (!note || !name) {
            return false;
        }
        if (typeof note.hasLabel === 'function') {
            return note.hasLabel(name);
        }
        const value = note.getLabelValue(name);
        return value !== null && value !== undefined;
    }

    function requireNote(noteId, message) {
        const note = api.getNote(noteId);
        if (!note) {
            throw new Error(message + ': ' + noteId);
        }
        return note;
    }

    /**
     * When set, every note created by the action below is recorded here, so a
     * failed multi-step create can delete exactly the notes it made, never an
     * existing category, folder or unrelated note.
     */
    let rollbackBatch = null;

    function track(note) {
        if (rollbackBatch) {
            rollbackBatch.push(note);
        }
        return note;
    }

    function findChildWithLabel(parent, name) {
        const children = parent.getChildNotes();
        for (let index = 0; index < children.length; index += 1) {
            if (hasLabel(children[index], name)) {
                return children[index];
            }
        }
        return null;
    }

    /** Set a note icon only when the note has none, so a user's choice wins. */
    function ensureIcon(note, className) {
        if (!note || !labels.icon || !nonEmpty(className)) {
            return;
        }
        if (hasLabel(note, labels.icon)) {
            return;
        }
        note.setLabel(labels.icon, String(className));
    }

    function findCategory(parent, name) {
        const children = parent.getChildNotes();
        for (let index = 0; index < children.length; index += 1) {
            if (children[index].title === name && hasLabel(children[index], labels.category)) {
                return children[index];
            }
        }
        return null;
    }

    function ensureCategory(parent, name) {
        const existing = findCategory(parent, name);
        if (existing) {
            return existing;
        }
        const note = track(api.createNewNote({
            parentNoteId: parent.noteId,
            title: name,
            type: 'text',
            content: ''
        }).note);
        note.setLabel(labels.category, '');
        return note;
    }

    /** Walk (and create) one nested category folder per path entry. */
    function ensureCategoryPath(toolsRoot, path) {
        // The tool-file reader already bounds the depth; this action can also
        // be called directly, so the bound lives here too.
        const depth = Math.min(path.length, 16);
        let parent = toolsRoot;
        for (let index = 0; index < depth; index += 1) {
            parent = ensureCategory(parent, path[index]);
        }
        return parent;
    }

    function ensureOptionsFolder(toolNote) {
        const existing = findChildWithLabel(toolNote, labels.options);
        if (existing) {
            return existing;
        }
        const note = track(api.createNewNote({
            parentNoteId: toolNote.noteId,
            title: text('back.noteOptions', 'Options'),
            type: 'text',
            content: ''
        }).note);
        note.setLabel(labels.options, '');
        ensureIcon(note, icons.options);
        return note;
    }

    function ensurePresetsNote(optionsFolder) {
        const existing = findChildWithLabel(optionsFolder, labels.presets);
        if (existing) {
            return existing;
        }
        const note = track(api.createNewNote({
            parentNoteId: optionsFolder.noteId,
            title: text('back.notePresets', 'Presets'),
            type: 'code',
            mime: 'application/json',
            content: '{"v":1,"presets":[]}'
        }).note);
        note.setLabel(labels.presets, '');
        return note;
    }

    /**
     * Tool-file presets -> the JSON stored in the Presets note. Mirrors the
     * frontend reader: entries need a name and values keep own primitive keys
     * only, so a hand-edited file or a script call can never smuggle
     * __proto__ or a nested object into the note.
     */
    function sanitisePresets(raw) {
        const out = [];
        if (!Array.isArray(raw)) {
            return out;
        }
        for (const entry of raw) {
            if (!entry || typeof entry.name !== 'string' || String(entry.name).trim() === '') {
                continue;
            }
            const values = {};
            if (entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values)) {
                for (const key of Object.keys(entry.values)) {
                    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                        continue;
                    }
                    const value = entry.values[key];
                    const type = typeof value;
                    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
                        continue;
                    }
                    values[key] = value;
                }
            }
            out.push({ name: String(entry.name).trim(), values: values });
        }
        return out;
    }

    /** Validate the tool and make sure its Options folder and Presets note exist. */
    function presetsLocation(toolId) {
        const tool = requireNote(toolId, text('back.errorToolNote', 'Tool note not found'));
        const folder = ensureOptionsFolder(tool);
        return { tool: tool, folder: folder, presets: ensurePresetsNote(folder) };
    }

    function readPresets(note) {
        let data = null;
        let valid = true;
        try {
            data = JSON.parse(note.getContent() || '');
        } catch (error) {
            valid = false;
        }
        if (!data || typeof data !== 'object' || !Array.isArray(data.presets)) {
            valid = false;
        }
        if (!valid) {
            data = { v: 1, presets: [] };
        }
        return { data: data, valid: valid };
    }

    /** Tool body: the caller's template when it passes one, else the three H2 sections. */
    function defaultToolContent(fallbacks) {
        if (fallbacks && nonEmpty(fallbacks.content)) {
            return String(fallbacks.content);
        }
        const localized = text('back.toolContent', '');
        if (nonEmpty(localized)) {
            return localized;
        }
        return [
            '<h2>What is?</h2>',
            '<p>Describe what this tool does and when to use it.</p>',
            '<h2>Official links</h2>',
            '<p>Add the official documentation, repository or website links here.</p>',
            '<h2>Useful links</h2>',
            '<p>Add useful guides, cheat sheets or articles here.</p>'
        ].join('\n');
    }

    function childContent(value, fallback) {
        if (nonEmpty(value)) {
            return String(value);
        }
        return nonEmpty(fallback) ? String(fallback) : '';
    }

    /**
     * Delete every note a failed multi-step action created, newest first. Only
     * notes recorded by track() are touched, never a note that already existed.
     */
    function rollbackNotes(batch) {
        for (let index = batch.length - 1; index >= 0; index -= 1) {
            try {
                batch[index].deleteNote();
            } catch (ignored) {
                // Best effort: the original failure is the one to report.
            }
        }
    }

    /** Shared creation path for createTool, bootstrap seeding and the importer. */
    function createToolNote(toolsRoot, spec, fallbacks) {
        const batch = [];
        const previousBatch = rollbackBatch;
        rollbackBatch = batch;
        try {
            return createToolNoteNotes(toolsRoot, spec, fallbacks);
        } catch (error) {
            rollbackNotes(batch);
            throw error;
        } finally {
            rollbackBatch = previousBatch;
        }
    }

    function createToolNoteNotes(toolsRoot, spec, fallbacks) {
        const safeSpec = spec || {};
        const safeFallbacks = fallbacks || {};
        const categoryName = nonEmpty(safeSpec.category) ? String(safeSpec.category) : text('back.noteUncategorized', 'Uncategorized');
        // `categoryPath` turns a nested tool file into real nested folders;
        // a caller that only knows one category keeps the flat behaviour.
        const categoryPath = Array.isArray(safeSpec.categoryPath)
            ? safeSpec.categoryPath
                .map(function (segment) {
                    return String(segment).trim();
                })
                .filter(function (segment) {
                    return segment !== '';
                })
            : [];
        const title = nonEmpty(safeSpec.title) ? String(safeSpec.title) : text('back.noteNewTool', 'New tool');
        const category = ensureCategoryPath(toolsRoot, categoryPath.length ? categoryPath : [categoryName]);
        const note = track(api.createNewNote({
            parentNoteId: category.noteId,
            title: title,
            type: 'text',
            content: nonEmpty(safeSpec.content) ? String(safeSpec.content) : defaultToolContent(safeFallbacks)
        }).note);
        note.setLabel(labels.tool, '');
        if (nonEmpty(safeSpec.base)) {
            note.setLabel(labels.base, String(safeSpec.base));
        }
        if (nonEmpty(safeSpec.description)) {
            note.setLabel(labels.description, String(safeSpec.description));
        }
        if (nonEmpty(safeSpec.tags)) {
            note.setLabel(labels.tags, String(safeSpec.tags));
        }

        const install = track(api.createNewNote({
            parentNoteId: note.noteId,
            title: text('back.noteInstall', 'Install'),
            type: 'text',
            content: childContent(safeSpec.install, safeFallbacks.install)
        }).note);
        install.setLabel(labels.install, '');

        const usage = track(api.createNewNote({
            parentNoteId: note.noteId,
            title: text('back.noteUsage', 'Usage'),
            type: 'text',
            content: childContent(safeSpec.usage, safeFallbacks.usage)
        }).note);
        usage.setLabel(labels.usage, '');

        const help = track(api.createNewNote({
            parentNoteId: note.noteId,
            title: text('back.noteHelp', 'Help'),
            type: 'code',
            mime: 'text/x-sh',
            content: childContent(safeSpec.help, safeFallbacks.help)
        }).note);
        help.setLabel(labels.helpNote, '');

        ensureIcon(install, icons.install);
        ensureIcon(usage, icons.usage);
        ensureIcon(help, icons.help);

        const folder = ensureOptionsFolder(note);
        const presetsNote = ensurePresetsNote(folder);
        const presetSpecs = sanitisePresets(safeSpec.presets);
        if (presetSpecs.length) {
            presetsNote.setContent(JSON.stringify({ v: 1, presets: presetSpecs }));
        }
        const specs = Array.isArray(safeSpec.options) ? safeSpec.options : [];
        for (let index = 0; index < specs.length; index += 1) {
            createOptionNote(folder, specs[index]);
        }
        return note;
    }

    /** Create one option note under a tool's Options folder. */
    function createOptionNote(folder, spec) {
        const safe = spec || {};
        const title = nonEmpty(safe.label) ? String(safe.label) : text('back.noteOption', 'Option');
        const note = track(api.createNewNote({
            parentNoteId: folder.noteId,
            title: title,
            type: 'text',
            content: safe.content == null ? '' : String(safe.content)
        }).note);
        note.setLabel(labels.option, '');
        if (nonEmpty(safe.flag)) {
            note.setLabel(labels.flag, String(safe.flag));
        }
        const doc = safe.help || safe.doc;
        if (nonEmpty(doc)) {
            note.setLabel(labels.doc, String(doc));
        }
        if (nonEmpty(safe.type)) {
            note.setLabel(labels.type, String(safe.type));
        }
        const enumValues = safe.values !== undefined && safe.values !== null ? safe.values : safe.enumValues;
        if (Array.isArray(enumValues)) {
            if (enumValues.length > 0) {
                note.setLabel(labels.enumValues, enumValues.join(','));
            }
        } else if (nonEmpty(enumValues)) {
            note.setLabel(labels.enumValues, String(enumValues));
        }
        let rawDefault = undefined;
        if (safe.default !== undefined && safe.default !== null) {
            rawDefault = safe.default;
        } else if (safe.defaultValue !== undefined && safe.defaultValue !== null) {
            rawDefault = safe.defaultValue;
        }
        if (rawDefault !== undefined) {
            note.setLabel(labels.defaultValue, String(rawDefault));
        }
        if (safe.required) {
            note.setLabel(labels.required, 'true');
        }
        if (safe.mode === 'inline') {
            note.setLabel(labels.mode, 'inline');
        }
        if (nonEmpty(safe.placeholder)) {
            note.setLabel(labels.placeholder, String(safe.placeholder));
        }
        if (safe.order !== undefined && safe.order !== null && String(safe.order).trim() !== '') {
            note.setLabel(labels.order, String(safe.order));
        }
        if (nonEmpty(safe.quote)) {
            note.setLabel(labels.quote, String(safe.quote));
        }
        if (safe.sep === '=' || safe.separator === '=') {
            note.setLabel(labels.separator, '=');
        }
        return note;
    }

    function parentForRoot() {
        if (options.parentId) {
            return options.parentId;
        }
        try {
            const parents = api.currentNote.getParentNotes();
            if (parents && parents.length) {
                return parents[0].noteId;
            }
        } catch (error) {
            // currentNote has no parents (root); fall through
        }
        return api.getTodayNote().noteId;
    }

    /** Give existing standard children their icons, preserving any user choice. */
    function backfillIcons() {
        if (!labels.icon) {
            return;
        }
        const tools = api.getNotesWithLabel(labels.tool);
        for (let index = 0; index < tools.length; index += 1) {
            const tool = tools[index];
            ensureIcon(findChildWithLabel(tool, labels.install), icons.install);
            ensureIcon(findChildWithLabel(tool, labels.usage), icons.usage);
            ensureIcon(findChildWithLabel(tool, labels.helpNote), icons.help);
            ensureIcon(findChildWithLabel(tool, labels.options), icons.options);
        }
    }

    function bootstrap() {
        let root = api.getNoteWithLabel(labels.root);
        if (!root) {
            root = api.createNewNote({
                parentNoteId: parentForRoot(),
                title: text('back.noteSettings', 'Command Maker'),
                type: 'text',
                content: text('back.noteSettingsContent', 'Command Maker settings. The plugin finds this note through its label.')
            }).note;
            root.setLabel(labels.root, '');
        }

        // Record the active language once, so the setting is discoverable and
        // later switches have a label to update.
        if (nonEmpty(options.lang) && labels.lang) {
            const configured = root.getLabelValue(labels.lang);
            if (configured === null || configured === undefined || String(configured).trim() === '') {
                root.setLabel(labels.lang, String(options.lang));
            }
        }

        if (nonEmpty(options.version) && root.getLabelValue(labels.version) !== String(options.version)) {
            root.setLabel(labels.version, String(options.version));
        }

        let toolsRoot = api.getNoteWithLabel(labels.tools);
        if (!toolsRoot) {
            toolsRoot = api.createNewNote({
                parentNoteId: root.noteId,
                title: text('back.noteTools', 'Tools'),
                type: 'text',
                content: text('back.noteToolsContent', 'Tool notes live in this folder, grouped by category. Move it anywhere; the label is what matters.')
            }).note;
            toolsRoot.setLabel(labels.tools, '');
            toolsRoot.setLabel(labels.managed, '');
        }

        let seeded = false;
        // Only a Tools folder the plugin created itself is seeded. A folder the
        // user chose (or labelled by hand) is never touched.
        if (options.seed && hasLabel(toolsRoot, labels.managed) && !hasLabel(toolsRoot, labels.seeded)) {
            const specs = Array.isArray(options.seedTools) ? options.seedTools : [];
            const fallbacks = options.newToolNotes || {};
            for (let index = 0; index < specs.length; index += 1) {
                createToolNote(toolsRoot, specs[index], fallbacks);
            }
            toolsRoot.setLabel(labels.seeded, '');
            seeded = true;
        }

        backfillIcons();
        return { rootId: root.noteId, toolsRootId: toolsRoot.noteId, seeded: seeded };
    }

    function createTool() {
        const toolsRoot = requireNote(options.toolsRootId, text('back.errorToolsRoot', 'Tools root not found'));
        const note = createToolNote(
            toolsRoot,
            {
                category: options.category,
                title: options.title,
                base: options.base,
                description: options.description,
                content: options.content,
                install: options.install,
                usage: options.usage,
                help: options.help,
                options: options.options
            },
            options.newToolNotes || {}
        );
        const folder = findChildWithLabel(note, labels.options);
        const presets = folder ? findChildWithLabel(folder, labels.presets) : null;
        return {
            noteId: note.noteId,
            optionsFolderId: folder ? folder.noteId : null,
            presetsId: presets ? presets.noteId : null
        };
    }

    /** Recreate a tool from a portable tool file (see src/toolfile.js). */
    function importTool() {
        const toolsRoot = requireNote(options.toolsRootId, text('back.errorToolsRoot', 'Tools root not found'));
        const note = createToolNote(toolsRoot, options.tool || {}, options.newToolNotes || {});
        const folder = findChildWithLabel(note, labels.options);
        const presets = folder ? findChildWithLabel(folder, labels.presets) : null;
        return {
            noteId: note.noteId,
            optionsFolderId: folder ? folder.noteId : null,
            presetsId: presets ? presets.noteId : null
        };
    }

    function addOption() {
        const location = presetsLocation(options.toolId);
        const note = createOptionNote(location.folder, options.option || {});
        return { noteId: note.noteId };
    }

    function importOptions() {
        // Same bound the tool-file reader enforces (src/toolfile.js
        // MAX_OPTIONS): one action must never create thousands of notes from
        // one pasted --help dump.
        const MAX_IMPORT_OPTIONS = 200;
        const location = presetsLocation(options.toolId);
        const all = Array.isArray(options.options) ? options.options : [];
        const specs = all.slice(0, MAX_IMPORT_OPTIONS);
        // Flag text comes from imported JSON; a plain object would confuse
        // `__proto__` and friends with membership.
        const seenFlags = new Set();
        const existing = location.folder.getChildNotes();
        for (let index = 0; index < existing.length; index += 1) {
            const flag = existing[index].getLabelValue(labels.flag);
            if (nonEmpty(flag)) {
                seenFlags.add(String(flag));
            }
        }
        const noteIds = [];
        let skipped = 0;
        // One failed creation must not leave a half-imported option list
        // behind, so every note this action creates is rolled back on error.
        const batch = [];
        const previousBatch = rollbackBatch;
        rollbackBatch = batch;
        try {
            for (let index = 0; index < specs.length; index += 1) {
                const spec = specs[index] || {};
                const flag = spec.flag;
                if (nonEmpty(flag) && seenFlags.has(String(flag))) {
                    skipped += 1;
                    continue;
                }
                if (nonEmpty(flag)) {
                    seenFlags.add(String(flag));
                }
                noteIds.push(createOptionNote(location.folder, spec).noteId);
            }
        } catch (error) {
            rollbackNotes(batch);
            throw error;
        } finally {
            rollbackBatch = previousBatch;
        }
        return { created: noteIds.length, skipped: skipped, capped: all.length - specs.length, noteIds: noteIds };
    }

    /**
     * Delete one option note. The target must carry the option label, so a wrong
     * or hostile note id can never remove an unrelated note.
     */
    function deleteOption() {
        const note = requireNote(options.noteId, text('back.errorOptionNote', 'Option note not found'));
        if (!hasLabel(note, labels.option)) {
            throw new Error(text('back.errorNotAnOptionPrefix', 'Note is not an option of a tool: ') + note.noteId);
        }
        note.deleteNote();
        return { ok: true };
    }

    function setToolBase() {
        const tool = requireNote(options.toolId, text('back.errorToolNote', 'Tool note not found'));
        if (nonEmpty(options.base)) {
            tool.setLabel(labels.base, String(options.base));
        } else if (typeof tool.removeLabel === 'function') {
            tool.removeLabel(labels.base);
        } else {
            tool.setLabel(labels.base, '');
        }
        return { ok: true };
    }

    function setToolsRoot() {
        const target = requireNote(options.noteId, text('back.errorNoteNotFound', 'Note not found'));
        // Set the new pointer first: if removing the label from a previous root
        // fails afterwards, the tools stay visible instead of losing the
        // pointer and making the next bootstrap seed an empty folder.
        target.setLabel(labels.tools, '');
        // A folder the user picks is theirs: never seed examples into it.
        target.setLabel(labels.seeded, '');
        // Exactly one root may hold #cmTools: a second one (left by a
        // half-finished move, or labelled by hand) would be picked
        // arbitrarily by the loader. Sweep the pointer off every other note,
        // reporting failures only after the sweep so the new pointer stands.
        let removalFailure = null;
        const roots = api.getNotesWithLabel(labels.tools);
        for (let index = 0; index < roots.length; index += 1) {
            const note = roots[index];
            if (!note || note.noteId === target.noteId) {
                continue;
            }
            try {
                note.removeLabel(labels.tools);
            } catch (error) {
                if (!removalFailure) {
                    removalFailure = error;
                }
            }
        }
        if (removalFailure) {
            throw removalFailure;
        }
        return { ok: true };
    }

    function savePreset() {
        const location = presetsLocation(options.toolId);
        const read = readPresets(location.presets);
        if (!read.valid) {
            throw new Error(text('back.errorPresetsSave', 'The Presets note is not valid JSON. Fix or delete it before saving a preset.'));
        }
        const data = read.data;
        const name = nonEmpty(options.name) ? String(options.name) : 'Preset';
        // Same sanitiser the reader applies: a preset written by a script can
        // never persist nested objects or __proto__ keys into the note.
        const values = sanitisePresets([{ name: name, values: options.values }])[0].values;
        let updated = false;
        for (let index = 0; index < data.presets.length; index += 1) {
            const entry = data.presets[index];
            if (entry && entry.name === name) {
                entry.values = values;
                updated = true;
                break;
            }
        }
        if (!updated) {
            data.presets.push({ name: name, values: values });
        }
        data.v = 1;
        location.presets.setContent(JSON.stringify(data));
        return { noteId: location.presets.noteId };
    }

    function deletePreset() {
        const location = presetsLocation(options.toolId);
        const read = readPresets(location.presets);
        if (!read.valid) {
            throw new Error(text('back.errorPresetsDelete', 'The Presets note is not valid JSON. Fix or delete it before deleting a preset.'));
        }
        const data = read.data;
        const name = String(options.name == null ? '' : options.name);
        const kept = [];
        for (let index = 0; index < data.presets.length; index += 1) {
            const entry = data.presets[index];
            if (entry && entry.name !== name) {
                kept.push(entry);
            }
        }
        data.presets = kept;
        location.presets.setContent(JSON.stringify(data));
        return { ok: true };
    }

    /**
     * Create (once) the Render Note that hosts the palette in a normal Trilium
     * tab, including the HTML wrapper and a clone of the plugin script that
     * mounts the UI into that wrapper. All pieces are looked up by label, so the
     * user can move them freely and re-clicking never duplicates anything.
     */
    function ensureTab() {
        const root = requireNote(options.rootId, text('back.errorSettingsNote', 'Command Maker settings note not found'));
        let html = api.getNoteWithLabel(labels.tabHtml);
        if (!html) {
            html = api.createNewNote({
                parentNoteId: root.noteId,
                title: text('back.noteTabTitle', 'Command Maker tab'),
                type: 'code',
                mime: 'text/html',
                content: '<div class="cm-tab-root"></div>'
            }).note;
            html.setLabel(labels.tabHtml, '');
        }
        let tab = api.getNoteWithLabel(labels.tab);
        if (!tab) {
            tab = api.createNewNote({
                parentNoteId: root.noteId,
                title: text('back.noteTabRenderTitle', 'Command Maker'),
                type: 'render',
                content: ''
            }).note;
            tab.setLabel(labels.tab, '');
        }
        if (tab.getRelationValue('renderNote') !== html.noteId) {
            tab.setRelation('renderNote', html.noteId);
        }
        if (nonEmpty(options.scriptNoteId)) {
            // A clone shares the content: updates to the plugin script reach the
            // tab renderer without copying the bundle into a second note.
            api.ensureNoteIsPresentInParent(String(options.scriptNoteId), html.noteId, '');
        }
        return { tabNoteId: tab.noteId, htmlNoteId: html.noteId };
    }

    function setLanguage() {
        const root = requireNote(options.rootId, text('back.errorSettingsNote', 'Command Maker settings note not found'));
        if (!labels.lang) {
            throw new Error(text('back.errorUnknownActionPrefix', 'Unknown action: ') + 'setLanguage');
        }
        root.setLabel(labels.lang, String(options.lang == null ? '' : options.lang));
        return { ok: true, lang: String(options.lang == null ? '' : options.lang) };
    }

    switch (options.action) {
        case 'bootstrap':
            return bootstrap();
        case 'setLanguage':
            return setLanguage();
        case 'createTool':
            return createTool();
        case 'importTool':
            return importTool();
        case 'addOption':
            return addOption();
        case 'importOptions':
            return importOptions();
        case 'deleteOption':
            return deleteOption();
        case 'setToolBase':
            return setToolBase();
        case 'setToolsRoot':
            return setToolsRoot();
        case 'savePreset':
            return savePreset();
        case 'deletePreset':
            return deletePreset();
        case 'ensureTab':
            return ensureTab();
        default:
            throw new Error(text('back.errorUnknownActionPrefix', 'Unknown action: ') + options.action);
    }
}

module.exports = { beRun };
