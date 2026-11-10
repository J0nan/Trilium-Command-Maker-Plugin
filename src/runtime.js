'use strict';

/**
 * Trilium runtime glue: reads FNote objects into plain snapshots, keeps a
 * tool index for fast search, and exposes actions to the palette.
 *
 * Structure the runtime expects:
 *   Tools/                 #cmTools (any path)
 *     Category/            #cmCategory
 *       Subcategory/       #cmCategory  (optional, any depth)
 *         Tool/            #cmTool  (three H2 sections in its content)
 *           Install        #cmInstall
 *           Usage          #cmUsage
 *           Help           #cmHelpNote
 *           Options/       #cmOptions
 *             Option       #cmOption
 *             Presets      #cmPresets (JSON)
 */

const Model = require('./model');
const Backend = require('./backend');
const Sections = require('./sections');
const Parse = require('./parse');
const ToolFile = require('./toolfile');
const Version = require('./version');
const Dom = require('./dom');
const UI = require('./ui');
const I18n = require('./i18n');

let index = [];
let entriesById = new Map();
let bootstrapPromise = null;
let bootstrapApi = null;
let bootstrapInfo = null;

// Overlay width, as a percentage of the window. Resolved from the settings
// note before the first mount and updated by the palette's width slider.
let panelWidth = Model.PANEL_WIDTH_DEFAULT;

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

/**
 * The standard child of a tool note: found by label first (survives a rename)
 * and by its default title second (survives a missing label).
 */
function standardChild(note, label, title) {
    if (!note) {
        return Promise.resolve(null);
    }
    return childWithLabel(note, label).then(function (found) {
        return found || childByTitle(note, title);
    });
}

function navigatorLanguages() {
    try {
        if (typeof navigator === 'undefined' || !navigator) {
            return [];
        }
        if (Array.isArray(navigator.languages) && navigator.languages.length) {
            return navigator.languages;
        }
        return navigator.language ? [navigator.language] : [];
    } catch (error) {
        return [];
    }
}

/**
 * The `cmLang` label on the settings note wins; otherwise follow the browser
 * language and fall back to English. Runs before bootstrap, so seeded notes
 * are written in the active language.
 */
async function resolveLocale() {
    let configured = '';
    const apiRef = getApi();
    if (apiRef) {
        try {
            const root = await apiRef.searchForNote('#' + Model.LABELS.root);
            if (root) {
                const value = root.getLabelValue(Model.LABELS.lang);
                configured = value === null || value === undefined ? '' : String(value);
            }
        } catch (error) {
            configured = '';
        }
    }
    return I18n.setLocale(I18n.normalizeLocale(configured) || I18n.detectLocale(navigatorLanguages()));
}

/**
 * The `cmPanelWidth` label on the settings note sets the overlay width as a
 * percentage. Missing or unreadable values fall back to the default.
 */
async function resolvePanelWidth() {
    let configured = '';
    const apiRef = getApi();
    if (apiRef) {
        try {
            const root = await apiRef.searchForNote('#' + Model.LABELS.root);
            if (root) {
                const value = root.getLabelValue(Model.LABELS.panelWidth);
                configured = value === null || value === undefined ? '' : String(value);
            }
        } catch (error) {
            configured = '';
        }
    }
    panelWidth = configured.trim() === ''
        ? Model.PANEL_WIDTH_DEFAULT
        : Model.normalizePanelWidth(configured);
    return panelWidth;
}

