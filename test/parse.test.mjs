import test from 'node:test';
import assert from 'node:assert/strict';

import Parse from '../src/parse.js';

const FFMPEG_HELP = [
    'Usage: ffmpeg [options] [[infile options] -i infile]... {[outfile options] outfile}...',
    '',
    'Main options:',
    '  -i URL            input file url',
    '  -y                overwrite output files without asking',
    '  -c:v CODEC        select the video encoder',
    '  -crf N            constant rate factor (quality), lower is better',
    '  -vf FILTERGRAPH   apply a video filter',
    '  -b:v RATE         video bitrate',
    '                    expressed in bits per second'
].join('\n');

const GIT_HELP = [
    'usage: git commit [-a | --interactive | --patch] [-s] [-v] [-u<mode>] [--amend]',
    '                  [--dry-run] [(-c | -C | --squash) <commit> | --fixup [(amend|reword):]<commit>]',
    '',
    '    -m, --message <message>  use the given message as the commit message',
    '    -a, --all                commit all changed files',
    '    --amend                  amend the previous commit',
    '    --allow-empty            allow recording an empty commit',
    '    --no-verify              bypass the pre-commit and commit-msg hooks',
    '    --author <author>        override the author'
].join('\n');

const CURL_HELP = [
    'Usage: curl [options...] <url>',
    '',
    ' -X, --request <method>      specify request method to use',
    ' -H, --header <header/@file> pass custom header(s) to server',
    ' -o, --output <file>         write to file instead of stdout',
    ' -L, --location              follow redirects',
    ' -s, --silent                silent mode',
    ' -u, --user <user:password>  server user and password',
    '     --compressed            request compressed response',
    ' -k, --insecure              allow insecure server connections',
    ' --[no-]color                use colors'
].join('\n');

function canonical(overrides) {
    return Object.assign({
        label: 'Input',
        flag: '--input',
        aliases: ['-i', '--input'],
        help: 'Input file to read.',
        type: 'path',
        values: [],
        defaultValue: '',
        required: false,
        mode: 'flag',
        placeholder: 'input',
        order: 10
    }, overrides || {});
}

test('stripHtml renders inline tags, entities and lists', () => {
    assert.equal(Parse.stripHtml('<p>a</p><p>b</p>'), 'a\nb');
    assert.equal(Parse.stripHtml('<ul><li>one</li><li>two</li></ul>'), 'one\ntwo');
    assert.equal(Parse.stripHtml('<p>x<br>y</p>'), 'x\ny');
    assert.equal(Parse.stripHtml(''), '');
    assert.equal(Parse.stripHtml(null), '');
    assert.equal(
        Parse.stripHtml('<p><strong>ffmpeg</strong> is a complete&nbsp;toolkit &lt;awesome&gt; &amp; fast</p>'),
        'ffmpeg is a complete toolkit <awesome> & fast'
    );
});

test('stripHtml collapses 3+ blank lines but keeps pre line breaks', () => {
    assert.equal(Parse.stripHtml('<p>first</p>\n\n\n\n<p>after</p>'), 'first\n\nafter');
    assert.equal(Parse.stripHtml('<p>x</p><pre>a\n\n\nb</pre><p>y</p>'), 'x\na\n\n\nb\ny');
    assert.equal(Parse.stripHtml('<pre>\nffmpeg -i "in.mp4"\n  out.mp4\n</pre>'), 'ffmpeg -i "in.mp4"\n  out.mp4');
});

test('stripHtml on a Trilium-like text note', () => {
    const html = [
        '<h2>What is?</h2>',
        '<p><strong>ffmpeg</strong> is a complete&nbsp;toolkit &lt;awesome&gt; &amp; fast.</p>',
        '<ul><li>converts video</li><li>streams audio</li></ul>',
        '<p>first</p>',
        '',
        '',
        '',
        '<p>after a long gap</p>',
        '<pre>ffmpeg -i in.mp4',
        '  out.mp4',
        '',
        '',
        '',
        'kept</pre>',
        '<p>tail</p>'
    ].join('\n');
    assert.equal(Parse.stripHtml(html), [
        'What is?',
        '',
        'ffmpeg is a complete toolkit <awesome> & fast.',
        '',
        'converts video',
        'streams audio',
        '',
        'first',
        '',
        'after a long gap',
        '',
        'ffmpeg -i in.mp4',
        '  out.mp4',
        '',
        '',
        '',
        'kept',
        '',
        'tail'
    ].join('\n'));
});

