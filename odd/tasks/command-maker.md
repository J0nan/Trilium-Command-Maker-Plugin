# Command Maker — Trilium plugin

Branch: `feat/command-maker` · Delivery: work-unit commits on the feature branch · Tests: `node --test test/`
Platform: TriliumNext ≥ 0.101 (frontend scripts, templates, launcher API).

## Specs

### S1 — Commands are template instances
Command notes are created from a template the plugin owns. The template carries `#template`, `#cmTemplate` and `#cmCommand`; instances inherit `#cmCommand` and get a `~template` relation. Both the template and every command are **code notes** (`text/x-sh`) so `note.getContent()` returns the raw base string instead of HTML. Discovery is `#cmCommand` minus the template note id (the template also matches because attributes are inherited). Exact user wording: "notes made with a templeate by this new pluging".

### S2 — Search
The palette has "a search function for looking for notes made with a templeate by this new pluging". The query filters on title, description, tags, the base command (note content, or `#cmBase` when present) and option names; every whitespace-separated term must match. Keyboard: `ArrowDown` / `ArrowUp` / `Enter` / `Escape`.

### S3 — Options form
Selecting a command shows "all the options available". Options are child notes of an `Options` folder inside the command note. Controls by type:
- `boolean` → checkbox
- `enum` → select built from `#cmValues`
- `number` → numeric input
- `string` / `path` → text input
Required options are marked with `*`. Placeholders present in the base string without a backing option are shown as **inferred** fields.

### S4 — Editable code block
Selected values are "added to a code block where the user can then modify". The preview is an editable `<textarea>`; once the user edits it the generator stops overwriting it and a "Regenerate" action restores the generated text.

### S5 — Presets
"save as a preset" stores the current value map as a child note of the command's `Presets` folder with content `{ "v": 1, "values": { … } }` and label `#cmPreset`. Loading a preset restores values; presets can be deleted.

### S6 — Copy
"or copy" copies the current preview text with `navigator.clipboard.writeText`, falling back to a hidden textarea + `document.execCommand('copy')`.

### S7 — Hybrid option model (user decision)
Options emit flags (`--flag value`, `--flag=value`, bare boolean flag) **and** the base string supports `{{placeholder}}` substitution. Rules:
1. One value, one channel: an option is either appended as a flag or substituted inline.
2. A placeholder present in the base string auto-promotes its option to inline. A flag option never gets appended twice.
3. A placeholder with no backing option becomes an inferred text field.
4. Placeholder names are slugs of the option title, overridable with `#cmPlaceholder`.
5. `\{{` escapes a literal placeholder.
6. Inline substitution is verbatim; `#cmQuote` applies to flag segments only. The base string owns its own quoting.

### S8 — Insert into the active note
"Insert" calls `api.addTextToActiveContextEditor(text)`. If the API is unavailable the action fails with a visible message instead of silently copying.

### S9 — Note schema
| Attribute | On | Meaning |
| --- | --- | --- |
| `#cmCommand` | template (inherited) | marks command notes |
| `#cmTemplate` | template | excludes the template from results |
| `#cmDesc`, `#cmTags` | command | palette subtitle and extra search terms |
| `#cmBase` | command | base string; falls back to the note content (code note, raw text) |
| `#cmOptions`, `#cmPresets` | folders | locate option and preset children |
| `#cmFlag` | option | flag text, empty for a positional |
| `#cmMode` | option | `flag` (default) or `inline` |
| `#cmPlaceholder` | option | token name; default slug of the title |
| `#cmType` | option | `string`, `path`, `number`, `boolean`, `enum` |
| `#cmValues` | option | enum values, comma separated |
| `#cmDefault`, `#cmRequired`, `#cmOrder`, `#cmQuote`, `#cmSep` | option | defaults, validation, ordering, shell quoting, `space`/`=` |

### S10 — Install and build
`npm run build` emits two artifacts from `src/`: `dist/command-maker.js` (the frontend script note) and `dist/install.js` (a backend one-shot that creates the plugin note and registers a launcher with `Ctrl+Shift+K`). No network access, no runtime dependencies.

## Tasks

