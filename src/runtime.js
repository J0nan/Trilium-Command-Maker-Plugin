'use strict';

/**
 * Trilium runtime glue: reads FNote objects into plain snapshots, keeps a
 * tool index for fast search, and exposes actions to the palette.
 *
 * Structure the runtime expects:
 *   Tools/                 #cmTools (any path)
 *     Category/            #cmCategory
 *       Tool/              #cmTool  (three H2 sections in its content)
 *         Install          #cmInstall
 *         Usage            #cmUsage
 *         Help             #cmHelpNote
 *         Options/         #cmOptions
 *           Option         #cmOption
 *           Presets        #cmPresets (JSON)
 */

const Model = require('./model');
const Backend = require('./backend');
const Sections = require('./sections');
const Parse = require('./parse');
const UI = require('./ui');

let index = [];
let entriesById = new Map();
let bootstrapPromise = null;
let bootstrapApi = null;
let bootstrapInfo = null;

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

function hasLabel(note, name) {
    if (!note) {
        return false;
    }
    try {
        if (typeof note.hasLabel === 'function') {
            return note.hasLabel(name);
        }
        const value = note.getLabelValue(name);
        return value !== null && value !== undefined;
    } catch (error) {
        return false;
    }
}

async function childWithLabel(note, label) {
    if (!note) {
        return null;
    }
    const children = await note.getChildNotes();
    for (const child of children) {
        if (hasLabel(child, label)) {
            return child;
        }
    }
    return null;
}

async function childByTitle(note, title) {
    const children = await note.getChildNotes();
    for (const child of children) {
        if (child.title === title) {
            return child;
        }
    }
    return null;
}

function ensureBootstrap() {
    const apiRef = getApi();
    if (bootstrapPromise && bootstrapApi === apiRef) {
        return bootstrapPromise;
    }
    if (!apiRef) {
        return Promise.reject(new Error('Trilium api is not available.'));
    }
    bootstrapApi = apiRef;
    bootstrapPromise = Promise.resolve(
        apiRef.runOnBackend(Backend.beRun, [{
            action: 'bootstrap',
            labels: Model.LABELS,
            seed: true,
            seedTools: Model.seedTools(),
            newToolNotes: Model.newToolNotes()
        }])
    ).then(function (result) {
        bootstrapInfo = result || null;
        return result;
    }).catch(function (error) {
        bootstrapPromise = null;
        bootstrapApi = null;
        throw error;
    });
    return bootstrapPromise;
}

async function resolveToolsRoot() {
    const apiRef = getApi();
    try {
        const found = await apiRef.searchForNote('#' + Model.LABELS.tools);
        if (found) {
            return found;
        }
    } catch (error) {
        // fall through to the bootstrap result
    }
    if (bootstrapInfo && bootstrapInfo.toolsRootId) {
        try {
            return await apiRef.getNote(bootstrapInfo.toolsRootId);
        } catch (error) {
            return null;
        }
    }
    return null;
}

async function readOptionSnapshots(toolNote) {
    const folder = await childWithLabel(toolNote, Model.LABELS.options);
    if (!folder) {
        return [];
    }
    const children = await folder.getChildNotes();
    const snapshots = [];
    for (const child of children) {
        if (hasLabel(child, Model.LABELS.option)) {
            snapshots.push({
                noteId: child.noteId,
                title: child.title,
                labels: readLabels(child)
            });
        }
    }
    return snapshots;
}

function optionSearchText(snapshots) {
    return snapshots.map(function (snapshot) {
        const labels = snapshot.labels || {};
        return [
            snapshot.title,
            labels[Model.LABELS.flag],
            labels[Model.LABELS.doc],
            labels[Model.LABELS.enumValues]
        ].join(' ');
    }).join(' ');
}

