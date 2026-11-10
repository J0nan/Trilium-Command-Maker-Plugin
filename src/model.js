'use strict';

/**
 * Turns a plain tool snapshot into a command definition.
 * Pure: the runtime reads FNote objects and passes
 * { noteId, title, category, content, labels, optionNotes, examples } snapshots.
 *
 * A tool definition looks like:
 * {
 *   noteId, title, category, categoryPath, categoryLabel,
 *   description, tags, base,
 *   options: [ option, ... ],
 *   inferred: [ option, ... ],
 *   placeholders: [ name, ... ],
 *   warnings: [ { code, message } ]
 * }
 *
 * `category` is the immediate folder that groups the tool; `categoryPath` is
 * the folder chain from Tools down to it, and `categoryLabel` that chain as
 * one display string ("Infrastructure / Wifi").
 */

const Render = require('./render');
const I18n = require('./i18n');

const LABELS = {
    // structure
    root: 'cmRoot',
    tools: 'cmTools',
    category: 'cmCategory',
    tool: 'cmTool',
    install: 'cmInstall',
    usage: 'cmUsage',
    helpNote: 'cmHelpNote',
    options: 'cmOptions',
    option: 'cmOption',
    presets: 'cmPresets',
    tab: 'cmTab',
    tabHtml: 'cmTabHtml',
    // tool metadata
    description: 'cmDesc',
    tags: 'cmTags',
    base: 'cmBase',
    // option metadata
    flag: 'cmFlag',
    mode: 'cmMode',
    placeholder: 'cmPlaceholder',
    type: 'cmType',
    enumValues: 'cmValues',
    defaultValue: 'cmDefault',
    required: 'cmRequired',
    order: 'cmOrder',
    quote: 'cmQuote',
    separator: 'cmSep',
    doc: 'cmDoc',
    // bookkeeping
    seeded: 'cmSeeded',
    managed: 'cmManaged',
    version: 'cmVersion',
    plugin: 'cmPlugin',
    // note presentation
    icon: 'iconClass',
    // settings
    lang: 'cmLang',
    panelWidth: 'cmPanelWidth',
};

const LABEL_NAMES = Object.keys(LABELS).map(function (key) {
    return LABELS[key];
});

// Overlay panel width, stored as a percentage of the window. Shared by the
// runtime (read/write), the palette menu (slider) and the backend (clamp).
const PANEL_WIDTH_MIN = 30;
const PANEL_WIDTH_MAX = 100;
const PANEL_WIDTH_DEFAULT = 70;

function normalizePanelWidth(value) {
    const parsed = Math.round(Number(value));
    if (!isFinite(parsed)) {
        return PANEL_WIDTH_DEFAULT;
    }
    if (parsed < PANEL_WIDTH_MIN) {
        return PANEL_WIDTH_MIN;
    }
    if (parsed > PANEL_WIDTH_MAX) {
        return PANEL_WIDTH_MAX;
    }
    return parsed;
}

const TYPES = ['string', 'path', 'number', 'boolean', 'enum'];
const QUOTES = ['none', 'single', 'double'];

/** Boxicons classes for the standard child notes. */
const ICONS = {
    install: 'bx bx-download',
    usage: 'bx bx-terminal',
    help: 'bx bx-help-circle',
    options: 'bx bx-cog'
};

function readString(labels, name, fallback) {
    const value = labels ? labels[name] : undefined;
    return value === undefined || value === null ? fallback : String(value);
}

function readBool(labels, name, fallback) {
    const value = labels ? labels[name] : undefined;
    if (value === undefined || value === null) {
        return fallback;
    }
    return ['true', '1', 'yes', 'on'].indexOf(String(value).trim().toLowerCase()) !== -1;
}

function readNumber(labels, name, fallback) {
    const value = labels ? labels[name] : undefined;
    if (value === undefined || value === null || String(value).trim() === '') {
        return fallback;
    }
    const parsed = Number(value);
    return isFinite(parsed) ? parsed : fallback;
}