function ensureBootstrap() {
    const apiRef = getApi();
    if (bootstrapPromise && bootstrapApi === apiRef) {
        return bootstrapPromise;
    }
    if (!apiRef) {
        return Promise.reject(new Error(I18n.t('error.apiUnavailable')));
    }
    bootstrapApi = apiRef;
    bootstrapPromise = resolveLocale().then(function (locale) {
        return apiRef.runOnBackend(Backend.beRun, [{
            action: 'bootstrap',
            labels: Model.LABELS,
            icons: Model.ICONS,
            version: Version.VERSION,
            lang: locale,
            panelWidth: panelWidth,
            strings: I18n.backendStrings(),
            seed: true,
            seedTools: Model.seedTools(),
            newToolNotes: Model.newToolNotes()
        }]);
    }).then(function (result) {
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

/**
 * Folder chain that groups a tool, outermost first: a tool in
 * Tools/Infrastructure/Wifi yields ['Infrastructure', 'Wifi']. The walk stops
 * at the Tools root, so the root itself never shows as a category; a note
 * moved outside that tree still reports the folders it actually sits in.
 */
function categoryPath(note, rootId) {
    const path = [];
    let current = note;
    for (let depth = 0; depth < 32; depth += 1) {
        let parents = [];
        try {
            parents = current && typeof current.getParentNotes === 'function'
                ? current.getParentNotes()
                : [];
        } catch (error) {
            parents = [];
        }
        const parent = Array.isArray(parents) && parents.length ? parents[0] : null;
        if (!parent) {
            break;
        }
        if (rootId && parent.noteId === rootId) {
            break;
        }
        path.unshift(String(parent.title || ''));
        current = parent;
    }
    return path;
}

async function refresh() {
    await ensureBootstrap();
    const apiRef = getApi();
    const notes = await apiRef.searchForNotes('#' + Model.LABELS.tool);
    const rootId = bootstrapInfo ? bootstrapInfo.toolsRootId : '';

    const nextIndex = [];
    const nextById = new Map();

    for (const note of notes) {
        const labels = readLabels(note);
        const path = categoryPath(note, rootId);
        const category = path.length ? path[path.length - 1] : '';
        const categoryLabel = path.join(' / ');

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

        const description = labels[Model.LABELS.description] || '';
        const base = labels[Model.LABELS.base] || Model.deriveBase(note.title);
        const entry = {
            noteId: note.noteId,
            title: note.title,
            category: category,
            categoryPath: path,
            categoryLabel: categoryLabel,
            labels: labels,
            note: note,
            whatIs: whatIs,
            optionSnapshots: optionSnapshots
        };

        nextById.set(note.noteId, entry);
        nextIndex.push({
            noteId: note.noteId,
            title: note.title,
            category: category,
            categoryPath: path,
            categoryLabel: categoryLabel,
            description: description,
            base: base,
            // Built once per refresh: search runs on every keystroke, and the
            // haystack comes from the same definition Model.searchableText feeds
            // to Model.matchesText.
            searchable: Model.searchableText({
                title: note.title,
                category: categoryLabel,
                description: description,
                tags: labels[Model.LABELS.tags],
                base: base,
                whatIs: whatIs,
                optionText: Model.optionNotesText(optionSnapshots)
            })
        });
    }

    index = nextIndex;
    entriesById = nextById;
    return index;
}

function search(query) {
    return index.filter(function (item) {
        return Model.matchesText(item.searchable, query);
    });
}

/**
 * Apply an option snapshot returned by the backend to the cached entry, so the
 * detail pane reflects a saved edit immediately instead of waiting for the
 * frontend entity cache to receive the backend change (or an F5 reload).
 */
function patchOptionSnapshot(noteId, saved) {
    if (!saved || saved.noteId !== noteId) {
        return;
    }
    entriesById.forEach(function (entry, entryId) {
        const snapshots = entry.optionSnapshots || [];
        let touched = false;
        for (let snapshotIndex = 0; snapshotIndex < snapshots.length; snapshotIndex += 1) {
            if (snapshots[snapshotIndex].noteId === noteId) {
                snapshots[snapshotIndex].title = saved.title;
                snapshots[snapshotIndex].labels = saved.labels || {};
                touched = true;
            }
        }
        if (!touched) {
            return;
        }
        const item = index.find(function (candidate) {
            return candidate.noteId === entryId;
        });
        if (item) {
            item.searchable = Model.searchableText({
                title: entry.title,
                category: entry.categoryLabel,
                description: entry.labels[Model.LABELS.description] || '',
                tags: entry.labels[Model.LABELS.tags],
                base: entry.labels[Model.LABELS.base] || Model.deriveBase(entry.title),
                whatIs: entry.whatIs,
                optionText: Model.optionNotesText(snapshots)
            });
        }
    });
}

function readPresetsContent(content) {
    let data = null;
    try {
        data = JSON.parse(String(content || ''));
    } catch (error) {
        return { presets: [], invalid: true };
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.presets)) {
        return { presets: [], invalid: true };
    }
    // One filter for every preset reader and writer: entries need a name,
    // values keep own primitive keys only (src/toolfile.js normalisePresets).
    return { presets: ToolFile.normalisePresets(data.presets), invalid: false };
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
        throw new Error(I18n.t('error.toolNotFound'));
    }
    const note = entry.note;
    const labels = entry.labels;

    let toolContent = '';
    try {
        toolContent = await note.getContent();
    } catch (error) {
        // The indexed note vanished (deleted from another tab or session).
        // Surface it instead of rendering a silently empty tool.
        throw new Error(I18n.t('error.toolReadFailed', { title: note.title }));
    }
    const parsed = Sections.parseToolNote(toolContent);

    const installNote = await standardChild(note, Model.LABELS.install, 'Install');
    const usageNote = await standardChild(note, Model.LABELS.usage, 'Usage');
    const helpNote = await standardChild(note, Model.LABELS.helpNote, 'Help');
    const optionsNote = await childWithLabel(note, Model.LABELS.options);
    const presetsNote = optionsNote ? await childWithLabel(optionsNote, Model.LABELS.presets) : null;

    const installHtml = await readRawContent(installNote);
    const installIsCode = Boolean(installNote && installNote.type === 'code');
    const installText = installIsCode ? installHtml : Parse.stripHtml(installHtml);
    const usageHtml = await readRawContent(usageNote);
    const helpText = await readNoteText(helpNote);
    const usageExamples = usageNote && usageNote.type === 'code'
        ? Sections.parseExampleLines(usageHtml)
        : Sections.parseExamples(usageHtml, labels[Model.LABELS.base] || Model.deriveBase(note.title));

    const definition = Model.buildTool({
        noteId: note.noteId,
        title: note.title,
        category: entry.category,
        categoryPath: entry.categoryPath,
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
        installHtml: installHtml,
        installIsCode: installIsCode,
        optionsFolderId: optionsNote ? optionsNote.noteId : null,
        presetsNoteId: presetsNote ? presetsNote.noteId : null,
        toolNotePath: toolNotePath
    };
}

async function readRawContent(note) {
    if (!note) {
        return '';
    }
    try {
        return String(await note.getContent() || '');
    } catch (error) {
        return '';
    }
}

/**
 * Read one tool into the portable file the palette writes to disk.
 * Raw note contents, the tool tags, the per-option note bodies and the
 * presets are kept, so the file carries everything it claims; preset value
 * keys bind to the original note IDs (see docs/guide.md: after import into a
 * different instance the stored values may not line up with recreated options).
 */
async function exportTool(noteId) {
    const entry = entriesById.get(noteId);
    if (!entry) {
        throw new Error(I18n.t('error.toolNotFound'));
    }
    const note = entry.note;
    const labels = entry.labels;

    const installNote = await standardChild(note, Model.LABELS.install, 'Install');
    const usageNote = await standardChild(note, Model.LABELS.usage, 'Usage');
    const helpNote = await standardChild(note, Model.LABELS.helpNote, 'Help');

    const optionsNote = await childWithLabel(note, Model.LABELS.options);
    const presetsNote = optionsNote ? await childWithLabel(optionsNote, Model.LABELS.presets) : null;
    const presetRead = presetsNote
        ? readPresetsContent(await readRawContent(presetsNote))
        : { presets: [] };

    const optionBodies = new Map();
    if (optionsNote) {
        const children = await optionsNote.getChildNotes();
        for (const child of children) {
            if (hasLabel(child, Model.LABELS.option)) {
                optionBodies.set(child.noteId, await readRawContent(child));
            }
        }
    }

    const definition = Model.buildTool({
        noteId: note.noteId,
        title: note.title,
        category: entry.category,
        labels: labels,
        optionNotes: entry.optionSnapshots
    });

    return ToolFile.buildToolFile({
        title: note.title,
        category: entry.category,
        categoryPath: entry.categoryPath,
        base: definition.base,
        description: definition.description,
        tags: labels[Model.LABELS.tags] || '',
        content: await readRawContent(note),
        install: await readRawContent(installNote),
        usage: await readRawContent(usageNote),
        help: await readRawContent(helpNote),
        options: definition.options.map(function (option) {
            return Object.assign({}, option, {
                content: optionBodies.has(option.noteId) ? optionBodies.get(option.noteId) : ''
            });
        }),
        presets: presetRead.presets
    });
}

async function copyText(text) {
    return Dom.copyText(text);
}

function insertText(text) {
    const apiRef = getApi();
    if (!apiRef || typeof apiRef.addTextToActiveContextEditor !== 'function') {
        throw new Error(I18n.t('error.insertUnsupported'));
    }
    apiRef.addTextToActiveContextEditor(text);
}

function backendAction(action, extra) {
    const apiRef = getApi();
    const params = Object.assign({
        action: action,
        labels: Model.LABELS,
        icons: Model.ICONS,
        strings: I18n.backendStrings()
    }, extra || {});
    return apiRef.runOnBackend(Backend.beRun, [params]);
}

function toolsRootId() {
    if (!bootstrapInfo || !bootstrapInfo.toolsRootId) {
        throw new Error(I18n.t('error.toolsRootUnavailable'));
    }
    return bootstrapInfo.toolsRootId;
}

async function setToolsRootAction(noteId) {
    // The backend sweeps #cmTools off every other note, so the caller no
    // longer needs to hand over the previous root.
    await backendAction('setToolsRoot', {
        noteId: noteId
    });
    bootstrapPromise = null;
    bootstrapInfo = null;
    index = [];
    entriesById = new Map();
    await refresh();
    return { noteId: noteId };
}

function versionParts(value) {
    return String(value == null ? '' : value)
        .replace(/^v/i, '')
        .split('.')
        .map(function (part) {
            return parseInt(part, 10) || 0;
        });
}

function compareVersions(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const delta = (a[index] || 0) - (b[index] || 0);
        if (delta !== 0) {
            return delta;
        }
    }
    return 0;
}

/**
 * One HTTP read with a bounded wait. `fetch` is absent on some Trilium builds,
 * and the callers turn that into a readable status instead of an exception.
 */
async function readUrl(url, kind) {
    const options = { headers: { Accept: kind === 'json' ? 'application/json' : 'text/plain' } };
    let timer = null;
    if (typeof AbortController === 'function') {
        const controller = new AbortController();
        options.signal = controller.signal;
        timer = setTimeout(function () {
            controller.abort();
        }, 10000);
    }
    try {
        const response = await fetch(url, options);
        if (!response || !response.ok) {
            throw new Error('HTTP ' + (response ? response.status : 'unknown'));
        }
        return kind === 'json' ? response.json() : response.text();
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

/**
 * Best-effort update check: the latest GitHub release, else the highest tag,
 * else the package.json version on the default branch. A private or unreachable
 * repository becomes a readable error.
 */
async function checkLatestVersion() {
    const result = { current: Version.VERSION, latest: '', outdated: false, error: '' };
    if (typeof fetch !== 'function') {
        result.error = I18n.t('error.updateCheckUnavailable');
        return result;
    }

    try {
        const release = await readUrl(Version.LATEST_RELEASE_API, 'json');
        const tag = release && (release.tag_name || release.name);
        if (tag) {
            result.latest = String(tag).replace(/^v/i, '');
            result.outdated = compareVersions(result.latest, result.current) > 0;
            return result;
        }
    } catch (error) {
        // no release yet; try tags
    }

    try {
        const tags = await readUrl(Version.LATEST_TAGS_API, 'json');
        if (Array.isArray(tags) && tags.length) {
            const names = tags
                .map(function (tag) {
                    return tag && tag.name ? String(tag.name).replace(/^v/i, '') : '';
                })
                .filter(function (name) {
                    return name !== '';
                });
            if (names.length) {
                names.sort(compareVersions);
                result.latest = names[names.length - 1];
                result.outdated = compareVersions(result.latest, result.current) > 0;
                return result;
            }
        }
    } catch (error) {
        // fall through to the default branch package.json
    }

    try {
        const text = String(await readUrl(Version.LATEST_RAW, 'text') || '');
        const match = /"version"\s*:\s*"([^"]+)"/.exec(text);
        if (match) {
            result.latest = match[1];
            result.outdated = compareVersions(result.latest, result.current) > 0;
            return result;
        }
        result.error = I18n.t('error.noPublishedVersion');
    } catch (error) {
        result.error = I18n.t('error.updateCheckFailed', {
            error: error && error.message ? error.message : error
        });
    }
    return result;
}

// --- automatic update check ------------------------------------------------
// The palette opens from the launcher, so that is when Trilium can look for
// updates without a background timer. The attempt and its result are remembered
// for a day (localStorage when the webview allows it), so a page reload keeps
// the banner without a second request, and the manual menu entry always
// bypasses the throttle.
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECKED_KEY = 'cmUpdateCheckedAt';
const MAX_BUNDLE_CHARS = 4 * 1024 * 1024;
const BUNDLE_MARKER = 'Command Maker - generated by tools/build.mjs';

let updateInfo = null;
let updateCheckedAt = 0;
let storedUpdate;
let updateCheckPromise = null;

/** Last stored check, or null when missing, unreadable or from another build. */
function readStoredUpdate() {
    try {
        if (typeof localStorage === 'undefined' || !localStorage) {
            return null;
        }
        const raw = localStorage.getItem(UPDATE_CHECKED_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        const at = Number(parsed && parsed.at);
        if (!isFinite(at) || at <= 0) {
            return null;
        }
        return {
            at: at,
            info: {
                current: String(parsed.current == null ? '' : parsed.current),
                latest: String(parsed.latest == null ? '' : parsed.latest),
                outdated: Boolean(parsed.outdated),
                error: String(parsed.error == null ? '' : parsed.error)
            }
        };
    } catch (error) {
        return null;
    }
}

function rememberUpdateCheck(info) {
    updateInfo = info;
    updateCheckedAt = Date.now();
    try {
        if (typeof localStorage !== 'undefined' && localStorage) {
            localStorage.setItem(UPDATE_CHECKED_KEY, JSON.stringify({
                at: updateCheckedAt,
                current: info.current,
                latest: info.latest,
                outdated: info.outdated,
                error: info.error || ''
            }));
        }
    } catch (error) {
        // A private window may refuse storage; the in-memory cache still holds.
    }
}

/** The manual check always looks again and refreshes the cached status. */
async function checkLatestVersionNow() {
    const info = await checkLatestVersion();
    rememberUpdateCheck(info);
    return info;
}

/** The stored result while it is under a day old and belongs to this build. */
function cachedUpdate() {
    let at = updateCheckedAt;
    let info = updateInfo;
    if (!info) {
        if (storedUpdate === undefined) {
            storedUpdate = readStoredUpdate();
        }
        if (!storedUpdate || storedUpdate.info.current !== Version.VERSION) {
            return null;
        }
        at = storedUpdate.at;
        info = storedUpdate.info;
        updateInfo = info;
        updateCheckedAt = at;
    }
    if (info.current !== Version.VERSION) {
        return null;
    }
    if (!at || (Date.now() - at) >= UPDATE_CHECK_INTERVAL_MS) {
        return null;
    }
    return info;
}

/**
 * Run the network check only when the last result is a day old. Startup and
 * every palette open call this; the first caller performs the request and the
 * others share the same promise.
 */
function checkUpdatesIfDue() {
    if (updateCheckPromise) {
        return updateCheckPromise;
    }
    const cached = cachedUpdate();
    if (cached) {
        return Promise.resolve(cached);
    }
    updateCheckPromise = checkLatestVersionNow().then(function (info) {
        updateCheckPromise = null;
        return info;
    }, function (error) {
        updateCheckPromise = null;
        throw error;
    });
    return updateCheckPromise;
}

function bundleVersion(text) {
    const match = /const VERSION = '([^']+)';/.exec(String(text || ''));
    return match ? match[1] : '';
}

