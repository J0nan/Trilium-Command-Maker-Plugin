'use strict';

/**
 * Portable tool files: one JSON document that holds everything needed to
 * recreate a tool note (metadata, the three H2 sections, the standard child
 * notes and every option).
 *
 * The palette exports a tool with buildToolFile() and imports one with
 * parseToolFile(). Both are pure: no Trilium API, no DOM, no file system.
 *
 * Shape:
 * {
 *   kind: 'command-maker-tool',
 *   version: 1,
 *   tool: {
 *     title, category, base, description,
 *     content, install, usage, help,
 *     options: [ option, ... ]
 *   }
 * }
 *
 * An option uses the same fields the backend option notes store, with the
 * portable names label/help/values/default so an AI model can fill it in
 * without knowing Trilium's labels.
 */

const Model = require('./model');

const TOOL_KIND = 'command-maker-tool';
const FILE_VERSION = 1;

const QUOTES = ['none', 'single', 'double'];

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
        message: 'Unknown option type "' + value + '"; using string.'
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
            message: 'Option entry ' + (index + 1) + ' is not an object.'
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
            message: 'Option entry ' + (index + 1) + ' has no label and no flag.'
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
    const quote = QUOTES.indexOf(trimmed(entry.quote).toLowerCase()) === -1
        ? 'none'
        : trimmed(entry.quote).toLowerCase();

    return {
        label: label === '' ? flag : label,
        flag: flag,
        help: trimmed(entry.help !== undefined ? entry.help : entry.doc),
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
            message: 'The tool "options" field is not an array; no options were read.'
        });
    }

    return {
        title: trimmed(source.title),
        category: trimmed(source.category),
        base: trimmed(source.base),
        description: trimmed(source.description),
        content: text(source.content),
        install: text(source.install),
        usage: text(source.usage),
        help: text(source.help),
        options: options
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
        warnings.push({ code: 'invalid-json', message: 'The tool file is empty.' });
        return { tool: null, warnings: warnings };
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        warnings.push({
            code: 'invalid-json',
            message: 'Not valid JSON: ' + (error && error.message ? error.message : error)
        });
        return { tool: null, warnings: warnings };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        warnings.push({ code: 'invalid-json', message: 'The tool file must be a JSON object.' });
        return { tool: null, warnings: warnings };
    }

    const spec = data.tool && typeof data.tool === 'object' && !Array.isArray(data.tool)
        ? data.tool
        : data;
    const tool = normaliseTool(spec, warnings);
    if (!nonEmpty(tool.title)) {
        warnings.push({ code: 'missing-title', message: 'The tool file has no "title".' });
        return { tool: null, warnings: warnings };
    }

    return { tool: tool, warnings: warnings };
}

module.exports = {
    TOOL_KIND,
    FILE_VERSION,
    normaliseOption,
    normaliseTool,
    buildToolFile,
    parseToolFile
};