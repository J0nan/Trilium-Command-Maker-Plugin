import test from 'node:test';
import assert from 'node:assert/strict';

import Model from '../src/model.js';

function optionNote(spec) {
    return {
        noteId: spec.noteId,
        title: spec.title,
        labels: spec.labels || {}
    };
}

test('deriveBase turns a tool title into a safe command name', () => {
    assert.equal(Model.deriveBase('Git commit'), 'git commit');
    assert.equal(Model.deriveBase('FFmpeg'), 'ffmpeg');
    assert.equal(Model.deriveBase('C++ compiler'), 'c++ compiler');
    assert.equal(Model.deriveBase('  My  Tool!!  '), 'my tool');
    assert.equal(Model.deriveBase(''), '');
});

test('optionFromNote applies defaults', () => {
    const option = Model.optionFromNote({ noteId: 'n1', title: 'Video codec', labels: {} });
    assert.equal(option.placeholder, 'video_codec');
    assert.equal(option.flag, '');
    assert.equal(option.mode, 'flag');
    assert.equal(option.type, 'string');
    assert.equal(option.quote, 'none');
    assert.equal(option.sep, ' ');
    assert.equal(option.order, 100);
    assert.equal(option.required, false);
    assert.equal(option.defaultValue, '');
    assert.equal(option.help, '');
    assert.deepEqual(option.enumValues, []);
});

test('optionFromNote reads the option help string and normalises labels', () => {
    const option = Model.optionFromNote({
        noteId: 'n1',
        title: 'Codec',
        labels: {
            cmFlag: '-c:v',
            cmDoc: 'Video encoder to use.',
            cmType: 'ENUM',
            cmValues: 'libx264, libx265 , libvpx-vp9',
            cmDefault: 'libx265',
            cmQuote: 'single',
            cmSep: '=',
            cmRequired: 'true',
            cmOrder: '20',
            cmPlaceholder: 'codec',
            cmMode: 'inline'
        }
    });
    assert.equal(option.help, 'Video encoder to use.');
    assert.equal(option.type, 'enum');
    assert.deepEqual(option.enumValues, ['libx264', 'libx265', 'libvpx-vp9']);
    assert.equal(option.defaultValue, 'libx265');
    assert.equal(option.quote, 'single');
    assert.equal(option.sep, '=');
    assert.equal(option.required, true);
    assert.equal(option.order, 20);
    assert.equal(option.placeholder, 'codec');
    assert.equal(option.mode, 'inline');
});

test('placeholder defaults to the flag name when no explicit placeholder exists', () => {
    const option = Model.optionFromNote({
        noteId: 'n1',
        title: 'Input file',
        labels: { cmFlag: '--input-file' }
    });
    assert.equal(option.placeholder, 'input_file');
});

test('unknown type and quote fall back to safe values', () => {
    const option = Model.optionFromNote({
        noteId: 'n1',
        title: 'X',
        labels: { cmType: 'money', cmQuote: 'shell' }
    });
    assert.equal(option.type, 'string');
    assert.equal(option.quote, 'none');
});

test('boolean options default to false', () => {
    const option = Model.optionFromNote({ noteId: 'n1', title: 'Verbose', labels: { cmType: 'boolean' } });
    assert.equal(option.defaultValue, false);
});

test('buildTool carries category, help strings and examples', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'ffmpeg',
        category: 'Media',
        content: '<h2>What is?</h2><p>Video tool.</p>',
        labels: { cmDesc: 'Media toolkit' },
        optionNotes: [
            optionNote({ noteId: 'o1', title: 'Input file', labels: { cmFlag: '-i', cmDoc: 'Input file.', cmType: 'path' } })
        ],
        examples: ['ffmpeg -i in.mp4 out.mp4']
    });
    assert.equal(definition.base, 'ffmpeg');
    assert.equal(definition.category, 'Media');
    assert.equal(definition.categoryLabel, 'Media', 'a flat category is its own label');
    assert.deepEqual(definition.categoryPath, []);
    assert.equal(definition.description, 'Media toolkit');
    assert.equal(definition.options[0].help, 'Input file.');
    assert.deepEqual(definition.examples, ['ffmpeg -i in.mp4 out.mp4']);
});

test('buildTool carries a nested category path and joins it into one label', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'iwconfig',
        category: 'Wifi',
        categoryPath: ['Infrastructure', 'Wifi'],
        content: '',
        labels: {},
        optionNotes: []
    });
    assert.equal(definition.category, 'Wifi');
    assert.deepEqual(definition.categoryPath, ['Infrastructure', 'Wifi']);
    assert.equal(definition.categoryLabel, 'Infrastructure / Wifi');
});

test('#cmBase overrides the derived base', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'Git commit',
        content: 'ignored',
        labels: { cmBase: 'git commit --no-pager' },
        optionNotes: []
    });
    assert.equal(definition.base, 'git commit --no-pager');
});

