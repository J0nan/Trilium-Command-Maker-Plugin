import test from 'node:test';
import assert from 'node:assert/strict';

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