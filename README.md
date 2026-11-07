# Command Maker for Trilium

A TriliumNext plugin that turns your CLI tool notes into a command palette: search a tool,
read what it does, fill in its documented options, and get a runnable command you can edit,
copy, insert, or save as a preset.

Built for TriliumNext ≥ 0.101 (launcher API, frontend scripts).

```
Ctrl+Shift+Space  →  search a tool  →  read help  →  fill options  →  command  →  copy / insert
```

Current version: **0.1**. The palette footer shows `v0.1`; click it to check
GitHub's latest release (falling back to the highest tag, then `package.json` on
`main`). The settings note stores `#cmVersion`, and the installer log prints the
version. A network/CORS failure is reported in the status and the **Repository**
link opens the source.

## Install

1. Create a note in Trilium. Set its type to **Code** and its language to
   **JavaScript (Trilium backend)**.
2. Paste the whole content of [`dist/install.js`](dist/install.js) into it.
3. Press the **Execute** button on the note (or right-click → Execute script).
4. Press `Ctrl+Shift+Space`.

The installer is idempotent. It creates:

| Note | Purpose |
| --- | --- |
| `Command Maker` (`#cmRoot`) | settings note: holds the plugin and the shortcut override |
| `Tools` (`#cmTools`) | data root: categories and tool notes live here |
| `Command Maker.js` (`#cmPlugin`) | the plugin runtime |

It also registers a launcher (`Command Maker`, `Ctrl+Shift+Space`) through
`api.createOrUpdateLauncher`, so no attribute editing and no `#widget` label are
required. The first time the palette opens it seeds two documented examples:
`git commit` (Version control) and `curl` (Network).

### Changing the keyboard shortcut

The default is `Ctrl+Shift+Space`. The shortcut belongs to the **launcher note**
(`#keyboardShortcut`), not to the plugin code, so you can change it without
rebuilding or reinstalling:

1. **Global menu → Configure launchbar → Command Maker**, and set the shortcut
   field. The launcher must be in **Visible launchers**, otherwise the shortcut
   never fires.
2. Or edit the launcher note `al_commandmaker` (hidden subtree) and change its
   `#keyboardShortcut` label. Removing the label keeps the launcher button and
   disables the hotkey.

Re-running the installer **preserves** the shortcut you set. Resolution order:

| Priority | Source |
| --- | --- |
| 1 | `#cmShortcut` on the `Command Maker` settings note (empty value = no shortcut) |
| 2 | `#keyboardShortcut` already present on the launcher |
| 3 | `ctrl+shift+space` (default for a fresh install) |

So to pin a shortcut that survives reinstalls, add `#cmShortcut=ctrl+alt+k` to the
`Command Maker` note. Useful alternatives that rarely collide: `ctrl+alt+k`,
`alt+shift+k`, `ctrl+shift+space`.

### Manual install (no installer script)

Create a **JS frontend** code note and paste [`dist/command-maker.js`](dist/command-maker.js).
Add the label `#cmPlugin`, then either create a launcher pointing at it
(Global menu → Configure launchbar → script launcher) or give it an
`#executeButton`. On first open the plugin creates the settings note and the
`Tools` folder if they do not exist.

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

The `Tools` folder is found by its `#cmTools` label, so you can drag it to another
path and the plugin keeps working. Use **Tools folder → Use the active note** in
the palette (or add `#cmTools` to any folder manually) to pick a different root.

### Tool notes

A tool note is a normal **text** note. Its content is meant to be read and edited
by you, with exactly three H2 sections:

```markdown
## What is?
Describe what the tool does and when to use it.

## Official links
Add the official documentation, repository or website links here.

## Useful links
Add useful guides, cheat sheets or articles here.
```

The palette renders the "What is?" text and makes the links from the other two
sections clickable. Everything you add above the `Options` folder is yours to
organize; the technical notes are confined to that one folder so they do not
get in the way when you read the tool manually.

### The three standard children

| Note | Type | Use |
| --- | --- | --- |
| `Install` | text | installation steps/commands |
| `Usage` | text | examples; every code block becomes a one-click example in the palette |
| `Help` | code (`text/x-sh`) | paste the output of `tool --help` here |

> A `Usage` note stored as a **code** note also works: every non-empty line is
> treated as one example.

The standard children get their own icons (`#iconClass`): download for `Install`,
terminal for `Usage`, help for `Help`, and a cog for `Options`. You can change any
icon; the plugin only fills in one that is missing.

