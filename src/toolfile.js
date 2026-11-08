'use strict';

/**
 * Portable tool files: one JSON document that holds everything needed to
 * recreate a tool note (metadata, the three H2 sections, the standard child
 * notes, every option including its note body, the tool tags and the presets).
 *
 * The palette exports a tool with buildToolFile() and imports one with
 * parseToolFile(). Both are pure: no Trilium API, no DOM, no file system.
 *
 * Shape (version 2 only: a file declaring any other version is rejected at
 * import; this plugin reads nothing else. A bare or hand-written object
 * without kind/version is read as the current shape):
 * {
 *   kind: 'command-maker-tool',
 *   version: 2,
 *   tool: {
 *     title, category, base, description, tags,
 *     content, install, usage, help,
 *     options: [ { ...option fields, content }, ... ],
 *     presets: [ { name, values }, ... ]
 *   }
 * }
 *
 * An option uses the same fields the backend option notes store, with the
 * portable names label/help/values/default so an AI model can fill it in
 * without knowing Trilium's labels. `content` carries the option note's body.
 */

const Model = require('./model');
const I18n = require('./i18n');

const TOOL_KIND = 'command-maker-tool';
const FILE_VERSION = 2;
// One tool file must not be able to create thousands of notes in a single
// import: the same bound the parser applies to examples (MAX_EXAMPLES).
const MAX_OPTIONS = 200;

function text(value) {
    return value === undefined || value === null ? '' : String(value);
}

function trimmed(value) {
    return text(value).trim();
}

function nonEmpty(value) {
    return trimmed(value) !== '';
}

function truthy(value) {
    if (value === true) {
        return true;
    }
    return ['true', '1', 'yes', 'on'].indexOf(trimmed(value).toLowerCase()) !== -1;
}

function splitValues(value) {
    if (value === undefined || value === null || value === '') {
        return [];
    }
    const list = Array.isArray(value) ? value : String(value).split(',');
    const out = [];
    for (const entry of list) {
        const next = trimmed(entry);
        if (next !== '' && out.indexOf(next) === -1) {
            out.push(next);
        }
    }
    return out;
}

/** Preset list -> safe [{ name, values }] with primitive own keys only. Never throws. */
function normalisePresets(raw) {
    const out = [];
    if (!Array.isArray(raw)) {
        return out;
    }
    for (const entry of raw) {
        if (!entry || typeof entry.name !== 'string' || trimmed(entry.name) === '') {
            continue;
        }
        const values = {};
        if (entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values)) {
            for (const key of Object.keys(entry.values)) {
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                    continue;
                }
                const value = entry.values[key];
                if (value === null || typeof value === 'object' || typeof value === 'function') {
                    continue;
                }
                values[key] = value;
            }
        }
        out.push({ name: trimmed(entry.name), values: values });
    }
    return out;
}

function normaliseType(raw, warnings) {
    const value = trimmed(raw).toLowerCase();
    if (value === '') {
        return 'string';
    }
    if (Model.TYPES.indexOf(value) !== -1) {
        return value;
    }
    warnings.push({
        code: 'invalid-type',
        message: I18n.t('warn.unknownType', { value: value })
    });
    return 'string';
}

function normaliseDefault(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return '';
    }
    if (typeof raw === 'boolean') {
        return raw ? 'true' : '';
    }
    return trimmed(raw);
}

/** Loose option entry -> the option shape the backend importer understands. */
function normaliseOption(entry, index, warnings) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        warnings.push({
            code: 'invalid-option',
            message: I18n.t('warn.optionEntryNotObject', { index: index + 1 })
        });
        return null;
    }

    const flag = trimmed(entry.flag);
    const label = trimmed(
        entry.label !== undefined ? entry.label
            : (entry.title !== undefined ? entry.title : entry.name)
    );
    if (label === '' && flag === '') {
        warnings.push({
            code: 'invalid-option',
            message: I18n.t('warn.optionEntryNoName', { index: index + 1 })
        });
        return null;
    }

    const type = normaliseType(entry.type, warnings);
    let values = splitValues(entry.values !== undefined ? entry.values : entry.enumValues);
    if (type === 'boolean') {
        values = [];
    }

    const rawDefault = entry.default !== undefined ? entry.default : entry.defaultValue;
    const rawOrder = entry.order === undefined || entry.order === null || trimmed(entry.order) === ''
        ? NaN
        : Number(entry.order);
    const quote = Model.QUOTES.indexOf(trimmed(entry.quote).toLowerCase()) === -1
        ? 'none'
        : trimmed(entry.quote).toLowerCase();

    return {
        label: label === '' ? flag : label,
        flag: flag,
        help: trimmed(entry.help !== undefined ? entry.help : entry.doc),
        content: text(entry.content),
        type: type,
        values: values,
        default: normaliseDefault(rawDefault),
        required: truthy(entry.required),
        mode: trimmed(entry.mode).toLowerCase() === 'inline' ? 'inline' : 'flag',
        placeholder: trimmed(entry.placeholder),
        order: isFinite(rawOrder) ? rawOrder : (index + 1) * 10,
        quote: quote,
        sep: trimmed(entry.sep) === '=' || trimmed(entry.separator) === '=' ? '=' : ' '
    };
}

