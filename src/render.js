'use strict';

const I18n = require('./i18n');

/**
 * Pure command assembly. No Trilium API, no DOM; safe to unit test in Node.
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

/** Value-map key for the free-text arguments inserted right after the base. */
const EXTRA_KEY = 'cm:extra';

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

/** Values are user labels, so only own quoter names are honoured. */
function quoterFor(mode) {
    const name = String(mode == null ? '' : mode);
    return Object.prototype.hasOwnProperty.call(QUOTERS, name) ? QUOTERS[name] : QUOTERS.none;
}

function slugify(text) {
    return String(text == null ? '' : text)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function quote(value, mode) {
    return quoterFor(mode)(String(value));
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
    PLACEHOLDER_RE.lastIndex = 0;
    let match = PLACEHOLDER_RE.exec(source);
    while (match !== null) {
        if (match[0].charAt(0) !== '\\' && names.indexOf(match[1]) === -1) {
            names.push(match[1]);
        }
        match = PLACEHOLDER_RE.exec(source);
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

/** Flag text without its leading dashes; the alphabetical tie-break below. */
function flagSortKey(option) {
    return String(option && option.flag != null ? option.flag : '').trim().replace(/^-+/, '');
}

/**
 * Command insertion order, shared by the renderer and the palette so the GUI
 * lists options exactly as they will be emitted: cmOrder, then the flag
 * alphabetically ignoring its leading dashes, then title and note id for
 * stability.
 */
function compareOptions(left, right) {
    const leftOrder = typeof left.order === 'number' ? left.order : 100;
    const rightOrder = typeof right.order === 'number' ? right.order : 100;
    if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
    }
    const leftFlag = flagSortKey(left).toLowerCase();
    const rightFlag = flagSortKey(right).toLowerCase();
    if (leftFlag && rightFlag && leftFlag !== rightFlag) {
        return leftFlag < rightFlag ? -1 : 1;
    }
    if (left.title !== right.title) {
        return String(left.title) < String(right.title) ? -1 : 1;
    }
    const leftId = String(left.noteId);
    const rightId = String(right.noteId);
    if (leftId === rightId) {
        return 0;
    }
    return leftId < rightId ? -1 : 1;
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

    const inlineNames = placeholderNames(base);

    // A Map, like every other name-keyed structure in this codebase: base
    // placeholders are user text, so `{{constructor}}` or `{{__proto__}}` must
    // stay an ordinary name instead of resolving to an Object.prototype member.
    const byPlaceholder = new Map();
    for (const option of options) {
        if (option && option.placeholder && !byPlaceholder.has(option.placeholder)) {
            byPlaceholder.set(option.placeholder, option);
        }
    }

    PLACEHOLDER_RE.lastIndex = 0;
    const substituted = base.replace(PLACEHOLDER_RE, function (match, name) {
        if (match.charAt(0) === '\\') {
            return match.slice(1);
        }
        const option = byPlaceholder.get(name);
        const key = option ? valueKey(option) : 'ph:' + name;
        const value = valueMap[key];
        if (isEmpty(value)) {
            warnings.push({
                code: 'missing-placeholder',
                message: I18n.t('warn.placeholderNoValue', { name: name })
            });
            return '';
        }
        if (option && option.type === 'number' && !isFinite(Number(value))) {
            warnings.push({
                code: 'invalid-number',
                message: I18n.t('warn.placeholderNotNumber', { name: name })
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
                    message: I18n.t('warn.inlineMissing', { title: option.title, placeholder: option.placeholder })
                });
            }
            continue;
        }

        const value = valueMap[valueKey(option)];
        if (isEmpty(value)) {
            if (option.required) {
                warnings.push({
                    code: 'missing-required',
                    message: I18n.t('warn.optionRequired', { title: option.title })
                });
            }
            continue;
        }

        if (option.type === 'number' && !isFinite(Number(value))) {
            warnings.push({
                code: 'invalid-number',
                message: I18n.t('warn.optionNotNumber', { title: option.title })
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

    const parts = [substituted.trim()];
    const extra = valueMap[EXTRA_KEY];
    if (!isEmpty(extra)) {
        parts.push(String(extra).trim());
    }
    for (const segment of segments) {
        if (segment) {
            parts.push(segment);
        }
    }

    return { command: parts.filter(function (part) { return part !== ''; }).join(' '), warnings: warnings };
}

module.exports = {
    EXTRA_KEY,
    slugify,
    isEmpty,
    isTruthyFlag,
    placeholderNames,
    valueKey,
    compareOptions,
    renderCommand
};