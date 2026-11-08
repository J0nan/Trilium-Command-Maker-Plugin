/**
 * Test bootstrap, loaded through `node --test --import`.
 *
 * Node exposes `navigator.language` from the host OS. The plugin follows that
 * language on a fresh install, so a Spanish machine would translate the whole
 * suite and every English assertion would fail. Pin English here; the locale
 * tests switch languages explicitly.
 */

import I18n from '../src/i18n.js';

Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'en-US', languages: ['en-US'] },
    configurable: true,
    writable: true
});

I18n.setLocale('en');