async function refresh() {
    await ensureBootstrap();
    const apiRef = getApi();
    const toolsRoot = await resolveToolsRoot();
    const notes = await apiRef.searchForNotes('#' + Model.LABELS.tool);

    const nextIndex = [];
    const nextById = new Map();

    for (const note of notes) {
        if (hasLabel(note, Model.LABELS.legacyTemplate)) {
            continue;
        }
        const labels = readLabels(note);
        let category = '';
        try {
            const parents = note.getParentNotes();
            if (parents && parents.length) {
                category = parents[0].title;
            }
        } catch (error) {
            category = '';
        }

        let optionSnapshots = [];
        try {
            optionSnapshots = await readOptionSnapshots(note);
        } catch (error) {
            optionSnapshots = [];
        }

        let whatIs = '';
        try {
            const parsed = Sections.parseToolNote(await note.getContent());
            whatIs = parsed.whatIs;
        } catch (error) {
            whatIs = '';
        }

        const entry = {
            noteId: note.noteId,
            title: note.title,
            category: category,
            labels: labels,
            note: note,
            optionSnapshots: optionSnapshots,
            searchText: [labels[Model.LABELS.description], whatIs].join(' ')
        };

        nextById.set(note.noteId, entry);
        nextIndex.push({
            noteId: note.noteId,
            title: note.title,
            category: category,
            description: labels[Model.LABELS.description] || '',
            base: labels[Model.LABELS.base] || Model.deriveBase(note.title),
            optionCount: optionSnapshots.length,
            optionTitles: optionSnapshots.map(function (snapshot) {
                return snapshot.title;
            })
        });
    }

    index = nextIndex;
    entriesById = nextById;
    return index;
}

function search(query) {
    return index.filter(function (item) {
        const entry = entriesById.get(item.noteId);
        return Model.matches({
            title: item.title,
            category: item.category,
            description: item.description,
            base: item.base,
            options: [],
            optionTitles: item.optionTitles,
            searchText: entry ? entry.searchText + ' ' + optionSearchText(entry.optionSnapshots) : ''
        }, query);
    });
}

function readPresetsContent(content) {
    let data = null;
    let invalid = false;
    try {
        data = JSON.parse(String(content || ''));
    } catch (error) {
        invalid = true;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.presets)) {
        return { presets: [], invalid: true };
    }
    return {
        presets: data.presets
            .filter(function (entry) {
                return entry && typeof entry.name === 'string';
            })
            .map(function (entry) {
                return {
                    name: entry.name,
                    values: entry.values && typeof entry.values === 'object' ? entry.values : {}
                };
            }),
        invalid: invalid
    };
}

async function readNoteText(note) {
    if (!note) {
        return '';
    }
    let content = '';
    try {
        content = await note.getContent();
    } catch (error) {
        return '';
    }
    if (note.type === 'code') {
        return String(content || '');
    }
    return Parse.stripHtml(content);
}