/** Tool object (exported or hand-written) -> the canonical portable tool. */
function normaliseTool(spec, warnings) {
    const source = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
    const options = [];
    if (Array.isArray(source.options)) {
        for (let index = 0; index < source.options.length; index += 1) {
            const option = normaliseOption(source.options[index], index, warnings);
            if (option) {
                options.push(option);
            }
        }
    } else if (source.options !== undefined && source.options !== null) {
        warnings.push({
            code: 'invalid-options',
            message: I18n.t('warn.optionsNotArray')
        });
    }

    return {
        title: trimmed(source.title),
        category: trimmed(source.category),
        base: trimmed(source.base),
        description: trimmed(source.description),
        tags: trimmed(source.tags),
        content: text(source.content),
        install: text(source.install),
        usage: text(source.usage),
        help: text(source.help),
        options: options,
        presets: normalisePresets(source.presets)
    };
}

/**
 * Tool data -> a portable file object ready for JSON.stringify.
 * @param {object} tool
 * @returns {{ kind: string, version: number, tool: object }}
 */
function buildToolFile(tool) {
    return {
        kind: TOOL_KIND,
        version: FILE_VERSION,
        tool: normaliseTool(tool, [])
    };
}

/**
 * Parse a tool file. Accepts the exported envelope, `{ tool: {...} }` or a bare
 * tool object. Never throws; unusable input becomes warnings.
 * @param {string} source
 * @returns {{ tool: object|null, warnings: Array }}
 */
function parseToolFile(source) {
    const warnings = [];
    const raw = text(source).trim();
    if (raw === '') {
        warnings.push({ code: 'invalid-json', message: I18n.t('warn.fileEmpty') });
        return { tool: null, warnings: warnings };
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        warnings.push({
            code: 'invalid-json',
            message: I18n.t('warn.notValidJson', { error: error && error.message ? error.message : error })
        });
        return { tool: null, warnings: warnings };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        warnings.push({ code: 'invalid-json', message: I18n.t('warn.fileNotObject') });
        return { tool: null, warnings: warnings };
    }

    // Only the current file shape is read: a file that declares a version the
    // plugin cannot interpret is refused instead of being half-trusted.
    if (data.version !== undefined && trimmed(data.version) !== String(FILE_VERSION)) {
        warnings.push({
            code: 'unsupported-version',
            message: I18n.t('warn.unsupportedVersion', { supported: FILE_VERSION, version: trimmed(data.version) })
        });
        return { tool: null, warnings: warnings };
    }
    if (data.kind !== undefined && trimmed(data.kind) !== '' && trimmed(data.kind) !== TOOL_KIND) {
        warnings.push({
            code: 'unexpected-kind',
            message: I18n.t('warn.unexpectedKind', { kind: trimmed(data.kind), expected: TOOL_KIND })
        });
    }

    const spec = data.tool && typeof data.tool === 'object' && !Array.isArray(data.tool)
        ? data.tool
        : data;
    const tool = normaliseTool(spec, warnings);
    if (!nonEmpty(tool.title)) {
        warnings.push({ code: 'missing-title', message: I18n.t('warn.missingTitle') });
        return { tool: null, warnings: warnings };
    }
    if (tool.options.length > MAX_OPTIONS) {
        warnings.push({
            code: 'too-many-options',
            message: I18n.t('warn.tooManyOptions', { count: tool.options.length, max: MAX_OPTIONS })
        });
        tool.options = tool.options.slice(0, MAX_OPTIONS);
    }

    return { tool: tool, warnings: warnings };
}

module.exports = {
    TOOL_KIND,
    FILE_VERSION,
    MAX_OPTIONS,
    normalisePresets,
    buildToolFile,
    parseToolFile
};