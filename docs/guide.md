# Command Maker for Trilium — full documentation

Everything the plugin does, in detail. Start with the [short README](../README.md) if you only want to install it and press `Ctrl+Shift+Space`.

A TriliumNext plugin that turns your CLI tool notes into a command palette: search a tool, read what it does, fill in its documented options, and get a runnable command you can edit, copy, insert, or save as a preset.

```
Ctrl+Shift+Space  →  search a tool  →  read help  →  fill options  →  command  →  copy / insert
```

## Contents

- [Install](#install)
  - [Uninstall](#uninstall)
  - [Changing the keyboard shortcut](#changing-the-keyboard-shortcut)
  - [Opening the palette in a tab](#opening-the-palette-in-a-tab)
  - [Manual install (no installer script)](#manual-install-no-installer-script)
- [Structure](#structure)
  - [Tool notes](#tool-notes)
  - [The three standard children](#the-three-standard-children)
  - [Option notes](#option-notes)
  - [Command assembly](#command-assembly)
  - [Presets](#presets)
- [Importing options](#importing-options)
- [Importing and exporting whole tools](#importing-and-exporting-whole-tools)
  - [Generating the file with an AI model](#generating-the-file-with-an-ai-model)
- [Version check](#version-check)
- [Design notes](#design-notes)
- [Releasing](#releasing)
- [Development](#development)
- [Limitations](#limitations)
- [License](#license)

## Install

Get the two files from the **Releases** page — do not copy them out of the repository, they are build artifacts:

- [`install.js`](https://github.com/J0nan/Trilium-Command-Maker-Plugin/releases/latest/download/install.js) — the installer (recommended).
- [`command-maker.js`](https://github.com/J0nan/Trilium-Command-Maker-Plugin/releases/latest/download/command-maker.js) — the plugin runtime, only needed for the manual install.

Browse all versions on the [Releases page](https://github.com/J0nan/Trilium-Command-Maker-Plugin/releases).

1. Download `install.js` from the latest release.
2. Create a note in Trilium. Set its type to **Code** and its language to **JavaScript (Trilium backend)**.
3. Paste the whole content of `install.js` into it.
4. Press the **Execute** button on the note (or right-click → Execute script).
5. Press `Ctrl+Shift+Space`.

The installer is idempotent. It creates:

| Note | Purpose |
| --- | --- |
| `Command Maker` (`#cmRoot`) | settings note: holds the plugin and the shortcut override |
| `Tools` (`#cmTools`) | data root: categories and tool notes live here |
| `Command Maker.js` (`#cmPlugin`) | the plugin runtime |

It also registers a launcher (`Command Maker`, `Ctrl+Shift+Space`) through `api.createOrUpdateLauncher`, so no attribute editing and no `#widget` label are required. The first time the palette opens it seeds two documented examples: `git commit` (Version control) and `curl` (Network).

### Uninstall

Nothing in Command Maker rewrites your own notes, so uninstalling is removing the notes the plugin created:

1. Delete the launcher note `al_commandmaker` (action launchers live as `al_` prefixed notes, out of the regular tree) — this removes the `Ctrl+Shift+Space` entry from the global menu.
2. Delete the `Command Maker` settings note (`#cmRoot`). Its children include the plugin runtime note `Command Maker.js` (`#cmPlugin`) and the palette tab notes, so they go with it.
3. Optionally delete the `Tools` folder (`#cmTools`) together with every tool note under it. Your tool notes are normal notes: if you want to keep the documentation but drop the plugin, **Export tool** each one first, or simply leave the folder in place — without the plugin it is just a folder of notes.

Reload Trilium afterwards. Re-running the installer later recreates everything it is missing.

### Changing the keyboard shortcut

The default is `Ctrl+Shift+Space`. The shortcut belongs to the **launcher note** (`#keyboardShortcut`), not to the plugin code, so you can change it without rebuilding or reinstalling:

1. **Global menu → Configure launchbar → Command Maker**, and set the shortcut field. The launcher must be in **Visible launchers**, otherwise the shortcut never fires.
2. Or edit the launcher note `al_commandmaker` (hidden subtree) and change its `#keyboardShortcut` label. Removing the label keeps the launcher button and disables the hotkey.

Re-running the installer keeps a shortcut you set on the launcher (priority 2), but removing `#keyboardShortcut` only disables the hotkey until the next install falls back to the default. To disable it **persistently**, add an empty `#cmShortcut=` to the `Command Maker` settings note — an empty value means "no shortcut" and wins over every other source. Resolution order:

| Priority | Source |
| --- | --- |
| 1 | `#cmShortcut` on the `Command Maker` settings note (empty value = no shortcut) |
| 2 | `#keyboardShortcut` already present on the launcher |
| 3 | `ctrl+shift+space` (default for a fresh install) |

So to pin a shortcut that survives reinstalls, add `#cmShortcut=ctrl+alt+k` to the `Command Maker` note. Useful alternatives that rarely collide: `ctrl+alt+k`, `alt+shift+k`, `ctrl+shift+space`.

### Opening the palette in a tab

The palette opens as an overlay. The **Open in tab** button in its header moves the same interface into a normal Trilium tab, so you can keep it next to your notes instead of covering them.

The first click creates three notes under the `Command Maker` settings note:

| Note | Purpose |
| --- | --- |
| `Command Maker` (`#cmTab`) | Render Note that displays the palette |
| `Command Maker tab` (`#cmTabHtml`) | HTML wrapper rendered by the note |
| `Command Maker.js` clone | The plugin script, cloned under the wrapper so it runs when the tab renders |

The plugin script is **cloned**, not copied, so updating the plugin also updates the tab. Clicking the button again reuses the same notes and opens one more tab.

### Manual install (no installer script)

Download `command-maker.js` from the [latest release](https://github.com/J0nan/Trilium-Command-Maker-Plugin/releases/latest/download/command-maker.js), create a **JS frontend** code note, and paste its whole content. Add the label `#cmPlugin`, then either create a launcher pointing at it (Global menu → Configure launchbar → script launcher) or give it an `#executeButton`. On first open the plugin creates the settings note and the `Tools` folder if they do not exist.

## Structure

```
Tools/                              #cmTools  (move it anywhere, the label follows)
├── Network/                        #cmCategory
│   └── curl/                       #cmTool
│       ├── Install                 #cmInstall   text
│       ├── Usage                   #cmUsage     text (examples in code blocks)
│       ├── Help                    #cmHelpNote  code (text/x-sh)
│       └── Options/                #cmOptions
│           ├── URL                 #cmOption #cmPlaceholder=url #cmRequired=true
│           └── Presets             #cmPresets  JSON
└── Version control/
    └── git commit/                 #cmTool
        └── ...
```

The `Tools` folder is found by its `#cmTools` label, so you can drag it to another path and the plugin keeps working. Use **Tools folder → Use the active note** in the palette (or the note-ID field there) to pick a different root: moving the root **moves the `#cmTools` label** from the old folder to the new one, and only one folder should carry the label — if you label a second folder by hand while another still holds it, the palette picks one of them unpredictably, so use the palette action instead of manual labelling.

If you installed the plugin runtime manually *before* ever running the installer, put the `Command Maker.js` note as a direct child of the `Command Maker` settings note first: the installer only recognises an existing `#cmPlugin` note there, and otherwise it creates a second plugin note.

### Tool notes

A tool note is a normal **text** note. Its content is meant to be read and edited by you, with exactly three H2 sections:

```markdown
## What is?
Describe what the tool does and when to use it.

## Official links
Add the official documentation, repository or website links here.

## Useful links
Add useful guides, cheat sheets or articles here.
```

The palette renders the "What is?" text and makes the links from the other two sections clickable. Everything you add above the `Options` folder is yours to organize; the technical notes are confined to that one folder so they do not get in the way when you read the tool manually.

Two optional labels shape how the palette shows and finds a tool:

| Label | Effect |
| --- | --- |
| `#cmDesc` | one-line description rendered under the tool title in the palette detail pane |
| `#cmTags` | comma-separated search keywords; matched by the search box, never displayed, and carried by **Export tool** into the backup file |

### The three standard children

| Note | Type | Use |
| --- | --- | --- |
| `Install` | text | installation steps/commands |
| `Usage` | text | examples; every code block becomes a one-click example in the palette |
| `Help` | code (`text/x-sh`) | paste the output of `tool --help` here |

> A `Usage` note stored as a **code** note also works: every non-empty line is treated as one example.

The standard children get their own icons (`#iconClass`): download for `Install`, terminal for `Usage`, help for `Help`, and a cog for `Options`. You can change any icon; the plugin only fills in one that is missing.

The palette reads all three: examples can be used or copied, the help output and install steps are shown in collapsible sections, and loading an example fills the option controls from its flags while the preview initially shows the example verbatim; changing any option then regenerates the command from the form.

`Install` keeps the note's formatting in the palette: paragraphs, lists, headings, bold/italic text, code blocks, tables and http(s)/mailto links are rendered as written. Scripts, styles, event handlers, classes and inline styles are removed before rendering. Inline code keeps the monospace/inline-code style, and every code block gets the same copy button Trilium shows on hover (always visible on touch devices). An `Install` note stored as a **code** note is shown as one copyable code block too.

### Option notes

Options live under the tool's `Options` folder. Each option is a note whose title is the readable label and whose attributes describe the flag:

| Attribute | Meaning | Default |
| --- | --- | --- |
| `#cmFlag` | flag text, e.g. `--input`; empty means positional | empty |
| `#cmDoc` | help string shown next to the flag | empty |
| `#cmMode` | `flag` or `inline` | `flag` |
| `#cmPlaceholder` | token name | slug of the flag/title |
| `#cmType` | `string`, `path`, `number`, `boolean`, `enum` | `string` |
| `#cmValues` | enum values, comma separated | — |
| `#cmDefault` | initial value | empty / `false` |
| `#cmRequired` | `true` marks the option required | `false` |
| `#cmOrder` | numeric ordering of emitted segments | `100` |
| `#cmQuote` | `none`, `single`, `double` (emitted segments) | `none` |
| `#cmSep` | `space` or `=` (`--flag=value`) | `space` |

Required options are grouped under a **Required** heading before the **Optional** ones, and produce a warning until they have a value. Set one with `#cmRequired=true`; the **Add option** modal and the import preview can set it for you.

Clicking anywhere on a boolean option row toggles its checkbox.

The option note's content is a good place for a longer explanation; the palette shows `#cmDoc` inline and keeps the full note one click away.

### Command assembly

The command is:

```
<base> <extra arguments> <selected option flags, ordered by #cmOrder>
```

- The base comes from `#cmBase` on the tool note. If it is empty, the tool title is lowercased (`Git commit` → `git commit`). You can edit it from the palette and it is saved back to the tool note.
- "Extra arguments" is a free-text field for positional arguments or subcommands, inserted right after the base.
- Placeholders still work in the base: `{{name}}` is substituted from the option with that placeholder, or becomes an inferred text field when no option exists. `\{{name}}` emits a literal `{{name}}`.

### Presets

A preset saves the current value map. Presets are stored in one JSON note inside the tool's `Options` folder, so they never clutter the tool note. Loading a preset fills every option control and regenerates the command.

## Importing options

**Import options** accepts three sources: pasted text, the currently open note, or a local file. It understands:

1. **`--help` output** — GNU/POSIX style, including `-m, --message <message>`, `--output=FILE`, `--[no-]color`, ffmpeg-style single-dash flags, continuation lines, `(default: …)`, `{a,b,c}` / `one of: a, b` enums.
2. **JSON** — an array, `{ "options": [...] }` or `{ "tool": { "options": [...] } }` with `flag`, `help`, `label`, `type`, `values`, `default`, `required`, `mode`, `placeholder`, `order`.
3. **Markdown table** — `| Flag | Help | Type |` rows.

Nothing is written until you parse and confirm: a preview lists every detected option with a checkbox. One import creates at most 200 option notes; when the source contains more, the status names how many were ignored (the same bound tool-file imports enforce). For a single option, use **Add option** in the palette footer; it writes the same option note with the label, flag and help string you type.

## Importing and exporting whole tools

The footer has **Import tool** and **Export tool** next to the option actions. Both work on one portable JSON file per tool:

```json
{
  "kind": "command-maker-tool",
  "version": 2,
  "tool": {
    "title": "ripgrep",
    "category": "Search",
    "base": "rg",
    "description": "Search text recursively.",
    "tags": "search, cli",
    "content": "<h2>What is?</h2>…<h2>Official links</h2>…<h2>Useful links</h2>…",
    "install": "<p>cargo install ripgrep</p>",
    "usage": "<pre><code>rg pattern</code></pre>",
    "help": "Usage: rg [OPTIONS] PATTERN",
    "options": [
      {
        "label": "Ignore case",
        "flag": "-i",
        "help": "Case insensitive.",
        "content": "<p>Long explanation kept in the option note body.</p>",
        "type": "boolean",
        "values": [],
        "default": "",
        "required": false,
        "mode": "flag",
        "placeholder": "ignore_case",
        "order": 10,
        "quote": "none",
        "sep": " "
      }
    ],
    "presets": [
      { "name": "web", "values": { "note:<note-id>": "web.mp4" } }
    ]
  }
}
```

- **Export tool** reads the selected tool, its three standard children, every option with its note body, the `#cmTags` value and the presets, and shows the JSON. **Copy JSON** copies it; **Download .json** saves it as `<tool>.tool.json`. A version-2 file is therefore a real backup: importing it recreates the tool with nothing the file holds dropped. (Preset values are keyed by option note IDs, so after importing into a *different* instance the stored preset values may not line up with the recreated option notes.) The file must carry `"version": 2` — or no version at all, for hand-written objects, which are read in the current shape; a file declaring any other version is rejected by **Parse** and nothing is written.
- **Import tool** accepts the same JSON from a paste, the active note or a file. It previews the title, category, base and options, then creates a new tool note under that category. A file listing more than 200 options imports only the first 200, with a warning in the preview. Existing tools are never modified or overwritten.

### Generating the file with an AI model

**Import tool → Copy AI prompt** copies a self-contained prompt. It explains the file shape, the option types and the HTML sections the tool note expects, and requires install commands to be `<pre><code>` blocks (never inline code). If the paste box already contains `--help` output, the prompt includes it too.

1. Run `<tool> --help` and copy the output.
2. Open **Import tool**, paste the help output and press **Copy AI prompt**.
3. Give the prompt to any AI model and paste its JSON answer back into the import box.
4. Press **Parse**, review the preview, then **Import tool**.

The model is told to return only the JSON object. If a markdown fence still slips into its answer, strip the ` ``` ` lines before pasting: a fenced file is not parsed as JSON and **Parse** reports `Not valid JSON: …` — nothing is written in either case.

## Version check

Current version: **0.1**. The palette footer shows `v0.1`; click it to check GitHub's latest release (falling back to the highest tag, then `package.json` on `main`). The settings note stores `#cmVersion`, and the installer log prints the version. A network/CORS failure is reported in the status and the **Repository** link opens the source.

## Design notes

- `src/model.js`, `src/render.js`, `src/parse.js`, `src/sections.js`, `src/toolfile.js`, `src/prompt.js` and `src/styles.js` are pure and unit tested. `src/dom.js` holds the shared DOM helpers (elements, styles, clipboard, download, file reads); it has no Trilium API dependency and is exercised through the palette tests. `src/ui.js` and `src/sourcePicker.js` build their own elements directly on the `document`. UI code reads everything it needs from the runtime controller, so it never touches the Trilium `api` global itself.
- `src/sourcePicker.js` is the paste / active note / file panel shared by both import dialogs, so the two of them cannot drift apart.
- `src/backend.js` exposes a single serialisable entry point (`beRun(params)`) because `api.runOnBackend` sends the function source, and inner helpers travel with it while outer helpers would not. Destructive actions validate their target (an option note is only deleted when it carries `#cmOption`).
- The frontend note MIME is `application/javascript;env=frontend`.
- `dist/` is committed so release builds are reproducible; users should download the assets from the Releases page instead of copying files from the repository.

## Releasing

Releases are created manually from GitHub Actions: **Actions → Release → Run workflow**, enter the new version (major.minor, for example `0.2`), and choose whether it is a prerelease. The workflow:

1. updates `package.json` and `src/version.js` (the build refuses to run if they disagree),
2. runs `npm run check` and rebuilds `dist/`,
3. commits `chore(release): vX.Y`, tags `vX.Y`, and pushes,
4. creates the GitHub release with `dist/command-maker.js` and `dist/install.js`.

The workflow only runs from `main`. If `main` is protected, allow GitHub Actions to bypass the protection; otherwise the tag push is rejected. Locally, the same bump is `node tools/bump-version.mjs 0.2` followed by `npm run check`.

## Development

```bash
npm run build     # src/ → dist/command-maker.js + dist/install.js
npm test          # unit tests for model, parser, sections, renderer, backend, UI
npm run check     # both
```

No dependencies, Node 20+. Network access is only used when you click the version in the palette to check for updates.

## Limitations

- The palette indexes tools on open. Large trees make the first open slower.
- Shell quoting targets POSIX shells. For PowerShell, set `#cmQuote=none` and quote inside the base string.
- Inserting into the editor relies on `api.addTextToActiveContextEditor`. If a Trilium build does not expose it, the action reports the problem instead of silently copying.
- The `--help` parser is a heuristic. Always review the preview before importing; JSON or a markdown table is the deterministic option.
- Help output is stored as text. Very long outputs are kept in the note but only the palette's collapsible section renders them.

## License

Released under the GNU General Public License v3.0 (or any later version). The full text ships in [LICENSE](../LICENSE).