test('buildTool discovers placeholders without an option', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'Copy',
        labels: { cmBase: 'cp {{source}} {{target}}' },
        optionNotes: [
            optionNote({ noteId: 'o1', title: 'Source', labels: { cmPlaceholder: 'source', cmFlag: '-s' } })
        ]
    });
    assert.equal(definition.base, 'cp {{source}} {{target}}');
    assert.equal(definition.options.length, 1);
    assert.deepEqual(definition.inferred.map((entry) => entry.placeholder), ['target']);
});

test('placeholder names that collide with Object properties stay ordinary', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'X',
        labels: { cmBase: 'run {{constructor}} {{__proto__}}' },
        optionNotes: []
    });
    assert.deepEqual(definition.placeholders, ['constructor', '__proto__']);
    assert.deepEqual(
        definition.inferred.map((entry) => entry.placeholder),
        ['constructor', '__proto__'],
        'inherited names are not mistaken for options that already exist'
    );
    assert.equal(definition.warnings.length, 0);
});

test('duplicate placeholders produce a warning', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'X',
        labels: { cmBase: 'run' },
        optionNotes: [
            optionNote({ noteId: 'o1', title: 'One', labels: { cmPlaceholder: 'same', cmFlag: '--one' } }),
            optionNote({ noteId: 'o2', title: 'Two', labels: { cmPlaceholder: 'same', cmFlag: '--two' } })
        ]
    });
    assert.equal(definition.options.length, 2);
    assert.equal(definition.warnings[0].code, 'duplicate-placeholder');
});

test('defaultValueMap keys options by note, inferred placeholders by name, and includes extra args', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'X',
        labels: { cmBase: 'run {{free}}' },
        optionNotes: [
            optionNote({ noteId: 'o1', title: 'Opt', labels: { cmPlaceholder: 'opt', cmDefault: 'd' } })
        ]
    });
    const values = Model.defaultValueMap(definition);
    assert.equal(values['note:o1'], 'd');
    assert.equal(values['ph:free'], '');
    assert.equal(values[Model.EXTRA_KEY], '');
});

test('matches searches title, category, flags, help strings and examples', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'git commit',
        category: 'Version control',
        labels: { cmDesc: 'create a commit', cmBase: 'git commit' },
        optionNotes: [
            optionNote({ noteId: 'o1', title: 'Amend', labels: { cmFlag: '--amend', cmType: 'boolean', cmDoc: 'Replace the previous commit.' } })
        ],
        examples: ['git commit --amend --no-edit']
    });
    const haystack = Model.searchableText(definition);
    const matches = (query) => Model.matchesText(haystack, query);
    assert.equal(matches('commit'), true);
    assert.equal(matches('amend'), true);
    assert.equal(matches('version'), true);
    assert.equal(matches('replace previous'), true);
    assert.equal(matches('no-edit'), true);
    assert.equal(matches('push'), false);
    assert.equal(matches(''), true);
});

test('sortOptions orders by cmOrder then title', () => {
    const list = [
        { title: 'zeta', order: 10, noteId: 'b' },
        { title: 'alpha', order: 10, noteId: 'c' },
        { title: 'first', order: 5, noteId: 'a' }
    ];
    list.sort(Model.sortOptions);
    assert.deepEqual(list.map((entry) => entry.title), ['first', 'alpha', 'zeta']);
});

test('toolTemplate contains exactly the three required H2 sections', () => {
    const content = Model.toolTemplate();
    const headings = content.match(/<h2>[^<]+<\/h2>/g) || [];
    assert.deepEqual(headings, [
        '<h2>What is?</h2>',
        '<h2>Official links</h2>',
        '<h2>Useful links</h2>'
    ]);
});

test('newToolNotes starts Install, Usage and Help with usable content', () => {
    const notes = Model.newToolNotes();
    assert.match(notes.install, /installation/i);
    assert.match(notes.usage, /examples/i);
    assert.equal(typeof notes.help, 'string');
});

test('seedTools provides three documented examples with help strings', () => {
    const tools = Model.seedTools();
    assert.equal(tools.length, 2);
    assert.deepEqual(tools.map((tool) => tool.title), ['git commit', 'curl']);
    assert.deepEqual(tools.map((tool) => tool.category), ['Version control', 'Network']);
    tools.forEach((tool) => {
        assert.ok(tool.base, tool.title + ' has a base command');
        assert.ok(tool.options.length >= 5, tool.title + ' exposes its options');
        tool.options.forEach((option) => {
            assert.ok(option.label, tool.title + ' option has a label');
            assert.ok(option.doc, tool.title + ' option has a help string');
        });
    });
    const curl = tools.filter(function (tool) {
        return tool.title === 'curl';
    })[0];
    const url = curl.options.filter(function (option) {
        return option.label === 'URL';
    })[0];
    assert.ok(url, 'curl has a URL option');
    assert.equal(url.flag, '', 'the URL is positional');
    assert.equal(url.required, true, 'the URL is required');
    assert.equal(url.order, 100, 'the URL is appended last');
    const required = tools.reduce(function (total, tool) {
        return total + tool.options.filter(function (option) {
            return option.required;
        }).length;
    }, 0);
    assert.ok(required >= 2, 'the seeded tools demonstrate required options');
});

