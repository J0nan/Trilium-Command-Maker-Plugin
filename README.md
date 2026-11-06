# Command Maker for Trilium

A TriliumNext plugin that turns notes into a command palette: search a command,
fill in its options, get a runnable string you can edit, copy, insert, or save
as a preset.

Built for TriliumNext ≥ 0.101 (templates, launcher API, frontend scripts).

```
Ctrl+Shift+K  →  search  →  fill options  →  command  →  copy / insert / preset
```

## Install

1. Create a note in Trilium. Set its type to **Code** and its language to
   **JavaScript (Trilium backend)**.
2. Paste the whole content of [`dist/install.js`](dist/install.js) into it.
3. Press the **Execute** button on the note (or right-click → Execute script).
4. Press `Ctrl+Shift+K`.

The installer is idempotent. It creates:

| Note | Purpose |
| --- | --- |
| `Command Maker` (`#cmRoot`) | holds the templates and your commands |
| `Command Template` (`#template`, `#cmTemplate`, `#cmCommand`) | the template new commands come from |
| `Option Template` (`#template`, `#cmOptionTemplate`) | defaults for new option notes |
| `Command Maker.js` (`#cmPlugin`) | the plugin runtime |
| two example commands | `ffmpeg compress`, `git commit` |

It also registers a launcher (`Command Maker`, `Ctrl+Shift+K`) through
`api.createOrUpdateLauncher`, so no attribute editing and no `#widget` label are
required.

### Manual install (no installer script)

Create a **JS frontend** code note and paste [`dist/command-maker.js`](dist/command-maker.js).
Add the label `#cmPlugin`, then either create a launcher pointing at it
(Global menu → Configure launchbar → script launcher) or give it an
`#executeButton`. On first open the plugin bootstraps its own note tree.

## Using it

- **Search** filters command notes by title, description, tags, base command and
  option names. `ArrowUp` / `ArrowDown` / `Enter`.
- **Options** render as checkboxes (boolean), selects (enum), number inputs and
  text inputs. Required options are marked `*`.
- **Command** is an editable code box. Editing it stops the generator from
  overwriting your changes; `Regenerate` restores the generated text.
- **Copy** uses the clipboard API with a legacy fallback. `Ctrl+Enter` copies.
  **Insert** appends the command to the active note's editor.
- **Presets** save the current value map under the command. Loading a preset
  restores every value.

## Command notes

A command is a note that inherits `#cmCommand`. It is a **code note** (`text/x-sh`)
so its content is the raw base string; options are child notes under an `Options`
folder.

```
Command Maker/
├── Command Template/          #template #cmTemplate #cmCommand
│   ├── Options/               #cmOptions  (~child:template → Option Template)
│   └── Presets/               #cmPresets
├── Option Template/           #template #cmOptionTemplate
└── ffmpeg compress/           #cmCommand
    ├── Options/
    │   ├── Input file         #cmFlag=-i   #cmPlaceholder=input #cmType=path #cmQuote=double
    │   ├── Video codec        #cmFlag=-c:v #cmType=enum #cmValues=libx264,libx265 #cmDefault=libx264
    │   ├── CRF quality        #cmFlag=-crf #cmType=number #cmDefault=23
    │   └── Overwrite output   #cmFlag=-y   #cmType=boolean
    └── Presets/
```

Base string of that command: `ffmpeg -i "{{input}}"`.

### Attribute reference

Command notes:

| Attribute | Meaning |
| --- | --- |
| `#cmDesc` | subtitle shown in search results |
| `#cmTags` | extra search terms |
| `#cmBase` | base string; overrides the note content |
| `#cmCommand` | marks the note as a command (inherited from the template) |

Option notes:

| Attribute | Meaning | Default |
| --- | --- | --- |
| `#cmFlag` | flag text, e.g. `--input`; empty means positional | empty |
| `#cmMode` | `flag` or `inline` | `flag` |
| `#cmPlaceholder` | token name | slug of the title |
| `#cmType` | `string`, `path`, `number`, `boolean`, `enum` | `string` |
| `#cmValues` | enum values, comma separated | — |
| `#cmDefault` | initial value | empty / `false` |
| `#cmRequired` | `true` marks the option required | `false` |
| `#cmOrder` | numeric ordering of emitted segments | `100` |
| `#cmQuote` | `none`, `single`, `double` | `none` |
| `#cmSep` | `space` or `=` (`--flag=value`) | `space` |

### Flags and placeholders together

Both mechanisms coexist:

1. One value, one channel — an option is either appended as a flag or
   substituted into a placeholder, never both.
2. If the base string contains `{{name}}` for an option, that option is
   substituted inline even if its mode is `flag`. This prevents the same value
   from being emitted twice.
3. A placeholder with no backing option becomes an **inferred** text field in
   the palette.
4. `\{{name}}` emits a literal `{{name}}`.

Values are rendered left to right: the substituted base first, then flag
segments ordered by `#cmOrder` (ties broken by title).

## Design notes

- `src/render.js` and `src/model.js` are pure and unit tested. `src/ui.js` is
  plain DOM — no JSX compile step, no Preact coupling.
- `src/backend.js` exposes a single serialisable backend entry point
  (`beRun(params)`) because `api.runOnBackend` sends the function source, and
  inner helpers travel with it while outer helpers would not.
- The frontend note MIME is `application/javascript;env=frontend`.
- `dist/` is committed because it is the artifact users import.

## Development

```bash
npm run build     # src/ → dist/command-maker.js + dist/install.js
npm test          # unit tests for model, renderer and build
npm run check     # both
```

No dependencies, no network access, Node 20+.

## Limitations

- A command note must be a code note (`text/x-sh`) for its content to be used as
  the base string; text notes return HTML, so use `#cmBase` there.
- Shell quoting targets POSIX shells. For PowerShell, set `#cmQuote=none` and
  quote inside the base string.
- Inserting into the editor relies on `api.addTextToActiveContextEditor`. If a
  Trilium build does not expose it, the action reports the problem instead of
  silently copying.
- Enum values live in `#cmValues`; adding them from the palette is not
  implemented — edit the option note.
- The palette indexes commands on open; large subtrees make the first open
  slower.