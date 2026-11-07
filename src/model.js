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
    migrated: 'cmMigrated',
    // legacy command/template labels, only used by the legacy importer
    legacyCommand: 'cmCommand',
    legacyTemplate: 'cmTemplate',
    legacyOptionTemplate: 'cmOptionTemplate',
    legacyPreset: 'cmPreset'
};

const LABEL_NAMES = Object.keys(LABELS).map(function (key) {
    return LABELS[key];
});

const TYPES = ['string', 'path', 'number', 'boolean', 'enum'];
const QUOTES = ['none', 'single', 'double'];

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
    if (left.order !== right.order) {
        return left.order - right.order;
    }
    if (left.title !== right.title) {
        return left.title < right.title ? -1 : 1;
    }
    return String(left.noteId) < String(right.noteId) ? -1 : 1;
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
    const byPlaceholder = {};
    for (const option of options) {
        if (!option.placeholder) {
            warnings.push({
                code: 'missing-placeholder-name',
                message: 'Option "' + option.title + '" has an empty placeholder name.'
            });
            continue;
        }
        if (byPlaceholder[option.placeholder]) {
            warnings.push({
                code: 'duplicate-placeholder',
                message: 'Two options share the placeholder "' + option.placeholder + '"; the first one wins.'
            });
            continue;
        }
        byPlaceholder[option.placeholder] = option;
    }

    const byFlag = {};
    for (const option of options) {
        if (!option.flag) {
            continue;
        }
        if (byFlag[option.flag]) {
            warnings.push({
                code: 'duplicate-flag',
                message: 'Two options use the flag "' + option.flag + '"; the command will repeat it.'
            });
            continue;
        }
        byFlag[option.flag] = true;
    }

    const declared = Render.placeholderNames(base);
    const inferred = declared
        .filter(function (name) {
            return !byPlaceholder[name];
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

function matches(definition, query) {
    const needle = String(query == null ? '' : query).trim().toLowerCase();
    if (needle === '') {
        return true;
    }
    const safeDefinition = definition || {};
    const optionText = (safeDefinition.options || [])
        .map(function (option) {
            return [option.title, option.flag, option.help, (option.enumValues || []).join(' ')].join(' ');
        })
        .join(' ');
    const haystack = [
        safeDefinition.title,
        safeDefinition.description,
        safeDefinition.tags,
        safeDefinition.category,
        safeDefinition.base,
        optionText,
        (safeDefinition.optionTitles || []).join(' '),
        (safeDefinition.examples || []).join(' '),
        safeDefinition.searchText
    ].join(' ').toLowerCase();

    return needle.split(/\s+/).every(function (term) {
        return haystack.indexOf(term) !== -1;
    });
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

/** Starting content for the three standard child notes. */
function newToolNotes() {
    return {
        install: '<p>Add the installation steps or commands for this tool.</p>',
        usage: '<p>Add examples of commands with this tool. Put each example in a code block.</p>',
        help: ''
    };
}

function seedTools() {
    return [
        {
            category: 'Media',
            title: 'ffmpeg',
            base: 'ffmpeg',
            description: 'Convert, inspect and process audio and video files.',
            content: [
                '<h2>What is?</h2>',
                '<p>ffmpeg is a complete, cross-platform command-line toolkit for converting, recording and streaming audio and video.</p>',
                '<h2>Official links</h2>',
                '<ul><li><a href="https://ffmpeg.org/documentation.html">Official documentation</a></li></ul>',
                '<h2>Useful links</h2>',
                '<ul><li><a href="https://ffmpeg.org/ffmpeg.html">ffmpeg command reference</a></li></ul>'
            ].join('\n'),
            install: '<p><strong>Windows:</strong> <code>winget install Gyan.FFmpeg</code></p><p><strong>macOS:</strong> <code>brew install ffmpeg</code></p><p><strong>Debian/Ubuntu:</strong> <code>sudo apt install ffmpeg</code></p>',
            usage: [
                '<p>Compress a video to H.264:</p>',
                '<pre><code>ffmpeg -i input.mp4 -c:v libx264 -crf 23 output.mp4</code></pre>',
                '<p>Extract the audio track:</p>',
                '<pre><code>ffmpeg -i input.mp4 -vn -c:a aac audio.m4a</code></pre>',
                '<p>Scale to 720p:</p>',
                '<pre><code>ffmpeg -i input.mp4 -vf scale=1280:-2 output.mp4</code></pre>'
            ].join('\n'),
            help: [
                'Usage: ffmpeg [options] [[infile options] -i infile]... {[outfile options] outfile}...',
                '',
                'Main options:',
                '  -i URL            input file url',
                '  -y                overwrite output files without asking',
                '  -c:v CODEC        select the video encoder',
                '  -c:a CODEC        select the audio encoder',
                '  -crf N            constant rate factor (quality), lower is better',
                '  -vf FILTERGRAPH   apply a video filter'
            ].join('\n'),
            options: [
                { label: 'Input file', flag: '-i', type: 'path', doc: 'Input file the command reads from.', order: 10 },
                { label: 'Video codec', flag: '-c:v', type: 'enum', values: ['libx264', 'libx265', 'libvpx-vp9'], defaultValue: 'libx264', doc: 'Video encoder to use.', order: 20 },
                { label: 'CRF quality', flag: '-crf', type: 'number', defaultValue: '23', doc: 'Constant Rate Factor; lower values keep more quality.', order: 30 },
                { label: 'Audio codec', flag: '-c:a', type: 'enum', values: ['aac', 'libopus', 'copy'], doc: 'Audio encoder to use.', order: 40 },
                { label: 'Video filter', flag: '-vf', type: 'string', doc: 'Video filter graph, for example scale=1280:-2.', order: 50 },
                { label: 'Overwrite output', flag: '-y', type: 'boolean', doc: 'Overwrite output files without asking.', order: 60 }
            ]
        },
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
                { label: 'Message', flag: '-m', type: 'string', doc: 'Commit message. Repeat the flag to add paragraphs.', order: 10 },
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
                { label: 'Insecure', flag: '-k', type: 'boolean', doc: 'Allow insecure TLS connections (skip certificate checks).', order: 90 }
            ]
        }
    ];
}

module.exports = {
    LABELS,
    LABEL_NAMES,
    TYPES,
    QUOTES,
    EXTRA_KEY: Render.EXTRA_KEY,
    deriveBase,
    optionFromNote,
    sortOptions,
    buildTool,
    defaultValueMap,
    matches,
    toolTemplate,
    newToolNotes,
    seedTools
};