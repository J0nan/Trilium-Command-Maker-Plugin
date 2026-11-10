import test from 'node:test';
import assert from 'node:assert/strict';

import Render from '../src/render.js';

function option(overrides) {
    return Object.assign({
        noteId: 'n1',
        title: 'Option',
        placeholder: 'opt',
        flag: '--opt',
        mode: 'flag',
        type: 'string',
        enumValues: [],
        defaultValue: '',
        required: false,
        order: 10,
        quote: 'none',
        sep: ' '
    }, overrides || {});
}

function definition(base, options, inferred) {
    return { title: 'test', base: base, options: options || [], inferred: inferred || [] };
}

test('slugify produces placeholder-safe names', () => {
    assert.equal(Render.slugify('Video codec'), 'video_codec');
    assert.equal(Render.slugify('  --Weird!! name  '), 'weird_name');
    assert.equal(Render.slugify(''), '');
});

test('appends a flag with a space separator', () => {
    const def = definition('run', [option({ placeholder: 'a', flag: '--a', type: 'number' })]);
    const result = Render.renderCommand(def, { 'note:n1': '5' });
    assert.equal(result.command, 'run --a 5');
    assert.deepEqual(result.warnings, []);
});

test('appends a flag with an equals separator', () => {
    const def = definition('run', [option({ placeholder: 'mode', flag: '--mode', sep: '=' })]);
    const result = Render.renderCommand(def, { 'note:n1': 'fast' });
    assert.equal(result.command, 'run --mode=fast');
});

test('booleans emit the bare flag only when true', () => {
    const def = definition('run', [option({ type: 'boolean', flag: '-y', placeholder: 'yes' })]);
    assert.equal(Render.renderCommand(def, { 'note:n1': false }).command, 'run');
    assert.equal(Render.renderCommand(def, { 'note:n1': true }).command, 'run -y');
});

test('a positional option appends its value without a flag', () => {
    const def = definition('run', [option({ flag: '', placeholder: 'file' })]);
    assert.equal(Render.renderCommand(def, { 'note:n1': 'a.txt' }).command, 'run a.txt');
});

test('a placeholder is substituted and the same option is not appended again', () => {
    const def = definition('git commit -m "{{message}}"', [
        option({ placeholder: 'message', flag: '-m' })
    ]);
    const result = Render.renderCommand(def, { 'note:n1': 'hi there' });
    assert.equal(result.command, 'git commit -m "hi there"');
    assert.deepEqual(result.warnings, []);
});

test('a flag option is promoted to inline when its placeholder is in the base', () => {
    const def = definition('ssh {{host}}', [option({ placeholder: 'host', flag: '--host', mode: 'flag' })]);
    const result = Render.renderCommand(def, { 'note:n1': 'example.com' });
    assert.equal(result.command, 'ssh example.com');
});

test('escaped placeholders stay literal', () => {
    const def = definition('echo \\{{name}}');
    const result = Render.renderCommand(def, {});
    assert.equal(result.command, 'echo {{name}}');
    assert.deepEqual(result.warnings, []);
});

test('a required option without a value is reported and omitted', () => {
    const def = definition('run', [option({ required: true, placeholder: 'x', flag: '--x' })]);
    const result = Render.renderCommand(def, {});
    assert.equal(result.command, 'run');
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'missing-required');
});

test('an inline option whose placeholder is missing warns', () => {
    const def = definition('run', [option({ mode: 'inline', placeholder: 'ghost', flag: '--g' })]);
    const result = Render.renderCommand(def, { 'note:n1': 'x' });
    assert.equal(result.command, 'run');
    assert.equal(result.warnings[0].code, 'unused-inline');
});

test('single quoting escapes embedded apostrophes', () => {
    const def = definition('run', [option({ quote: 'single', flag: '', placeholder: 'p' })]);
    const result = Render.renderCommand(def, { 'note:n1': "it's" });
    assert.equal(result.command, "run 'it'\\''s'");
});

