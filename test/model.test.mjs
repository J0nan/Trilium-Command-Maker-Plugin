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
    assert.equal(definition.description, 'Media toolkit');
    assert.equal(definition.options[0].help, 'Input file.');
    assert.deepEqual(definition.examples, ['ffmpeg -i in.mp4 out.mp4']);
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
    assert.equal(Model.matches(definition, 'commit'), true);
    assert.equal(Model.matches(definition, 'amend'), true);
    assert.equal(Model.matches(definition, 'version'), true);
    assert.equal(Model.matches(definition, 'replace previous'), true);
    assert.equal(Model.matches(definition, 'no-edit'), true);
    assert.equal(Model.matches(definition, 'push'), false);
    assert.equal(Model.matches(definition, ''), true);
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
    assert.equal(tools.length, 3);
    assert.deepEqual(tools.map((tool) => tool.title), ['ffmpeg', 'git commit', 'curl']);
    assert.deepEqual(tools.map((tool) => tool.category), ['Media', 'Version control', 'Network']);
    tools.forEach((tool) => {
        assert.ok(tool.base, tool.title + ' has a base command');
        assert.ok(tool.options.length >= 5, tool.title + ' exposes its options');
        tool.options.forEach((option) => {
            assert.ok(option.flag, tool.title + ' option has a flag');
            assert.ok(option.doc, tool.title + ' option has a help string');
        });
    });
});