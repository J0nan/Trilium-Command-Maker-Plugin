'use strict';

/**
 * Pure option importers (S7): plain `--help` output, a JSON options file or a
 * markdown table all become canonical options. No Trilium API, no DOM, no
 * external dependencies.
 *
 * A canonical option looks like:
 * {
 *   label: 'Input file', flag: '--input', aliases: ['-i', '--input'],
 *   help: 'Input file to read.', type: 'path', values: [], defaultValue: '',
 *   required: false, mode: 'flag', placeholder: 'input', order: 10
 * }
 *
 * Every parser returns { options, warnings } and never throws: whatever it
 * cannot understand becomes a warning the palette can show in the preview.
 *
 * Types come from Model's set: a help line with no metavar is a boolean; a
 * JSON or table entry that carries no type at all falls back to 'string',
 * matching Model.optionFromNote.
 */

const Model = require('./model');
const Render = require('./render');

const TYPES = Model.TYPES;
const PATH_TOKENS = ['PATH', 'FILE', 'DIR', 'FOLDER'];
const NUMBER_TOKENS = ['N', 'NUM', 'NUMBER', 'INT', 'INTEGER', 'COUNT', 'SIZE', 'SECONDS'];

const NAMED_ENTITIES = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    en: '\u2013',
    em: '\u2014',
    ndash: '\u2013',
    mdash: '\u2014',
    lsquo: '\u2018',
    rsquo: '\u2019',
    ldquo: '\u201c',
    rdquo: '\u201d',
    hellip: '\u2026',
    middot: '\u00b7',
    bull: '\u2022',
    copy: '\u00a9',
    reg: '\u00ae',
    deg: '\u00b0'
};

const ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const PRE_RE = /<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi;
/** Tags whose end means "start a new line" in plain text. */
const BLOCK_BREAK_RE = /<br\s*\/?>|<\/p\s*>|<\/li\s*>|<\/h[1-6]\s*>|<\/pre\s*>|<\/tr\s*>/gi;
const TAG_RE = /<[^>]*>/g;
/** 2+ spaces (or a tab) separate an option spec from its description. */
const GAP_RE = /\t| {2,}/;
/** `: ` or an em dash also start a description. */
const LEADING_SEPARATOR_RE = /[:\u2014]\s+/;

const TOKEN_FLAG_RE = /^(-{1,2})(?:\[(no-|on-)?\])?([A-Za-z0-9][A-Za-z0-9:._+@%~-]*)$/;
const OPENERS = '<[({';
const CLOSERS = '>])}';
/** A help block header ends in a colon: "Options:", "Main arguments:". */
const SECTION_HEADER_RE = /^[A-Za-z][A-Za-z0-9 ()/,.'\u2019-]*:$/;
const USAGE_LINE_RE = /^(usage|synopsis|overview|syntax)\b/i;

/** `&mdash;` / `&#8212;` / `&#x2014;` and friends, decoded in one pass. */
function decodeEntities(text) {
    return String(text == null ? '' : text).replace(ENTITY_RE, function (match, body) {
        if (body.charAt(0) === '#') {
            const isHex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
            const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
            if (!isFinite(code) || code < 0 || code > 0x10ffff) {
                return match;
            }
            try {
                return String.fromCodePoint(code);
            } catch (err) {
                return match;
            }
        }
        const named = Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body.toLowerCase())
            ? NAMED_ENTITIES[body.toLowerCase()]
            : undefined;
        return named === undefined ? match : named;
    });
}

/** Three or more consecutive line breaks become one blank line. */
function collapseBlankLines(text) {
    return String(text).replace(/\n{3,}/g, '\n\n');
}

/** HTML outside `<pre>`: block tags become newlines, the rest becomes prose. */
function textChunk(html) {
    const withoutTags = String(html)
        .replace(COMMENT_RE, ' ')
        .replace(BLOCK_BREAK_RE, '\n')
        .replace(TAG_RE, '');
    const lines = withoutTags.split(/\r?\n/).map(function (line) {
        return line.replace(/[^\S\n]+/g, ' ').trim();
    });
    return collapseBlankLines(decodeEntities(lines.join('\n')));
}

