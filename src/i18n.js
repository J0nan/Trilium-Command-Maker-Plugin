'use strict';

/**
 * Locale catalog for the whole plugin. One bundle ships every language; the
 * active locale comes from the `cmLang` label on the Command Maker settings
 * note (see src/runtime.js) and falls back to the browser/Trilium language,
 * then English.
 *
 * Contract:
 *   t(key, params)        -> localized string (falls back to English, then key)
 *   setLocale(value)      -> activate a locale, returns the normalized code
 *   getLocale()           -> the active code
 *   detectLocale(list)    -> first supported language in a preference list
 *   backendStrings()      -> plain, parameter-free strings for runOnBackend
 *
 * `backend.js` runs serialized on the Trilium backend, so it cannot require
 * this module; it receives its strings in the action options instead.
 */

const DEFAULT_LOCALE = 'en';
const LOCALES = ['en', 'es'];

const EN = {
    // --- palette shell -----------------------------------------------------
    'ui.searchPlaceholder': 'Search tools…',
    'ui.searchLabel': 'Search tools',
    'ui.openInTab': 'Open in tab',
    'ui.openInTabTitle': 'Open Command Maker in a new Trilium tab',
    'ui.closeTitle': 'Close (Esc)',
    'ui.closeLabel': 'Close palette',
    'ui.closeDialog': 'Close dialog',
    'ui.close': 'Close',
    'ui.newTool': 'New tool',
    'ui.importTool': 'Import tool',
    'ui.exportTool': 'Export tool',
    'ui.importOptions': 'Import options',
    'ui.addOption': 'Add option',
    'ui.toolsFolder': 'Tools folder',
    'ui.repository': 'Repository',
    'ui.language': 'Language',
    'ui.checkUpdates': 'Check for updates',
    'ui.loading': 'Loading…',
    'ui.noToolsMatch': 'No tools match.',
    'ui.pickTool': 'Pick a tool from the list.',
    'ui.noOptions': 'This tool has no options yet. Use "Import options" or add option notes under Options.',
    'ui.required': 'Required',
    'ui.optional': 'Optional',
    'ui.inferred': 'inferred',
    'ui.examples': 'Examples',
    'ui.whatIs': 'What is?',
    'ui.baseCommand': 'Base command',
    'ui.extraArgs': 'Extra arguments',
    'ui.extraPlaceholder': 'Positional arguments or subcommands, inserted after the base',
    'ui.command': 'Command',
    'ui.commandPreview': 'Command preview',
    'ui.copy': 'Copy',
    'ui.insert': 'Insert',
    'ui.regenerate': 'Regenerate',
    'ui.openNote': 'Open note',
    'ui.use': 'Use',
    'ui.load': 'Load',
    'ui.delete': 'Delete',
    'ui.confirmDelete': 'Confirm delete',
    'ui.preset': 'Preset',
    'ui.presets': 'Presets',
    'ui.presetName': 'Preset name',
    'ui.savePreset': 'Save preset',
    'ui.presetsBroken': 'Presets note needs fixing',
    'ui.noPresets': 'No presets yet',
    'ui.helpOutput': 'Help output',
    'ui.install': 'Install',
    'ui.parse': 'Parse',
    'ui.importSelected': 'Import selected',
    'ui.add': 'Add',
    'ui.create': 'Create',
    'ui.optionsCount': function (params) {
        return 'Options (' + params.count + ')';
    },
    'ui.filterPlaceholder': 'Filter options…',
    'ui.filterLabel': 'Filter options',
    'ui.toolName': 'Tool name',
    'ui.toolNamePlaceholder': 'Tool name (e.g. docker)',
    'ui.category': 'Category',
    'ui.newCategory': 'New category…',
    'ui.newCategoryPlaceholder': 'New category name',
    'ui.baseOptional': 'Base command (optional, defaults to the name)',

    // --- option types ------------------------------------------------------
    'type.string': 'string',
    'type.path': 'path',
    'type.number': 'number',
    'type.boolean': 'boolean',
    'type.enum': 'enum',

    // --- status messages ---------------------------------------------------
    'status.updateUnavailable': 'Update check is unavailable.',
    'status.checkingUpdates': 'Checking for updates…',
    'status.updateError': 'v{version}: {error} See the Repository link.',
    'status.installedLatest': 'Installed v{current}; latest v{latest}. Click to check again.',
    'status.latest': 'v{version} is the latest version.',
    'status.outdated': 'v{current} installed · latest is v{latest}.',
    'status.ahead': 'v{current} is newer than the latest published tag (v{latest}).',
    'status.noPublished': 'v{version}: no published version found.',
    'status.nothingToCopy': 'Nothing to copy.',
    'status.copied': 'Copied to the clipboard.',
    'status.clipboardFailed': 'Could not write to the clipboard.',
    'status.inserted': 'Inserted into the active note.',
    'status.pickPreset': 'Pick a preset first.',
    'status.presetLoaded': 'Preset loaded.',
    'status.presetNameRequired': 'Preset name is required.',
    'status.presetSaved': 'Preset saved.',
    'status.presetDeleted': 'Preset deleted.',
    'status.confirmDelete': 'Press Delete again to remove "{name}".',
    'status.exampleLoaded': 'Example loaded into the form.',
    'status.codeCopied': 'Code copied to the clipboard.',
    'status.baseUpdated': 'Base command updated.',
    'status.toolNameRequired': 'Tool name is required.',
    'status.categoryRequired': 'Category name is required.',
    'status.toolCreated': 'Tool created.',
    'status.selectToolFirst': 'Select a tool first.',
    'status.promptCopied': 'AI prompt copied to the clipboard.',
    'status.toolFileCopied': 'Tool file copied to the clipboard.',
    'status.downloaded': 'Downloaded {name}.',
    'status.optionLabelRequired': 'Option label is required.',
    'status.optionAdded': 'Option added.',
    'status.toolsRootActive': 'Tools folder updated to the active note.',
    'status.enterNoteId': 'Enter a note ID.',
    'status.toolsRootUpdated': 'Tools folder updated.',
    'status.noteRead': 'Note read.',
    'status.fileRead': 'File read.',

    // --- warnings rendered in the UI --------------------------------------
    'warn.presetsInvalid': 'The Presets note is not valid JSON. Fix or delete it before saving a preset.',
    'warn.placeholderNoValue': function (params) {
        return 'Placeholder {{' + params.name + '}} has no value.';
    },
    'warn.placeholderNotNumber': function (params) {
        return 'Placeholder {{' + params.name + '}} expects a number.';
    },
    'warn.inlineMissing': function (params) {
        return 'Option "' + params.title + '" is inline but {{' + params.placeholder + '}} is not in the command.';
    },
    'warn.optionRequired': function (params) {
        return 'Option "' + params.title + '" is required.';
    },
    'warn.optionNotNumber': function (params) {
        return 'Option "' + params.title + '" expects a number.';
    },
    'warn.missingPlaceholderName': function (params) {
        return 'Option "' + params.title + '" has an empty placeholder name.';
    },
    'warn.duplicatePlaceholder': function (params) {
        return 'Two options share the placeholder "' + params.name + '"; the first one wins.';
    },
    'warn.duplicateFlag': function (params) {
        return 'Two options use the flag "' + params.flag + '"; the command will repeat it.';
    },
    'warn.duplicateFlagOption': 'Option "{flag}" from {origin} duplicates the earlier one on {first}; the first one wins.',
    'warn.unparsedOptionLine': 'Could not parse the option line "{text}".',
    'warn.jsonEmpty': 'The JSON import is empty.',
    'warn.notValidJson': 'Not valid JSON: {error}',
    'warn.noOptionsArray': 'No options array found in the JSON.',
    'warn.entryNotObject': '{origin} is not an object.',
    'warn.entryNoFlag': '{origin} has no flag.',
    'warn.entryUnusableFlag': '{origin} has an unusable flag.',
    'warn.entryUnusableFlagValue': '{origin} has an unusable flag "{flag}".',
    'warn.htmlTable': 'HTML tables are not supported; use a markdown table.',
    'warn.noTableRows': 'No markdown table rows were found.',
    'warn.noFlagColumn': 'The table header has no flag column.',
    'warn.unknownType': 'Unknown option type "{value}"; using string.',
    'warn.optionEntryNotObject': 'Option entry {index} is not an object.',
    'warn.optionEntryNoName': 'Option entry {index} has no label and no flag.',
    'warn.optionsNotArray': 'The tool "options" field is not an array; no options were read.',
    'warn.fileEmpty': 'The tool file is empty.',
    'warn.fileNotObject': 'The tool file must be a JSON object.',
    'warn.unsupportedVersion': 'This plugin reads tool files version {supported}; the file declares version "{version}".',
    'warn.unexpectedKind': 'Unexpected file kind "{kind}"; expected "{expected}".',
    'warn.missingTitle': 'The tool file has no "title".',
    'warn.tooManyOptions': 'The tool file lists {count} options; only the first {max} are imported.',

    // --- import options dialog --------------------------------------------
    'import.hint': 'Paste "--help" output, a JSON options file, or a markdown table. Nothing is written until you import.',
    'import.placeholder': '--help output, JSON or a markdown table…',
    'import.noOptions': 'No options found. Check the format and try again.',
    'import.selectOption': 'Select {name}',
    'import.nothingToParse': 'Nothing to parse. Paste help output, read the active note or choose a file.',
    'import.parsed': function (params) {
        return 'Parsed ' + params.count + ' option' + (params.count === 1 ? '' : 's') + '.';
    },
    'import.selectOne': 'Select at least one option.',
    'import.imported': function (params) {
        const created = params.created;
        let text = 'Imported ' + created + ' option' + (created === 1 ? '' : 's') + '.';
        if (params.skipped) {
            text += ' Skipped ' + params.skipped + ' duplicate' + (params.skipped === 1 ? '' : 's') + '.';
        }
        if (params.capped) {
            text += ' Ignored ' + params.capped + ' option' + (params.capped === 1 ? '' : 's') + ' over the per-import limit.';
        }
        return text;
    },
    'import.required': 'Required',
    'import.title': 'Import options into "{title}"',

    // --- import tool dialog ------------------------------------------------
    'importTool.hint': 'Paste a tool file (JSON) exported from another tool, or one generated with "Copy AI prompt". Nothing is written until you import.',
    'importTool.placeholder': "Tool file JSON, or the output of the tool's --help command…",
    'importTool.copyPrompt': 'Copy AI prompt',
    'importTool.copyPromptTitle': 'Copy a prompt for any AI model, including the pasted --help output',
    'importTool.nothingToParse': 'Nothing to parse. Paste a tool file, read the active note or choose a file.',
    'importTool.parsed': 'Parsed tool "{title}".',
    'importTool.parseFailed': 'The tool file could not be parsed.',
    'importTool.parseFirst': 'Parse a tool file first.',
    'importTool.imported': 'Imported tool "{title}".',
    'importTool.title': 'Import a tool',
    'importTool.fieldTitle': 'Title',
    'importTool.fieldCategory': 'Category',
    'importTool.fieldBase': 'Base command',
    'importTool.uncategorized': 'Uncategorized',
    'importTool.noOptions': 'This tool file has no options.',
    'importTool.positional': '(positional)',

    // --- export tool dialog ------------------------------------------------
    'export.note': 'This plain-JSON file carries the tags, options and presets, so it can be imported here, kept as a backup, or shared.',
    'export.filename': 'Suggested file name: {name}',
    'export.copyJson': 'Copy JSON',
    'export.download': 'Download .json',
    'export.title': 'Export "{title}"',

    // --- add option dialog -------------------------------------------------
    'addOption.labelPlaceholder': 'Option label, e.g. Output file',
    'addOption.flagPlaceholder': 'Flag, e.g. --output (empty = positional)',
    'addOption.helpPlaceholder': 'What is this option for?',
    'addOption.defaultPlaceholder': 'Default value (optional)',
    'addOption.valuesPlaceholder': 'Enum values, comma separated (optional)',
    'addOption.note': "The option is stored as a note under the tool's Options folder.",
    'addOption.requiredNote': 'Required options are grouped first under Required in the palette.',
    'addOption.fieldLabel': 'Label',
    'addOption.fieldFlag': 'Flag',
    'addOption.fieldHelp': 'Help',
    'addOption.fieldType': 'Type',
    'addOption.fieldDefault': 'Default',
    'addOption.fieldValues': 'Values',
    'addOption.fieldOrder': 'Order',
    'addOption.title': 'Add an option to "{title}"',

    // --- tools folder dialog ----------------------------------------------
    'toolsFolder.useActive': 'Use the active note',
    'toolsFolder.open': 'Open Tools folder',
    'toolsFolder.idPlaceholder': 'Note ID of an existing folder',
    'toolsFolder.useId': 'Use this note ID',
    'toolsFolder.current': 'Current Tools folder: "{title}" ({id}).',
    'toolsFolder.none': 'No Tools folder yet.',

    // --- source picker -----------------------------------------------------
    'source.paste': 'Paste text',
    'source.note': 'Active note',
    'source.file': 'File',
    'source.readNote': 'Read active note',
    'source.read': function (params) {
        return 'Read "' + params.label + '" (' + params.count + ' characters).';
    },
    'source.fileName': 'file',

    // --- frontend errors ---------------------------------------------------
    'error.downloadUnsupported': 'This environment cannot download files. Copy the text instead.',
    'error.filesUnsupported': 'This browser cannot read local files.',
    'error.fileRead': 'Could not read the selected file.',
    'error.apiUnavailable': 'Trilium api is not available.',
    'error.toolNotFound': 'Tool not found. Reopen the palette.',
    'error.toolReadFailed': 'Tool "{title}" could not be read; it may have been deleted. Reopen the palette to refresh.',
    'error.insertUnsupported': 'This Trilium version cannot insert into the editor. Copy the command instead.',
    'error.toolsRootUnavailable': 'Tools folder is not available yet. Reopen the palette.',
    'error.notReady': 'Command Maker is not ready yet. Reopen the palette.',
    'error.pluginNoteMissing': 'Cannot locate the Command Maker plugin note.',
    'error.tabUnsupported': 'This Trilium version cannot open notes in a new tab.',
    'error.noActiveNote': 'No active note.',
    'error.noActiveNoteForTools': 'No active note to use as the Tools folder.',
    'error.noteNotFound': 'Note not found: {id}',
    'error.updateCheckUnavailable': 'This environment cannot check for updates.',
    'error.noPublishedVersion': 'No published version found.',
    'error.updateCheckFailed': 'Could not check for updates: {error}',

    // --- AI prompt ---------------------------------------------------------
    'prompt.intro': 'You convert command-line tool documentation into a Command Maker tool file.',
    'prompt.returnOnly': 'Return only the JSON object. Do not wrap it in a markdown code fence, do not add commentary,',
    'prompt.noOmit': 'and do not omit fields. Use this exact shape:',
    'prompt.rulesHeading': 'Rules:',
    'prompt.inputHeading': 'Input:',
    'prompt.toolName': 'Tool name: {title}',
    'prompt.toolNamePlaceholder': 'Tool name: <tool name>',
    'prompt.helpLabel': '--help output:',
    'prompt.helpPlaceholder': "<paste the output of the tool's --help command here>",
    'prompt.convert': 'Convert the input above now. Return only the JSON object.',
    'prompt.schemaTitle': '<command name, e.g. git commit>',
    'prompt.schemaCategory': '<short group, e.g. Version control>',
    'prompt.schemaBase': '<command the user types, e.g. git commit>',
    'prompt.schemaDescription': '<one sentence>',
    'prompt.schemaInstall': '<p>Install on Windows:</p><pre><code>winget install tool</code></pre>',
    'prompt.schemaUsage': '<p>Example:</p><pre><code>...</code></pre>',
    'prompt.schemaHelp': '<the exact --help output, unchanged>',
    'prompt.schemaOptionLabel': 'Input file',
    'prompt.schemaOptionHelp': 'Input file to read.',
    'prompt.ruleTitleBase': '- title: the command name. base: the exact command the user types (keep subcommands, e.g. "git commit").',
    'prompt.ruleTags': '- tags, presets and per-option "content" exist for full backups; leave them out unless a backup was asked for.',
    'prompt.ruleCategory': '- category: a short group such as "Network", "Media" or "Version control".',
    'prompt.ruleDescription': '- description: one sentence that explains what the tool does.',
    'prompt.ruleContent': function () {
        return '- content: HTML with exactly three <h2> sections in this order: "'
            + t('model.headingWhatIs') + '", "' + t('model.headingOfficial')
            + '", "' + t('model.headingUseful') + '".';
    },
    'prompt.ruleContentBody': function () {
        return '  Put a <p> summary under "' + t('model.headingWhatIs')
            + '" and one <ul><li><a href="...">...</a></li></ul> list under each links section.';
    },
    'prompt.ruleContentNoLinks': '  If no URL is known, leave an empty <ul></ul>; never invent links.',
    'prompt.ruleInstall': '- install: HTML install steps (Windows, macOS, Linux) when known; otherwise a short placeholder paragraph.',
    'prompt.ruleInstallBlocks': '  Put every install command in its own <pre><code>command</code></pre> block. Never use inline <code> for install commands;',
    'prompt.ruleInstallInline': '  inline code is only for short words, file names or values mentioned in prose.',
    'prompt.ruleUsage': '- usage: HTML with two or three realistic <pre><code>command</code></pre> examples.',
    'prompt.ruleHelp': '- help: the raw --help text, unchanged.',
    'prompt.ruleOptions': '- options: one entry per documented option or positional argument.',
    'prompt.ruleFlag': '  - flag: the primary flag ("-i", "--ignore-case"), or "" for a positional argument.',
    'prompt.ruleLabel': '  - label: a short human name ("Ignore case"); required when flag is "".',
    'prompt.ruleOptionHelp': '  - help: what the option does, taken from the help output.',
    'prompt.ruleType': '  - type: "boolean" when it takes no value, "path" for files or directories, "number" for counts or sizes,',
    'prompt.ruleTypeMore': '    "enum" when there is a fixed set of values, "string" otherwise.',
    'prompt.ruleValues': '  - values: the enum choices only, otherwise [].',
    'prompt.ruleDefault': '  - default: the default stated in the help output, otherwise "".',
    'prompt.ruleRequired': '  - required: true only for positional arguments or options the tool requires.',
    'prompt.rulePlaceholder': '  - placeholder: a short unique identifier ("input", "url").',
    'prompt.ruleOrder': '  - order: 10, 20, 30... in the order the options appear.',
    'prompt.ruleQuote': '  - quote: "double" for free text or URLs that may contain spaces, otherwise "none".',
    'prompt.ruleSep': '  - sep: " " normally, "=" only for --flag=value style options.',
    'prompt.ruleMode': '  - mode: "flag" unless the base command itself must contain {{placeholder}}.',
    'prompt.ruleNoInvention': 'Do not invent options that are not in the help output.',

    // --- backend (serialized: parameter-free strings only) ----------------
    'back.noteOptions': 'Options',
    'back.notePresets': 'Presets',
    'back.noteInstall': 'Install',
    'back.noteUsage': 'Usage',
    'back.noteHelp': 'Help',
    'back.noteUncategorized': 'Uncategorized',
    'back.noteNewTool': 'New tool',
    'back.noteOption': 'Option',
    'back.noteSettings': 'Command Maker',
    'back.noteSettingsContent': 'Command Maker settings. The plugin finds this note through its label.',
    'back.noteTools': 'Tools',
    'back.noteToolsContent': 'Tool notes live in this folder, grouped by category. Move it anywhere; the label is what matters.',
    'back.noteTabTitle': 'Command Maker tab',
    'back.noteTabRenderTitle': 'Command Maker',
    'back.errorToolsRoot': 'Tools root not found',
    'back.errorToolNote': 'Tool note not found',
    'back.errorOptionNote': 'Option note not found',
    'back.errorSettingsNote': 'Command Maker settings note not found',
    'back.errorNotAnOptionPrefix': 'Note is not an option of a tool: ',
    'back.errorNoteNotFound': 'Note not found',
    'back.errorPresetsSave': 'The Presets note is not valid JSON. Fix or delete it before saving a preset.',
    'back.errorPresetsDelete': 'The Presets note is not valid JSON. Fix or delete it before deleting a preset.',
    'back.errorUnknownActionPrefix': 'Unknown action: ',

    // --- tool note templates and seeds ------------------------------------
    'model.headingWhatIs': 'What is?',
    'model.headingOfficial': 'Official links',
    'model.headingUseful': 'Useful links',
    'model.toolTemplate': [
        '<h2>What is?</h2>',
        '<p>Describe what this tool does and when to use it.</p>',
        '<h2>Official links</h2>',
        '<p>Add the official documentation, repository or website links here.</p>',
        '<h2>Useful links</h2>',
        '<p>Add useful guides, cheat sheets or articles here.</p>'
    ].join('\n'),
    'model.installTemplate': '<p>Add the installation steps or commands for this tool.</p>',
    'model.usageTemplate': '<p>Add examples of commands with this tool. Put each example in a code block.</p>',
    'model.categoryVersionControl': 'Version control',
    'model.categoryNetwork': 'Network',
    'model.gitDescription': 'Record staged changes in the current Git repository.',
    'model.gitWhatIs': '<code>git commit</code> records the staged changes of the repository as a new commit.',
    'model.gitOfficial': 'Official git-commit documentation',
    'model.gitUseful': 'Conventional Commits',
    'model.gitCommitExample': 'Commit with a message:',
    'model.gitAddAllExample': 'Add all tracked changes and commit:',
    'model.gitAmendExample': 'Amend the last commit without changing its message:',
    'model.gitOptionMessage': 'Commit message. Repeat the flag to add paragraphs.',
    'model.gitOptionMessageLabel': 'Message',
    'model.gitOptionAll': 'Stage all tracked changes before committing.',
    'model.gitOptionAllLabel': 'All changes',
    'model.gitOptionAmend': 'Replace the previous commit instead of creating a new one.',
    'model.gitOptionAmendLabel': 'Amend last commit',
    'model.gitOptionEmpty': 'Record a commit with no changes.',
    'model.gitOptionEmptyLabel': 'Allow empty',
    'model.gitOptionHooks': 'Bypass pre-commit and commit-msg hooks.',
    'model.gitOptionHooksLabel': 'Skip hooks',
    'model.gitOptionAuthor': 'Override the commit author, for example "Name <mail@example.com>".',
    'model.gitOptionAuthorLabel': 'Author',
    'model.gitOptionDate': 'Override the author date.',
    'model.gitOptionDateLabel': 'Date',
    'model.curlDescription': 'Transfer data from or to a server with the curl command-line client.',
    'model.curlWhatIs': 'curl is a command-line tool for transferring data with URLs. It supports HTTP, HTTPS, FTP and many other protocols.',
    'model.curlOfficial': 'Official curl documentation',
    'model.curlUseful': 'curl man page',
    'model.curlPostExample': 'POST JSON:',
    'model.curlDownloadExample': 'Download a file, following redirects:',
    'model.curlHeadersExample': 'Show only the response headers:',
    'model.curlOptionRequest': 'HTTP request method.',
    'model.curlOptionRequestLabel': 'Request method',
    'model.curlOptionHeader': 'Add a request header, for example "Content-Type: application/json".',
    'model.curlOptionHeaderLabel': 'Header',
    'model.curlOptionData': 'Request body sent to the server.',
    'model.curlOptionDataLabel': 'Data',
    'model.curlOptionOutput': 'Write the response body to this file instead of stdout.',
    'model.curlOptionOutputLabel': 'Output file',
    'model.curlOptionFollow': 'Follow HTTP redirects.',
    'model.curlOptionFollowLabel': 'Follow redirects',
    'model.curlOptionSilent': 'Do not show progress or error messages.',
    'model.curlOptionSilentLabel': 'Silent',
    'model.curlOptionCompressed': 'Ask the server for a compressed response and decompress it.',
    'model.curlOptionCompressedLabel': 'Compressed',
    'model.curlOptionUser': 'Server credentials as user:password.',
    'model.curlOptionUserLabel': 'User',
    'model.curlOptionInsecure': 'Allow insecure TLS connections (skip certificate checks).',
    'model.curlOptionInsecureLabel': 'Insecure',
    'model.curlOptionUrl': 'URL to request. Positional; appended last.',
    'model.curlOptionUrlLabel': 'URL'
};

