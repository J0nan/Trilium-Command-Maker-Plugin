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
 * Actions: bootstrap | createCategory | createTool | importTool | addOption |
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

    function findCategory(toolsRoot, name) {
        const children = toolsRoot.getChildNotes();
        for (let index = 0; index < children.length; index += 1) {
            if (children[index].title === name && hasLabel(children[index], labels.category)) {
                return children[index];
            }
        }
        return null;
    }

    function ensureCategory(toolsRoot, name) {
        const existing = findCategory(toolsRoot, name);
        if (existing) {
            return existing;
        }
        const note = api.createNewNote({
            parentNoteId: toolsRoot.noteId,
            title: name,
            type: 'text',
            content: ''
        }).note;
        note.setLabel(labels.category, '');
        return note;
    }

    function ensureOptionsFolder(toolNote) {
        const existing = findChildWithLabel(toolNote, labels.options);
        if (existing) {
            return existing;
        }
        const note = api.createNewNote({
            parentNoteId: toolNote.noteId,
            title: 'Options',
            type: 'text',
            content: ''
        }).note;
        note.setLabel(labels.options, '');
        ensureIcon(note, icons.options);
        return note;
    }

    function ensurePresetsNote(optionsFolder) {
        const existing = findChildWithLabel(optionsFolder, labels.presets);
        if (existing) {
            return existing;
        }
        const note = api.createNewNote({
            parentNoteId: optionsFolder.noteId,
            title: 'Presets',
            type: 'code',
            mime: 'application/json',
            content: '{"v":1,"presets":[]}'
        }).note;
        note.setLabel(labels.presets, '');
        return note;
    }

    /**
     * Tool-file presets -> the JSON stored in the Presets note. Mirrors the
     * frontend reader: entries need a name, values keep own primitive keys
     * only, so a hand-edited file can never smuggle __proto__ into the note.
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
                    if (value === null || typeof value === 'object' || typeof value === 'function') {
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
        const tool = requireNote(toolId, 'Tool note not found');
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

    /** Shared creation path for createTool, bootstrap seeding and the importer. */
    function createToolNote(toolsRoot, spec, fallbacks) {
        const safeSpec = spec || {};
        const safeFallbacks = fallbacks || {};
        const categoryName = nonEmpty(safeSpec.category) ? String(safeSpec.category) : 'Uncategorized';
        const title = nonEmpty(safeSpec.title) ? String(safeSpec.title) : 'New tool';
        const category = ensureCategory(toolsRoot, categoryName);
        const note = api.createNewNote({
            parentNoteId: category.noteId,
            title: title,
            type: 'text',
            content: nonEmpty(safeSpec.content) ? String(safeSpec.content) : defaultToolContent(safeFallbacks)
        }).note;
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

        const install = api.createNewNote({
            parentNoteId: note.noteId,
            title: 'Install',
            type: 'text',
            content: childContent(safeSpec.install, safeFallbacks.install)
        }).note;
        install.setLabel(labels.install, '');

        const usage = api.createNewNote({
            parentNoteId: note.noteId,
            title: 'Usage',
            type: 'text',
            content: childContent(safeSpec.usage, safeFallbacks.usage)
        }).note;
        usage.setLabel(labels.usage, '');

        const help = api.createNewNote({
            parentNoteId: note.noteId,
            title: 'Help',
            type: 'code',
            mime: 'text/x-sh',
            content: childContent(safeSpec.help, safeFallbacks.help)
        }).note;
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
        const title = nonEmpty(safe.label) ? String(safe.label) : 'Option';
        const note = api.createNewNote({
            parentNoteId: folder.noteId,
            title: title,
            type: 'text',
            content: safe.content == null ? '' : String(safe.content)
        }).note;
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
            // currentNote has no parents (root) — fall through
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
                title: 'Command Maker',
                type: 'text',
                content: 'Command Maker settings. The plugin finds this note through its label.'
            }).note;
            root.setLabel(labels.root, '');
        }

        if (nonEmpty(options.version) && root.getLabelValue(labels.version) !== String(options.version)) {
            root.setLabel(labels.version, String(options.version));
        }

        let toolsRoot = api.getNoteWithLabel(labels.tools);
        if (!toolsRoot) {
            toolsRoot = api.createNewNote({
                parentNoteId: root.noteId,
                title: 'Tools',
                type: 'text',
                content: 'Tool notes live in this folder, grouped by category. Move it anywhere; the label is what matters.'
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

    function createCategory() {
        const toolsRoot = requireNote(options.toolsRootId, 'Tools root not found');
        const name = nonEmpty(options.name) ? String(options.name) : 'Uncategorized';
        return { noteId: ensureCategory(toolsRoot, name).noteId };
    }

    function createTool() {
        const toolsRoot = requireNote(options.toolsRootId, 'Tools root not found');
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
        const toolsRoot = requireNote(options.toolsRootId, 'Tools root not found');
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
        const location = presetsLocation(options.toolId);
        const specs = Array.isArray(options.options) ? options.options : [];
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
        return { created: noteIds.length, skipped: skipped, noteIds: noteIds };
    }

    /**
     * Delete one option note. The target must carry the option label, so a wrong
     * or hostile note id can never remove an unrelated note.
     */
    function deleteOption() {
        const note = requireNote(options.noteId, 'Option note not found');
        if (!hasLabel(note, labels.option)) {
            throw new Error('Note is not an option of a tool: ' + note.noteId);
        }
        note.deleteNote();
        return { ok: true };
    }

    function setToolBase() {
        const tool = requireNote(options.toolId, 'Tool note not found');
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
        const target = requireNote(options.noteId, 'Note not found');
        if (options.oldToolsRootId && options.oldToolsRootId !== options.noteId) {
            const old = api.getNote(options.oldToolsRootId);
            if (old && typeof old.removeLabel === 'function') {
                old.removeLabel(labels.tools);
            }
        }
        target.setLabel(labels.tools, '');
        // A folder the user picks is theirs: never seed examples into it.
        target.setLabel(labels.seeded, '');
        return { ok: true };
    }

    function savePreset() {
        const location = presetsLocation(options.toolId);
        const read = readPresets(location.presets);
        if (!read.valid) {
            throw new Error('The Presets note is not valid JSON. Fix or delete it before saving a preset.');
        }
        const data = read.data;
        const name = nonEmpty(options.name) ? String(options.name) : 'Preset';
        const values = options.values && typeof options.values === 'object' && !Array.isArray(options.values)
            ? options.values
            : {};
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
            throw new Error('The Presets note is not valid JSON. Fix or delete it before deleting a preset.');
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
        const root = requireNote(options.rootId, 'Command Maker settings note not found');
        let html = api.getNoteWithLabel(labels.tabHtml);
        if (!html) {
            html = api.createNewNote({
                parentNoteId: root.noteId,
                title: 'Command Maker tab',
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
                title: 'Command Maker',
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

    switch (options.action) {
        case 'bootstrap':
            return bootstrap();
        case 'createCategory':
            return createCategory();
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
            throw new Error('Unknown action: ' + options.action);
    }
}

module.exports = { beRun };