function splitValues(value) {
    return String(value == null ? '' : value)
        .split(',')
        .map(function (entry) {
            return entry.trim();
        })
        .filter(function (entry) {
            return entry !== '';
        });
}

/** Default command name for a tool note: its title, safely lowercased. */
function deriveBase(title) {
    return String(title == null ? '' : title)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._+\- ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function optionPlaceholder(snapshot, flag, title) {
    const explicit = readString(snapshot.labels, LABELS.placeholder, '');
    if (explicit.trim() !== '') {
        return explicit.trim();
    }
    const fromFlag = String(flag || '').replace(/^-+/, '');
    return Render.slugify(fromFlag !== '' ? fromFlag : title);
}

function optionFromNote(note) {
    const snapshot = note || {};
    const labels = snapshot.labels || {};
    const title = String(snapshot.title || '');

    let type = readString(labels, LABELS.type, 'string').trim().toLowerCase();
    if (TYPES.indexOf(type) === -1) {
        type = 'string';
    }

    let quote = readString(labels, LABELS.quote, 'none').trim().toLowerCase();
    if (QUOTES.indexOf(quote) === -1) {
        quote = 'none';
    }

    const enumValues = splitValues(readString(labels, LABELS.enumValues, ''));

    const rawDefault = labels[LABELS.defaultValue];
    const defaultValue = rawDefault === undefined || rawDefault === null
        ? (type === 'boolean' ? false : '')
        : String(rawDefault);

    const flag = readString(labels, LABELS.flag, '');

    return {
        noteId: snapshot.noteId || null,
        title: title,
        help: readString(labels, LABELS.doc, '').trim(),
        placeholder: optionPlaceholder(snapshot, flag, title),
        flag: flag,
        mode: readString(labels, LABELS.mode, 'flag').trim().toLowerCase() === 'inline' ? 'inline' : 'flag',
        type: type,
        enumValues: enumValues,
        defaultValue: defaultValue,
        required: readBool(labels, LABELS.required, false),
        order: readNumber(labels, LABELS.order, 100),
        quote: quote,
        sep: readString(labels, LABELS.separator, ' ').trim() === '=' ? '=' : ' '
    };
}

function sortOptions(left, right) {
    return Render.compareOptions(left, right);
}

/**
 * Sequential #cmOrder values for an option list already in command order.
 * Only note-backed options can be persisted; inferred placeholders have no
 * note to label. Ten-point gaps leave room for a manual #cmOrder later.
 */
function orderPlan(options) {
    const plan = [];
    (Array.isArray(options) ? options : []).forEach(function (option) {
        if (option && option.noteId) {
            plan.push({ noteId: option.noteId, order: (plan.length + 1) * 10 });
        }
    });
    return plan;
}

/** New order plan after moving one option to a position in command order. */
function reorderPlan(options, noteId, targetIndex) {
    const noteOptions = (Array.isArray(options) ? options : []).filter(function (option) {
        return option && option.noteId;
    });
    const from = noteOptions.findIndex(function (option) {
        return option.noteId === noteId;
    });
    if (from === -1) {
        return [];
    }
    const ordered = noteOptions.slice();
    const moved = ordered.splice(from, 1)[0];
    const parsed = Number(targetIndex);
    const target = isFinite(parsed) ? Math.max(0, Math.min(ordered.length, parsed)) : ordered.length;
    ordered.splice(target, 0, moved);
    return orderPlan(ordered);
}

function buildTool(note) {
    const snapshot = note || {};
    const labels = snapshot.labels || {};
    // Folders may nest (Tools/Infrastructure/Wifi), so a tool keeps the whole
    // chain: `category` stays the immediate folder for creation and export,
    // while `categoryPath`/`categoryLabel` are what the palette shows.
    const categoryPath = Array.isArray(snapshot.categoryPath)
        ? snapshot.categoryPath
            .map(function (part) {
                return String(part);
            })
            .filter(function (part) {
                return part !== '';
            })
        : [];
    const category = String(snapshot.category || '');

    const configuredBase = labels[LABELS.base];
    const base = configuredBase !== undefined && configuredBase !== null && String(configuredBase).trim() !== ''
        ? String(configuredBase)
        : deriveBase(snapshot.title);

    const optionNotes = Array.isArray(snapshot.optionNotes) ? snapshot.optionNotes : [];
    const options = optionNotes.map(optionFromNote).sort(sortOptions);

    const warnings = [];
    // Placeholders and flags come from note labels, so the maps must not inherit
    // Object.prototype: a `__proto__` name would otherwise be treated as a duplicate.
    const byPlaceholder = new Map();
    for (const option of options) {
        if (!option.placeholder) {
            warnings.push({
                code: 'missing-placeholder-name',
                message: I18n.t('warn.missingPlaceholderName', { title: option.title })
            });
            continue;
        }
        if (byPlaceholder.has(option.placeholder)) {
            warnings.push({
                code: 'duplicate-placeholder',
                message: I18n.t('warn.duplicatePlaceholder', { name: option.placeholder })
            });
            continue;
        }
        byPlaceholder.set(option.placeholder, option);
    }

    const byFlag = new Set();
    for (const option of options) {
        if (!option.flag) {
            continue;
        }
        if (byFlag.has(option.flag)) {
            warnings.push({
                code: 'duplicate-flag',
                message: I18n.t('warn.duplicateFlag', { flag: option.flag })
            });
            continue;
        }
        byFlag.add(option.flag);
    }

    const declared = Render.placeholderNames(base);
    const inferred = declared
        .filter(function (name) {
            return !byPlaceholder.has(name);
        })
        .map(function (name) {
            return {
                noteId: null,
                title: name,
                help: '',
                placeholder: name,
                flag: '',
                mode: 'inline',
                type: 'string',
                enumValues: [],
                defaultValue: '',
                required: true,
                order: 0,
                quote: 'none',
                sep: ' ',
                inferred: true
            };
        });

    return {
        noteId: snapshot.noteId || '',
        title: String(snapshot.title || ''),
        category: category,
        categoryPath: categoryPath,
        categoryLabel: categoryPath.length ? categoryPath.join(' / ') : category,
        description: readString(labels, LABELS.description, ''),
        tags: readString(labels, LABELS.tags, ''),
        base: base,
        options: options,
        inferred: inferred,
        placeholders: declared,
        warnings: warnings,
        examples: Array.isArray(snapshot.examples) ? snapshot.examples.slice() : [],
        searchText: String(snapshot.searchText || '')
    };
}

/** Split a shell-ish command into tokens, keeping quoted values together. */
function tokenizeCommand(command) {
    const tokens = [];
    let current = '';
    let quote = '';
    let escaped = false;
    const text = String(command == null ? '' : command);
    for (let index = 0; index < text.length; index += 1) {
        const char = text.charAt(index);
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (quote !== '') {
            if (char === quote) {
                quote = '';
            } else {
                current += char;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current !== '') {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += char;
    }
    if (current !== '') {
        tokens.push(current);
    }
    return tokens;
}

/**
 * Turn a rendered example back into a value map for the palette form.
 * Known flags are matched, and unconsumed tokens fill positional options in
 * order. Subcommands and placeholders stay in the example preview.
 */
function valuesFromExample(definition, command) {
    const safe = definition || {};
    const options = Array.isArray(safe.options) ? safe.options : [];
    const inferred = Array.isArray(safe.inferred) ? safe.inferred : [];
    const values = {};
    for (const option of options) {
        values[Render.valueKey(option)] = option.type === 'boolean' ? false : '';
    }
    for (const option of inferred) {
        values[Render.valueKey(option)] = '';
    }
    values[Render.EXTRA_KEY] = '';

    let tokens = tokenizeCommand(command);
    const base = String(safe.base == null ? '' : safe.base);
    const canMapPositionals = base.indexOf('{{') === -1;
    if (canMapPositionals) {
        const baseTokens = tokenizeCommand(base);
        let matches = baseTokens.length > 0 && baseTokens.length <= tokens.length;
        for (let index = 0; matches && index < baseTokens.length; index += 1) {
            if (tokens[index] !== baseTokens[index]) {
                matches = false;
            }
        }
        if (matches) {
            tokens = tokens.slice(baseTokens.length);
        }
    }

    // A Map, like every other flag-keyed structure in this file: a tool file
    // can carry a literal "__proto__" flag, and a plain object would let that
    // key replace the map's prototype instead of becoming an entry.
    const byFlag = new Map();
    for (const option of options) {
        if (option.flag) {
            byFlag.set(option.flag, option);
        }
    }

    const positionals = [];
    let unknownFlag = false;
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === '') {
            continue;
        }
        if (token.charAt(0) !== '-' || token.length < 2) {
            positionals.push(token);
            continue;
        }
        let flag = token;
        let inlineValue = null;
        const equals = token.indexOf('=');
        if (token.slice(0, 2) === '--' && equals > 2) {
            flag = token.slice(0, equals);
            inlineValue = token.slice(equals + 1);
        }
        const option = byFlag.get(flag);
        if (!option) {
            unknownFlag = true;
            continue;
        }
        const key = Render.valueKey(option);
        if (option.type === 'boolean') {
            values[key] = true;
            continue;
        }
        if (inlineValue !== null) {
            values[key] = inlineValue;
            continue;
        }
        const next = tokens[index + 1];
        const nextIsKnownFlag = next !== undefined && next.charAt(0) === '-' && next.length > 1 && byFlag.get(next);
        if (next !== undefined && !nextIsKnownFlag) {
            values[key] = next;
            index += 1;
        }
    }

    if (!unknownFlag && canMapPositionals && positionals.length) {
        const positionalOptions = options.filter(function (option) {
            return !option.flag && option.mode !== 'inline';
        });
        for (let index = 0; index < positionalOptions.length && index < positionals.length; index += 1) {
            values[Render.valueKey(positionalOptions[index])] = positionals[index];
        }
    }

    return values;
}

function defaultValueMap(definition) {
    const values = {};
    const safeDefinition = definition || {};
    values[Render.EXTRA_KEY] = '';
    for (const option of safeDefinition.options || []) {
        values[Render.valueKey(option)] = option.defaultValue;
    }
    for (const option of safeDefinition.inferred || []) {
        values[Render.valueKey(option)] = '';
    }
    return values;
}

/** Search text for raw option snapshots, used while indexing a tool tree. */
function optionNotesText(snapshots) {
    return (snapshots || []).map(function (snapshot) {
        const labels = (snapshot && snapshot.labels) || {};
        return [
            snapshot ? snapshot.title : '',
            labels[LABELS.flag],
            labels[LABELS.doc],
            labels[LABELS.enumValues]
        ].join(' ');
    }).join(' ');
}

/**
 * Everything a tool can be found by. One definition on purpose: the index and
 * `matchesText` over this haystack must never disagree about what is searchable.
 */
function searchableText(snapshot) {
    const safe = snapshot || {};
    const optionText = safe.optionText
        || (safe.options || []).map(function (option) {
            return [option.title, option.flag, option.help, (option.enumValues || []).join(' ')].join(' ');
        }).join(' ');
    return [
        safe.title,
        safe.category,
        safe.description,
        safe.tags,
        safe.base,
        safe.whatIs,
        optionText,
        (safe.optionTitles || []).join(' '),
        (safe.examples || []).join(' '),
        safe.searchText
    ].join(' ');
}

/** True when every whitespace-separated query term appears in the haystack. */
function matchesText(haystack, query) {
    const needle = String(query == null ? '' : query).trim().toLowerCase();
    if (needle === '') {
        return true;
    }
    const text = String(haystack == null ? '' : haystack).toLowerCase();
    return needle.split(/\s+/).every(function (term) {
        return text.indexOf(term) !== -1;
    });
}

/** Content template for a new tool note: exactly the three H2 sections. */
function toolTemplate() {
    return I18n.t('model.toolTemplate');
}

/** Starting content for the three standard child notes plus the tool body. */
function newToolNotes() {
    return {
        content: toolTemplate(),
        install: I18n.t('model.installTemplate'),
        usage: I18n.t('model.usageTemplate'),
        help: ''
    };
}

function seedTools() {
    const heading = {
        whatIs: I18n.t('model.headingWhatIs'),
        official: I18n.t('model.headingOfficial'),
        useful: I18n.t('model.headingUseful')
    };
    return [
        {
            category: I18n.t('model.categoryVersionControl'),
            title: 'git commit',
            base: 'git commit',
            description: I18n.t('model.gitDescription'),
            content: [
                '<h2>' + heading.whatIs + '</h2>',
                '<p>' + I18n.t('model.gitWhatIs') + '</p>',
                '<h2>' + heading.official + '</h2>',
                '<ul><li><a href="https://git-scm.com/docs/git-commit">' + I18n.t('model.gitOfficial') + '</a></li></ul>',
                '<h2>' + heading.useful + '</h2>',
                '<ul><li><a href="https://www.conventionalcommits.org/">' + I18n.t('model.gitUseful') + '</a></li></ul>'
            ].join('\n'),
            install: '<p><strong>Windows:</strong> <code>winget install Git.Git</code></p><p><strong>macOS:</strong> <code>brew install git</code></p><p><strong>Debian/Ubuntu:</strong> <code>sudo apt install git</code></p>',
            usage: [
                '<p>' + I18n.t('model.gitCommitExample') + '</p>',
                '<pre><code>git commit -m "fix: handle empty input"</code></pre>',
                '<p>' + I18n.t('model.gitAddAllExample') + '</p>',
                '<pre><code>git commit -am "chore: update dependencies"</code></pre>',
                '<p>' + I18n.t('model.gitAmendExample') + '</p>',
                '<pre><code>git commit --amend --no-edit</code></pre>'
            ].join('\n'),
            help: [
                'usage: git commit [-a | --interactive | --patch] [-s] [-v] [-u<mode>] [--amend]',
                '                  [--dry-run] [(-c | -C | --squash) <commit> | --fixup [(amend|reword):]<commit>]',
                '                  [-F <file> | -m <msg>] [--reset-author] [--allow-empty]',
                '',
                '    -m, --message <message>  use the given message as the commit message',
                '    -a, --all                commit all changed files',
                '    --amend                  amend the previous commit',
                '    --allow-empty            allow recording an empty commit',
                '    --no-verify              bypass the pre-commit and commit-msg hooks',
                '    --author <author>        override the author'
            ].join('\n'),
            options: [
                { label: I18n.t('model.gitOptionMessageLabel'), flag: '-m', type: 'string', doc: I18n.t('model.gitOptionMessage'), order: 10, required: true },
                { label: I18n.t('model.gitOptionAllLabel'), flag: '-a', type: 'boolean', doc: I18n.t('model.gitOptionAll'), order: 20 },
                { label: I18n.t('model.gitOptionAmendLabel'), flag: '--amend', type: 'boolean', doc: I18n.t('model.gitOptionAmend'), order: 30 },
                { label: I18n.t('model.gitOptionEmptyLabel'), flag: '--allow-empty', type: 'boolean', doc: I18n.t('model.gitOptionEmpty'), order: 40 },
                { label: I18n.t('model.gitOptionHooksLabel'), flag: '--no-verify', type: 'boolean', doc: I18n.t('model.gitOptionHooks'), order: 50 },
                { label: I18n.t('model.gitOptionAuthorLabel'), flag: '--author', type: 'string', doc: I18n.t('model.gitOptionAuthor'), order: 60 },
                { label: I18n.t('model.gitOptionDateLabel'), flag: '--date', type: 'string', doc: I18n.t('model.gitOptionDate'), order: 70 }
            ]
        },
        {
            category: I18n.t('model.categoryNetwork'),
            title: 'curl',
            base: 'curl',
            description: I18n.t('model.curlDescription'),
            content: [
                '<h2>' + heading.whatIs + '</h2>',
                '<p>' + I18n.t('model.curlWhatIs') + '</p>',
                '<h2>' + heading.official + '</h2>',
                '<ul><li><a href="https://curl.se/docs/">' + I18n.t('model.curlOfficial') + '</a></li></ul>',
                '<h2>' + heading.useful + '</h2>',
                '<ul><li><a href="https://curl.se/docs/manpage.html">' + I18n.t('model.curlUseful') + '</a></li></ul>'
            ].join('\n'),
            install: '<p><strong>Windows:</strong> <code>winget install curl.curl</code></p><p><strong>macOS:</strong> <code>brew install curl</code></p><p><strong>Debian/Ubuntu:</strong> <code>sudo apt install curl</code></p>',
            usage: [
                '<p>' + I18n.t('model.curlPostExample') + '</p>',
                '<pre><code>curl -X POST -H "Content-Type: application/json" -d "{\\"name\\":\\"value\\"}" https://api.example.com/items</code></pre>',
                '<p>' + I18n.t('model.curlDownloadExample') + '</p>',
                '<pre><code>curl -L -o file.zip https://example.com/file.zip</code></pre>',
                '<p>' + I18n.t('model.curlHeadersExample') + '</p>',
                '<pre><code>curl -sSI https://example.com</code></pre>'
            ].join('\n'),
            help: [
                'Usage: curl [options...] <url>',
                '',
                ' -X, --request <method>      specify request method to use',
                ' -H, --header <header/@file> pass custom header(s) to server',
                ' -d, --data <data>           HTTP POST data',
                ' -o, --output <file>         write to file instead of stdout',
                ' -L, --location              follow redirects',
                ' -s, --silent                silent mode',
                ' -u, --user <user:password>  server user and password',
                '     --compressed            request compressed response',
                ' -k, --insecure              allow insecure server connections'
            ].join('\n'),
            options: [
                { label: I18n.t('model.curlOptionRequestLabel'), flag: '-X', type: 'enum', values: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], doc: I18n.t('model.curlOptionRequest'), order: 10 },
                { label: I18n.t('model.curlOptionHeaderLabel'), flag: '-H', type: 'string', doc: I18n.t('model.curlOptionHeader'), order: 20 },
                { label: I18n.t('model.curlOptionDataLabel'), flag: '-d', type: 'string', doc: I18n.t('model.curlOptionData'), order: 30 },
                { label: I18n.t('model.curlOptionOutputLabel'), flag: '-o', type: 'path', doc: I18n.t('model.curlOptionOutput'), order: 40 },
                { label: I18n.t('model.curlOptionFollowLabel'), flag: '-L', type: 'boolean', doc: I18n.t('model.curlOptionFollow'), order: 50 },
                { label: I18n.t('model.curlOptionSilentLabel'), flag: '-s', type: 'boolean', doc: I18n.t('model.curlOptionSilent'), order: 60 },
                { label: I18n.t('model.curlOptionCompressedLabel'), flag: '--compressed', type: 'boolean', doc: I18n.t('model.curlOptionCompressed'), order: 70 },
                { label: I18n.t('model.curlOptionUserLabel'), flag: '-u', type: 'string', doc: I18n.t('model.curlOptionUser'), order: 80 },
                { label: I18n.t('model.curlOptionInsecureLabel'), flag: '-k', type: 'boolean', doc: I18n.t('model.curlOptionInsecure'), order: 90 },
                { label: I18n.t('model.curlOptionUrlLabel'), flag: '', type: 'string', placeholder: 'url', quote: 'double', doc: I18n.t('model.curlOptionUrl'), order: 100, required: true }
            ]
        }
    ];
}

module.exports = {
    LABELS,
    LABEL_NAMES,
    TYPES,
    QUOTES,
    ICONS,
    PANEL_WIDTH_MIN,
    PANEL_WIDTH_MAX,
    PANEL_WIDTH_DEFAULT,
    normalizePanelWidth,
    EXTRA_KEY: Render.EXTRA_KEY,
    deriveBase,
    optionFromNote,
    sortOptions,
    orderPlan,
    reorderPlan,
    buildTool,
    defaultValueMap,
    valuesFromExample,
    tokenizeCommand,
    matchesText,
    searchableText,
    optionNotesText,
    toolTemplate,
    newToolNotes,
    seedTools
};