| ID | Task | Specs | Route | Status |
| --- | --- | --- | --- | --- |
| T1 | Repo scaffolding, gitignore, feature doc, README | S10 | inline | done |
| T2 | Pure renderer (`src/render.js`) | S4, S5, S7 | inline | done |
| T3 | Pure model (`src/model.js`) | S1, S3, S7, S9 | inline | done |
| T4 | Backend operations (`src/backend.js`) | S1, S3, S5, S9 | inline | done |
| T5 | Palette UI (`src/ui.js`) | S2, S3, S4, S5, S6, S8 | inline | done |
| T6 | Runtime wiring + entry (`src/runtime.js`, `src/entry.js`) | S1, S2 | inline | done |
| T7 | Build + installer (`tools/`) | S10 | inline | done |
| T8 | Tests (render, model, build) | S4, S7, S10 | inline | done |
| T9 | Fix B1: serialisable backend dispatch | S1, S5, S9 | inline | done |
| T10 | Fix B2: index note content for search | S2 | inline | done |
| T11 | Advisories: compile-cache ignore, dead seed quote | S8, S10 | inline | done |

## Log

### L1 — user request (verbatim)
"I want to make a Trilium plugin (https://github.com/TriliumNext/Trilium) that helps me create commands. It should have a search function for looking for notes made with a templeate by this new pluging. After selecting the command it should show all the optionsavailable (which the user has populated in a specific format define by this plugin beforehand) and while they are selected they are added toa code block where the user can then modify, save as a preset, orcopy. Plan how could it be done and ask me anything you need to."

### L2 — user request (verbatim)
"Initialize the repo, on the gitignore add the codegraph and .alt folder and any other file/folder not necesary for the plugin. Then Go ahead with the implementation"

### L3 — decisions
- Hybrid option model chosen by the user (flags **and** free placeholders). S7 encodes the interplay rules.
- Deviation from the original plan: the runtime ships as **one** frontend note produced by a small bundler instead of a Trilium script bundle. Reason: a single note is atomic to install and update, avoids coupling to bundle globals (`module.exports` exposed as globals named after notes), and keeps the sources unit-testable in plain Node. The repo keeps `src/` modular.
- Frontend note MIME verified as `application/javascript;env=frontend` (not `text/javascript`).
- Installer uses `api.createOrUpdateLauncher({ type: 'script' })`, so no `#widget` label and no DOM injection; the launcher owns the keyboard shortcut.
- Assumption (unverified): `api.addTextToActiveContextEditor` for S8. Failure is surfaced, not hidden.
- Quoting defaults to `none` because the user writes the surrounding shell syntax in the base string. `#cmQuote` opts into quoting per option.

### L4 — self-checks
- `npm run build` emits `dist/command-maker.js` (59 941 B) and `dist/install.js` (64 301 B); both are parsed with `new Function` so a syntax error fails the build.
- `npm test` runs 34 tests: renderer (16), model (11), backend serialisation (2), runtime search (2), build (2) and a palette integration test that executes the real bundle in a `vm` context with a fake DOM and fake `api` (search → select → preview → edit → copy → insert, plus the single-instance guard).
- Observed: `tests 34 / pass 34 / fail 0`.
- Defect found and fixed during implementation: segments were emitted in input order instead of `#cmOrder`; `renderCommand` now sorts defensively (test "segments are ordered by cmOrder then title").
- Design correction during implementation: command notes are code notes (`text/x-sh`) because text notes return HTML from `getContent()`, which would corrupt the base string.

### L5 — independent verification round 1 (blockers found)
Verifier ran a scratch copy at `%TEMP%\opencode\cm-verify-7k2d9`; workspace untouched.
- **B1 (blocker, fixed):** `beRun` switched on the module-scope `ACTIONS` constant, but `api.runOnBackend` ships only the function source, so every backend action threw `ReferenceError: ACTIONS is not defined` in real Trilium. The suite missed it because the palette test mocks `runOnBackend` without serialising. Fix: literal action names inside `beRun`; regression test evaluates `beRun.toString()` in a fresh `vm` context and dispatches every action.
- **B2 (blocker, fixed):** search indexed only `#cmBase`, not the note content, which is where the base string actually lives. `search('ffmpeg')` returned 0 for a command titled `My encode`. Fix: `readBase()` indexes content (or `#cmBase`) during `refresh()`; regression test asserts content-based matching.
- Advisories fixed: `node-compile-cache/` added to `.gitignore`; the seeded inline option no longer carries a dead `#cmQuote`.
- Advisories accepted: inline substitution is verbatim (documented in S7.6 and the README); empty inline values leave dangling context but emit a warning; all Trilium API calls remain unverifiable at runtime.