/** HTML inside `<pre>`: its inner line breaks are kept exactly. */
function preChunk(inner) {
    const text = decodeEntities(String(inner).replace(TAG_RE, ''));
    return text.replace(/^\r?\n/, '').replace(/\s+$/, '') + '\n';
}

/**
 * HTML note body -> readable plain text. Blank runs of 3+ lines collapse to
 * one; `<pre>` content keeps its own line breaks.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
    const source = String(html == null ? '' : html);
    let out = '';
    let cursor = 0;
    PRE_RE.lastIndex = 0;
    let match = PRE_RE.exec(source);
    while (match !== null) {
        out += textChunk(source.slice(cursor, match.index));
        out += preChunk(match[1]);
        cursor = match.index + match[0].length;
        match = PRE_RE.exec(source);
    }
    out += textChunk(source.slice(cursor));
    return out.replace(/^[ \t\n]+/, '').replace(/[\s\n]+$/, '');
}

function splitList(text) {
    return String(text == null ? '' : text)
        .split(',')
        .map(function (entry) {
            return entry.trim();
        })
        .filter(function (entry) {
            return entry !== '';
        });
}

function uniq(list) {
    return Array.from(new Set(list));
}

function bracketDepth(token) {
    let depth = 0;
    for (const ch of token) {
        if (OPENERS.indexOf(ch) !== -1) {
            depth += 1;
        } else if (CLOSERS.indexOf(ch) !== -1) {
            depth -= 1;
        }
    }
    return depth;
}

/** Whitespace tokens, then split on `,` `|` `;` outside brackets. */
function tokenize(text) {
    const out = [];
    for (const rough of String(text == null ? '' : text).split(/\s+/)) {
        if (rough === '') {
            continue;
        }
        let depth = 0;
        let current = '';
        for (const ch of rough) {
            if (OPENERS.indexOf(ch) !== -1) {
                depth += 1;
            } else if (CLOSERS.indexOf(ch) !== -1) {
                depth -= 1;
            }
            if (depth === 0 && (ch === ',' || ch === '|' || ch === ';')) {
                if (current !== '') {
                    out.push(current);
                    current = '';
                }
                continue;
            }
            current += ch;
        }
        if (current !== '') {
            out.push(current);
        }
    }
    // Rejoin tokens whose brackets span more than one token: `{a, b, c}`.
    const merged = [];
    let pending = '';
    for (const token of out) {
        if (pending !== '') {
            pending += ' ' + token;
            if (bracketDepth(pending) <= 0) {
                merged.push(pending);
                pending = '';
            }
            continue;
        }
        if (bracketDepth(token) > 0) {
            pending = token;
            continue;
        }
        merged.push(token);
    }
    if (pending !== '') {
        merged.push(pending);
    }
    return merged;
}

