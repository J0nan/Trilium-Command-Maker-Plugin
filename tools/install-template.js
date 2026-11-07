// ---------------------------------------------------------------------------
// Command Maker - installer (Trilium backend script).
//
// 1. In Trilium create a note, set its type to Code and its language to
//    "JavaScript (Trilium backend)".
// 2. Paste this whole file into the note.
// 3. Press the Execute button (or right-click the note -> Execute script).
// 4. Press Ctrl+Shift+Space.
//
// The installer is idempotent: running it again updates the plugin note and
// keeps the shortcut you configured (see resolveShortcut below).
// ---------------------------------------------------------------------------

var BUNDLE = __BUNDLE__;

var ROOT_LABEL = 'cmRoot';
var TOOLS_LABEL = 'cmTools';
var PLUGIN_LABEL = 'cmPlugin';
var LAUNCHER_ID = 'commandmaker';
var SHORTCUT_LABEL = 'cmShortcut';
var DEFAULT_SHORTCUT = 'ctrl+shift+space';
var FRONTEND_MIME = 'application/javascript;env=frontend';

function findChild(parent, label) {
    var children = parent.getChildNotes();
    for (var index = 0; index < children.length; index += 1) {
        var child = children[index];
        var found = false;
        if (typeof child.hasLabel === 'function') {
            found = child.hasLabel(label);
        } else {
            var value = child.getLabelValue(label);
            found = value !== null && value !== undefined;
        }
        if (found) {
            return child;
        }
    }
    return null;
}

function resolveShortcut(rootNote) {
    // 1. explicit override on the Command Maker root note.
    //    An empty value means "no shortcut" (the launcher button still works).
    var configured = rootNote.getLabelValue(SHORTCUT_LABEL);
    if (configured !== null && configured !== undefined) {
        return String(configured);
    }

    // 2. whatever the user set on the launcher itself (Configure launchbar).
    try {
        var launcher = api.getNote('al_' + LAUNCHER_ID);
        if (launcher) {
            var current = launcher.getLabelValue('keyboardShortcut');
            if (current !== null && current !== undefined && String(current).trim() !== '') {
                return String(current);
            }
        }
    } catch (error) {
        // best effort: a missing launcher falls through to the default
    }

    // 3. default for a fresh install.
    return DEFAULT_SHORTCUT;
}

var root = api.getNoteWithLabel(ROOT_LABEL);
if (!root) {
    var parentId = null;
    try {
        parentId = api.currentNote.getParentNotes()[0].noteId;
    } catch (error) {
        parentId = null;
    }
    if (!parentId) {
        parentId = api.getTodayNote().noteId;
    }
    root = api.createNewNote({
        parentNoteId: parentId,
        title: 'Command Maker',
        type: 'text',
        content: 'Command Maker settings. The plugin finds this note through its label.'
    }).note;
    root.setLabel(ROOT_LABEL, '');
}

// The Tools folder is the data root. It can be dragged anywhere in the tree;
// the label is what the plugin follows. Categories and tools live inside it.
var toolsRoot = api.getNoteWithLabel(TOOLS_LABEL);
if (!toolsRoot) {
    toolsRoot = api.createNewNote({
        parentNoteId: root.noteId,
        title: 'Tools',
        type: 'text',
        content: 'Tool notes live here, grouped by category. Move this folder anywhere you like; the plugin follows its label.'
    }).note;
    toolsRoot.setLabel(TOOLS_LABEL, '');
}

var shortcut = resolveShortcut(root);

var scriptNote = findChild(root, PLUGIN_LABEL);
if (scriptNote) {
    scriptNote.setContent(BUNDLE);
} else {
    scriptNote = api.createNewNote({
        parentNoteId: root.noteId,
        title: 'Command Maker.js',
        type: 'code',
        mime: FRONTEND_MIME,
        content: BUNDLE
    }).note;
    scriptNote.setLabel(PLUGIN_LABEL, '');
}

api.createOrUpdateLauncher({
    id: LAUNCHER_ID,
    type: 'script',
    scriptNoteId: scriptNote.noteId,
    targetNoteId: root.noteId,
    title: 'Command Maker',
    icon: 'bx-terminal',
    keyboardShortcut: shortcut,
    isVisible: true
});

api.log('Command Maker installed. Shortcut: ' + (shortcut ? shortcut : 'none') + '.');