/**
 * Download the bundle published for `version` and refuse anything that is not
 * that exact build: the file is about to replace the running plugin note, so a
 * stale, truncated or unrelated response must never be written.
 */
async function downloadBundle(version) {
    if (typeof fetch !== 'function') {
        throw new Error(I18n.t('error.updateCheckUnavailable'));
    }
    const tagUrl = Version.bundleUrl(version);
    let text = '';
    try {
        text = String(await readUrl(tagUrl, 'text') || '');
    } catch (error) {
        // The fallback only exists for a version announced through package.json
        // on the default branch, where no tag exists yet. The version marker is
        // still checked, so a newer branch can never slip in unannounced.
        if (tagUrl === Version.BUNDLE_MAIN) {
            throw error;
        }
        text = String(await readUrl(Version.BUNDLE_MAIN, 'text') || '');
    }
    if (text === '') {
        throw new Error(I18n.t('error.updateNotABundle'));
    }
    if (text.length > MAX_BUNDLE_CHARS) {
        throw new Error(I18n.t('error.updateBundleTooLarge'));
    }
    if (text.indexOf(BUNDLE_MARKER) === -1 || text.indexOf('function __def(') === -1) {
        throw new Error(I18n.t('error.updateNotABundle'));
    }
    const found = bundleVersion(text);
    if (compareVersions(found, version) !== 0) {
        throw new Error(I18n.t('error.updateBundleMismatch', {
            expected: String(version).replace(/^v/i, ''),
            found: found || '?'
        }));
    }
    return text;
}