/** One token -> { flags, metavar } or null when it is not a flag. */
function flagsFromToken(token) {
    let piece = String(token);
    // `[--dry-run]`: the flag itself is wrapped in option brackets.
    if (piece.charAt(0) === '[' && piece.slice(-1) === ']' && piece.charAt(1) === '-') {
        piece = piece.slice(1, -1);
    }
    let match = TOKEN_FLAG_RE.exec(piece);
    let attached = '';
    if (!match) {
        // `--output=FILE`, `--color[=WHEN]`, `--format=(choices)`, `-b:v{a|b}`: the tail is the metavar.
        const open = piece.search(/[=<[{(]/);
        if (open !== -1) {
            attached = piece.slice(open)
                .replace(/^[=[{\s]+/, '')
                .replace(/[\])\s]+$/, '')
                .replace(/=$/, '');
            piece = piece.slice(0, open);
        }
        match = TOKEN_FLAG_RE.exec(piece);
    }
    if (!match) {
        return null;
    }
    const dash = match[1];
    const bare = match[3];
    if (match[2] === 'no-') {
        return { flags: [dash + bare, '--no-' + bare], metavar: attached, negated: true };
    }
    if (match[2] === 'on-') {
        return { flags: ['--no-' + bare, dash + bare], metavar: attached, negated: true };
    }
    return { flags: [dash + bare], metavar: attached, negated: false };
}

function isMetavarToken(token, allowLowercase) {
    if (token === '') {
        return false;
    }
    if (OPENERS.indexOf(token.charAt(0)) !== -1) {
        return true;
    }
    if (/^[A-Z][A-Za-z0-9_]*$/.test(token) && token.indexOf('-') === -1) {
        return true;
    }
    // ffmpeg and other tools print lowercase single-word metavars: `-i url`,
    // `-crf crf`. Only accept them when a 2+ gap already proved a description
    // follows, so `-y overwrite output files` keeps its prose as the help.
    if (allowLowercase) {
        return /^[a-z][a-z0-9_.-]*$/.test(token);
    }
    return false;
}

function isSeparatorToken(token) {
    return token === ',' || token === '|' || token === '/' || token === ';';
}

/**
 * Walk leading flag tokens and their metavars; the rest is prose.
 * Supports `-q QUEUE, --queue QUEUE` and `-m, --message <message>` by
 * continuing after a metavar when another flag follows.
 */
function readTokens(tokens, allowLowercaseMetavar) {
    const flags = [];
    let metavar = '';
    let negated = false;
    let index = 0;
    let awaitingMetavar = false;
    while (index < tokens.length) {
        const token = tokens[index];
        if (isSeparatorToken(token)) {
            index += 1;
            continue;
        }
        const parsed = flagsFromToken(token);
        if (parsed) {
            for (const flag of parsed.flags) {
                if (flags.indexOf(flag) === -1) {
                    flags.push(flag);
                }
            }
            if (metavar === '' && parsed.metavar !== '') {
                metavar = parsed.metavar;
            }
            negated = negated || parsed.negated;
            awaitingMetavar = true;
            index += 1;
            continue;
        }
        if (awaitingMetavar && isMetavarToken(token, allowLowercaseMetavar)) {
            metavar = metavar === '' ? token : metavar;
            awaitingMetavar = false;
            index += 1;
            continue;
        }
        break;
    }
    return { flags: flags, metavar: metavar, negated: negated, rest: tokens.slice(index) };
}

function readSpecText(text) {
    return readTokens(tokenize(text), false);
}

function enumValuesFrom(spec, description) {
    const candidates = [];
    const shapes = [/\{([^{}]*)\}/g, /\(([^()]*)\)/g, /\[([^[\]]*)\]/g];
    for (const shape of shapes) {
        let match = shape.exec(String(spec == null ? '' : spec));
        while (match !== null) {
            candidates.push(splitList(match[1].split('|').join(',')));
            match = shape.exec(String(spec == null ? '' : spec));
        }
    }
    const prose = /\b(?:one of|possible values|valid values)\s*:?\s*([^\n.]+)/i.exec(String(description == null ? '' : description));
    if (prose) {
        candidates.push(splitList(prose[1].replace(/^["'`[]/, '').replace(/["'`\]]$/, '')));
    }
    for (const candidate of candidates) {
        if (candidate.length >= 2 && candidate.every(function (value) {
            return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value);
        })) {
            return uniq(candidate);
        }
    }
    return [];
}

function metavarTokens(metavar) {
    return String(metavar == null ? '' : metavar)
        .replace(/[-_]+/g, ' ')
        .split(/[^A-Za-z0-9]+/)
        .filter(function (token) {
            return token !== '';
        })
        .map(function (token) {
            return token.toUpperCase();
        });
}

/**
 * Best-effort option type from a metavar and its description.
 * @returns {'boolean'|'path'|'number'|'enum'|'string'}
 */
function inferType(metavar, help) {
    const met = String(metavar == null ? '' : metavar).trim();
    if (enumValuesFrom(met, help).length > 0) {
        return 'enum';
    }
    if (met === '') {
        return 'boolean';
    }
    const tokens = metavarTokens(met);
    if (tokens.some(function (token) {
        return PATH_TOKENS.indexOf(token) !== -1;
    })) {
        return 'path';
    }
    if (tokens.some(function (token) {
        return NUMBER_TOKENS.indexOf(token) !== -1;
    })) {
        return 'number';
    }
    // `-crf crf ... (default 23)` and numeric ranges are numeric even when the
    // metavar itself says nothing.
    const defaultValue = extractDefaultValue(help);
    if (defaultValue !== '' && /^[-+]?\d+(?:\.\d+)?$/.test(defaultValue)) {
        return 'number';
    }
    if (/\b(?:from|between)\s+[-+]?\d/i.test(String(help == null ? '' : help))) {
        return 'number';
    }
    return 'string';
}

const DEFAULT_PATTERNS = [
    /\(\s*defaults?\s*[:=]\s*([^()]*)\)/i,
    /\(\s*defaults?\s+(?!to\b)([^()]+?)\)/i,
    /\bdefaults?\s+to\s+(?:(?:(\d+(?:\.\d+)?|\S+)|"([^"]*)"|'([^']*)'|`([^`]*)`))((?:[ \t]+[^\s,.;:](?:[^\s,.;:]*))*)/i,
    /\bdefault\s*[:=]\s*(\S[^(]*?)(?=\s+when\b|\s+(?:can|must|may|is|to|only|or|if)\b|[.,;]|\s*$)/i
];

/** `(default: X)`, `[default: X]`, `default: X`, `defaults to X`. */
function extractDefaultValue(text) {
    const source = String(text == null ? '' : text);
    const square = /\[\s*defaults?\s*[:=]\s*([^\]]*)\]/i.exec(source);
    if (square && square[1].trim() !== '') {
        return square[1].trim();
    }
    for (const pattern of DEFAULT_PATTERNS) {
        const match = pattern.exec(source);
        if (!match) {
            continue;
        }
        const value = match[1] !== undefined
            ? String(match[1]) + (match[5] === undefined ? '' : match[5])
            : (match[2] || match[3] || match[4] || '');
        const trimmed = value.trim();
        if (trimmed !== '') {
            return trimmed;
        }
    }
    return '';
}

function primaryFlag(flags) {
    const long = flags.filter(function (flag) {
        return flag.indexOf('--') === 0;
    })[0];
    return long || flags.filter(function (flag) {
        return flag.length > 1;
    })[0] || '';
}

/** `--video-codec` -> `Video codec`. */
function labelFromFlags(flags) {
    const words = primaryFlag(flags)
        .replace(/^-+/, '')
        .replace(/[-_]+/g, ' ')
        .replace(/[:=/[\](){}<>,]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (words === '') {
        return '';
    }
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `--video-codec` -> `video_codec`, `-c:v` -> `c_v`, else the label slug. */
function placeholderFrom(flags, fallback) {
    const bare = primaryFlag(flags).replace(/^-+/, '').replace(/[=:<>\[\]{}()|]/g, ' ');
    const slug = Render.slugify(bare);
    return slug !== '' ? slug : Render.slugify(fallback);
}

function truthy(value) {
    if (value === true) {
        return true;
    }
    return ['true', '1', 'yes', 'on'].indexOf(String(value).trim().toLowerCase()) !== -1;
}

function warning(code, message, extra) {
    const entry = { code: code, message: message };
    if (extra && extra.line !== undefined) {
        entry.line = extra.line;
    }
    if (extra && extra.text !== undefined) {
        entry.text = extra.text;
    }
    return entry;
}

function booleanDefaultFrom(text) {
    const match = /\bon\b|\byes\b|\benabled\b|\btrue\b/i.exec(String(text == null ? '' : text));
    return match ? 'true' : '';
}

/**
 * Canonical option from an internal source ({ flags, metavar, ... } or a loose
 * JSON entry via { flag, aliases, ... }). Returns null when no flag is usable.
 */
function buildOption(source) {
    const entry = source || {};
    let flags = Array.isArray(entry.flags) ? entry.flags.filter(function (flag) {
        return typeof flag === 'string' && flag.trim() !== '';
    }).map(function (flag) {
        return flag.trim();
    }) : [];
    let metavar = String(entry.metavar == null ? '' : entry.metavar).trim();
    let negated = entry.negated === true;

    if (flags.length === 0) {
        const text = [entry.flag].concat(entry.aliases || [])
            .filter(function (value) {
                return value !== undefined && value !== null && String(value).trim() !== '';
            })
            .map(function (value) {
                return String(value).trim();
            })
            .join(' ');
        const parsed = readSpecText(text);
        flags = parsed.flags;
        negated = negated || parsed.negated;
        if (metavar === '') {
            metavar = parsed.metavar;
        }
    }
    if (flags.length === 0) {
        return null;
    }

    const flag = primaryFlag(flags);
    const help = String(entry.help == null ? '' : entry.help).trim() || String(entry.doc == null ? '' : entry.doc).trim();

    let values = [];
    const rawValues = entry.values !== undefined && entry.values !== null ? entry.values : entry.enumValues;
    if (rawValues !== undefined && rawValues !== null && rawValues !== '') {
        values = Array.isArray(rawValues)
            ? rawValues.map(function (value) {
                return String(value).trim();
            })
            : splitList(rawValues);
        values = uniq(values.filter(function (value) {
            return value !== '';
        }));
    }
    if (values.length === 0) {
        values = enumValuesFrom(metavar, help);
    }

    let type = String(entry.type == null ? '' : entry.type).trim().toLowerCase();
    if (TYPES.indexOf(type) === -1) {
        type = '';
    }
    if (type === '' && values.length > 0) {
        type = 'enum';
    }
    if (type === '') {
        if (negated) {
            type = 'boolean';
        } else if (metavar === '' && entry.fromHelp !== true) {
            // A JSON or table entry with no `type` and no metavar: same default as Model.optionFromNote.
            type = 'string';
        } else {
            type = inferType(metavar, help);
        }
    }
    if (type === 'boolean') {
        values = [];
    }

    const label = String(entry.label == null ? '' : entry.label).trim() || labelFromFlags(flags);
    let rawDefault = entry.defaultValue !== undefined && entry.defaultValue !== null
        ? entry.defaultValue
        : entry['default'];
    let defaultValue;
    if (rawDefault === undefined || rawDefault === null || rawDefault === '') {
        defaultValue = extractDefaultValue(help) || (type === 'boolean' ? booleanDefaultFrom(help) : '');
    } else if (typeof rawDefault === 'boolean') {
        defaultValue = rawDefault ? 'true' : '';
    } else {
        defaultValue = String(rawDefault).trim();
    }

    const rawOrder = entry.order === '' || entry.order === undefined || entry.order === null
        ? NaN
        : Number(entry.order);
    const order = isFinite(rawOrder)
        ? rawOrder
        : (typeof entry.index === 'number' ? (entry.index + 1) * 10 : 10);

    return {
        label: label,
        flag: flag,
        aliases: flags.slice(),
        help: help,
        type: type,
        values: values,
        defaultValue: String(defaultValue),
        required: truthy(entry.required),
        mode: String(entry.mode == null ? '' : entry.mode).trim().toLowerCase() === 'inline' ? 'inline' : 'flag',
        placeholder: String(entry.placeholder == null ? '' : entry.placeholder).trim() || placeholderFrom(flags, label),
        order: order
    };
}

/**
 * Loose JSON entry (or hand-built object) -> canonical option.
 * @returns {object|null} null when the entry has no usable flag
 */
function normalizeOption(entry) {
    return buildOption(entry);
}

/**
 * One trimmed help line -> { flags, metavar, negated, description, loose }.
 * `loose` marks a line whose flag was followed by prose the parser had to
 * guess at, which is reported as unparsed. Null when not an option line.
 */
function readHelpLine(line) {
    let spec = line;
    let description = '';
    const gap = GAP_RE.exec(line);
    const separator = LEADING_SEPARATOR_RE.exec(line);
    if (gap && (!separator || gap.index < separator.index)) {
        spec = line.slice(0, gap.index);
        description = line.slice(gap.index + gap[0].length).trim();
    } else if (separator) {
        spec = line.slice(0, separator.index);
        description = line.slice(separator.index + separator[0].length).trim();
    }

    const parsed = readTokens(tokenize(spec), description !== '');
    if (parsed.flags.length === 0) {
        return null;
    }
    const inline = parsed.rest.join(' ');
    let loose = false;
    if (inline !== '' && description === '') {
        description = inline;
    } else if (inline !== '') {
        // `-c CODEC extra words   real help`: the spec itself ran on.
        loose = true;
    }
    return {
        flags: parsed.flags,
        metavar: parsed.metavar,
        negated: parsed.negated,
        description: description,
        loose: loose
    };
}

function pushOption(options, warnings, seen, option, origin) {
    if (!option) {
        return;
    }
    if (seen.has(option.flag)) {
        warnings.push(warning('duplicate-flag', 'Option "' + option.flag + '" from ' + origin
            + ' duplicates the earlier one on ' + seen.get(option.flag) + '; the first one wins.'));
        return;
    }
    seen.set(option.flag, origin);
    options.push(option);
}

/**
 * Parse plain `--help` output into canonical options.
 * @param {string} text
 * @returns {{ options: Array, warnings: Array }}
 */
function parseHelpText(text) {
    const options = [];
    const warnings = [];
    const seen = new Map();
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    let current = null;
    let currentIndent = 0;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].replace(/\t/g, '    ').replace(/\s+$/, '');
        const trimmed = line.trim();
        if (trimmed === '' || /^[-=_*]{3,}$/.test(trimmed)) {
            continue;
        }
        const indent = /^ */.exec(line)[0].length;

        if (USAGE_LINE_RE.test(trimmed) || SECTION_HEADER_RE.test(trimmed)) {
            current = null;
            continue;
        }

        if (trimmed.charAt(0) !== '-') {
            if (current !== null && indent > currentIndent) {
                current.help = current.help === '' ? trimmed : current.help + ' ' + trimmed;
                const added = extractDefaultValue(current.help);
                if (added !== '') {
                    current.defaultValue = added;
                }
            } else {
                current = null;
            }
            continue;
        }

        const read = readHelpLine(trimmed);
        if (!read || read.loose) {
            warnings.push(warning('unparsed-option-line',
                'Could not parse the option line "' + trimmed + '".', { line: index + 1, text: trimmed }));
            current = null;
            continue;
        }
        const option = buildOption({
            flags: read.flags,
            metavar: read.metavar,
            negated: read.negated,
            help: read.description,
            fromHelp: true,
            index: options.length
        });
        if (!option) {
            warnings.push(warning('unparsed-option-line',
                'Could not parse the option line "' + trimmed + '".', { line: index + 1, text: trimmed }));
            current = null;
            continue;
        }
        pushOption(options, warnings, seen, option, 'line ' + (index + 1));
        current = option;
        currentIndent = indent;
    }
    return { options: options, warnings: warnings };
}

/**
 * Parse a JSON options file: a bare array, `{ "options": [...] }` or
 * `{ "tool": { "options": [...] } }`.
 * @param {string} text
 * @returns {{ options: Array, warnings: Array }}
 */
function parseJsonOptions(text) {
    const warnings = [];
    const source = String(text == null ? '' : text);
    if (source.trim() === '') {
        return { options: [], warnings: [warning('invalid-json', 'The JSON import is empty.')] };
    }
    let data;
    try {
        data = JSON.parse(source);
    } catch (err) {
        return { options: [], warnings: [warning('invalid-json', 'Not valid JSON: ' + String(err && err.message || err))] };
    }

    let list = null;
    if (Array.isArray(data)) {
        list = data;
    } else if (data && typeof data === 'object') {
        if (Array.isArray(data.options)) {
            list = data.options;
        } else if (data.tool && typeof data.tool === 'object' && Array.isArray(data.tool.options)) {
            list = data.tool.options;
        }
    }
    if (list === null) {
        return { options: [], warnings: [warning('invalid-json', 'No options array found in the JSON.')] };
    }

    const options = [];
    const seen = new Map();
    for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const origin = 'entry ' + (index + 1);
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            warnings.push(warning('invalid-entry', origin + ' is not an object.', { line: index + 1 }));
            continue;
        }
        if (entry.flag === undefined || entry.flag === null || String(entry.flag).trim() === '') {
            warnings.push(warning('invalid-entry', origin + ' has no flag.', { line: index + 1 }));
            continue;
        }
        const aliases = Array.isArray(entry.aliases)
            ? entry.aliases.map(function (value) {
                return String(value);
            })
            : (entry.aliases === undefined || entry.aliases === null ? [] : splitList(String(entry.aliases)));
        const option = buildOption({
            flag: entry.flag,
            aliases: aliases,
            help: entry.help,
            doc: entry.doc,
            label: entry.label,
            type: entry.type,
            values: entry.values !== undefined ? entry.values : entry.enumValues,
            defaultValue: entry.defaultValue !== undefined ? entry.defaultValue : entry['default'],
            required: entry.required,
            mode: entry.mode,
            placeholder: entry.placeholder,
            order: entry.order,
            index: options.length
        });
        if (!option) {
            warnings.push(warning('invalid-entry', origin + ' has an unusable flag.', { line: index + 1 }));
            continue;
        }
        pushOption(options, warnings, seen, option, origin);
    }
    return { options: options, warnings: warnings };
}

function cleanCell(cell) {
    return String(cell == null ? '' : cell).trim().replace(/^`+/, '').replace(/`+$/, '')
        .replace(/^\*+/, '').replace(/\*+$/, '').trim();
}

function splitRow(line) {
    let row = line.trim();
    if (row.charAt(0) === '|') {
        row = row.slice(1);
    }
    if (row.slice(-1) === '|') {
        row = row.slice(0, -1);
    }
    return row.split('|').map(cleanCell);
}

const FLAG_HEADER_RE = /^(flag|option|switch|argument|arg)\b/i;

function columnHeader(header, pattern) {
    for (let index = 0; index < header.length; index += 1) {
        if (pattern.test(header[index])) {
            return index;
        }
    }
    return -1;
}

/**
 * Parse a markdown table of options: first cell flag, second cell help,
 * optional third cell type. Separator rows are skipped.
 * @param {string} text
 * @returns {{ options: Array, warnings: Array }}
 */
function parseMarkdownTable(text) {
    const warnings = [];
    const source = String(text == null ? '' : text);
    if (/^\s*<(?:table|tr|thead|tbody)\b/i.test(source)) {
        warnings.push(warning('no-table', 'HTML tables are not supported; use a markdown table.'));
        return { options: [], warnings: warnings };
    }
    const rows = [];
    for (const line of source.split(/\r?\n/)) {
        if (line.trim().charAt(0) !== '|') {
            continue;
        }
        const cells = splitRow(line);
        const separator = cells.every(function (cell) {
            return cell === '' || /^:?-{2,}:?$/.test(cell);
        });
        if (!separator) {
            rows.push(cells);
        }
    }
    if (rows.length === 0) {
        warnings.push(warning('no-table', 'No markdown table rows were found.'));
        return { options: [], warnings: warnings };
    }

    const header = rows[0].map(function (cellValue) {
        return cellValue.toLowerCase();
    });
    let flagColumn = columnHeader(header, FLAG_HEADER_RE);
    let firstDataRow = 1;
    if (flagColumn === -1) {
        // A table written without a header row: its first column already holds flags.
        const probe = readSpecText(rows[0][0] === undefined ? '' : rows[0][0]);
        if (probe.flags.length > 0) {
            flagColumn = 0;
            firstDataRow = 0;
        }
    }
    if (flagColumn === -1) {
        warnings.push(warning('no-flag-column', 'The table header has no flag column.'));
        return { options: [], warnings: warnings };
    }
    const named = function (pattern) {
        return firstDataRow === 1 ? columnHeader(header, pattern) : -1;
    };
    const helpColumn = named(/^(help|description|doc|summary|meaning)\b/);
    const typeColumn = named(/^(type|value type)\b/);
    const labelColumn = named(/^(label|name|title)\b/);
    const valuesColumn = named(/^(values|enum|allowed values)\b/);
    const defaultColumn = named(/^(default|default value)\b/);
    const requiredColumn = named(/^required\b/);
    const orderColumn = named(/^order\b/);
    const cell = function (columns, which) {
        return which === -1 || columns[which] === undefined ? '' : String(columns[which]);
    };

    const options = [];
    const seen = new Map();
    for (let index = firstDataRow; index < rows.length; index += 1) {
        const columns = rows[index];
        const rawFlag = cell(columns, flagColumn);
        const origin = 'table row ' + (index + 1);
        if (rawFlag === '') {
            warnings.push(warning('invalid-entry', origin + ' has no flag.', { line: index + 1 }));
            continue;
        }
        const help = helpColumn === -1 ? cell(columns, flagColumn + 1) : cell(columns, helpColumn);
        const type = cell(columns, typeColumn);
        const option = buildOption({
            flag: rawFlag,
            help: help,
            label: cell(columns, labelColumn),
            type: type,
            values: cell(columns, valuesColumn),
            defaultValue: cell(columns, defaultColumn),
            required: cell(columns, requiredColumn),
            order: cell(columns, orderColumn),
            index: options.length
        });
        if (!option) {
            warnings.push(warning('invalid-entry', origin + ' has an unusable flag "' + rawFlag + '".', { line: index + 1 }));
            continue;
        }
        if (typeColumn === -1 && type === '') {
            const maybeType = cell(columns, flagColumn + 2).toLowerCase();
            if (TYPES.indexOf(maybeType) !== -1) {
                option.type = maybeType;
                if (maybeType !== 'enum') {
                    option.values = [];
                }
            }
        }
        pushOption(options, warnings, seen, option, origin);
    }
    return { options: options, warnings: warnings };
}

/**
 * Detect the import format and parse it.
 * @param {string} text
 * @returns {{ format: 'json'|'table'|'help', options: Array, warnings: Array }}
 */
function parseImport(text) {
    const trimmed = String(text == null ? '' : text).trim();
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
        const result = parseJsonOptions(text);
        return { format: 'json', options: result.options, warnings: result.warnings };
    }
    if (trimmed.charAt(0) === '|') {
        const result = parseMarkdownTable(text);
        return { format: 'table', options: result.options, warnings: result.warnings };
    }
    const result = parseHelpText(text);
    return { format: 'help', options: result.options, warnings: result.warnings };
}

module.exports = {
    TYPES,
    decodeEntities,
    stripHtml,
    inferType,
    normalizeOption,
    parseHelpText,
    parseJsonOptions,
    parseMarkdownTable,
    parseImport
};
