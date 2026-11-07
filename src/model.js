'use strict';

/**
 * Turns a plain note snapshot into a command definition.
 * Pure: the runtime is responsible for reading FNote objects and passing
 * { noteId, title, content, labels, optionNotes } snapshots.
 */

const Render = require('./render');

const LABELS = {
    root: 'cmRoot',
    command: 'cmCommand',
    template: 'cmTemplate',
    optionTemplate: 'cmOptionTemplate',
    options: 'cmOptions',
    presets: 'cmPresets',
    preset: 'cmPreset',
    description: 'cmDesc',
    tags: 'cmTags',
    base: 'cmBase',
    flag: 'cmFlag',
    mode: 'cmMode',
    placeholder: 'cmPlaceholder',
    type: 'cmType',
    enumValues: 'cmValues',
    defaultValue: 'cmDefault',
    required: 'cmRequired',
    order: 'cmOrder',
    quote: 'cmQuote',
    separator: 'cmSep'
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

    const enumValues = readString(labels, LABELS.enumValues, '')
        .split(',')
        .map(function (entry) {
            return entry.trim();
        })
        .filter(function (entry) {
            return entry !== '';
        });

    const rawDefault = labels[LABELS.defaultValue];
    const defaultValue = rawDefault === undefined || rawDefault === null
        ? (type === 'boolean' ? false : '')
        : String(rawDefault);

    return {
        noteId: snapshot.noteId || null,
        title: title,
        placeholder: readString(labels, LABELS.placeholder, Render.slugify(title)),
        flag: readString(labels, LABELS.flag, ''),
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

function buildCommand(note) {
    const snapshot = note || {};
    const labels = snapshot.labels || {};

    const base = labels[LABELS.base] !== undefined && labels[LABELS.base] !== null
        ? String(labels[LABELS.base])
        : String(snapshot.content || '');

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

    const declared = Render.placeholderNames(base);
    const inferred = declared
        .filter(function (name) {
            return !byPlaceholder[name];
        })
        .map(function (name) {
            return {
                noteId: null,
                title: name,
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
        description: readString(labels, LABELS.description, ''),
        tags: readString(labels, LABELS.tags, ''),
        base: base,
        options: options,
        inferred: inferred,
        placeholders: declared,
        warnings: warnings
    };
}

function defaultValueMap(definition) {
    const values = {};
    const safeDefinition = definition || {};
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
            return [option.title, option.flag, (option.enumValues || []).join(' ')].join(' ');
        })
        .join(' ');
    const haystack = [
        safeDefinition.title,
        safeDefinition.description,
        safeDefinition.tags,
        safeDefinition.base,
        optionText,
        (safeDefinition.optionTitles || []).join(' ')
    ].join(' ').toLowerCase();

    return needle.split(/\s+/).every(function (term) {
        return haystack.indexOf(term) !== -1;
    });
}

module.exports = {
    LABELS,
    LABEL_NAMES,
    TYPES,
    QUOTES,
    optionFromNote,
    sortOptions,
    buildCommand,
    defaultValueMap,
    matches
};