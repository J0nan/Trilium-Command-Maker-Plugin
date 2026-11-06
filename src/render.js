'use strict';

/**
 * Pure command assembly. No Trilium API, no DOM — safe to unit test in Node.
 *
 * A command definition looks like:
 * {
 *   title: 'ffmpeg compress',
 *   base: 'ffmpeg -i "{{input}}"',
 *   options: [ option, ... ],
 *   inferred: [ option, ... ]   // placeholders without a backing option note
 * }
 *
 * An option looks like:
 * {
 *   noteId, title, placeholder, flag, mode: 'flag'|'inline',
 *   type: 'string'|'path'|'number'|'boolean'|'enum',
 *   enumValues: [], defaultValue, required, order, quote: 'none'|'single'|'double',
 *   sep: ' '|'='
 * }
 */

const PLACEHOLDER_RE = /\\?\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const PLACEHOLDER_SOURCE_RE = /\\?\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

const QUOTERS = {
    none(value) {
        return value;
    },
    single(value) {
        return "'" + String(value).replace(/'/g, "'\\''") + "'";
    },
    double(value) {
        return '"' + String(value).replace(/([\\"$`])/g, '\\$1') + '"';
    }
};

function slugify(text) {
    return String(text == null ? '' : text)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function quote(value, mode) {
    const quoter = QUOTERS[mode] || QUOTERS.none;
    return quoter(String(value));
}

function isEmpty(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function isTruthyFlag(value) {
    if (value === true) {
        return true;
    }
    const normalised = String(value).trim().toLowerCase();
    return normalised === 'true' || normalised === '1' || normalised === 'yes' || normalised === 'on';
}

/** Placeholder names used by a base string, in order, ignoring `\{{escaped}}`. */
function placeholderNames(base) {
    const names = [];
    const source = String(base == null ? '' : base);
    PLACEHOLDER_SOURCE_RE.lastIndex = 0;
    let match = PLACEHOLDER_SOURCE_RE.exec(source);
    while (match !== null) {
        if (match[0].charAt(0) !== '\\' && names.indexOf(match[1]) === -1) {
            names.push(match[1]);
        }
        match = PLACEHOLDER_SOURCE_RE.exec(source);
    }
    return names;
}

/** Stable key used to store a value for an option (note-backed or inferred). */
function valueKey(option) {
    if (!option) {
        return '';
    }
    if (option.noteId) {
        return 'note:' + option.noteId;
    }
    return 'ph:' + (option.placeholder || option.name || '');
}

/** Same precedence as Model.sortOptions: cmOrder, then title, then note id. */
function compareOptions(left, right) {
    const leftOrder = typeof left.order === 'number' ? left.order : 100;
    const rightOrder = typeof right.order === 'number' ? right.order : 100;
    if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
    }
    if (left.title !== right.title) {
        return String(left.title) < String(right.title) ? -1 : 1;
    }
    return String(left.noteId) < String(right.noteId) ? -1 : 1;
}

function formatValue(option, value) {
    const flag = option.flag || '';
    const separator = option.sep === '=' ? '=' : ' ';

    if (option.type === 'boolean') {
        const on = isTruthyFlag(value);
        if (!flag) {
            return on ? 'true' : 'false';
        }
        return on ? flag : '';
    }

    const rendered = option.type === 'number' ? String(value) : quote(value, option.quote);

    if (!flag) {
        return rendered;
    }
    return separator === '=' ? flag + '=' + rendered : flag + ' ' + rendered;
}

/**
 * Renders a definition with a value map. Never throws: problems become warnings.
 * @returns {{ command: string, warnings: Array<{code: string, message: string}> }}
 */
function renderCommand(definition, values) {
    const warnings = [];
    const safeDefinition = definition || {};
    const base = String(safeDefinition.base == null ? '' : safeDefinition.base);
    const options = Array.isArray(safeDefinition.options) ? safeDefinition.options : [];
    const valueMap = values || {};

    const byPlaceholder = {};
    for (const option of options) {
        if (option && option.placeholder && !byPlaceholder[option.placeholder]) {
            byPlaceholder[option.placeholder] = option;
        }
    }

    const inlineNames = placeholderNames(base);

    PLACEHOLDER_RE.lastIndex = 0;
    const substituted = base.replace(PLACEHOLDER_RE, function (match, name) {
        if (match.charAt(0) === '\\') {
            return match.slice(1);
        }
        const option = byPlaceholder[name];
        const key = option ? valueKey(option) : 'ph:' + name;
        const value = valueMap[key];
        if (isEmpty(value)) {
            warnings.push({
                code: 'missing-placeholder',
                message: 'Placeholder {{' + name + '}} has no value.'
            });
            return '';
        }
        if (option && option.type === 'number' && !isFinite(Number(value))) {
            warnings.push({
                code: 'invalid-number',
                message: 'Placeholder {{' + name + '}} expects a number.'
            });
        }
        return String(value);
    });

    const segments = [];
    const orderedOptions = options.slice().sort(compareOptions);
    for (const option of orderedOptions) {
        const isInline = inlineNames.indexOf(option.placeholder) !== -1;

        if (isInline) {
            continue;
        }

        if (option.mode === 'inline') {
            if (option.placeholder) {
                warnings.push({
                    code: 'unused-inline',
                    message: 'Option "' + option.title + '" is inline but {{' + option.placeholder + '}} is not in the command.'
                });
            }
            continue;
        }

        const value = valueMap[valueKey(option)];
        if (isEmpty(value)) {
            if (option.required) {
                warnings.push({
                    code: 'missing-required',
                    message: 'Option "' + option.title + '" is required.'
                });
            }
            continue;
        }

        if (option.type === 'number' && !isFinite(Number(value))) {
            warnings.push({
                code: 'invalid-number',
                message: 'Option "' + option.title + '" expects a number.'
            });
            continue;
        }

        if (option.type === 'boolean' && !isTruthyFlag(value)) {
            continue;
        }

        const segment = formatValue(option, value);
        if (segment) {
            segments.push(segment);
        }
    }

    const parts = [substituted.trim()].concat(segments).filter(function (part) {
        return part !== '';
    });

    return { command: parts.join(' '), warnings: warnings };
}

module.exports = {
    slugify,
    quote,
    isEmpty,
    isTruthyFlag,
    placeholderNames,
    valueKey,
    formatValue,
    renderCommand
};