'use strict';

/**
 * The prompt a user copies into any AI model together with the output of a
 * tool's `--help` command. The model answers with the JSON tool file that the
 * palette's "Import tool" action understands (see src/toolfile.js).
 *
 * Field names and file values stay English: they are the file format, not
 * prose. Only the instructions and the example text follow the active locale.
 */

const I18n = require('./i18n');

function schema() {
    const whatIs = I18n.t('model.headingWhatIs');
    const official = I18n.t('model.headingOfficial');
    const useful = I18n.t('model.headingUseful');
    // Built as data and serialized: a translation that contains a quote must
    // never turn the example into invalid JSON.
    return JSON.stringify({
        kind: 'command-maker-tool',
        version: 2,
        tool: {
            title: I18n.t('prompt.schemaTitle'),
            category: I18n.t('prompt.schemaCategory'),
            base: I18n.t('prompt.schemaBase'),
            description: I18n.t('prompt.schemaDescription'),
            content: '<h2>' + whatIs + '</h2><p>...</p><h2>' + official
                + '</h2><ul><li><a href="https://...">...</a></li></ul><h2>' + useful
                + '</h2><ul><li><a href="https://...">...</a></li></ul>',
            install: I18n.t('prompt.schemaInstall'),
            usage: I18n.t('prompt.schemaUsage'),
            help: I18n.t('prompt.schemaHelp'),
            options: [{
                label: I18n.t('prompt.schemaOptionLabel'),
                flag: '-i',
                help: I18n.t('prompt.schemaOptionHelp'),
                type: 'path',
                values: [],
                default: '',
                required: true,
                mode: 'flag',
                placeholder: 'input',
                order: 10,
                quote: 'none',
                sep: ' '
            }]
        }
    }, null, 2);
}

function rules() {
    return [
        I18n.t('prompt.ruleTitleBase'),
        I18n.t('prompt.ruleTags'),
        I18n.t('prompt.ruleCategory'),
        I18n.t('prompt.ruleDescription'),
        I18n.t('prompt.ruleContent'),
        I18n.t('prompt.ruleContentBody'),
        I18n.t('prompt.ruleContentNoLinks'),
        I18n.t('prompt.ruleInstall'),
        I18n.t('prompt.ruleInstallBlocks'),
        I18n.t('prompt.ruleInstallInline'),
        I18n.t('prompt.ruleUsage'),
        I18n.t('prompt.ruleHelp'),
        I18n.t('prompt.ruleOptions'),
        I18n.t('prompt.ruleFlag'),
        I18n.t('prompt.ruleLabel'),
        I18n.t('prompt.ruleOptionHelp'),
        I18n.t('prompt.ruleType'),
        I18n.t('prompt.ruleTypeMore'),
        I18n.t('prompt.ruleValues'),
        I18n.t('prompt.ruleDefault'),
        I18n.t('prompt.ruleRequired'),
        I18n.t('prompt.rulePlaceholder'),
        I18n.t('prompt.ruleOrder'),
        I18n.t('prompt.ruleQuote'),
        I18n.t('prompt.ruleSep'),
        I18n.t('prompt.ruleMode'),
        I18n.t('prompt.ruleNoInvention')
    ].join('\n');
}

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
        I18n.t('prompt.intro'),
        '',
        I18n.t('prompt.returnOnly'),
        I18n.t('prompt.noOmit'),
        '',
        schema(),
        '',
        I18n.t('prompt.rulesHeading'),
        rules(),
        '',
        I18n.t('prompt.inputHeading'),
        title === '' ? I18n.t('prompt.toolNamePlaceholder') : I18n.t('prompt.toolName', { title: title }),
        I18n.t('prompt.helpLabel'),
        helpText === '' ? I18n.t('prompt.helpPlaceholder') : helpText,
        '',
        I18n.t('prompt.convert')
    ];
    return lines.join('\n');
}

module.exports = { buildToolPrompt };