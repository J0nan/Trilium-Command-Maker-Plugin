// ---------------------------------------------------------------------------
// Command Maker - installer (Trilium backend script).
//
// 1. In Trilium create a note, set its type to Code and its language to
//    "JavaScript (Trilium backend)".
// 2. Paste this whole file into the note.
// 3. Press the Execute button (or right-click the note -> Execute script).
// 4. Press Ctrl+Shift+K.
//
// The installer is idempotent: running it again updates the plugin note.
// ---------------------------------------------------------------------------

var BUNDLE = __BUNDLE__;

var ROOT_LABEL = 'cmRoot';
var PLUGIN_LABEL = 'cmPlugin';
var LAUNCHER_ID = 'commandmaker';
var SHORTCUT = 'ctrl+shift+k';
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
        content: 'Press Ctrl+Shift+K to open the command palette.'
    }).note;
    root.setLabel(ROOT_LABEL, '');
}

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
    keyboardShortcut: SHORTCUT,
    isVisible: true
});

api.log('Command Maker installed. Press ' + SHORTCUT + ' to open the palette.');