async function load(noteId) {
    const entry = entriesById.get(noteId);
    if (!entry) {
        throw new Error('Tool not found. Reopen the palette.');
    }
    const note = entry.note;
    const labels = entry.labels;

    let toolContent = '';
    try {
        toolContent = await note.getContent();
    } catch (error) {
        toolContent = '';
    }
    const parsed = Sections.parseToolNote(toolContent);

    const installNote = await childWithLabel(note, Model.LABELS.install) || await childByTitle(note, 'Install');
    const usageNote = await childWithLabel(note, Model.LABELS.usage) || await childByTitle(note, 'Usage');
    const helpNote = await childWithLabel(note, Model.LABELS.helpNote) || await childByTitle(note, 'Help');
    const optionsNote = await childWithLabel(note, Model.LABELS.options);
    const presetsNote = optionsNote ? await childWithLabel(optionsNote, Model.LABELS.presets) : null;

    const installText = await readNoteText(installNote);
    const usageHtml = usageNote ? await usageNote.getContent() : '';
    const helpText = await readNoteText(helpNote);
    const usageExamples = usageNote && usageNote.type === 'code'
        ? Sections.parseExampleLines(usageHtml)
        : Sections.parseExamples(usageHtml, labels[Model.LABELS.base] || Model.deriveBase(note.title));

    const definition = Model.buildTool({
        noteId: note.noteId,
        title: note.title,
        category: entry.category,
        content: toolContent,
        labels: labels,
        optionNotes: entry.optionSnapshots,
        examples: usageExamples,
        searchText: entry.searchText
    });

    let presets = [];
    let presetsInvalid = false;
    if (presetsNote) {
        try {
            const read = readPresetsContent(await presetsNote.getContent());
            presets = read.presets;
            presetsInvalid = read.invalid;
        } catch (error) {
            presets = [];
            presetsInvalid = true;
        }
    }

    let toolNotePath = '';
    try {
        toolNotePath = note.getBestNotePathString();
    } catch (error) {
        toolNotePath = '';
    }

    return {
        definition: definition,
        presets: presets,
        presetsInvalid: presetsInvalid,
        whatIs: parsed.whatIs,
        links: parsed.links,
        officialLinks: parsed.officialLinks,
        usefulLinks: parsed.usefulLinks,
        usageExamples: usageExamples,
        helpText: helpText,
        installText: installText,
        optionsFolderId: optionsNote ? optionsNote.noteId : null,
        presetsNoteId: presetsNote ? presetsNote.noteId : null,
        toolNotePath: toolNotePath
    };
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

function toolsRootId() {
    if (!bootstrapInfo || !bootstrapInfo.toolsRootId) {
        throw new Error('Tools folder is not available yet. Reopen the palette.');
    }
    return bootstrapInfo.toolsRootId;
}

async function setToolsRootAction(noteId) {
    const current = await resolveToolsRoot();
    await backendAction('setToolsRoot', {
        noteId: noteId,
        oldToolsRootId: current ? current.noteId : null
    });
    bootstrapPromise = null;
    bootstrapInfo = null;
    index = [];
    entriesById = new Map();
    await refresh();
    return { noteId: noteId };
}

function controller() {
    return {
        refresh: refresh,
        search: search,
        load: load,
        copy: copyText,
        insert: insertText,

        categories() {
            const seen = [];
            for (const item of index) {
                if (item.category && seen.indexOf(item.category) === -1) {
                    seen.push(item.category);
                }
            }
            seen.sort();
            return seen;
        },

        async createTool(spec) {
            const notes = Model.newToolNotes();
            const created = await backendAction('createTool', {
                toolsRootId: toolsRootId(),
                category: spec.category,
                title: spec.title,
                base: spec.base,
                description: spec.description,
                content: Model.toolTemplate(),
                install: notes.install,
                usage: notes.usage,
                help: notes.help
            });
            await refresh();
            return created;
        },

        addOption(toolId, option) {
            return backendAction('addOption', { toolId: toolId, option: option });
        },

        importOptions(toolId, options) {
            return backendAction('importOptions', { toolId: toolId, options: options || [] });
        },

        deleteOption(noteId) {
            return backendAction('deleteOption', { noteId: noteId });
        },

        setToolBase(toolId, base) {
            return backendAction('setToolBase', { toolId: toolId, base: base });
        },

        savePreset(toolId, name, values) {
            return backendAction('savePreset', { toolId: toolId, name: name, values: values });
        },

        deletePreset(toolId, name) {
            return backendAction('deletePreset', { toolId: toolId, name: name });
        },

        async importLegacy() {
            const created = await backendAction('importLegacy', {
                toolsRootId: toolsRootId(),
                categoryName: 'Imported',
                newToolNotes: Model.newToolNotes()
            });
            await refresh();
            return created;
        },

        async currentToolsRoot() {
            const root = await resolveToolsRoot();
            return root ? { noteId: root.noteId, title: root.title } : null;
        },

        setToolsRoot(noteId) {
            return setToolsRootAction(noteId);
        },

        async useActiveNoteAsToolsRoot() {
            const apiRef = getApi();
            const active = apiRef.getActiveContextNote();
            if (!active) {
                throw new Error('No active note to use as the Tools folder.');
            }
            return setToolsRootAction(active.noteId);
        },

        async activeNoteText() {
            const apiRef = getApi();
            const active = apiRef.getActiveContextNote();
            if (!active) {
                throw new Error('No active note.');
            }
            const text = await readNoteText(active);
            return { noteId: active.noteId, title: active.title, text: text };
        },

        async noteText(noteId) {
            const apiRef = getApi();
            const note = await apiRef.getNote(noteId);
            if (!note) {
                throw new Error('Note not found: ' + noteId);
            }
            const text = await readNoteText(note);
            return { noteId: note.noteId, title: note.title, text: text };
        },

        openNote(noteId) {
            const apiRef = getApi();
            return Promise.resolve(apiRef.getNote(noteId)).then(function (note) {
                if (!note) {
                    throw new Error('Note not found: ' + noteId);
                }
                const path = note.getBestNotePathString();
                return apiRef.activateNote(path);
            });
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