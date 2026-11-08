'use strict';

/**
 * Pure readers for the parts of a tool note the palette shows (S3, S5, S11):
 * the three H2 sections, their links, and the Usage examples.
 * No Trilium API, no DOM, no external dependencies.
 *
 * parseToolNote(html)  -> { whatIs, officialLinks, usefulLinks, links, sections }
 * parseExamples(html, base) -> string[]   (at most 50, source order)
 */

const Parse = require('./parse');

const H2_RE = /<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi;
const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`<>]+))/i;
/** Only these schemes may become a clickable link. */
const SAFE_URL_RE = /^(?:https?|mailto):/i;
/** `<pre>`, `<p>` and `<li>` blocks, in source order. */
const BLOCK_RE = /<(pre|p|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

const WHAT_IS = ['what is', 'qué es', 'que es'];
const OFFICIAL = ['official links', 'enlaces oficiales'];
const USEFUL = ['useful links', 'enlaces útiles', 'enlaces utiles'];

const MAX_EXAMPLES = 50;

/** Tags that survive install-note rendering; everything else loses its markup. */
const ALLOWED_TAGS = new Set([
    'p', 'br', 'div', 'span',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
    'code', 'pre',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'blockquote', 'hr',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'dl', 'dt', 'dd'
]);
const DROP_ELEMENT_RE = /<(script|style|iframe|object|embed|svg|math|form|input|textarea|select|button|link|meta)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG_TOKEN_RE = /<\/?([a-zA-Z][A-Za-z0-9:-]*)([^>]*)>/g;
const TRAILING_UNCLOSED_TAG_RE = /<[a-zA-Z][^>]*$/;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

function trim(value) {
    return String(value == null ? '' : value).trim();
}

/** Heading text used for lookup: lowercase, single-spaced, punctuation-free. */
function normalizeHeading(value) {
    return trim(value)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[?？:;.,!\u2026\u00bf\u00a1]+/g, '')
        .trim();
}

/** The exact section key: lowercased, trimmed heading text. */
function sectionKey(value) {
    return trim(Parse.stripHtml(String(value == null ? '' : value).replace(/\s+/g, ' '))).toLowerCase();
}

function sectionBodies(source) {
    const marks = [];
    H2_RE.lastIndex = 0;
    let match = H2_RE.exec(source);
    while (match !== null) {
        marks.push({ key: sectionKey(match[1]), bodyStart: match.index + match[0].length, start: match.index });
        match = H2_RE.exec(source);
    }
    return marks.map(function (mark, index) {
        const end = index + 1 < marks.length ? marks[index + 1].start : source.length;
        return { key: mark.key, html: source.slice(mark.bodyStart, end) };
    });
}

/** Every http(s)/mailto anchor inside a section's HTML. */
function linksInSection(html, section) {
    const links = [];
    const source = String(html == null ? '' : html);
    ANCHOR_RE.lastIndex = 0;
    let match = ANCHOR_RE.exec(source);
    while (match !== null) {
        const hrefMatch = HREF_RE.exec(match[1]);
        const href = hrefMatch ? Parse.decodeEntities(trim(hrefMatch[1] || hrefMatch[2] || hrefMatch[3])) : '';
        if (href !== '' && SAFE_URL_RE.test(href)) {
            const text = Parse.stripHtml(match[2]);
            links.push({ text: text === '' ? href : text, href: href, section: section });
        }
        match = ANCHOR_RE.exec(source);
    }
    return links;
}

function findSectionKey(sections, wanted) {
    const needles = (Array.isArray(wanted) ? wanted : [wanted]).map(normalizeHeading);
    for (const heading of Object.keys(sections)) {
        if (needles.indexOf(normalizeHeading(heading)) !== -1) {
            return heading;
        }
    }
    return null;
}

/**
 * Tool note HTML -> the three H2 sections, their links and the "What is?" text.
 * @param {string} html
 * @returns {{ whatIs: string, officialLinks: Array, usefulLinks: Array, links: Array, sections: object }}
 */
function parseToolNote(html) {
    const source = String(html == null ? '' : html);
    // Heading text is note content, so keys are collected in a Map first: a
    // heading named `__proto__` must become an ordinary section, never a
    // prototype assignment.
    const found = new Map();
    const rawBodies = new Map();
    for (const body of sectionBodies(source)) {
        const key = body.key === '' ? 'untitled' : body.key;
        if (found.has(key)) {
            continue;
        }
        found.set(key, Parse.stripHtml(body.html));
        rawBodies.set(key, body.html);
    }
    const sections = Object.fromEntries(found);

    const officialKey = findSectionKey(sections, OFFICIAL);
    const usefulKey = findSectionKey(sections, USEFUL);
    const officialLinks = linksInSection(officialKey === null ? '' : rawBodies.get(officialKey), 'official');
    const usefulLinks = linksInSection(usefulKey === null ? '' : rawBodies.get(usefulKey), 'useful');

    const whatIsKey = findSectionKey(sections, WHAT_IS);
    return {
        whatIs: whatIsKey === null ? Parse.stripHtml(source) : trim(sections[whatIsKey]),
        officialLinks: officialLinks,
        usefulLinks: usefulLinks,
        links: officialLinks.concat(usefulLinks),
        sections: sections
    };
}

function firstToken(base) {
    return trim(base).split(/\s+/)[0] || '';
}

function addExample(out, text) {
    if (text === '' || out.indexOf(text) !== -1) {
        return;
    }
    out.push(text);
}

function looksLikeCommand(text, token) {
    if (text === '' || /\n/.test(text) || token === '') {
        return false;
    }
    if (/[.!?\u00a1\u00bf]$/.test(text)) {
        return false;
    }
    if (text.slice(0, token.length).toLowerCase() !== token.toLowerCase()) {
        return false;
    }
    return text.length === token.length || /\s/.test(text.charAt(token.length));
}

/**
 * Usage note HTML -> example command lines.
 * Code blocks always count; a single-line `<p>`/`<li>` that starts with the
 * command name and does not end in a period counts too.
 * @param {string} html
 * @param {string} base the tool command, e.g. `ffmpeg` or `git commit`
 * @returns {Array<string>}
 */
function parseExamples(html, base) {
    const source = String(html == null ? '' : html);
    const token = firstToken(base);
    const out = [];
    BLOCK_RE.lastIndex = 0;
    let match = BLOCK_RE.exec(source);
    while (match !== null) {
        const tag = match[1].toLowerCase();
        const text = Parse.stripHtml(match[0]);
        if (text !== '') {
            if (tag === 'pre') {
                addExample(out, text);
            } else if (looksLikeCommand(text, token)) {
                addExample(out, text);
            }
        }
        match = BLOCK_RE.exec(source);
    }
    return out.slice(0, MAX_EXAMPLES);
}

/**
 * Usage note stored as a code note -> one example per non-empty line.
 * @param {string} text
 * @returns {Array<string>}
 */
function parseExampleLines(text) {
    const out = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.charAt(0) === '#' || trimmed.slice(0, 2) === '//') {
            return;
        }
        addExample(out, trimmed);
    });
    return out.slice(0, MAX_EXAMPLES);
}

function escapeAttribute(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Same rules as escapeAttribute: safe for text and for double-quoted attributes. */
const escapeHtml = escapeAttribute;

function safeHref(raw) {
    const decoded = Parse.decodeEntities(String(raw == null ? '' : raw)).trim();
    return SAFE_URL_RE.test(decoded) ? decoded : '';
}

/**
 * Install-note HTML -> the same formatting with only safe tags and attributes.
 * Keeps paragraphs, lists, headings, code blocks, emphasis and http(s)/mailto
 * links; removes scripts, styles, event handlers, classes and inline styles.
 * @param {string} html
 * @returns {string}
 */
function sanitizeNoteHtml(html) {
    const source = String(html == null ? '' : html).replace(COMMENT_RE, '');
    const cleaned = source.replace(DROP_ELEMENT_RE, '');
    return cleaned.replace(TAG_TOKEN_RE, function (match, rawName, rawAttrs) {
        const tag = String(rawName).toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
            return '';
        }
        if (match.charAt(1) === '/') {
            return '</' + tag + '>';
        }
        if (tag === 'a') {
            const found = HREF_RE.exec(rawAttrs || '');
            const href = found
                ? safeHref(found[1] !== undefined ? found[1] : (found[2] !== undefined ? found[2] : found[3]))
                : '';
            return href === ''
                ? '<a>'
                : '<a href="' + escapeAttribute(href) + '" target="_blank" rel="noopener noreferrer">';
        }
        return '<' + tag + '>';
    }).replace(TRAILING_UNCLOSED_TAG_RE, '');
}

/**
 * Wrap every `<pre>` block in a relative container that can hold a copy button.
 * Inline `<code>` is left alone.
 * @param {string} html
 * @param {string} buttonHtml trusted markup for the copy control
 * @returns {string}
 */
function wrapCodeBlocks(html, buttonHtml) {
    return String(html == null ? '' : html).replace(/<pre\b[^>]*>[\s\S]*?<\/pre\s*>/gi, function (block) {
        return '<div class="cm-code-block">' + (buttonHtml || '') + block + '</div>';
    });
}

module.exports = {
    parseToolNote,
    parseExamples,
    parseExampleLines,
    sanitizeNoteHtml,
    escapeHtml,
    wrapCodeBlocks
};