const ES = {
    // --- palette shell -----------------------------------------------------
    'ui.searchPlaceholder': 'Buscar herramientas…',
    'ui.searchLabel': 'Buscar herramientas',
    'ui.openInTab': 'Abrir en pestaña',
    'ui.openInTabTitle': 'Abrir Command Maker en una pestaña nueva de Trilium',
    'ui.closeTitle': 'Cerrar (Esc)',
    'ui.closeLabel': 'Cerrar la paleta',
    'ui.closeDialog': 'Cerrar el diálogo',
    'ui.close': 'Cerrar',
    'ui.newTool': 'Nueva herramienta',
    'ui.importTool': 'Importar herramienta',
    'ui.exportTool': 'Exportar herramienta',
    'ui.importOptions': 'Importar opciones',
    'ui.addOption': 'Añadir opción',
    'ui.toolsFolder': 'Carpeta de herramientas',
    'ui.repository': 'Repositorio',
    'ui.language': 'Idioma',
    'ui.checkUpdates': 'Buscar actualizaciones',
    'ui.loading': 'Cargando…',
    'ui.noToolsMatch': 'Ninguna herramienta coincide.',
    'ui.pickTool': 'Elige una herramienta de la lista.',
    'ui.noOptions': 'Esta herramienta aún no tiene opciones. Usa "Importar opciones" o añade notas de opción dentro de Opciones.',
    'ui.required': 'Obligatorias',
    'ui.optional': 'Opcionales',
    'ui.inferred': 'inferida',
    'ui.examples': 'Ejemplos',
    'ui.whatIs': '¿Qué es?',
    'ui.baseCommand': 'Comando base',
    'ui.extraArgs': 'Argumentos adicionales',
    'ui.extraPlaceholder': 'Argumentos posicionales o subcomandos, insertados después del comando base',
    'ui.command': 'Comando',
    'ui.commandPreview': 'Vista previa del comando',
    'ui.copy': 'Copiar',
    'ui.insert': 'Insertar',
    'ui.regenerate': 'Regenerar',
    'ui.openNote': 'Abrir nota',
    'ui.use': 'Usar',
    'ui.load': 'Cargar',
    'ui.delete': 'Borrar',
    'ui.confirmDelete': 'Confirmar borrado',
    'ui.preset': 'Preset',
    'ui.presets': 'Presets',
    'ui.presetName': 'Nombre del preset',
    'ui.savePreset': 'Guardar preset',
    'ui.presetsBroken': 'La nota de presets necesita arreglo',
    'ui.noPresets': 'Aún no hay presets',
    'ui.helpOutput': 'Salida de --help',
    'ui.install': 'Instalación',
    'ui.parse': 'Analizar',
    'ui.importSelected': 'Importar selección',
    'ui.add': 'Añadir',
    'ui.create': 'Crear',
    'ui.optionsCount': function (params) {
        return 'Opciones (' + params.count + ')';
    },
    'ui.filterPlaceholder': 'Filtrar opciones…',
    'ui.filterLabel': 'Filtrar opciones',
    'ui.toolName': 'Nombre de la herramienta',
    'ui.toolNamePlaceholder': 'Nombre de la herramienta (p. ej. docker)',
    'ui.category': 'Categoría',
    'ui.newCategory': 'Nueva categoría…',
    'ui.newCategoryPlaceholder': 'Nombre de la nueva categoría',
    'ui.baseOptional': 'Comando base (opcional, por defecto el nombre)',

    // --- option types ------------------------------------------------------
    'type.string': 'texto',
    'type.path': 'ruta',
    'type.number': 'número',
    'type.boolean': 'booleano',
    'type.enum': 'enumerado',

    // --- status messages ---------------------------------------------------
    'status.updateUnavailable': 'La comprobación de actualizaciones no está disponible.',
    'status.checkingUpdates': 'Buscando actualizaciones…',
    'status.updateError': 'v{version}: {error} Consulta el enlace al repositorio.',
    'status.installedLatest': 'Instalada la v{current}; última v{latest}. Haz clic para comprobar de nuevo.',
    'status.latest': 'La v{version} es la última versión.',
    'status.outdated': 'Instalada la v{current} · la última es la v{latest}.',
    'status.ahead': 'La v{current} es más reciente que la última etiqueta publicada (v{latest}).',
    'status.noPublished': 'v{version}: no se encontró ninguna versión publicada.',
    'status.nothingToCopy': 'No hay nada que copiar.',
    'status.copied': 'Copiado al portapapeles.',
    'status.clipboardFailed': 'No se pudo escribir en el portapapeles.',
    'status.inserted': 'Insertado en la nota activa.',
    'status.pickPreset': 'Elige primero un preset.',
    'status.presetLoaded': 'Preset cargado.',
    'status.presetNameRequired': 'El nombre del preset es obligatorio.',
    'status.presetSaved': 'Preset guardado.',
    'status.presetDeleted': 'Preset borrado.',
    'status.confirmDelete': 'Pulsa Borrar otra vez para eliminar "{name}".',
    'status.exampleLoaded': 'Ejemplo cargado en el formulario.',
    'status.codeCopied': 'Código copiado al portapapeles.',
    'status.baseUpdated': 'Comando base actualizado.',
    'status.toolNameRequired': 'El nombre de la herramienta es obligatorio.',
    'status.categoryRequired': 'El nombre de la categoría es obligatorio.',
    'status.toolCreated': 'Herramienta creada.',
    'status.selectToolFirst': 'Selecciona primero una herramienta.',
    'status.promptCopied': 'Prompt de IA copiado al portapapeles.',
    'status.toolFileCopied': 'Archivo de herramienta copiado al portapapeles.',
    'status.downloaded': 'Se descargó {name}.',
    'status.optionLabelRequired': 'La etiqueta de la opción es obligatoria.',
    'status.optionAdded': 'Opción añadida.',
    'status.toolsRootActive': 'Carpeta de herramientas actualizada a la nota activa.',
    'status.enterNoteId': 'Introduce un ID de nota.',
    'status.toolsRootUpdated': 'Carpeta de herramientas actualizada.',
    'status.noteRead': 'Nota leída.',
    'status.fileRead': 'Archivo leído.',

    // --- warnings rendered in the UI --------------------------------------
    'warn.presetsInvalid': 'La nota de presets no es JSON válido. Arréglala o bórrala antes de guardar un preset.',
    'warn.placeholderNoValue': function (params) {
        return 'El marcador {{' + params.name + '}} no tiene valor.';
    },
    'warn.placeholderNotNumber': function (params) {
        return 'El marcador {{' + params.name + '}} espera un número.';
    },
    'warn.inlineMissing': function (params) {
        return 'La opción "' + params.title + '" es inline pero {{' + params.placeholder + '}} no está en el comando.';
    },
    'warn.optionRequired': function (params) {
        return 'La opción "' + params.title + '" es obligatoria.';
    },
    'warn.optionNotNumber': function (params) {
        return 'La opción "' + params.title + '" espera un número.';
    },
    'warn.missingPlaceholderName': function (params) {
        return 'La opción "' + params.title + '" tiene un nombre de marcador vacío.';
    },
    'warn.duplicatePlaceholder': function (params) {
        return 'Dos opciones comparten el marcador "' + params.name + '"; gana la primera.';
    },
    'warn.duplicateFlag': function (params) {
        return 'Dos opciones usan el flag "' + params.flag + '"; el comando lo repetirá.';
    },
    'warn.duplicateFlagOption': 'La opción "{flag}" de {origin} duplica la anterior en {first}; gana la primera.',
    'warn.unparsedOptionLine': 'No se pudo analizar la línea de opción "{text}".',
    'warn.jsonEmpty': 'La importación JSON está vacía.',
    'warn.notValidJson': 'JSON no válido: {error}',
    'warn.noOptionsArray': 'No se encontró ningún array de opciones en el JSON.',
    'warn.entryNotObject': '{origin} no es un objeto.',
    'warn.entryNoFlag': '{origin} no tiene flag.',
    'warn.entryUnusableFlag': '{origin} tiene un flag inutilizable.',
    'warn.entryUnusableFlagValue': '{origin} tiene un flag inutilizable "{flag}".',
    'warn.htmlTable': 'Las tablas HTML no son compatibles; usa una tabla markdown.',
    'warn.noTableRows': 'No se encontraron filas de tabla markdown.',
    'warn.noFlagColumn': 'La cabecera de la tabla no tiene columna de flag.',
    'warn.unknownType': 'Tipo de opción desconocido "{value}"; se usa texto.',
    'warn.optionEntryNotObject': 'La entrada de opción {index} no es un objeto.',
    'warn.optionEntryNoName': 'La entrada de opción {index} no tiene etiqueta ni flag.',
    'warn.optionsNotArray': 'El campo "options" de la herramienta no es un array; no se leyó ninguna opción.',
    'warn.fileEmpty': 'El archivo de herramienta está vacío.',
    'warn.fileNotObject': 'El archivo de herramienta debe ser un objeto JSON.',
    'warn.unsupportedVersion': 'Este plugin lee archivos de herramienta de la versión {supported}; el archivo declara la versión "{version}".',
    'warn.unexpectedKind': 'Tipo de archivo inesperado "{kind}"; se esperaba "{expected}".',
    'warn.missingTitle': 'El archivo de herramienta no tiene "title".',
    'warn.tooManyOptions': 'El archivo de herramienta lista {count} opciones; solo se importan las primeras {max}.',

    // --- import options dialog --------------------------------------------
    'import.hint': 'Pega la salida de "--help", un archivo JSON de opciones o una tabla markdown. No se escribe nada hasta que importes.',
    'import.placeholder': 'Salida de --help, JSON o una tabla markdown…',
    'import.noOptions': 'No se encontraron opciones. Revisa el formato e inténtalo de nuevo.',
    'import.selectOption': 'Seleccionar {name}',
    'import.nothingToParse': 'No hay nada que analizar. Pega la salida de --help, lee la nota activa o elige un archivo.',
    'import.parsed': function (params) {
        return params.count === 1
            ? 'Se analizó 1 opción.'
            : 'Se analizaron ' + params.count + ' opciones.';
    },
    'import.selectOne': 'Selecciona al menos una opción.',
    'import.imported': function (params) {
        const created = params.created;
        let text = created === 1
            ? 'Se importó 1 opción.'
            : 'Se importaron ' + created + ' opciones.';
        if (params.skipped) {
            text += params.skipped === 1
                ? ' Se omitió 1 duplicada.'
                : ' Se omitieron ' + params.skipped + ' duplicadas.';
        }
        if (params.capped) {
            text += params.capped === 1
                ? ' Se ignoró 1 opción por el límite por importación.'
                : ' Se ignoraron ' + params.capped + ' opciones por el límite por importación.';
        }
        return text;
    },
    'import.required': 'Obligatoria',
    'import.title': 'Importar opciones en "{title}"',

    // --- import tool dialog ------------------------------------------------
    'importTool.hint': 'Pega un archivo de herramienta (JSON) exportado desde otra herramienta o generado con "Copiar prompt de IA". No se escribe nada hasta que importes.',
    'importTool.placeholder': 'JSON del archivo de herramienta o la salida del comando --help…',
    'importTool.copyPrompt': 'Copiar prompt de IA',
    'importTool.copyPromptTitle': 'Copia un prompt para cualquier modelo de IA, con la salida de --help pegada',
    'importTool.nothingToParse': 'No hay nada que analizar. Pega un archivo de herramienta, lee la nota activa o elige un archivo.',
    'importTool.parsed': 'Herramienta "{title}" analizada.',
    'importTool.parseFailed': 'No se pudo analizar el archivo de herramienta.',
    'importTool.parseFirst': 'Analiza primero un archivo de herramienta.',
    'importTool.imported': 'Herramienta "{title}" importada.',
    'importTool.title': 'Importar una herramienta',
    'importTool.fieldTitle': 'Título',
    'importTool.fieldCategory': 'Categoría',
    'importTool.fieldBase': 'Comando base',
    'importTool.uncategorized': 'Sin categoría',
    'importTool.noOptions': 'Este archivo de herramienta no tiene opciones.',
    'importTool.positional': '(posicional)',

    // --- export tool dialog ------------------------------------------------
    'export.note': 'Este archivo JSON plano incluye las etiquetas, las opciones y los presets, así que puedes importarlo aquí, guardarlo como copia de seguridad o compartirlo.',
    'export.filename': 'Nombre de archivo sugerido: {name}',
    'export.copyJson': 'Copiar JSON',
    'export.download': 'Descargar .json',
    'export.title': 'Exportar "{title}"',

    // --- add option dialog -------------------------------------------------
    'addOption.labelPlaceholder': 'Etiqueta de la opción, p. ej. Archivo de salida',
    'addOption.flagPlaceholder': 'Flag, p. ej. --output (vacío = posicional)',
    'addOption.helpPlaceholder': '¿Para qué sirve esta opción?',
    'addOption.defaultPlaceholder': 'Valor por defecto (opcional)',
    'addOption.valuesPlaceholder': 'Valores de enumeración separados por comas (opcional)',
    'addOption.note': 'La opción se guarda como una nota dentro de la carpeta de opciones de la herramienta.',
    'addOption.requiredNote': 'Las opciones obligatorias se agrupan primero bajo Obligatorias en la paleta.',
    'addOption.fieldLabel': 'Etiqueta',
    'addOption.fieldFlag': 'Flag',
    'addOption.fieldHelp': 'Ayuda',
    'addOption.fieldType': 'Tipo',
    'addOption.fieldDefault': 'Por defecto',
    'addOption.fieldValues': 'Valores',
    'addOption.fieldOrder': 'Orden',
    'addOption.title': 'Añadir una opción a "{title}"',

    // --- tools folder dialog ----------------------------------------------
    'toolsFolder.useActive': 'Usar la nota activa',
    'toolsFolder.open': 'Abrir la carpeta de herramientas',
    'toolsFolder.idPlaceholder': 'ID de nota de una carpeta existente',
    'toolsFolder.useId': 'Usar este ID de nota',
    'toolsFolder.current': 'Carpeta de herramientas actual: "{title}" ({id}).',
    'toolsFolder.none': 'Aún no hay carpeta de herramientas.',

    // --- source picker -----------------------------------------------------
    'source.paste': 'Pegar texto',
    'source.note': 'Nota activa',
    'source.file': 'Archivo',
    'source.readNote': 'Leer la nota activa',
    'source.read': function (params) {
        return 'Se leyó "' + params.label + '" (' + params.count + ' caracteres).';
    },
    'source.fileName': 'archivo',

    // --- frontend errors ---------------------------------------------------
    'error.downloadUnsupported': 'Este entorno no puede descargar archivos. Copia el texto en su lugar.',
    'error.filesUnsupported': 'Este navegador no puede leer archivos locales.',
    'error.fileRead': 'No se pudo leer el archivo seleccionado.',
    'error.apiUnavailable': 'La API de Trilium no está disponible.',
    'error.toolNotFound': 'Herramienta no encontrada. Vuelve a abrir la paleta.',
    'error.toolReadFailed': 'No se pudo leer la herramienta "{title}"; puede que se haya borrado. Vuelve a abrir la paleta para actualizar.',
    'error.insertUnsupported': 'Esta versión de Trilium no puede insertar en el editor. Copia el comando en su lugar.',
    'error.toolsRootUnavailable': 'La carpeta de herramientas aún no está disponible. Vuelve a abrir la paleta.',
    'error.notReady': 'Command Maker aún no está listo. Vuelve a abrir la paleta.',
    'error.pluginNoteMissing': 'No se encuentra la nota del plugin Command Maker.',
    'error.tabUnsupported': 'Esta versión de Trilium no puede abrir notas en una pestaña nueva.',
    'error.noActiveNote': 'No hay ninguna nota activa.',
    'error.noActiveNoteForTools': 'No hay ninguna nota activa para usar como carpeta de herramientas.',
    'error.noteNotFound': 'Nota no encontrada: {id}',
    'error.updateCheckUnavailable': 'Este entorno no puede comprobar actualizaciones.',
    'error.noPublishedVersion': 'No se encontró ninguna versión publicada.',
    'error.updateCheckFailed': 'No se pudieron comprobar las actualizaciones: {error}',

    // --- AI prompt ---------------------------------------------------------
    'prompt.intro': 'Conviertes la documentación de herramientas de línea de comandos en un archivo de herramienta de Command Maker.',
    'prompt.returnOnly': 'Devuelve solo el objeto JSON. No lo envuelvas en un bloque de código markdown, no añadas comentarios',
    'prompt.noOmit': 'y no omitas campos. Usa exactamente esta forma:',
    'prompt.rulesHeading': 'Reglas:',
    'prompt.inputHeading': 'Entrada:',
    'prompt.toolName': 'Nombre de la herramienta: {title}',
    'prompt.toolNamePlaceholder': 'Nombre de la herramienta: <nombre de la herramienta>',
    'prompt.helpLabel': 'Salida de --help:',
    'prompt.helpPlaceholder': '<pega aquí la salida del comando --help de la herramienta>',
    'prompt.convert': 'Convierte la entrada anterior ahora. Devuelve solo el objeto JSON.',
    'prompt.schemaTitle': '<nombre del comando, p. ej. git commit>',
    'prompt.schemaCategory': '<grupo corto, p. ej. Control de versiones>',
    'prompt.schemaBase': '<comando que escribe el usuario, p. ej. git commit>',
    'prompt.schemaDescription': '<una frase>',
    'prompt.schemaInstall': '<p>Instalar en Windows:</p><pre><code>winget install tool</code></pre>',
    'prompt.schemaUsage': '<p>Ejemplo:</p><pre><code>...</code></pre>',
    'prompt.schemaHelp': '<la salida exacta de --help, sin cambios>',
    'prompt.schemaOptionLabel': 'Archivo de entrada',
    'prompt.schemaOptionHelp': 'Archivo de entrada que leer.',
    'prompt.ruleTitleBase': '- title: el nombre del comando. base: el comando exacto que escribe el usuario (mantén los subcomandos, p. ej. "git commit").',
    'prompt.ruleTags': '- tags, presets y el "content" de cada opción existen para copias de seguridad completas; omítelos salvo que se pida una copia de seguridad.',
    'prompt.ruleCategory': '- category: un grupo corto como "Red", "Multimedia" o "Control de versiones".',
    'prompt.ruleDescription': '- description: una frase que explique qué hace la herramienta.',
    'prompt.ruleContent': function () {
        return '- content: HTML con exactamente tres secciones <h2> en este orden: "'
            + t('model.headingWhatIs') + '", "' + t('model.headingOfficial')
            + '", "' + t('model.headingUseful') + '".';
    },
    'prompt.ruleContentBody': function () {
        return '  Pon un resumen <p> bajo "' + t('model.headingWhatIs')
            + '" y una lista <ul><li><a href="...">...</a></li></ul> bajo cada sección de enlaces.';
    },
    'prompt.ruleContentNoLinks': '  Si no conoces ninguna URL, deja un <ul></ul> vacío; nunca inventes enlaces.',
    'prompt.ruleInstall': '- install: pasos de instalación en HTML (Windows, macOS, Linux) cuando se conozcan; si no, un párrafo breve de relleno.',
    'prompt.ruleInstallBlocks': '  Pon cada comando de instalación en su propio bloque <pre><code>comando</code></pre>. No uses <code> en línea para comandos de instalación;',
    'prompt.ruleInstallInline': '  el código en línea es solo para palabras cortas, nombres de archivo o valores mencionados en el texto.',
    'prompt.ruleUsage': '- usage: HTML con dos o tres ejemplos realistas <pre><code>comando</code></pre>.',
    'prompt.ruleHelp': '- help: el texto raw de --help, sin cambios.',
    'prompt.ruleOptions': '- options: una entrada por cada opción documentada o argumento posicional.',
    'prompt.ruleFlag': '  - flag: el flag principal ("-i", "--ignore-case"), o "" para un argumento posicional.',
    'prompt.ruleLabel': '  - label: un nombre humano corto ("Ignorar mayúsculas"); obligatorio cuando flag es "".',
    'prompt.ruleOptionHelp': '  - help: qué hace la opción, tomado de la salida de ayuda.',
    'prompt.ruleType': '  - type: "boolean" cuando no lleva valor, "path" para archivos o directorios, "number" para recuentos o tamaños,',
    'prompt.ruleTypeMore': '    "enum" cuando hay un conjunto fijo de valores, "string" en el resto de casos.',
    'prompt.ruleValues': '  - values: solo las opciones de la enumeración; si no, [].',
    'prompt.ruleDefault': '  - default: el valor por defecto indicado en la ayuda; si no, "".',
    'prompt.ruleRequired': '  - required: true solo para argumentos posicionales u opciones que la herramienta exige.',
    'prompt.rulePlaceholder': '  - placeholder: un identificador corto y único ("entrada", "url").',
    'prompt.ruleOrder': '  - order: 10, 20, 30... en el orden en que aparecen las opciones.',
    'prompt.ruleQuote': '  - quote: "double" para texto libre o URLs que puedan contener espacios; si no, "none".',
    'prompt.ruleSep': '  - sep: " " normalmente, "=" solo para opciones con estilo --flag=valor.',
    'prompt.ruleMode': '  - mode: "flag" salvo que el comando base deba contener {{placeholder}}.',
    'prompt.ruleNoInvention': 'No inventes opciones que no aparezcan en la salida de ayuda.',

    // --- backend (serialized: parameter-free strings only) ----------------
    'back.noteOptions': 'Opciones',
    'back.notePresets': 'Presets',
    'back.noteInstall': 'Instalación',
    'back.noteUsage': 'Uso',
    'back.noteHelp': 'Ayuda',
    'back.noteUncategorized': 'Sin categoría',
    'back.noteNewTool': 'Nueva herramienta',
    'back.noteOption': 'Opción',
    'back.noteSettings': 'Command Maker',
    'back.noteSettingsContent': 'Ajustes de Command Maker. El plugin encuentra esta nota por su etiqueta.',
    'back.noteTools': 'Herramientas',
    'back.noteToolsContent': 'Las notas de herramientas viven en esta carpeta, agrupadas por categoría. Muévela donde quieras; lo que importa es la etiqueta.',
    'back.noteTabTitle': 'Pestaña de Command Maker',
    'back.noteTabRenderTitle': 'Command Maker',
    'back.errorToolsRoot': 'No se encontró la raíz de herramientas',
    'back.errorToolNote': 'No se encontró la nota de la herramienta',
    'back.errorOptionNote': 'No se encontró la nota de la opción',
    'back.errorSettingsNote': 'No se encontró la nota de ajustes de Command Maker',
    'back.errorNotAnOptionPrefix': 'La nota no es una opción de ninguna herramienta: ',
    'back.errorNoteNotFound': 'Nota no encontrada',
    'back.errorPresetsSave': 'La nota de presets no es JSON válido. Arréglala o bórrala antes de guardar un preset.',
    'back.errorPresetsDelete': 'La nota de presets no es JSON válido. Arréglala o bórrala antes de borrar un preset.',
    'back.errorUnknownActionPrefix': 'Acción desconocida: ',

    // --- tool note templates and seeds ------------------------------------
    'model.headingWhatIs': '¿Qué es?',
    'model.headingOfficial': 'Enlaces oficiales',
    'model.headingUseful': 'Enlaces útiles',
    'model.toolTemplate': [
        '<h2>¿Qué es?</h2>',
        '<p>Describe qué hace esta herramienta y cuándo usarla.</p>',
        '<h2>Enlaces oficiales</h2>',
        '<p>Añade aquí la documentación oficial, el repositorio o el sitio web.</p>',
        '<h2>Enlaces útiles</h2>',
        '<p>Añade aquí guías, chuletas o artículos útiles.</p>'
    ].join('\n'),
    'model.installTemplate': '<p>Añade los pasos o comandos de instalación de esta herramienta.</p>',
    'model.usageTemplate': '<p>Añade ejemplos de comandos con esta herramienta. Pon cada ejemplo en un bloque de código.</p>',
    'model.categoryVersionControl': 'Control de versiones',
    'model.categoryNetwork': 'Red',
    'model.gitDescription': 'Registra los cambios preparados en el repositorio Git actual.',
    'model.gitWhatIs': '<code>git commit</code> registra los cambios preparados del repositorio como un commit nuevo.',
    'model.gitOfficial': 'Documentación oficial de git-commit',
    'model.gitUseful': 'Conventional Commits',
    'model.gitCommitExample': 'Haz un commit con mensaje:',
    'model.gitAddAllExample': 'Añade todos los cambios rastreados y haz commit:',
    'model.gitAmendExample': 'Modifica el último commit sin cambiar su mensaje:',
    'model.gitOptionMessage': 'Mensaje del commit. Repite el flag para añadir párrafos.',
    'model.gitOptionMessageLabel': 'Mensaje',
    'model.gitOptionAll': 'Prepara todos los cambios rastreados antes de hacer commit.',
    'model.gitOptionAllLabel': 'Todos los cambios',
    'model.gitOptionAmend': 'Sustituye el commit anterior en lugar de crear uno nuevo.',
    'model.gitOptionAmendLabel': 'Modificar el último commit',
    'model.gitOptionEmpty': 'Registra un commit sin cambios.',
    'model.gitOptionEmptyLabel': 'Permitir vacío',
    'model.gitOptionHooks': 'Omite los hooks pre-commit y commit-msg.',
    'model.gitOptionHooksLabel': 'Omitir hooks',
    'model.gitOptionAuthor': 'Sustituye el autor del commit, por ejemplo "Nombre <correo@ejemplo.com>".',
    'model.gitOptionAuthorLabel': 'Autor',
    'model.gitOptionDate': 'Sustituye la fecha del autor.',
    'model.gitOptionDateLabel': 'Fecha',
    'model.curlDescription': 'Transfiere datos desde o hacia un servidor con el cliente de línea de comandos curl.',
    'model.curlWhatIs': 'curl es una herramienta de línea de comandos para transferir datos con URLs. Admite HTTP, HTTPS, FTP y muchos otros protocolos.',
    'model.curlOfficial': 'Documentación oficial de curl',
    'model.curlUseful': 'Página man de curl',
    'model.curlPostExample': 'Envía un POST con JSON:',
    'model.curlDownloadExample': 'Descarga un archivo siguiendo redirecciones:',
    'model.curlHeadersExample': 'Muestra solo las cabeceras de la respuesta:',
    'model.curlOptionRequest': 'Método HTTP de la petición.',
    'model.curlOptionRequestLabel': 'Método',
    'model.curlOptionHeader': 'Añade una cabecera a la petición, por ejemplo "Content-Type: application/json".',
    'model.curlOptionHeaderLabel': 'Cabecera',
    'model.curlOptionData': 'Cuerpo de la petición que se envía al servidor.',
    'model.curlOptionDataLabel': 'Datos',
    'model.curlOptionOutput': 'Escribe el cuerpo de la respuesta en este archivo en lugar de la salida estándar.',
    'model.curlOptionOutputLabel': 'Archivo de salida',
    'model.curlOptionFollow': 'Sigue las redirecciones HTTP.',
    'model.curlOptionFollowLabel': 'Seguir redirecciones',
    'model.curlOptionSilent': 'No muestra el progreso ni los mensajes de error.',
    'model.curlOptionSilentLabel': 'Silencioso',
    'model.curlOptionCompressed': 'Pide al servidor una respuesta comprimida y la descomprime.',
    'model.curlOptionCompressedLabel': 'Comprimido',
    'model.curlOptionUser': 'Credenciales del servidor como usuario:contraseña.',
    'model.curlOptionUserLabel': 'Usuario',
    'model.curlOptionInsecure': 'Permite conexiones TLS inseguras (omite la comprobación de certificados).',
    'model.curlOptionInsecureLabel': 'Inseguro',
    'model.curlOptionUrl': 'URL que solicitar. Posicional; se añade al final.',
    'model.curlOptionUrlLabel': 'URL'
};

