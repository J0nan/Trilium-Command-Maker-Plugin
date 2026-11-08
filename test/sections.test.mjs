import test from 'node:test';
import assert from 'node:assert/strict';

import Sections from '../src/sections.js';

const TOOL_NOTE = [
    '<p>Some preamble the palette should ignore.</p>',
    '<h2>What is?</h2>',
    '<p><strong>ffmpeg</strong> converts &amp; streams audio and video.</p>',
    '<h2>Official links</h2>',
    '<ul><li><a href="https://ffmpeg.org/documentation.html">Official documentation</a></li>',
    '<li><a href="https://wiki.example.org/index.php?title=F&amp;x=1"></a></li></ul>',
    '<h2>Useful links</h2>',
    '<p><a href="mailto:team@example.org">Team</a> <a href="#anchor">skip me</a>',
    '<a href="https://ffmpeg.org/ffmpeg.html">ffmpeg command reference</a></p>'
].join('\n');

test('parseToolNote reads the three H2 sections', () => {
    const note = Sections.parseToolNote(TOOL_NOTE);
    assert.equal(note.whatIs, 'ffmpeg converts & streams audio and video.');
    assert.deepEqual(Object.keys(note.sections), ['what is?', 'official links', 'useful links']);
    assert.equal(note.sections['what is?'], 'ffmpeg converts & streams audio and video.');
    assert.equal(note.sections['official links'], 'Official documentation');
    assert.ok(!JSON.stringify(note.sections).includes('preamble'));
});

test('parseToolNote collects only http, https and mailto links', () => {
    const note = Sections.parseToolNote(TOOL_NOTE);
    assert.deepEqual(note.officialLinks, [
        { text: 'Official documentation', href: 'https://ffmpeg.org/documentation.html', section: 'official' },
        {
            text: 'https://wiki.example.org/index.php?title=F&x=1',
            href: 'https://wiki.example.org/index.php?title=F&x=1',
            section: 'official'
        }
    ]);
    assert.deepEqual(note.usefulLinks, [
        { text: 'Team', href: 'mailto:team@example.org', section: 'useful' },
        { text: 'ffmpeg command reference', href: 'https://ffmpeg.org/ffmpeg.html', section: 'useful' }
    ]);
    assert.deepEqual(note.links, note.officialLinks.concat(note.usefulLinks));
    assert.equal(note.links.length, 4);
});

test('parseToolNote tolerates heading variants and empty sections', () => {
    const note = Sections.parseToolNote([
        '<H2 class="x">WHAT IS</H2>',
        '<p>A converter.</p>',
        '<h2>Official links</h2>',
        '<p>Nothing here yet.</p>'
    ].join('\n'));
    assert.equal(note.whatIs, 'A converter.');
    assert.deepEqual(Object.keys(note.sections), ['what is', 'official links']);
    assert.deepEqual(note.officialLinks, []);
    assert.deepEqual(note.usefulLinks, []);
    assert.deepEqual(note.links, []);
});

test('parseToolNote falls back to the whole note when there is no H2', () => {
    const note = Sections.parseToolNote('<p>Just <strong>text</strong>, no headings.</p>');
    assert.equal(note.whatIs, 'Just text, no headings.');
    assert.deepEqual(note.sections, {});
    assert.deepEqual(note.links, []);
    assert.equal(Sections.parseToolNote('').whatIs, '');
    assert.equal(Sections.parseToolNote(null).whatIs, '');
});

test('parseToolNote keeps a __proto__ heading as an ordinary section', () => {
    const note = Sections.parseToolNote([
        '<h2>__proto__</h2><p>Not a prototype.</p>',
        '<h2>Official links</h2><ul></ul>'
    ].join(''));
    assert.equal(note.sections['__proto__'], 'Not a prototype.');
    assert.equal(Object.getPrototypeOf(note.sections), Object.prototype);
    assert.equal({}.polluted, undefined);
});

test('parseExamples takes the pre blocks and command-looking paragraphs', () => {
    const usage = [
        '<p>Compress a video to H.264:</p>',
        '<pre><code>ffmpeg -i input.mp4 -c:v libx264 -crf 23 output.mp4</code></pre>',
        '<p>Extract the audio track:</p>',
        '<pre><code>ffmpeg -i input.mp4 -vn -c:a aac audio.m4a</code></pre>',
        '<p>ffmpeg -i in.mkv out.mp4</p>',
        '<p>ffmpeg is a great converter.</p>',
        '<ul><li>ffmpeg -L -o file.zip https://example.com/file.zip</li></ul>',
        '<pre><code>ffmpeg -i input.mp4 -c:v libx264 -crf 23 output.mp4</code></pre>',
        '<pre><code>   </code></pre>'
    ].join('\n');
    assert.deepEqual(Sections.parseExamples(usage, 'ffmpeg'), [
        'ffmpeg -i input.mp4 -c:v libx264 -crf 23 output.mp4',
        'ffmpeg -i input.mp4 -vn -c:a aac audio.m4a',
        'ffmpeg -i in.mkv out.mp4',
        'ffmpeg -L -o file.zip https://example.com/file.zip'
    ]);
});

test('parseExamples decodes entities and keeps multi-line blocks', () => {
    assert.deepEqual(
        Sections.parseExamples('<pre><code>git commit -m &quot;fix: input&quot;</code></pre>', 'git commit'),
        ['git commit -m "fix: input"']
    );
    assert.deepEqual(Sections.parseExamples('<pre>ffmpeg -i in.mp4\n  out.mp4</pre>', 'ffmpeg'), [
        'ffmpeg -i in.mp4\n  out.mp4'
    ]);
});