function canReloadPage() {
    try {
        if (typeof window !== 'undefined' && window && window.location && typeof window.location.reload === 'function') {
            return true;
        }
    } catch (error) {
        // fall through to the Trilium api
    }
    try {
        const apiRef = getApi();
        return Boolean(apiRef && typeof apiRef.reload === 'function');
    } catch (error) {
        return false;
    }
}

function reloadPage() {
    try {
        if (typeof window !== 'undefined' && window && window.location && typeof window.location.reload === 'function') {
            window.location.reload();
            return true;
        }
    } catch (error) {
        // fall through to the Trilium api
    }
    try {
        const apiRef = getApi();
        if (apiRef && typeof apiRef.reload === 'function') {
            apiRef.reload();
            return true;
        }
    } catch (error) {
        // the caller tells the user to reload by hand
    }
    return false;
}

/**
 * Install the update the last check found: fetch the matching bundle, write it
 * into the plugin note through the backend and refresh the page so the new
 * script runs. Nothing here runs unless the user presses the update button.
 */
async function installUpdate() {
    const info = updateInfo;
    if (!info || !info.outdated || !info.latest) {
        throw new Error(I18n.t('error.noUpdateAvailable'));
    }
    const bundle = await downloadBundle(info.latest);
    const installed = await backendAction('applyBundle', {
        bundle: bundle,
        version: info.latest
    });
    const version = installed && installed.version ? installed.version : info.latest;
    rememberUpdateCheck({ current: version, latest: version, outdated: false, error: '' });
    const reloading = canReloadPage();
    if (reloading) {
        setTimeout(reloadPage, 1500);
    }
    return { noteId: installed ? installed.noteId : '', version: version, reloading: reloading };
}

