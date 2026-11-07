import test from 'node:test';
import assert from 'node:assert/strict';

import Model from '../src/model.js';

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
    assert.deepEqual(option.enumValues, []);
});

test('optionFromNote reads and normalises labels', () => {
    const option = Model.optionFromNote({
        noteId: 'n1',
        title: 'Codec',
        labels: {
            cmFlag: '-c:v',
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

test('buildCommand discovers placeholders without an option', () => {
    const definition = Model.buildCommand({
        noteId: 'cmd1',
        title: 'Copy',
        content: 'cp {{source}} {{target}}',
        labels: {},
        optionNotes: [
            { noteId: 'o1', title: 'Source', labels: { cmPlaceholder: 'source', cmFlag: '-s' } }
        ]
    });
    assert.equal(definition.base, 'cp {{source}} {{target}}');
    assert.equal(definition.options.length, 1);
    assert.deepEqual(definition.inferred.map((entry) => entry.placeholder), ['target']);
});

test('#cmBase overrides the note content', () => {
    const definition = Model.buildCommand({
        noteId: 'cmd1',
        title: 'X',
        content: 'ignored',
        labels: { cmBase: 'echo hi' },
        optionNotes: []
    });
    assert.equal(definition.base, 'echo hi');
});

test('duplicate placeholders produce a warning', () => {
    const definition = Model.buildCommand({
        noteId: 'cmd1',
        title: 'X',
        content: 'run',
        labels: {},
        optionNotes: [
            { noteId: 'o1', title: 'One', labels: { cmPlaceholder: 'same', cmFlag: '--one' } },
            { noteId: 'o2', title: 'Two', labels: { cmPlaceholder: 'same', cmFlag: '--two' } }
        ]
    });
    assert.equal(definition.options.length, 2);
    assert.equal(definition.warnings[0].code, 'duplicate-placeholder');
});

test('defaultValueMap keys options by note and inferred placeholders by name', () => {
    const definition = Model.buildCommand({
        noteId: 'cmd1',
        title: 'X',
        content: 'run {{free}}',
        labels: {},
        optionNotes: [
            { noteId: 'o1', title: 'Opt', labels: { cmPlaceholder: 'opt', cmDefault: 'd' } }
        ]
    });
    const values = Model.defaultValueMap(definition);
    assert.equal(values['note:o1'], 'd');
    assert.equal(values['ph:free'], '');
});

test('matches searches title, flags and additional option titles', () => {
    const definition = Model.buildCommand({
        noteId: 'cmd1',
        title: 'git commit',
        content: 'git commit',
        labels: { cmDesc: 'create a commit' },
        optionNotes: [
            { noteId: 'o1', title: 'Amend', labels: { cmFlag: '--amend', cmType: 'boolean' } }
        ]
    });
    assert.equal(Model.matches(definition, 'commit'), true);
    assert.equal(Model.matches(definition, 'amend'), true);
    assert.equal(Model.matches(definition, 'create commit'), true);
    assert.equal(Model.matches(definition, 'push'), false);
    assert.equal(Model.matches(definition, ''), true);
    assert.equal(Model.matches({ title: 'x', optionTitles: ['Hyperdrive'] }, 'hyper'), true);
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