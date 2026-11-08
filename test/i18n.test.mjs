import test from 'node:test';
import assert from 'node:assert/strict';

import I18n from '../src/i18n.js';
import Model from '../src/model.js';
import Sections from '../src/sections.js';
import Prompt from '../src/prompt.js';

test('every English key has a Spanish counterpart', () => {
    const english = Object.keys(I18n.DICTIONARIES.en).sort();
    const spanish = Object.keys(I18n.DICTIONARIES.es).sort();
    assert.deepEqual(spanish, english, 'the two catalogs must stay in sync');
});

test('normalizeLocale accepts language tags and rejects unknown languages', () => {
    assert.equal(I18n.normalizeLocale('es-ES'), 'es');
    assert.equal(I18n.normalizeLocale('ES_es'), 'es');
    assert.equal(I18n.normalizeLocale('en-GB'), 'en');
    assert.equal(I18n.normalizeLocale('fr-FR'), '');
    assert.equal(I18n.normalizeLocale(''), '');
    assert.equal(I18n.normalizeLocale(null), '');
});

test('detectLocale takes the first supported preference and falls back to English', () => {
    assert.equal(I18n.detectLocale(['fr-CA', 'es-ES', 'en-US']), 'es');
    assert.equal(I18n.detectLocale(['de-DE', 'fr-FR']), 'en');
    assert.equal(I18n.detectLocale([]), 'en');
    assert.equal(I18n.detectLocale('es-MX'), 'es');
});

test('setLocale switches languages and ignores unsupported values', () => {
    try {
        assert.equal(I18n.setLocale('es-ES'), 'es');
        assert.equal(I18n.getLocale(), 'es');
        assert.equal(I18n.t('ui.newTool'), 'Nueva herramienta');
        assert.equal(I18n.setLocale('fr'), 'en');
        assert.equal(I18n.getLocale(), 'en');
        assert.equal(I18n.t('ui.newTool'), 'New tool');
    } finally {
        I18n.setLocale('en');
    }
});

test('t falls back to English, then to the key, and interpolates parameters', () => {
    try {
        I18n.setLocale('es');
        assert.equal(I18n.t('does.not.exist'), 'does.not.exist');
        assert.equal(
            I18n.t('status.confirmDelete', { name: 'web' }),
            'Pulsa Borrar otra vez para eliminar "web".'
        );
        assert.match(I18n.t('warn.placeholderNoValue', { name: 'input' }), /\{\{input\}\}/);
    } finally {
        I18n.setLocale('en');
    }
});

test('counted Spanish messages use real plurals', () => {
    try {
        I18n.setLocale('es');
        assert.equal(I18n.t('import.imported', { created: 1 }), 'Se importó 1 opción.');
        assert.equal(
            I18n.t('import.imported', { created: 3, skipped: 2, capped: 0 }),
            'Se importaron 3 opciones. Se omitieron 2 duplicadas.'
        );
        assert.equal(I18n.t('import.parsed', { count: 1 }), 'Se analizó 1 opción.');
        assert.equal(I18n.t('import.parsed', { count: 4 }), 'Se analizaron 4 opciones.');
    } finally {
        I18n.setLocale('en');
    }
});

test('backendStrings are plain values the serialized backend can read', () => {
    try {
        I18n.setLocale('es');
        const strings = I18n.backendStrings();
        assert.equal(strings['back.noteInstall'], 'Instalación');
        assert.equal(strings['back.noteUsage'], 'Uso');
        assert.match(strings['back.toolContent'], /<h2>¿Qué es\?<\/h2>/);
        for (const [key, value] of Object.entries(strings)) {
            assert.equal(typeof value, 'string', key + ' must serialize as a string');
            assert.equal(value.indexOf('{'), -1, key + ' must not need parameters');
        }
    } finally {
        I18n.setLocale('en');
    }
});

test('Spanish section headings parse like the English ones', () => {
    const html = [
        '<h2>¿Qué es?</h2><p>Codifica y procesa vídeo.</p>',
        '<h2>Enlaces oficiales</h2><ul><li><a href="https://ffmpeg.org">ffmpeg.org</a></li></ul>',
        '<h2>Enlaces útiles</h2><ul><li><a href="https://ffmpeg.org/ffmpeg.html">Referencia</a></li></ul>'
    ].join('');
    const parsed = Sections.parseToolNote(html);
    assert.equal(parsed.whatIs, 'Codifica y procesa vídeo.');
    assert.equal(parsed.officialLinks.length, 1);
    assert.equal(parsed.usefulLinks.length, 1);
    assert.equal(parsed.links.length, 2);
});

test('the Spanish tool template stays a parseable three-section body', () => {
    try {
        I18n.setLocale('es');
        const content = Model.toolTemplate();
        assert.match(content, /<h2>¿Qué es\?<\/h2>/);
        assert.match(content, /<h2>Enlaces oficiales<\/h2>/);
        assert.match(content, /<h2>Enlaces útiles<\/h2>/);
        const parsed = Sections.parseToolNote(content);
        assert.match(parsed.whatIs, /Describe qué hace esta herramienta/);
        const notes = Model.newToolNotes();
        assert.match(notes.install, /instalación/i);
        assert.match(notes.usage, /ejemplos/i);
    } finally {
        I18n.setLocale('en');
    }
});

test('seeded tools follow the active language without losing their data', () => {
    try {
        I18n.setLocale('es');
        const tools = Model.seedTools();
        assert.deepEqual(tools.map((tool) => tool.category), ['Control de versiones', 'Red']);
        assert.deepEqual(tools.map((tool) => tool.title), ['git commit', 'curl']);
        const git = tools[0];
        assert.match(git.content, /<h2>¿Qué es\?<\/h2>/);
        assert.equal(git.options[0].label, 'Mensaje');
        assert.equal(git.options[0].flag, '-m');
        assert.ok(git.help.indexOf('usage: git commit') === 0, 'raw help output is not translated');
    } finally {
        I18n.setLocale('en');
    }
});

test('the AI prompt follows the locale but keeps the file format values', () => {
    try {
        I18n.setLocale('es');
        const text = Prompt.buildToolPrompt({ title: 'ripgrep', helpText: 'Usage: rg [options]' });
        assert.match(text, /Reglas:/);
        assert.match(text, /Enlaces oficiales/);
        assert.match(text, /Nombre de la herramienta: ripgrep/);
        assert.match(text, /"kind": "command-maker-tool"/);
        assert.match(text, /"type": "path"/);
    } finally {
        I18n.setLocale('en');
    }
});