test('decodeEntities handles named, decimal and hex entities once', () => {
    assert.equal(Parse.decodeEntities('&#65;&#x42;&#39;&amp;x'), 'AB\'&x');
    assert.equal(Parse.decodeEntities('&amp;lt;'), '&lt;');
    assert.equal(Parse.decodeEntities('&mdash; &unknown;'), '\u2014 &unknown;');
});

test('decodeEntities never resolves an inherited Object property', () => {
    assert.equal(Parse.decodeEntities('&constructor; &toString; &__proto__;'), '&constructor; &toString; &__proto__;');
});

test('inferType follows the metavar and description rules', () => {
    assert.equal(Parse.inferType('', 'overwrite output files'), 'boolean');
    assert.equal(Parse.inferType('{a,b,c}', ''), 'enum');
    assert.equal(Parse.inferType('[a|b|c]', ''), 'enum');
    assert.equal(Parse.inferType('(a|b|c)', ''), 'enum');
    assert.equal(Parse.inferType('', 'log level, one of: a, b'), 'enum');
    assert.equal(Parse.inferType('FILE', ''), 'path');
    assert.equal(Parse.inferType('<path>', ''), 'path');
    assert.equal(Parse.inferType('OUT_DIR', ''), 'path');
    assert.equal(Parse.inferType('N', ''), 'number');
    assert.equal(Parse.inferType('COUNT', ''), 'number');
    assert.equal(Parse.inferType('SECONDS', ''), 'number');
    assert.equal(Parse.inferType('NAME', ''), 'string');
    assert.equal(Parse.inferType('<message>', ''), 'string');
});

test('normalizeOption returns the canonical shape', () => {
    assert.deepEqual(
        Parse.normalizeOption({ flag: '-i, --input', help: 'Input file to read.', type: 'path' }),
        canonical()
    );
    assert.deepEqual(
        Parse.normalizeOption({ flag: '--video-codec', doc: 'Video encoder to use.' }),
        canonical({
            label: 'Video codec',
            flag: '--video-codec',
            aliases: ['--video-codec'],
            help: 'Video encoder to use.',
            type: 'string',
            placeholder: 'video_codec'
        })
    );
    assert.deepEqual(
        Parse.normalizeOption({ flag: '--preset', values: ['slow', 'fast'], help: 'Preset.' }),
        canonical({
            label: 'Preset',
            flag: '--preset',
            aliases: ['--preset'],
            help: 'Preset.',
            type: 'enum',
            values: ['slow', 'fast'],
            placeholder: 'preset'
        })
    );
    assert.deepEqual(
        Parse.normalizeOption({ flag: '-y', help: 'Overwrite.', type: 'boolean', default: true }),
        canonical({
            label: 'Y',
            flag: '-y',
            aliases: ['-y'],
            help: 'Overwrite.',
            type: 'boolean',
            defaultValue: 'true',
            placeholder: 'y'
        })
    );
    assert.deepEqual(
        Parse.normalizeOption({ flag: '-o', help: 'Inline output.', mode: 'inline', required: 'yes', order: '30' }),
        canonical({
            label: 'O',
            flag: '-o',
            aliases: ['-o'],
            help: 'Inline output.',
            type: 'string',
            placeholder: 'o',
            required: true,
            mode: 'inline',
            order: 30
        })
    );
    assert.equal(Parse.normalizeOption({}), null);
    assert.equal(Parse.normalizeOption({ help: 'no flag' }), null);
    assert.equal(Parse.normalizeOption(null), null);
});

test('parseHelpText reads an ffmpeg help excerpt', () => {
    const result = Parse.parseHelpText(FFMPEG_HELP);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.options.map(function (option) {
        return option.flag;
    }), ['-i', '-y', '-c:v', '-crf', '-vf', '-b:v']);
    assert.deepEqual(result.options.map(function (option) {
        return option.order;
    }), [10, 20, 30, 40, 50, 60]);

    assert.deepEqual(result.options[0], canonical({
        label: 'I',
        flag: '-i',
        aliases: ['-i'],
        help: 'input file url',
        type: 'string',
        placeholder: 'i'
    }));
    assert.equal(result.options[1].type, 'boolean');
    assert.equal(result.options[1].help, 'overwrite output files without asking');
    assert.equal(result.options[2].placeholder, 'c_v');
    assert.equal(result.options[2].label, 'C v');
    assert.equal(result.options[3].type, 'number');
    assert.equal(result.options[4].type, 'string');
    // The deeper-indented line is appended to the description.
    assert.equal(result.options[5].help, 'video bitrate expressed in bits per second');
});