/**
 * In a Render Note, Trilium executes the JS child with `api.$container` set to
 * the rendered note content. The HTML wrapper carries `.cm-tab-root`, so the
 * palette mounts inside the tab instead of as an overlay. A launcher script has
 * no rendered container and falls through to the normal overlay.
 */
function embeddedHost(apiRef) {
    if (!apiRef || !apiRef.$container) {
        return null;
    }
    try {
        const container = apiRef.$container;
        if (typeof container.find !== 'function') {
            return null;
        }
        const marked = container.find('.cm-tab-root');
        const node = marked && marked.length ? marked[0] : null;
        return node && typeof node.appendChild === 'function' ? node : null;
    } catch (error) {
        return null;
    }
}

async function openInTab() {
    const apiRef = getApi();
    if (!apiRef) {
        throw new Error(I18n.t('error.apiUnavailable'));
    }
    const info = await ensureBootstrap();
    if (!info || !info.rootId) {
        throw new Error(I18n.t('error.notReady'));
    }
    const scriptNote = apiRef.startNote;
    if (!scriptNote || !scriptNote.noteId) {
        throw new Error(I18n.t('error.pluginNoteMissing'));
    }
    const result = await backendAction('ensureTab', {
        rootId: info.rootId,
        scriptNoteId: scriptNote.noteId
    });
    if (typeof apiRef.openTabWithNote !== 'function') {
        throw new Error(I18n.t('error.tabUnsupported'));
    }
    if (typeof apiRef.waitUntilSynced === 'function') {
        await apiRef.waitUntilSynced();
    }
    await apiRef.openTabWithNote(result.tabNoteId, true);
    return result.tabNoteId;
}

