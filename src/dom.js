'use strict';

const I18n = require('./i18n');

/**
 * Small DOM helpers shared by the palette. Nothing here knows about Trilium:
 * the palette receives its data through the controller (see runtime.js), which
 * keeps this module testable with a plain DOM.
 */

/** Create an element with an optional class name and text. */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined && text !== null) {
        node.textContent = String(text);
    }
    return node;
}

/** Inject one stylesheet per document, no matter how often the palette opens. */
function ensureStyle(id, css) {
    if (document.getElementById(id)) {
        return;
    }
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
}

/** Drop a view mounted by an earlier render of the same tab note. */
function clearEmbeddedView(container, viewClass) {
    let stale = null;
    if (typeof container.querySelector === 'function') {
        stale = container.querySelector('.' + viewClass);
    } else if (container.children) {
        for (let index = 0; index < container.children.length; index += 1) {
            const child = container.children[index];
            if (child && String(child.className || '').split(/\s+/).indexOf(viewClass) !== -1) {
                stale = child;
                break;
            }
        }
    }
    if (!stale) {
        return;
    }
    if (typeof stale.remove === 'function') {
        stale.remove();
    } else if (stale.parentNode && typeof stale.parentNode.removeChild === 'function') {
        stale.parentNode.removeChild(stale);
    }
}

/**
 * Read the code-block colours of the active Trilium theme so the command
 * preview looks like every other code block. Null when the theme cannot be read.
 */
function codeBlockTheme() {
    let resolveStyle = null;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        resolveStyle = function (node) {
            return window.getComputedStyle(node);
        };
    } else if (typeof getComputedStyle === 'function') {
        resolveStyle = function (node) {
            return getComputedStyle(node);
        };
    }
    if (!resolveStyle || typeof document === 'undefined' || !document.body) {
        return null;
    }

    let probe = null;
    try {
        probe = document.createElement('code');
        probe.className = 'hljs';
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        document.body.appendChild(probe);
        const computed = resolveStyle(probe);
        const background = computed ? String(computed.backgroundColor || '') : '';
        const color = computed ? String(computed.color || '') : '';
        if (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)') {
            return null;
        }
        return { background: background, color: color };
    } catch (ignored) {
        return null;
    } finally {
        if (probe && typeof probe.remove === 'function') {
            probe.remove();
        }
    }
}

/** Copy text, using the clipboard API and falling back to the legacy command. */
async function copyText(text) {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (error) {
        // fall through to the execCommand fallback
    }
    const area = document.createElement('textarea');
    try {
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        return Boolean(document.execCommand('copy'));
    } catch (error) {
        return false;
    } finally {
        if (area.parentNode && typeof area.parentNode.removeChild === 'function') {
            area.parentNode.removeChild(area);
        } else if (typeof area.remove === 'function') {
            area.remove();
        }
    }
}

/** Save text as a local file. Throws when the runtime has no Blob/URL support. */
function downloadText(filename, value, mime) {
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        throw new Error(I18n.t('error.downloadUnsupported'));
    }
    const blob = new Blob([value], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
        URL.revokeObjectURL(url);
    }, 0);
}

/** Read a File chosen by the user, preferring the modern File.text(). */
function readFileText(file) {
    if (file && typeof file.text === 'function') {
        return Promise.resolve(file.text());
    }
    return new Promise(function (resolve, reject) {
        if (typeof FileReader === 'undefined') {
            reject(new Error(I18n.t('error.filesUnsupported')));
            return;
        }
        const reader = new FileReader();
        reader.onload = function () {
            resolve(String(reader.result || ''));
        };
        reader.onerror = function () {
            reject(new Error(I18n.t('error.fileRead')));
        };
        reader.readAsText(file);
    });
}

module.exports = {
    el,
    ensureStyle,
    clearEmbeddedView,
    codeBlockTheme,
    copyText,
    downloadText,
    readFileText
};