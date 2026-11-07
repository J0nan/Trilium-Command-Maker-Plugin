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