function exampleDefinition() {
    return Model.buildTool({
        noteId: 't1',
        title: 'ffmpeg',
        labels: { cmBase: 'ffmpeg' },
        optionNotes: [
            { noteId: 'o1', title: 'Input', labels: { cmFlag: '-i', cmType: 'path' } },
            { noteId: 'o2', title: 'Codec', labels: { cmFlag: '-c:v', cmType: 'enum', cmValues: 'libx264,libx265', cmDefault: 'libx264' } },
            { noteId: 'o3', title: 'CRF', labels: { cmFlag: '-crf', cmType: 'number', cmDefault: '23' } },
            { noteId: 'o4', title: 'Overwrite', labels: { cmFlag: '-y', cmType: 'boolean' } }
        ]
    });
}

test('valuesFromExample maps flags, values, booleans and clears omitted options', () => {
    const values = Model.valuesFromExample(exampleDefinition(), 'ffmpeg -i in.mp4 -c:v libx265 -crf 18 -y out.mp4');
    assert.equal(values['note:o1'], 'in.mp4');
    assert.equal(values['note:o2'], 'libx265');
    assert.equal(values['note:o3'], '18');
    assert.equal(values['note:o4'], true);
    assert.equal(values[Model.EXTRA_KEY], '');

    const minimal = Model.valuesFromExample(exampleDefinition(), 'ffmpeg -i in.mp4');
    assert.equal(minimal['note:o1'], 'in.mp4');
    assert.equal(minimal['note:o2'], '', 'an omitted enum is cleared, not defaulted');
    assert.equal(minimal['note:o3'], '', 'an omitted number is cleared, not defaulted');
    assert.equal(minimal['note:o4'], false, 'an omitted boolean is false');
});

test('valuesFromExample handles quoted values and --flag=value forms', () => {
    const definition = Model.buildTool({
        noteId: 't1',
        title: 'git commit',
        labels: { cmBase: 'git commit' },
        optionNotes: [
            { noteId: 'm1', title: 'Message', labels: { cmFlag: '-m', cmType: 'string' } },
            { noteId: 'm2', title: 'Amend', labels: { cmFlag: '--amend', cmType: 'boolean' } }
        ]
    });
    const values = Model.valuesFromExample(definition, 'git commit -m "fix: handle input" --amend');
    assert.equal(values['note:m1'], 'fix: handle input');
    assert.equal(values['note:m2'], true);

    const longDefinition = Model.buildTool({
        noteId: 't1',
        title: 'git commit',
        labels: { cmBase: 'git commit' },
        optionNotes: [
            { noteId: 'm3', title: 'Message', labels: { cmFlag: '--message', cmType: 'string' } }
        ]
    });
    const equals = Model.valuesFromExample(longDefinition, 'git commit --message=quick');
    assert.equal(equals['note:m3'], 'quick');
});

test('valuesFromExample fills a positional option from the example', () => {
    const definition = Model.buildTool({
        noteId: 'curl',
        title: 'curl',
        labels: { cmBase: 'curl' },
        optionNotes: [
            { noteId: 'method', title: 'Request method', labels: { cmFlag: '-X', cmType: 'string' } },
            { noteId: 'url', title: 'URL', labels: { cmType: 'string', cmPlaceholder: 'url' } }
        ]
    });
    const values = Model.valuesFromExample(definition, 'curl -X POST https://api.example.com');
    assert.equal(values['note:method'], 'POST');
    assert.equal(values['note:url'], 'https://api.example.com');
    assert.equal(values['note:url'] !== 'curl', true, 'the base command is not treated as a positional');
});

test('valuesFromExample does not guess positional values past an unknown flag', () => {
    const definition = Model.buildTool({
        noteId: 'curl',
        title: 'curl',
        labels: { cmBase: 'curl' },
        optionNotes: [
            { noteId: 'url', title: 'URL', labels: { cmType: 'string', cmPlaceholder: 'url' } }
        ]
    });
    const values = Model.valuesFromExample(definition, 'curl --unknown value https://api.example.com');
    assert.equal(values['note:url'], '');
});

test('tokenizeCommand keeps quoted values together and strips the quotes', () => {
    assert.deepEqual(
        Model.tokenizeCommand('curl -H "Content-Type: application/json" -d \'{"a":1}\' https://example.com'),
        ['curl', '-H', 'Content-Type: application/json', '-d', '{"a":1}', 'https://example.com']
    );
});