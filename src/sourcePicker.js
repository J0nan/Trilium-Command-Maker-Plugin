'use strict';

/**
 * The "where does the input come from" panel shared by both import dialogs:
 * pasted text, the active note, or a local file. It only collects text; the
 * caller decides how to parse and store it.
 */

const Dom = require('./dom');

const SOURCES = [
    { id: 'paste', label: 'Paste text' },
    { id: 'note', label: 'Active note' },
    { id: 'file', label: 'File' }
];

/**
 * @param {object} config
 * @param {object} config.controller palette controller (activeNoteText)
 * @param {string} [config.hint] helper line above the tabs
 * @param {string} [config.placeholder] textarea placeholder
 * @param {string} [config.accept] file input accept list
 * @param {function(string, boolean)} [config.onStatus] status reporter
 * @param {function(Error)} [config.onError] error reporter
 * @returns {{ node: Element, getText: function(): string }}
 */
function createSourcePicker(config) {
    const settings = config || {};
    const controller = settings.controller || {};
    const onStatus = typeof settings.onStatus === 'function' ? settings.onStatus : function () {};
    const onError = typeof settings.onError === 'function' ? settings.onError : function () {};

    const node = Dom.el('div', '');
    const tabs = Dom.el('div', 'cm-tabs');
    const tabNodes = {};
    for (const source of SOURCES) {
        const tab = Dom.el('button', 'cm-tab' + (source.id === 'paste' ? ' is-active' : ''), source.label);
        tab.type = 'button';
        tabNodes[source.id] = tab;
        tabs.appendChild(tab);
    }

    const hint = Dom.el('div', 'cm-note', settings.hint || '');

    const textArea = document.createElement('textarea');
    textArea.className = 'cm-control cm-preview';
    textArea.rows = 12;
    textArea.placeholder = settings.placeholder || '';

    const notePreview = Dom.el('div', 'cm-note', '');
    const readNoteButton = Dom.el('button', 'cm-button', 'Read active note');
    readNoteButton.type = 'button';
    readNoteButton.style.display = 'none';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.className = 'cm-control';
    fileInput.accept = settings.accept || '.txt,.json,.md,.markdown,.log,.help,.text';
    fileInput.style.display = 'none';

    let source = 'paste';
    let sourceText = '';

    function setSource(next) {
        source = next;
        for (const entry of SOURCES) {
            tabNodes[entry.id].classList.toggle('is-active', entry.id === next);
        }
        textArea.style.display = next === 'paste' ? '' : 'none';
        readNoteButton.style.display = next === 'note' ? '' : 'none';
        notePreview.style.display = next === 'note' && notePreview.textContent ? '' : 'none';
        fileInput.style.display = next === 'file' ? '' : 'none';
    }

    function showRead(label, text) {
        sourceText = text;
        notePreview.textContent = 'Read "' + label + '" (' + text.length + ' characters).';
        notePreview.style.display = '';
    }

    for (const entry of SOURCES) {
        tabNodes[entry.id].addEventListener('click', function () {
            setSource(entry.id);
        });
    }

    readNoteButton.addEventListener('click', async function () {
        try {
            const note = await controller.activeNoteText();
            showRead(note.title, note.text);
            onStatus('Note read.');
        } catch (error) {
            onError(error);
        }
    });

    fileInput.addEventListener('change', async function () {
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
            return;
        }
        try {
            showRead(file.name || 'file', await Dom.readFileText(file));
            onStatus('File read.');
        } catch (error) {
            onError(error);
        }
    });

    function getText() {
        return source === 'paste' ? textArea.value : sourceText;
    }

    node.appendChild(tabs);
    node.appendChild(hint);
    node.appendChild(textArea);
    node.appendChild(readNoteButton);
    node.appendChild(notePreview);
    node.appendChild(fileInput);
    setSource('paste');

    return { node: node, getText: getText };
}

module.exports = { createSourcePicker };