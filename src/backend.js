'use strict';

/**
 * Backend operations.
 *
 * Everything runs through a single `beRun(params)` function because Trilium's
 * `api.runOnBackend` serialises the function by source: inner helpers travel
 * with it, outer helpers would not. `params.labels` carries the attribute names
 * so the schema lives in one place (model.js) instead of being duplicated here.
 *
 * Actions: bootstrap | createCommand | addOption | savePreset | deletePreset
 */

const ACTIONS = {
    bootstrap: 'bootstrap',
    createCommand: 'createCommand',
    addOption: 'addOption',
    savePreset: 'savePreset',
    deletePreset: 'deletePreset'
};

function beRun(params) {
    const options = params || {};
    const labels = options.labels || {};

    function hasLabel(note, name) {
        if (typeof note.hasLabel === 'function') {
            return note.hasLabel(name);
        }
        const value = note.getLabelValue(name);
        return value !== null && value !== undefined;
    }

    function hasRelation(note, name) {
        if (typeof note.hasRelation === 'function') {
            return note.hasRelation(name);
        }
        const value = note.getRelationValue(name);
        return value !== null && value !== undefined;
    }

    function findChild(parent, label) {
        const children = parent.getChildNotes();
        for (let index = 0; index < children.length; index += 1) {
            if (hasLabel(children[index], label)) {
                return children[index];
            }
        }
        return null;
    }

    function findChildByTitle(parent, title) {
        const children = parent.getChildNotes();
        for (let index = 0; index < children.length; index += 1) {
            if (children[index].title === title) {
                return children[index];
            }
        }
        return null;
    }

    function ensureFolder(parent, label, title) {
        const existing = findChild(parent, label);
        if (existing) {
            return existing;
        }
        const note = api.createNewNote({
            parentNoteId: parent.noteId,
            title: title,
            type: 'text',
            content: ''
        }).note;
        note.setLabel(label, '');
        return note;
    }

    function slugify(text) {
        return String(text == null ? '' : text)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function createOption(commandNote, spec) {
        const optionTemplate = api.getNoteWithLabel(labels.optionTemplate);
        const folder = ensureFolder(commandNote, labels.options, 'Options');
        const note = api.createNewNote({
            parentNoteId: folder.noteId,
            title: spec.label || 'Option',
            type: 'text',
            content: ''
        }).note;

        if (optionTemplate && !hasRelation(note, 'template')) {
            note.setRelation('template', optionTemplate.noteId);
        }
        if (spec.flag) {
            note.setLabel(labels.flag, spec.flag);
        }
        if (spec.type) {
            note.setLabel(labels.type, spec.type);
        }
        if (spec.mode) {
            note.setLabel(labels.mode, spec.mode);
        }
        if (spec.placeholder !== undefined && spec.placeholder !== null) {
            note.setLabel(labels.placeholder, String(spec.placeholder));
        } else {
            note.setLabel(labels.placeholder, slugify(spec.label));
        }
        if (spec.enumValues && spec.enumValues.length) {
            note.setLabel(labels.enumValues, spec.enumValues.join(','));
        }
        if (spec.defaultValue !== undefined && spec.defaultValue !== null) {
            note.setLabel(labels.defaultValue, String(spec.defaultValue));
        }
        if (spec.quote) {
            note.setLabel(labels.quote, spec.quote);
        }
        if (spec.sep) {
            note.setLabel(labels.separator, spec.sep);
        }
        if (spec.order !== undefined && spec.order !== null) {
            note.setLabel(labels.order, String(spec.order));
        }
        if (spec.required) {
            note.setLabel(labels.required, 'true');
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

    function seedCommand(title, base, specs) {
        const note = api.createNewNote({
            parentNoteId: api.getNoteWithLabel(labels.root).noteId,
            title: title,
            type: 'code',
            mime: 'text/x-sh',
            content: base
        }).note;
        const template = api.getNoteWithLabel(labels.template);
        note.setRelation('template', template.noteId);
        note.setLabel(labels.command, '');
        note.setLabel(labels.description, '');
        note.setContent(base);
        ensureFolder(note, labels.options, 'Options');
        ensureFolder(note, labels.presets, 'Presets');
        for (let index = 0; index < specs.length; index += 1) {
            createOption(note, specs[index]);
        }
        return note;
    }

    function hasSeededCommands(templateId) {
        const candidates = api.getNotesWithLabel(labels.command);
        for (let index = 0; index < candidates.length; index += 1) {
            if (candidates[index].noteId !== templateId) {
                return true;
            }
        }
        return false;
    }

    function bootstrap() {
        let root = api.getNoteWithLabel(labels.root);
        if (!root) {
            root = api.createNewNote({
                parentNoteId: parentForRoot(),
                title: 'Command Maker',
                type: 'text',
                content: 'Commands live in this subtree. Press Ctrl+Shift+K to open the palette.'
            }).note;
            root.setLabel(labels.root, '');
        }

        let template = api.getNoteWithLabel(labels.template);
        if (!template) {
            template = api.createNewNote({
                parentNoteId: root.noteId,
                title: 'Command Template',
                type: 'code',
                mime: 'text/x-sh',
                content: 'command goes here'
            }).note;
            template.setLabel('template', '');
            template.setLabel(labels.template, '');
            template.setLabel(labels.command, '');
            template.setLabel(labels.description, 'One line describing the command.');
        }

        let optionTemplate = api.getNoteWithLabel(labels.optionTemplate);
        if (!optionTemplate) {
            optionTemplate = api.createNewNote({
                parentNoteId: root.noteId,
                title: 'Option Template',
                type: 'text',
                content: ''
            }).note;
            optionTemplate.setLabel('template', '');
            optionTemplate.setLabel(labels.optionTemplate, '');
            optionTemplate.setLabel(labels.type, 'string');
            optionTemplate.setLabel(labels.quote, 'none');
            optionTemplate.setLabel(labels.order, '100');
        }

        const optionsFolder = ensureFolder(template, labels.options, 'Options');
        if (!hasRelation(optionsFolder, 'child:template')) {
            optionsFolder.setRelation('child:template', optionTemplate.noteId);
        }
        ensureFolder(template, labels.presets, 'Presets');

        if (!hasSeededCommands(template.noteId)) {
            seedCommand('ffmpeg compress', 'ffmpeg -i "{{input}}"', [
                { label: 'Input file', flag: '-i', type: 'path', placeholder: 'input', order: 10, quote: 'double' },
                { label: 'Video codec', flag: '-c:v', type: 'enum', enumValues: ['libx264', 'libx265', 'libvpx-vp9'], defaultValue: 'libx264', order: 20 },
                { label: 'CRF quality', flag: '-crf', type: 'number', defaultValue: '23', order: 30 },
                { label: 'Overwrite output', flag: '-y', type: 'boolean', order: 40 }
            ]);
            seedCommand('git commit', 'git commit -m "{{message}}"', [
                { label: 'Message', flag: '', type: 'string', placeholder: 'message', order: 10 },
                { label: 'Amend last commit', flag: '--amend', type: 'boolean', order: 20 },
                { label: 'Skip hooks', flag: '--no-verify', type: 'boolean', order: 30 }
            ]);
        }

        return {
            rootId: root.noteId,
            templateId: template.noteId,
            optionTemplateId: optionTemplate.noteId
        };
    }

    function createCommand() {
        const root = api.getNoteWithLabel(labels.root);
        const template = api.getNoteWithLabel(labels.template);
        if (!root || !template) {
            throw new Error('Command Maker is not installed. Run the installer first.');
        }
        const title = String(options.title || '').trim() || 'New command';
        const base = String(options.base || 'command goes here');
        const note = api.createNewNote({
            parentNoteId: root.noteId,
            title: title,
            type: 'code',
            mime: 'text/x-sh',
            content: base
        }).note;
        note.setRelation('template', template.noteId);
        note.setLabel(labels.command, '');
        note.setLabel(labels.description, '');
        note.setContent(base);
        ensureFolder(note, labels.options, 'Options');
        ensureFolder(note, labels.presets, 'Presets');
        return { noteId: note.noteId };
    }

    function addOption() {
        const command = api.getNote(options.commandId);
        if (!command) {
            throw new Error('Command note not found: ' + options.commandId);
        }
        const note = createOption(command, options.option || {});
        return { noteId: note.noteId };
    }

    function savePreset() {
        const command = api.getNote(options.commandId);
        if (!command) {
            throw new Error('Command note not found: ' + options.commandId);
        }
        const folder = ensureFolder(command, labels.presets, 'Presets');
        const name = String(options.name || '').trim() || 'Preset';
        const payload = JSON.stringify({ v: 1, values: options.values || {} });
        const existing = findChildByTitle(folder, name);
        if (existing) {
            existing.setContent(payload);
            return { noteId: existing.noteId };
        }
        const note = api.createNewNote({
            parentNoteId: folder.noteId,
            title: name,
            type: 'code',
            mime: 'application/json',
            content: payload
        }).note;
        note.setLabel(labels.preset, '');
        return { noteId: note.noteId };
    }

    function deletePreset() {
        const note = api.getNote(options.noteId);
        if (!note) {
            throw new Error('Preset not found: ' + options.noteId);
        }
        note.deleteNote();
        return { ok: true };
    }

    switch (options.action) {
        case ACTIONS.bootstrap:
            return bootstrap();
        case ACTIONS.createCommand:
            return createCommand();
        case ACTIONS.addOption:
            return addOption();
        case ACTIONS.savePreset:
            return savePreset();
        case ACTIONS.deletePreset:
            return deletePreset();
        default:
            throw new Error('Unknown action: ' + options.action);
    }
}

module.exports = { beRun, ACTIONS };