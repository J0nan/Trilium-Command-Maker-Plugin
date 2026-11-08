'use strict';

/**
 * The prompt a user copies into any AI model together with the output of a
 * tool's `--help` command. The model answers with the JSON tool file that the
 * palette's "Import tool" action understands (see src/toolfile.js).
 */

const SCHEMA = [
    '{',
    '  "kind": "command-maker-tool",',
    '  "version": 1,',
    '  "tool": {',
    '    "title": "<command name, e.g. git commit>",',
    '    "category": "<short group, e.g. Version control>",',
    '    "base": "<command the user types, e.g. git commit>",',
    '    "description": "<one sentence>",',
    '    "content": "<h2>What is?</h2><p>...</p><h2>Official links</h2><ul><li><a href=\\"https://...\\">...</a></li></ul><h2>Useful links</h2><ul><li><a href=\\"https://...\\">...</a></li></ul>",',
    '    "install": "<p>Install on Windows:</p><pre><code>winget install tool</code></pre>",',
    '    "usage": "<p>Example:</p><pre><code>...</code></pre>",',
    '    "help": "<the exact --help output, unchanged>",',
    '    "options": [',
    '      {',
    '        "label": "Input file",',
    '        "flag": "-i",',
    '        "help": "Input file to read.",',
    '        "type": "path",',
    '        "values": [],',
    '        "default": "",',
    '        "required": true,',
    '        "mode": "flag",',
    '        "placeholder": "input",',
    '        "order": 10,',
    '        "quote": "none",',
    '        "sep": " "',
    '      }',
    '    ]',
    '  }',
    '}'
].join('\n');

const RULES = [
    '- title: the command name. base: the exact command the user types (keep subcommands, e.g. "git commit").',
    '- category: a short group such as "Network", "Media" or "Version control".',
    '- description: one sentence that explains what the tool does.',
    '- content: HTML with exactly three <h2> sections in this order: "What is?", "Official links", "Useful links".',
    '  Put a <p> summary under "What is?" and one <ul><li><a href="...">...</a></li></ul> list under each links section.',
    '  If no URL is known, leave an empty <ul></ul>; never invent links.',
    '- install: HTML install steps (Windows, macOS, Linux) when known; otherwise a short placeholder paragraph.',
    '  Put every install command in its own <pre><code>command</code></pre> block. Never use inline <code> for install commands;',
    '  inline code is only for short words, file names or values mentioned in prose.',
    '- usage: HTML with two or three realistic <pre><code>command</code></pre> examples.',
    '- help: the raw --help text, unchanged.',
    '- options: one entry per documented option or positional argument.',
    '  - flag: the primary flag ("-i", "--ignore-case"), or "" for a positional argument.',
    '  - label: a short human name ("Ignore case"); required when flag is "".',
    '  - help: what the option does, taken from the help output.',
    '  - type: "boolean" when it takes no value, "path" for files or directories, "number" for counts or sizes,',
    '    "enum" when there is a fixed set of values, "string" otherwise.',
    '  - values: the enum choices only, otherwise [].',
    '  - default: the default stated in the help output, otherwise "".',
    '  - required: true only for positional arguments or options the tool requires.',
    '  - placeholder: a short unique identifier ("input", "url").',
    '  - order: 10, 20, 30... in the order the options appear.',
    '  - quote: "double" for free text or URLs that may contain spaces, otherwise "none".',
    '  - sep: " " normally, "=" only for --flag=value style options.',
    '  - mode: "flag" unless the base command itself must contain {{placeholder}}.',
    'Do not invent options that are not in the help output.'
].join('\n');

function clean(value) {
    return String(value == null ? '' : value).trim();
}

/**
 * @param {{ title?: string, helpText?: string }} [options]
 * @returns {string}
 */
function buildToolPrompt(options) {
    const safe = options || {};
    const title = clean(safe.title);
    const helpText = clean(safe.helpText);

    const lines = [
        'You convert command-line tool documentation into a Command Maker tool file.',
        '',
        'Return only the JSON object. Do not wrap it in a markdown code fence, do not add commentary,',
        'and do not omit fields. Use this exact shape:',
        '',
        SCHEMA,
        '',
        'Rules:',
        RULES,
        '',
        'Input:',
        title === '' ? 'Tool name: <tool name>' : 'Tool name: ' + title,
        '--help output:',
        helpText === '' ? "<paste the output of the tool's --help command here>" : helpText,
        '',
        'Convert the input above now. Return only the JSON object.'
    ];
    return lines.join('\n');
}

module.exports = { buildToolPrompt };