test('parseHelpText reads git short and long flags', () => {
    const result = Parse.parseHelpText(GIT_HELP);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.options[0], canonical({
        label: 'Message',
        flag: '--message',
        aliases: ['-m', '--message'],
        help: 'use the given message as the commit message',
        type: 'string',
        placeholder: 'message'
    }));
    assert.deepEqual(result.options[1].aliases, ['-a', '--all']);
    assert.equal(result.options[1].flag, '--all');
    assert.equal(result.options[1].type, 'boolean');
    assert.deepEqual(result.options[2], canonical({
        label: 'Amend',
        flag: '--amend',
        aliases: ['--amend'],
        help: 'amend the previous commit',
        type: 'boolean',
        placeholder: 'amend',
        order: 30
    }));
    assert.equal(result.options[4].flag, '--no-verify');
    assert.equal(result.options[4].label, 'No verify');
    assert.equal(result.options[4].type, 'boolean');
    assert.equal(result.options[5].type, 'string');
    assert.equal(result.options.length, 6);
});

test('parseHelpText reads curl metavars and negatable flags', () => {
    const result = Parse.parseHelpText(CURL_HELP);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.options.length, 9);

    const byFlag = {};
    for (const option of result.options) {
        byFlag[option.flag] = option;
    }
    assert.deepEqual(byFlag['--request'].aliases, ['-X', '--request']);
    assert.equal(byFlag['--request'].label, 'Request');
    assert.equal(byFlag['--request'].type, 'string');
    assert.equal(byFlag['--header'].type, 'path');
    assert.equal(byFlag['--output'].type, 'path');
    assert.equal(byFlag['--location'].type, 'boolean');
    assert.equal(byFlag['--silent'].type, 'boolean');
    assert.equal(byFlag['--user'].type, 'string');
    assert.equal(byFlag['--compressed'].type, 'boolean');
    assert.equal(byFlag['--compressed'].label, 'Compressed');
    // --[no-]color is boolean and canonicalised without the [no-] part.
    assert.deepEqual(byFlag['--color'].aliases, ['--color', '--no-color']);
    assert.equal(byFlag['--color'].type, 'boolean');
    assert.equal(byFlag['--color'].placeholder, 'color');
});

test('parseHelpText parses defaults out of the description', () => {
    const result = Parse.parseHelpText([
        '  -crf N            set the constant rate factor (default: 23)',
        '  --jobs N          run N jobs in parallel (defaults to 1)',
        '  -b RATE           set the bitrate [default: 128k]',
        '  --timeout N       max time in seconds, default: 30 when not set'
    ].join('\n'));
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.options.map(function (option) {
        return option.defaultValue;
    }), ['23', '1', '128k', '30']);
    assert.deepEqual(result.options.map(function (option) {
        return option.type;
    }), ['number', 'number', 'string', 'number']);
});

test('parseHelpText infers enums from a metavar or from "one of:"', () => {
    const result = Parse.parseHelpText([
        '  --loglevel {error,warning,info,debug}  set logging level',
        '  --preset WHEN        use a preset, one of: auto, always, never',
        '  --level [1|2|3]     verbosity level'
    ].join('\n'));
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.options.map(function (option) {
        return option.type;
    }), ['enum', 'enum', 'enum']);
    assert.deepEqual(result.options[0].values, ['error', 'warning', 'info', 'debug']);
    assert.deepEqual(result.options[1].values, ['auto', 'always', 'never']);
    assert.deepEqual(result.options[2].values, ['1', '2', '3']);
});

test('parseHelpText dedupes flags and warns about lines it cannot parse', () => {
    const result = Parse.parseHelpText([
        '  -o, --output FILE   write output to FILE',
        '  --output FORMAT     output format',
        '  - Not a flag at all.'
    ].join('\n'));
    assert.equal(result.options.length, 1);
    assert.deepEqual(result.options[0].aliases, ['-o', '--output']);
    assert.equal(result.warnings.length, 2);
    assert.equal(result.warnings[0].code, 'duplicate-flag');
    assert.ok(result.warnings[0].message.includes('--output'));
    assert.deepEqual(result.warnings[1], {
        code: 'unparsed-option-line',
        message: 'Could not parse the option line "- Not a flag at all.".',
        line: 3,
        text: '- Not a flag at all.'
    });
});

