import test from 'node:test';
import assert from 'node:assert/strict';

import I18n from '../src/i18n.js';
import Prompt from '../src/prompt.js';

test('the AI prompt describes the tool file shape and asks for JSON only', () => {
    const text = Prompt.buildToolPrompt();

    assert.match(text, /command-maker-tool/);
    assert.match(text, /Return only the JSON object/i);
    assert.match(text, /"options"/);
    assert.match(text, /What is\?/);
    assert.match(text, /Official links/);
    assert.match(text, /Useful links/);
    assert.match(text, /boolean/);
    assert.match(text, /path/);
    assert.match(text, /enum/);
    assert.match(text, /positional/i);
    assert.ok(text.indexOf('--help') !== -1, 'the prompt mentions the help output');
});

test('the AI prompt embeds the tool name and the pasted help output', () => {
    const text = Prompt.buildToolPrompt({
        title: 'ripgrep',
        helpText: 'Usage: rg [OPTIONS] PATTERN\n  -i, --ignore-case  case insensitive'
    });

    assert.match(text, /Tool name: ripgrep/);
    assert.match(text, /Usage: rg \[OPTIONS\] PATTERN/);
    assert.match(text, /--ignore-case/);
});

test('the AI prompt asks for install commands as code blocks, not inline code', () => {
    const text = Prompt.buildToolPrompt();

    assert.match(text, /"install": "[^"]*<pre><code>/);
    assert.match(text, /Never use inline <code> for install commands/i);
});

test('the AI prompt leaves clear placeholders when the input is missing', () => {
    const text = Prompt.buildToolPrompt();

    assert.match(text, /<tool name>/i);
    assert.match(text, /<paste the output/i);
});

test('an empty or junk help text does not add an empty section', () => {
    const text = Prompt.buildToolPrompt({ title: '   ', helpText: '   ' });

    assert.match(text, /<tool name>/i);
    assert.equal(text.includes('Tool name: \n'), false);
});

/**
 * The schema example is the one block a model is asked to imitate verbatim,
 * so it must stay machine-readable whatever the active translation does.
 */
function exampleJson(text) {
    const start = text.indexOf('{\n  "kind"');
    assert.ok(start !== -1, 'the prompt carries the example document');
    const end = text.indexOf('\n}', start);
    assert.ok(end !== -1, 'the example document is closed');
    return JSON.parse(text.slice(start, end + 2));
}

test('the example tool file in the prompt is valid JSON', () => {
    const parsed = exampleJson(Prompt.buildToolPrompt());
    assert.equal(parsed.kind, 'command-maker-tool');
    assert.equal(parsed.version, 2);
    assert.equal(parsed.tool.options[0].type, 'path');
});

test('a translation with quotes cannot break the example tool file', () => {
    const key = 'prompt.schemaTitle';
    const catalogue = I18n.DICTIONARIES.en;
    const original = catalogue[key];
    try {
        catalogue[key] = '<command name, e.g. "git commit">';
        const parsed = exampleJson(Prompt.buildToolPrompt());
        assert.equal(parsed.tool.title, '<command name, e.g. "git commit">');
    } finally {
        catalogue[key] = original;
    }
});
