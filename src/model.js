'use strict';

/**
 * Turns a plain tool snapshot into a command definition.
 * Pure: the runtime reads FNote objects and passes
 * { noteId, title, category, content, labels, optionNotes, examples } snapshots.
 *
 * A tool definition looks like:
 * {
 *   noteId, title, category, description, tags, base,
 *   options: [ option, ... ],
 *   inferred: [ option, ... ],
 *   placeholders: [ name, ... ],
 *   warnings: [ { code, message } ]
 * }
 */

const Render = require('./render');

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
    // note presentation
    icon: 'iconClass',
};

const LABEL_NAMES = Object.keys(LABELS).map(function (key) {
    return LABELS[key];
});

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

function buildTool(note) {
    const snapshot = note || {};
    const labels = snapshot.labels || {};

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
                message: 'Option "' + option.title + '" has an empty placeholder name.'
            });
            continue;
        }
        if (byPlaceholder.has(option.placeholder)) {
            warnings.push({
                code: 'duplicate-placeholder',
                message: 'Two options share the placeholder "' + option.placeholder + '"; the first one wins.'
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
                message: 'Two options use the flag "' + option.flag + '"; the command will repeat it.'
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
        category: String(snapshot.category || ''),
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

    const byFlag = {};
    for (const option of options) {
        if (option.flag) {
            byFlag[option.flag] = option;
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
        const option = byFlag[flag];
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
        const nextIsKnownFlag = next !== undefined && next.charAt(0) === '-' && next.length > 1 && byFlag[next];
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
 * `matches` must never disagree about what is searchable.
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

function matches(definition, query) {
    return matchesText(searchableText(definition), query);
}

/** Content template for a new tool note: exactly the three H2 sections. */
function toolTemplate() {
    return [
        '<h2>What is?</h2>',
        '<p>Describe what this tool does and when to use it.</p>',
        '<h2>Official links</h2>',
        '<p>Add the official documentation, repository or website links here.</p>',
        '<h2>Useful links</h2>',
        '<p>Add useful guides, cheat sheets or articles here.</p>'
    ].join('\n');
}

/** Starting content for the three standard child notes plus the tool body. */
function newToolNotes() {
    return {
        content: toolTemplate(),
        install: '<p>Add the installation steps or commands for this tool.</p>',
        usage: '<p>Add examples of commands with this tool. Put each example in a code block.</p>',
        help: ''
    };
}

function seedTools() {
    return [
        {
            category: 'Version control',
            title: 'git commit',
            base: 'git commit',
            description: 'Record staged changes in the current Git repository.',
            content: [
                '<h2>What is?</h2>',
                '<p><code>git commit</code> records the staged changes of the repository as a new commit.</p>',
                '<h2>Official links</h2>',
                '<ul><li><a href="https://git-scm.com/docs/git-commit">Official git-commit documentation</a></li></ul>',
                '<h2>Useful links</h2>',
                '<ul><li><a href="https://www.conventionalcommits.org/">Conventional Commits</a></li></ul>'
            ].join('\n'),
            install: '<p><strong>Windows:</strong> <code>winget install Git.Git</code></p><p><strong>macOS:</strong> <code>brew install git</code></p><p><strong>Debian/Ubuntu:</strong> <code>sudo apt install git</code></p>',
            usage: [
                '<p>Commit with a message:</p>',
                '<pre><code>git commit -m "fix: handle empty input"</code></pre>',
                '<p>Add all tracked changes and commit:</p>',
                '<pre><code>git commit -am "chore: update dependencies"</code></pre>',
                '<p>Amend the last commit without changing its message:</p>',
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
                { label: 'Message', flag: '-m', type: 'string', doc: 'Commit message. Repeat the flag to add paragraphs.', order: 10, required: true },
                { label: 'All changes', flag: '-a', type: 'boolean', doc: 'Stage all tracked changes before committing.', order: 20 },
                { label: 'Amend last commit', flag: '--amend', type: 'boolean', doc: 'Replace the previous commit instead of creating a new one.', order: 30 },
                { label: 'Allow empty', flag: '--allow-empty', type: 'boolean', doc: 'Record a commit with no changes.', order: 40 },
                { label: 'Skip hooks', flag: '--no-verify', type: 'boolean', doc: 'Bypass pre-commit and commit-msg hooks.', order: 50 },
                { label: 'Author', flag: '--author', type: 'string', doc: 'Override the commit author, for example "Name <mail@example.com>".', order: 60 },
                { label: 'Date', flag: '--date', type: 'string', doc: 'Override the author date.', order: 70 }
            ]
        },
        {
            category: 'Network',
            title: 'curl',
            base: 'curl',
            description: 'Transfer data from or to a server with the curl command-line client.',
            content: [
                '<h2>What is?</h2>',
                '<p>curl is a command-line tool for transferring data with URLs. It supports HTTP, HTTPS, FTP and many other protocols.</p>',
                '<h2>Official links</h2>',
                '<ul><li><a href="https://curl.se/docs/">Official curl documentation</a></li></ul>',
                '<h2>Useful links</h2>',
                '<ul><li><a href="https://curl.se/docs/manpage.html">curl man page</a></li></ul>'
            ].join('\n'),
            install: '<p><strong>Windows:</strong> <code>winget install curl.curl</code></p><p><strong>macOS:</strong> <code>brew install curl</code></p><p><strong>Debian/Ubuntu:</strong> <code>sudo apt install curl</code></p>',
            usage: [
                '<p>POST JSON:</p>',
                '<pre><code>curl -X POST -H "Content-Type: application/json" -d "{\\"name\\":\\"value\\"}" https://api.example.com/items</code></pre>',
                '<p>Download a file, following redirects:</p>',
                '<pre><code>curl -L -o file.zip https://example.com/file.zip</code></pre>',
                '<p>Show only the response headers:</p>',
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
                { label: 'Request method', flag: '-X', type: 'enum', values: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], doc: 'HTTP request method.', order: 10 },
                { label: 'Header', flag: '-H', type: 'string', doc: 'Add a request header, for example "Content-Type: application/json".', order: 20 },
                { label: 'Data', flag: '-d', type: 'string', doc: 'Request body sent to the server.', order: 30 },
                { label: 'Output file', flag: '-o', type: 'path', doc: 'Write the response body to this file instead of stdout.', order: 40 },
                { label: 'Follow redirects', flag: '-L', type: 'boolean', doc: 'Follow HTTP redirects.', order: 50 },
                { label: 'Silent', flag: '-s', type: 'boolean', doc: 'Do not show progress or error messages.', order: 60 },
                { label: 'Compressed', flag: '--compressed', type: 'boolean', doc: 'Ask the server for a compressed response and decompress it.', order: 70 },
                { label: 'User', flag: '-u', type: 'string', doc: 'Server credentials as user:password.', order: 80 },
                { label: 'Insecure', flag: '-k', type: 'boolean', doc: 'Allow insecure TLS connections (skip certificate checks).', order: 90 },
                { label: 'URL', flag: '', type: 'string', placeholder: 'url', quote: 'double', doc: 'URL to request. Positional; appended last.', order: 100, required: true }
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
    EXTRA_KEY: Render.EXTRA_KEY,
    deriveBase,
    optionFromNote,
    sortOptions,
    buildTool,
    defaultValueMap,
    valuesFromExample,
    tokenizeCommand,
    matches,
    matchesText,
    searchableText,
    optionNotesText,
    toolTemplate,
    newToolNotes,
    seedTools
};