test('parseHelpText accepts comma, space and pipe separated flag lists', () => {
    const result = Parse.parseHelpText([
        '  -m --message MSG   use the given message',
        '  -v|--verbose       be verbose'
    ].join('\n'));
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.options.map(function (option) {
        return option.flag;
    }), ['--message', '--verbose']);
    assert.deepEqual(result.options.map(function (option) {
        return option.aliases;
    }), [['-m', '--message'], ['-v', '--verbose']]);
    assert.deepEqual(result.options.map(function (option) {
        return option.type;
    }), ['string', 'boolean']);
});

test('parseJsonOptions accepts an array, {options} and {tool.options}', () => {
    const array = Parse.parseJsonOptions(JSON.stringify([
        { flag: '-i, --input', help: 'Input file to read.', type: 'path' },
        { flag: '--crf', doc: 'Constant rate factor.', label: 'CRF quality', type: 'number', default: '23' },
        { flag: '-y', help: 'Overwrite output files.', type: 'boolean' },
        { flag: '--preset', enumValues: 'slow, fast', help: 'Preset to use.' },
        { help: 'missing flag' },
        'not an object'
    ]));
    assert.deepEqual(array.options, [
        canonical(),
        canonical({
            label: 'CRF quality',
            flag: '--crf',
            aliases: ['--crf'],
            help: 'Constant rate factor.',
            type: 'number',
            defaultValue: '23',
            placeholder: 'crf',
            order: 20
        }),
        canonical({
            label: 'Y',
            flag: '-y',
            aliases: ['-y'],
            help: 'Overwrite output files.',
            type: 'boolean',
            placeholder: 'y',
            order: 30
        }),
        canonical({
            label: 'Preset',
            flag: '--preset',
            aliases: ['--preset'],
            help: 'Preset to use.',
            type: 'enum',
            values: ['slow', 'fast'],
            placeholder: 'preset',
            order: 40
        })
    ]);
    assert.deepEqual(array.warnings.map(function (entry) {
        return entry.code;
    }), ['invalid-entry', 'invalid-entry']);

    const wrapped = Parse.parseJsonOptions(JSON.stringify({
        tool: 'ffmpeg',
        options: [{ flag: '-i, --input', help: 'Input file to read.', type: 'path' }]
    }));
    assert.deepEqual(wrapped.options, [canonical()]);
    assert.deepEqual(wrapped.warnings, []);

    const nested = Parse.parseJsonOptions(JSON.stringify({
        tool: { title: 'ffmpeg', options: [{ flag: '-y', help: 'Overwrite.', type: 'boolean' }] }
    }));
    assert.equal(nested.options.length, 1);
    assert.equal(nested.options[0].flag, '-y');

    const duplicated = Parse.parseJsonOptions(JSON.stringify([
        { flag: '--input', help: 'first' },
        { flag: '--input', help: 'second' }
    ]));
    assert.equal(duplicated.options.length, 1);
    assert.equal(duplicated.options[0].help, 'first');
    assert.deepEqual(duplicated.warnings.map(function (entry) {
        return entry.code;
    }), ['duplicate-flag']);
});

test('parseJsonOptions reports broken JSON instead of throwing', () => {
    const broken = Parse.parseJsonOptions('{ not json');
    assert.deepEqual(broken.options, []);
    assert.equal(broken.warnings[0].code, 'invalid-json');

    const noOptions = Parse.parseJsonOptions('{"tool": "ffmpeg"}');
    assert.deepEqual(noOptions.options, []);
    assert.equal(noOptions.warnings[0].code, 'invalid-json');

    const empty = Parse.parseJsonOptions('');
    assert.deepEqual(empty.options, []);
    assert.equal(empty.warnings[0].code, 'invalid-json');
});