function controller() {
    return {
        refresh: refresh,
        search: search,
        load: load,
        copy: copyText,
        insert: insertText,
        version() {
            return Version.VERSION;
        },
        repository() {
            return Version.REPOSITORY;
        },
        checkLatestVersion: checkLatestVersionNow,
        /** Run the throttled daily check; resolves to the cached status. */
        checkUpdatesIfDue: checkUpdatesIfDue,
        /** Download and write the bundle the last check found. */
        installUpdate: installUpdate,

        /** Surface a message in the Trilium UI; the footer keeps its own copy. */
        message(text) {
            try {
                const apiRef = getApi();
                if (apiRef && typeof apiRef.showMessage === 'function') {
                    apiRef.showMessage(String(text));
                }
            } catch (error) {
                // the footer status is the fallback
            }
        },

        error(text) {
            try {
                const apiRef = getApi();
                if (apiRef && typeof apiRef.showError === 'function') {
                    apiRef.showError('Command Maker: ' + String(text));
                }
            } catch (error) {
                // the footer status is the fallback
            }
        },

        categories() {
            const seen = new Map();
            for (const item of index) {
                if (item.categoryLabel && item.categoryPath && item.categoryPath.length) {
                    if (!seen.has(item.categoryLabel)) {
                        seen.set(item.categoryLabel, item.categoryPath.slice());
                    }
                }
            }
            return Array.from(seen.keys()).sort().map(function (label) {
                return { label: label, path: seen.get(label) };
            });
        },

        async createTool(spec) {
            const safe = spec || {};
            const categoryPath = Array.isArray(safe.categoryPath)
                ? safe.categoryPath
                    .map(function (segment) {
                        return String(segment).trim();
                    })
                    .filter(function (segment) {
                        return segment !== '';
                    })
                : [];
            const notes = Model.newToolNotes();
            const created = await backendAction('createTool', {
                toolsRootId: toolsRootId(),
                category: safe.category || (categoryPath.length ? categoryPath[categoryPath.length - 1] : ''),
                categoryPath: categoryPath,
                title: safe.title,
                base: spec.base,
                description: spec.description,
                content: notes.content,
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

        async updateOption(noteId, option) {
            const saved = await backendAction('updateOption', { noteId: noteId, option: option });
            patchOptionSnapshot(noteId, saved);
            return saved;
        },

        reorderOptions(order) {
            return backendAction('reorderOptions', { order: order || [] });
        },

        exportTool(noteId) {
            return exportTool(noteId);
        },

        async importTool(tool) {
            const created = await backendAction('importTool', {
                toolsRootId: toolsRootId(),
                tool: tool,
                newToolNotes: Model.newToolNotes()
            });
            await refresh();
            return created;
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

        async currentToolsRoot() {
            const root = await resolveToolsRoot();
            return root ? { noteId: root.noteId, title: root.title } : null;
        },

        setToolsRoot(noteId) {
            return setToolsRootAction(noteId);
        },

        /**
         * Persist the language on the settings note and activate it. The UI
         * remounts after this resolves, so every new string is localized.
         */
        async setLanguage(locale) {
            const normalized = I18n.normalizeLocale(locale) || I18n.DEFAULT_LOCALE;
            const previous = I18n.getLocale();
            // Switch first: the backend action carries the strings it needs and
            // the UI remounts only after the write succeeds.
            I18n.setLocale(normalized);
            try {
                const info = await ensureBootstrap();
                await backendAction('setLanguage', { rootId: info.rootId, lang: normalized });
            } catch (error) {
                I18n.setLocale(previous);
                throw error;
            }
            return normalized;
        },

        language() {
            return I18n.getLocale();
        },

        /** Active overlay width percentage; the palette applies it on mount. */
        panelWidth() {
            return panelWidth;
        },

        /**
         * Persist the overlay width on the settings note and remember it, so a
         * remount (language switch) keeps the chosen percentage.
         */
        async setPanelWidth(percent) {
            const value = Model.normalizePanelWidth(percent);
            const info = await ensureBootstrap();
            await backendAction('setPanelWidth', {
                rootId: info.rootId,
                width: value,
                min: Model.PANEL_WIDTH_MIN,
                max: Model.PANEL_WIDTH_MAX
            });
            panelWidth = value;
            return value;
        },

        async useActiveNoteAsToolsRoot() {
            const apiRef = getApi();
            const active = apiRef.getActiveContextNote();
            if (!active) {
                throw new Error(I18n.t('error.noActiveNoteForTools'));
            }
            return setToolsRootAction(active.noteId);
        },

        async activeNoteText() {
            const apiRef = getApi();
            const active = apiRef.getActiveContextNote();
            if (!active) {
                throw new Error(I18n.t('error.noActiveNote'));
            }
            const text = await readNoteText(active);
            return { noteId: active.noteId, title: active.title, text: text };
        },

        async openNote(noteId) {
            const apiRef = getApi();
            const note = await apiRef.getNote(noteId);
            if (!note) {
                throw new Error(I18n.t('error.noteNotFound', { id: noteId }));
            }
            return apiRef.activateNote(note.getBestNotePathString());
        },

        openInTab: openInTab
    };
}

function start() {
    const apiRef = getApi();
    if (!apiRef) {
        console.error('[command-maker] Trilium api is not available.');
        return;
    }
    const host = embeddedHost(apiRef);
    const paletteOptions = host ? { container: host } : undefined;

    function mount() {
        try {
            UI.openPalette(controller(), paletteOptions);
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

    // The locale and the panel width come from note labels, so both are resolved
    // before the first mount: every label the palette builds is already in the
    // right language and the overlay opens at the saved width. A failed lookup
    // still opens the palette with the detected language and default width.
    Promise.all([
        resolveLocale().catch(function () {
            return I18n.getLocale();
        }),
        resolvePanelWidth().catch(function () {
            return panelWidth;
        })
    ]).then(mount);
}

module.exports = { start, controller, refresh, search, load };