The palette reads all three: examples can be used or copied, the help output and
install steps are shown in collapsible sections, and loading an example fills the
option controls from its flags while the preview initially shows the example
verbatim; changing any option then regenerates the command from the form.

### Option notes

Options live under the tool's `Options` folder. Each option is a note whose title
is the readable label and whose attributes describe the flag:

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

Required options are grouped under a **Required** heading before the
**Optional** ones, and produce a warning until they have a value. Set one with
`#cmRequired=true`; the **Add option** modal and the import preview can set it
for you.

Clicking anywhere on a boolean option row toggles its checkbox.

The option note's content is a good place for a longer explanation; the palette
shows `#cmDoc` inline and keeps the full note one click away.

### Command assembly

The command is:

```
<base> <extra arguments> <selected option flags, ordered by #cmOrder>
```

- The base comes from `#cmBase` on the tool note. If it is empty, the tool title is
  lowercased (`Git commit` → `git commit`). You can edit it from the palette and it
  is saved back to the tool note.
- "Extra arguments" is a free-text field for positional arguments or subcommands,
  inserted right after the base.
- Placeholders still work in the base: `{{name}}` is substituted from the option
  with that placeholder, or becomes an inferred text field when no option exists.
  `\{{name}}` emits a literal `{{name}}`.

### Presets

A preset saves the current value map. Presets are stored in one JSON note inside
the tool's `Options` folder, so they never clutter the tool note. Loading a preset
fills every option control and regenerates the command.

## Importing options

**Import options** accepts three sources: pasted text, the currently open note, or
a local file. It understands:

1. **`--help` output** — GNU/POSIX style, including `-m, --message <message>`,
   `--output=FILE`, `--[no-]color`, ffmpeg-style single-dash flags, continuation
   lines, `(default: …)`, `{a,b,c}` / `one of: a, b` enums.
2. **JSON** — an array, `{ "options": [...] }` or `{ "tool": { "options": [...] } }`
   with `flag`, `help`, `label`, `type`, `values`, `default`, `required`, `mode`,
   `placeholder`, `order`.
3. **Markdown table** — `| Flag | Help | Type |` rows.

Nothing is written until you parse and confirm: a preview lists every detected
option with a checkbox. For a single option, use **Add option** in the palette
footer; it writes the same option note with the label, flag and help string you
type.

## Design notes

- `src/model.js`, `src/render.js`, `src/parse.js` and `src/sections.js` are pure and
  unit tested. `src/ui.js` is plain DOM — no JSX compile step, no Preact coupling.
- `src/backend.js` exposes a single serialisable entry point (`beRun(params)`)
  because `api.runOnBackend` sends the function source, and inner helpers travel
  with it while outer helpers would not.
- The frontend note MIME is `application/javascript;env=frontend`.
- `dist/` is committed because it is the artifact users import.

## Releasing

Releases are created manually from GitHub Actions: **Actions → Release → Run
workflow**, enter the new version (major.minor, for example `0.2`), and choose
whether it is a prerelease. The workflow:

1. updates `package.json` and `src/version.js` (the build refuses to run if they disagree),
2. runs `npm run check` and rebuilds `dist/`,
3. commits `chore(release): vX.Y`, tags `vX.Y`, and pushes,
4. creates the GitHub release with `dist/command-maker.js` and `dist/install.js`.

The workflow only runs from `main`. If `main` is protected, allow GitHub Actions
to bypass the protection; otherwise the tag push is rejected. Locally, the same
bump is `node tools/bump-version.mjs 0.2` followed by `npm run check`.

## Development

```bash
npm run build     # src/ → dist/command-maker.js + dist/install.js
npm test          # unit tests for model, parser, sections, renderer, backend, UI
npm run check     # both
```

No dependencies, Node 20+. Network access is only used when you click the version
in the palette to check for updates.

## Limitations

- The palette indexes tools on open. Large trees make the first open slower.
- Shell quoting targets POSIX shells. For PowerShell, set `#cmQuote=none` and
  quote inside the base string.
- Inserting into the editor relies on `api.addTextToActiveContextEditor`. If a
  Trilium build does not expose it, the action reports the problem instead of
  silently copying.
- The `--help` parser is a heuristic. Always review the preview before importing;
  JSON or a markdown table is the deterministic option.
- Help output is stored as text. Very long outputs are kept in the note but only
  the palette's collapsible section renders them.