test('parseMarkdownTable reads flag, help and type cells', () => {
    const table = Parse.parseMarkdownTable([
        '| Flag | Help | Type |',
        '| --- | --- | --- |',
        '| `-i, --input` | Input file to read. | path |',
        '| `--crf` | Constant rate factor. | number |',
        '| `-y` | Overwrite output files. | boolean |'
    ].join('\n'));
    assert.deepEqual(table.warnings, []);
    assert.deepEqual(table.options, [
        canonical(),
        canonical({
            label: 'Crf',
            flag: '--crf',
            aliases: ['--crf'],
            help: 'Constant rate factor.',
            type: 'number',
            placeholder: 'crf',
            order: 20
        }),
        canonical({
            label: 'Y',
            flag: '-y',
            aliases: ['-y'],
            help: 'Overwrite output files.',
            type: 'boolean',
            placeholder: 'y',
            order: 30
        })
    ]);

    const synonyms = Parse.parseMarkdownTable([
        '| Option | Description |',
        '| ------ | ----------- |',
        '| `--amend` | Amend the previous commit |'
    ].join('\n'));
    assert.deepEqual(synonyms.warnings, []);
    assert.equal(synonyms.options.length, 1);
    assert.equal(synonyms.options[0].flag, '--amend');
    // A table row without type information keeps the canonical string default.
    assert.equal(synonyms.options[0].type, 'string');
    assert.equal(synonyms.options[0].help, 'Amend the previous commit');

    const headerless = Parse.parseMarkdownTable('| -i | Input file |\n| -o | Output file |');
    assert.deepEqual(headerless.warnings, []);
    assert.deepEqual(headerless.options.map(function (option) {
        return option.flag;
    }), ['-i', '-o']);

    const noFlagColumn = Parse.parseMarkdownTable([
        '| Name | Value |',
        '| --- | --- |',
        '| alpha | beta |'
    ].join('\n'));
    assert.deepEqual(noFlagColumn.options, []);
    assert.equal(noFlagColumn.warnings[0].code, 'no-flag-column');

    // An HTML table is not a markdown table: it warns instead of guessing.
    const html = Parse.parseMarkdownTable('<table><tr><td>-y</td><td>Overwrite</td></tr></table>');
    assert.deepEqual(html.options, []);
    assert.equal(html.warnings[0].code, 'no-table');
});

test('parseImport detects the format', () => {
    const json = Parse.parseImport('\n  {"options":[{"flag":"-y","help":"Overwrite."}]}');
    assert.equal(json.format, 'json');
    assert.equal(json.options.length, 1);
    assert.equal(json.options[0].flag, '-y');

    const table = Parse.parseImport('| Flag | Help |\n| --- | --- |\n| -y | Overwrite |');
    assert.equal(table.format, 'table');
    assert.equal(table.options.length, 1);
    assert.equal(table.options[0].flag, '-y');

    const help = Parse.parseImport('Usage: thing\n\n  -y    overwrite output files');
    assert.equal(help.format, 'help');
    assert.equal(help.options.length, 1);
    assert.equal(help.options[0].type, 'boolean');

    const bareArray = Parse.parseImport('[{"flag":"--input","help":"Input file."}]');
    assert.equal(bareArray.format, 'json');
    assert.equal(bareArray.options[0].flag, '--input');
});

test('parsers never throw on odd input', () => {
    for (const input of [undefined, null, '', '   ', '| a | b |', '-x', '{}', '[]', '[1,2]', '-- a --']) {
        assert.doesNotThrow(function () {
            Parse.parseImport(input);
        }, 'input: ' + String(input));
    }
});

test('parseHelpText reads real ffmpeg help output with lowercase metavars', () => {
    const result = Parse.parseHelpText([
        'Main options:',
        '-i url              input file url (specify multiple input files)',
        '-y                  overwrite output files',
        '-c codec            codec name ("copy" to copy stream)',
        '-c:v codec          force video codec (\'copy\' to copy stream)',
        '-crf crf            select the quality for constant quality mode (from -1 to 51) (default 23)'
    ].join('\n'));
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.options.map((option) => option.flag), ['-i', '-y', '-c', '-c:v', '-crf']);
    assert.equal(result.options[0].type, 'string');
    assert.equal(result.options[1].type, 'boolean');
    assert.equal(result.options[4].type, 'number');
    assert.equal(result.options[4].defaultValue, '23');
});

test('parseHelpText keeps the long flag of an argparse option pair', () => {
    const result = Parse.parseHelpText([
        'options:',
        '  -q QUEUE, --queue QUEUE',
        '                        set the queue'
    ].join('\n'));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.options.length, 1);
    assert.deepEqual(result.options[0].aliases, ['-q', '--queue']);
    assert.equal(result.options[0].flag, '--queue');
    assert.equal(result.options[0].help, 'set the queue');
});

test('parseHelpText extracts parenthesised defaults without a colon', () => {
    const result = Parse.parseHelpText('-b bufsize   buffer size (default 200000)');
    assert.equal(result.options.length, 1);
    assert.equal(result.options[0].defaultValue, '200000');
});