test('parseExamples needs the base token and returns at most 50', () => {
    // Without a base only code blocks count: a bare paragraph is prose.
    assert.deepEqual(Sections.parseExamples('<p>ffmpeg -i in out</p>', ''), []);
    assert.deepEqual(Sections.parseExamples('<pre>ffmpeg -i in out</pre>', null), ['ffmpeg -i in out']);
    assert.deepEqual(Sections.parseExamples('<p>curl -sSI https://example.com</p>', 'curl'), [
        'curl -sSI https://example.com'
    ]);
    assert.deepEqual(Sections.parseExamples('<p>ffmpegmpeg -i in out</p>', 'ffmpeg'), []);
    const many = [];
    for (let index = 0; index < 60; index += 1) {
        many.push('<pre>cmd ' + index + '</pre>');
    }
    assert.equal(Sections.parseExamples(many.join(''), 'cmd').length, 50);
});

test('parseExampleLines reads one example per line from a code Usage note', () => {
    assert.deepEqual(
        Sections.parseExampleLines('ffmpeg -i in.mp4 out.mp4\n\n# comment\nffmpeg -i in.mp4 -c:v libx264 out.mp4\n'),
        ['ffmpeg -i in.mp4 out.mp4', 'ffmpeg -i in.mp4 -c:v libx264 out.mp4']
    );
});

test('sanitizeNoteHtml keeps readable formatting and removes unsafe markup', () => {
    const html = [
        '<h3>Install</h3>',
        '<p>Use <strong>winget</strong> or <code>brew</code>.</p>',
        '<ul><li>One</li><li>Two</li></ul>',
        '<pre><code>winget install Tool</code></pre>',
        '<a href="https://example.com" onclick="steal()">Docs</a>',
        '<script>alert(1)</script>',
        '<img src="x" onerror="alert(1)">',
        '<div class="x" style="color:red">Text</div>'
    ].join('');

    const clean = Sections.sanitizeNoteHtml(html);
    assert.match(clean, /<h3>Install<\/h3>/);
    assert.match(clean, /<strong>winget<\/strong>/);
    assert.match(clean, /<ul><li>One<\/li><li>Two<\/li><\/ul>/);
    assert.match(clean, /<pre><code>winget install Tool<\/code><\/pre>/);
    assert.match(clean, /<a href="https:\/\/example.com" target="_blank" rel="noreferrer">Docs<\/a>/);
    assert.match(clean, /<div>Text<\/div>/);
    assert.equal(clean.includes('script'), false);
    assert.equal(clean.includes('alert(1)'), false, 'script and event contents are removed');
    assert.equal(clean.includes('onclick'), false);
    assert.equal(clean.includes('onerror'), false);
    assert.equal(clean.includes('class='), false);
    assert.equal(clean.includes('style='), false);
    assert.equal(clean.includes('<img'), false);
});

test('sanitizeNoteHtml strips a trailing unterminated tag token', () => {
    assert.equal(
        Sections.sanitizeNoteHtml('<p>ok</p><script src=//evil.example'),
        '<p>ok</p>',
        'an unterminated script token must never reach the page'
    );
    assert.equal(
        Sections.sanitizeNoteHtml('text ending with <imG src=x'),
        'text ending with ',
        'any unterminated tag at the end is dropped, allowed ones included'
    );
    assert.equal(
        Sections.sanitizeNoteHtml('a < b and 5<3'),
        'a < b and 5<3',
        'a bare less-than in prose is left alone'
    );
});

test('sanitizeNoteHtml only keeps safe link targets', () => {
    const clean = Sections.sanitizeNoteHtml([
        '<a href="javascript:alert(1)">bad</a>',
        '<a href="//evil.test">relative</a>',
        '<a href="mailto:team@example.org">team</a>',
        '<a href="https://x.test/?a=1&amp;b=2" title="ignored">link</a>'
    ].join(''));

    assert.ok(clean.indexOf('<a>bad</a>') !== -1);
    assert.ok(clean.indexOf('<a>relative</a>') !== -1);
    assert.match(clean, /<a href="mailto:team@example.org" target="_blank" rel="noreferrer">team<\/a>/);
    assert.match(clean, /<a href="https:\/\/x.test\/\?a=1&amp;b=2" target="_blank" rel="noreferrer">link<\/a>/);
    assert.equal(clean.includes('javascript:'), false);
    assert.equal(clean.includes('title='), false);
});

test('sanitizeNoteHtml drops comments and style blocks', () => {
    const clean = Sections.sanitizeNoteHtml('<!-- secret --><style>p{color:red}</style><p onclick="x">ok</p>');
    assert.equal(clean, '<p>ok</p>');
});

test('wrapCodeBlocks adds a copy control to every code block but not inline code', () => {
    const button = '<button class="cm-code-copy">copy</button>';
    const html = '<p>Run</p><pre><code>tool --install</code></pre><pre>plain</pre><code>inline</code>';

    const wrapped = Sections.wrapCodeBlocks(html, button);
    assert.match(wrapped, /<div class="cm-code-block"><button class="cm-code-copy">copy<\/button><pre><code>tool --install<\/code><\/pre><\/div>/);
    assert.match(wrapped, /<div class="cm-code-block"><button class="cm-code-copy">copy<\/button><pre>plain<\/pre><\/div>/);
    assert.match(wrapped, /<code>inline<\/code>$/);
    assert.equal((wrapped.match(/cm-code-block/g) || []).length, 2);
});

test('wrapCodeBlocks leaves markup without pre blocks unchanged', () => {
    const html = '<p>Run <code>tool</code>.</p>';
    assert.equal(Sections.wrapCodeBlocks(html, '<button></button>'), html);
});