test('double quoting escapes quotes, dollars and backticks', () => {
    const def = definition('run', [option({ quote: 'double', flag: '', placeholder: 'p' })]);
    const result = Render.renderCommand(def, { 'note:n1': 'a "b" $c `d`' });
    assert.equal(result.command, 'run "a \\"b\\" \\$c \\`d\\`"');
});

test('an unknown quote mode falls back to no quoting', () => {
    const def = definition('run', [option({ quote: 'constructor', flag: '', placeholder: 'p' })]);
    const result = Render.renderCommand(def, { 'note:n1': 'a b' });
    assert.equal(result.command, 'run a b');
});

test('comparing an option with itself reports equality', () => {
    const left = option({ placeholder: 'a', flag: '--a' });
    assert.equal(Render.compareOptions(left, left), 0);
});

test('non-numeric values are rejected for number options', () => {
    const def = definition('run', [option({ type: 'number', placeholder: 'n', flag: '-n' })]);
    const result = Render.renderCommand(def, { 'note:n1': 'abc' });
    assert.equal(result.command, 'run');
    assert.equal(result.warnings[0].code, 'invalid-number');
});

test('segments are ordered by cmOrder then flag alphabetically ignoring dashes', () => {
    const def = definition('run', [
        option({ noteId: 'n2', title: 'Aardvark', placeholder: 'c', flag: '--zeta', order: 10 }),
        option({ noteId: 'n1', title: 'Zebra', placeholder: 'a', flag: '--alpha', order: 10 }),
        option({ noteId: 'n3', title: 'Middle', placeholder: 'b', flag: '--middle', order: 5 })
    ]);
    const result = Render.renderCommand(def, { 'note:n1': '1', 'note:n2': '3', 'note:n3': '2' });
    assert.equal(result.command, 'run --middle 2 --alpha 1 --zeta 3');
});

test('short and long flags tie-break on the flag text, not the dashes', () => {
    const def = definition('run', [
        option({ noteId: 'n1', title: 'Yellow', placeholder: 'b', flag: '-b', order: 10 }),
        option({ noteId: 'n2', title: 'Alpha', placeholder: 'a', flag: '--a', order: 10 })
    ]);
    const result = Render.renderCommand(def, { 'note:n1': '2', 'note:n2': '1' });
    assert.equal(result.command, 'run --a 1 -b 2');
});

test('an unresolved placeholder warns and leaves no gap', () => {
    const def = definition('run {{missing}}');
    const result = Render.renderCommand(def, {});
    assert.equal(result.command, 'run');
    assert.equal(result.warnings[0].code, 'missing-placeholder');
});

test('a placeholder named like an Object member stays an ordinary name', () => {
    const def = definition('run {{constructor}} {{__proto__}}');
    const result = Render.renderCommand(def, {});
    assert.equal(result.command, 'run');
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.every(function (warning) {
        return warning.code === 'missing-placeholder';
    }));
});

test('extra arguments are inserted after the base and before flags', () => {
    const def = definition('docker', [option({ placeholder: 'detach', flag: '-d', type: 'boolean' })]);
    const result = Render.renderCommand(def, { [Render.EXTRA_KEY]: 'run alpine', 'note:n1': true });
    assert.equal(result.command, 'docker run alpine -d');
});

test('empty extra arguments do not add a gap', () => {
    const def = definition('docker', [option({ placeholder: 'detach', flag: '-d', type: 'boolean' })]);
    assert.equal(Render.renderCommand(def, { [Render.EXTRA_KEY]: '   ' }).command, 'docker');
});

test('a non-numeric placeholder value warns but still renders', () => {
    const def = definition('sleep {{count}}', [
        option({ placeholder: 'count', flag: '--count', type: 'number' })
    ]);
    const result = Render.renderCommand(def, { 'note:n1': 'soon' });
    assert.equal(result.command, 'sleep soon');
    assert.equal(result.warnings[0].code, 'invalid-number');
});