// Backend fallback body: the same template the frontend sends, without
// duplicating the HTML in two places.
EN['back.toolContent'] = EN['model.toolTemplate'];
ES['back.toolContent'] = ES['model.toolTemplate'];

const DICTIONARIES = { en: EN, es: ES };

let current = DEFAULT_LOCALE;

function normalizeLocale(value) {
    const base = String(value == null ? '' : value).trim().toLowerCase().split(/[-_]/)[0];
    return LOCALES.indexOf(base) !== -1 ? base : '';
}

function detectLocale(candidates) {
    const list = Array.isArray(candidates) ? candidates : [candidates];
    for (const candidate of list) {
        const found = normalizeLocale(candidate);
        if (found) {
            return found;
        }
    }
    return DEFAULT_LOCALE;
}

function setLocale(value) {
    current = normalizeLocale(value) || DEFAULT_LOCALE;
    return current;
}

function getLocale() {
    return current;
}

function interpolate(text, params) {
    if (!params) {
        return text;
    }
    return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
    });
}

function t(key, params) {
    const dictionary = DICTIONARIES[current] || EN;
    let value = dictionary[key];
    if (value === undefined) {
        value = EN[key];
    }
    if (value === undefined) {
        return key;
    }
    if (typeof value === 'function') {
        return String(value(params || {}));
    }
    return interpolate(value, params);
}

/** Keys the backend needs; passed as plain values because it runs serialized. */
const BACKEND_KEYS = [
    'back.noteOptions', 'back.notePresets', 'back.noteInstall', 'back.noteUsage',
    'back.noteHelp', 'back.noteUncategorized', 'back.noteNewTool', 'back.noteOption',
    'back.noteSettings', 'back.noteSettingsContent', 'back.noteTools',
    'back.noteToolsContent', 'back.noteTabTitle', 'back.noteTabRenderTitle',
    'back.toolContent',
    'back.errorToolsRoot', 'back.errorToolNote', 'back.errorOptionNote',
    'back.errorSettingsNote', 'back.errorNotAnOptionPrefix',
    'back.errorNoteNotFound', 'back.errorNoteNotFoundPrefix',
    'back.errorPresetsSave', 'back.errorPresetsDelete',
    'back.errorUnknownActionPrefix'
];

function backendStrings() {
    const out = {};
    for (const key of BACKEND_KEYS) {
        out[key] = t(key);
    }
    return out;
}

module.exports = {
    DEFAULT_LOCALE,
    LOCALES,
    DICTIONARIES,
    normalizeLocale,
    detectLocale,
    setLocale,
    getLocale,
    t,
    backendStrings
};