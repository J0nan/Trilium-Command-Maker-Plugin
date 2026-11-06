'use strict';

/**
 * Trilium runtime glue: reads FNote objects into plain snapshots, keeps a
 * command index for fast fuzzy search, and exposes actions to the palette.
 */

const Model = require('./model');
const Backend = require('./backend');
const UI = require('./ui');

let index = [];
let notesById = new Map();
let bootstrapPromise = null;

function getApi() {
    return typeof api !== 'undefined' ? api : null;
}

function readLabels(note) {
    const labels = {};
    if (!note) {
        return labels;
    }
    for (const name of Model.LABEL_NAMES) {
        let value = null;
        try {
            value = note.getLabelValue(name);
        } catch (error) {
            value = null;
        }
        if (value !== null && value !== undefined) {
            labels[name] = String(value);
        }
    }
    return labels;
}

async function childWithLabel(note, label) {
    const children = await note.getChildNotes();
    for (const child of children) {
        let value = null;
        try {
            value = child.getLabelValue(label);
        } catch (error) {
            value = null;
        }
        if (value !== null && value !== undefined) {
            return child;
        }
    }
    return null;
}

function ensureBootstrap() {
    if (bootstrapPromise) {
        return bootstrapPromise;
    }
    const apiRef = getApi();
    if (!apiRef) {
        return Promise.reject(new Error('Trilium api is not available.'));
    }
    bootstrapPromise = Promise.resolve(
        apiRef.runOnBackend(Backend.beRun, [{
            action: Backend.ACTIONS.bootstrap,
            labels: Model.LABELS
        }])
    ).catch(function (error) {
        bootstrapPromise = null;
        throw error;
    });
    return bootstrapPromise;
}

async function readOptionTitles(note) {
    const optionsNote = await childWithLabel(note, Model.LABELS.options);
    if (!optionsNote) {
        return [];
    }
    const children = await optionsNote.getChildNotes();
    return children.map(function (child) {
        return child.title;
    });
}

async function refresh() {
    await ensureBootstrap();
    const apiRef = getApi();
    const notes = await apiRef.searchForNotes('#' + Model.LABELS.command);

    let templateId = null;
    try {
        const template = await apiRef.searchForNote('#' + Model.LABELS.template);
        templateId = template ? template.noteId : null;
    } catch (error) {
        templateId = null;
    }

    const nextIndex = [];
    const nextById = new Map();
    for (const note of notes) {
        if (templateId && note.noteId === templateId) {
            continue;
        }
        const labels = readLabels(note);
        let optionTitles = [];
        try {
            optionTitles = await readOptionTitles(note);
        } catch (error) {
            optionTitles = [];
        }
        nextById.set(note.noteId, note);
        nextIndex.push({
            noteId: note.noteId,
            title: note.title,
            labels: labels,
            optionTitles: optionTitles
        });
    }

    index = nextIndex;
    notesById = nextById;
    return index;
}

function search(query) {
    return index.filter(function (item) {
        return Model.matches({
            title: item.title,
            description: item.labels[Model.LABELS.description] || '',
            tags: item.labels[Model.LABELS.tags] || '',
            base: item.labels[Model.LABELS.base] || '',
            options: [],
            optionTitles: item.optionTitles || []
        }, query);
    });
}

async function readPresets(presetsNote) {
    const children = await presetsNote.getChildNotes();
    const presets = [];
    for (const child of children) {
        let marker = null;
        try {
            marker = child.getLabelValue(Model.LABELS.preset);
        } catch (error) {
            marker = null;
        }
        if (marker === null || marker === undefined) {
            continue;
        }
        let values = {};
        try {
            const parsed = JSON.parse(await child.getContent());
            values = parsed && parsed.values ? parsed.values : {};
        } catch (error) {
            values = {};
        }
        presets.push({ noteId: child.noteId, title: child.title, values: values });
    }
    return presets;
}

async function load(noteId) {
    const note = notesById.get(noteId);
    if (!note) {
        throw new Error('Command not found. Reopen the palette.');
    }
    const labels = readLabels(note);

    let content = '';
    try {
        content = await note.getContent();
    } catch (error) {
        content = '';
    }

    const optionsNote = await childWithLabel(note, Model.LABELS.options);
    const presetsNote = await childWithLabel(note, Model.LABELS.presets);
    const optionNotes = optionsNote ? await optionsNote.getChildNotes() : [];

    const definition = Model.buildCommand({
        noteId: note.noteId,
        title: note.title,
        content: content,
        labels: labels,
        optionNotes: optionNotes.map(function (optionNote) {
            return {
                noteId: optionNote.noteId,
                title: optionNote.title,
                labels: readLabels(optionNote)
            };
        })
    });

    const presets = presetsNote ? await readPresets(presetsNote) : [];
    return { definition: definition, presets: presets };
}

async function copyText(text) {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (error) {
        // fall through to the legacy path
    }
    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return Boolean(ok);
    } catch (error) {
        return false;
    }
}

function insertText(text) {
    const apiRef = getApi();
    if (!apiRef || typeof apiRef.addTextToActiveContextEditor !== 'function') {
        throw new Error('This Trilium version cannot insert into the editor. Copy the command instead.');
    }
    apiRef.addTextToActiveContextEditor(text);
}

function backendAction(action, extra) {
    const apiRef = getApi();
    const params = Object.assign({ action: action, labels: Model.LABELS }, extra || {});
    return apiRef.runOnBackend(Backend.beRun, [params]);
}

function controller() {
    return {
        refresh: refresh,
        search: search,
        load: load,
        copy: copyText,
        insert: insertText,
        createCommand(title) {
            return backendAction(Backend.ACTIONS.createCommand, { title: title });
        },
        addOption(commandId, option) {
            return backendAction(Backend.ACTIONS.addOption, { commandId: commandId, option: option });
        },
        savePreset(commandId, name, values) {
            return backendAction(Backend.ACTIONS.savePreset, {
                commandId: commandId,
                name: name,
                values: values
            });
        },
        deletePreset(noteId) {
            return backendAction(Backend.ACTIONS.deletePreset, { noteId: noteId });
        }
    };
}

function start() {
    const apiRef = getApi();
    if (!apiRef) {
        console.error('[command-maker] Trilium api is not available.');
        return;
    }
    try {
        UI.openPalette(controller());
    } catch (error) {
        console.error('[command-maker]', error);
        try {
            if (typeof apiRef.showError === 'function') {
                apiRef.showError('Command Maker: ' + (error && error.message ? error.message : error));
            }
        } catch (ignored) {
            // nothing else to do
        }
    }
}

module.exports = { start, controller, refresh, search, load };