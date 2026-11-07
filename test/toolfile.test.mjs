import test from 'node:test';
import assert from 'node:assert/strict';

import ToolFile from '../src/toolfile.js';

const option = {
    label: 'Input file',
    flag: '-i',
    help: 'Input file to read.',
    type: 'path',
    values: [],
    default: 'in.mp4',
    required: true,
    mode: 'flag',
    placeholder: 'input',
    order: 10,
    quote: 'none',
    sep: ' '
};

const positional = {
    label: 'URL',
    flag: '',
    help: 'URL to request.',
    type: 'string',
    values: [],
    default: '',
    required: true,
    mode: 'flag',
    placeholder: 'url',
    order: 100,
    quote: 'double',
    sep: ' '
};

function sampleTool() {
    return {
        title: 'ffmpeg',
        category: 'Media',
        base: 'ffmpeg',
        description: 'Media toolkit',
        content: '<h2>What is?</h2><p>Encode video.</p><h2>Official links</h2><ul></ul><h2>Useful links</h2><ul></ul>',
        install: '<p>winget install ffmpeg</p>',
        usage: '<pre><code>ffmpeg -i in.mp4 out.mp4</code></pre>',
        help: 'Usage: ffmpeg [options]',
        options: [option, positional]
    };
}

test('buildToolFile wraps the tool with a kind and a version', () => {
    const file = ToolFile.buildToolFile(sampleTool());

    assert.equal(file.kind, ToolFile.TOOL_KIND);
    assert.equal(file.version, ToolFile.FILE_VERSION);
    assert.equal(file.tool.title, 'ffmpeg');
    assert.equal(file.tool.category, 'Media');
    assert.equal(file.tool.options.length, 2);
    assert.equal(file.tool.options[0].label, 'Input file');
    assert.deepEqual(file.tool.options[0].values, []);
    assert.equal(file.tool.options[1].flag, '', 'positional options keep an empty flag');
});

test('a built file survives a JSON round trip through parseToolFile', () => {
    const file = ToolFile.buildToolFile(sampleTool());
    const text = JSON.stringify(file, null, 2);
    const parsed = ToolFile.parseToolFile(text);

    assert.deepEqual(parsed.warnings, []);
    assert.deepEqual(parsed.tool, file.tool);
});

test('parseToolFile accepts a bare tool object and a tool envelope', () => {
    const bare = ToolFile.parseToolFile(JSON.stringify(sampleTool()));
    assert.equal(bare.tool.title, 'ffmpeg');
    assert.equal(bare.warnings.length, 0);

    const wrapped = ToolFile.parseToolFile(JSON.stringify({ tool: sampleTool() }));
    assert.equal(wrapped.tool.title, 'ffmpeg');
    assert.equal(wrapped.tool.options.length, 2);
});

test('parseToolFile normalizes loose options and derived defaults', () => {
    const parsed = ToolFile.parseToolFile(JSON.stringify({
        tool: {
            title: 'rg',
            options: [
                { title: 'Ignore case', flag: '--ignore-case', doc: 'Case insensitive.', type: 'boolean' },
                { flag: '-j', help: 'Threads.', type: 'number', values: '2,4,8', required: 'yes' },
                { label: 'Pattern', flag: '', placeholder: 'pattern' }
            ]
        }
    }));

    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.tool.options[0].label, 'Ignore case');
    assert.equal(parsed.tool.options[0].help, 'Case insensitive.');
    assert.equal(parsed.tool.options[1].label, '-j');
    assert.deepEqual(parsed.tool.options[1].values, ['2', '4', '8']);
    assert.equal(parsed.tool.options[1].required, true);
    assert.equal(parsed.tool.options[2].flag, '', 'positional options are valid');
    assert.equal(parsed.tool.options[2].type, 'string');
    assert.equal(parsed.tool.options[2].order, 30, 'order falls back to the entry position');
});

test('parseToolFile reports unusable entries instead of throwing', () => {
    const invalid = ToolFile.parseToolFile('{not json');
    assert.equal(invalid.tool, null);
    assert.match(invalid.warnings[0].message, /JSON/i);

    const empty = ToolFile.parseToolFile('');
    assert.equal(empty.tool, null);
    assert.ok(empty.warnings.length > 0);

    const missingTitle = ToolFile.parseToolFile(JSON.stringify({ options: [] }));
    assert.equal(missingTitle.tool, null);
    assert.match(missingTitle.warnings.map((warning) => warning.code).join(' '), /title/);

    const badOptions = ToolFile.parseToolFile(JSON.stringify({
        title: 'x',
        options: [{ help: 'no label and no flag' }, 'nope', { label: 'Ok', flag: '-o' }]
    }));
    assert.equal(badOptions.tool.title, 'x');
    assert.equal(badOptions.tool.options.length, 1);
    assert.equal(badOptions.warnings.length, 2);
});

test('unknown option types fall back to string with a warning', () => {
    const parsed = ToolFile.parseToolFile(JSON.stringify({
        title: 'x',
        options: [{ label: 'Thing', flag: '-t', type: 'mystery' }]
    }));
    assert.equal(parsed.tool.options[0].type, 'string');
    assert.ok(parsed.warnings.some((warning) => warning.code === 'invalid-type'));
});