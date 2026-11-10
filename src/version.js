'use strict';

/**
 * Single source of truth for the installed plugin version and where to look for
 * a newer one. `tools/build.mjs` fails the build when VERSION and package.json
 * disagree.
 */
const VERSION = '1.2';
const REPOSITORY = 'https://github.com/J0nan/Trilium-Command-Maker-Plugin';
const LATEST_RELEASE_API = 'https://api.github.com/repos/J0nan/Trilium-Command-Maker-Plugin/releases/latest';
const LATEST_TAGS_API = 'https://api.github.com/repos/J0nan/Trilium-Command-Maker-Plugin/tags?per_page=50';
const LATEST_RAW = 'https://raw.githubusercontent.com/J0nan/Trilium-Command-Maker-Plugin/main/package.json';
const RAW_PREFIX = 'https://raw.githubusercontent.com/J0nan/Trilium-Command-Maker-Plugin';
const BUNDLE_MAIN = RAW_PREFIX + '/main/dist/command-maker.js';

/**
 * Where the built runtime for one version tag lives. The release workflow
 * commits `dist/` with every tag, so a raw URL serves exactly the bytes a
 * release shipped without depending on an asset redirect.
 */
function bundleUrl(version) {
    const tag = String(version == null ? '' : version).replace(/^v/i, '').trim();
    return tag === '' ? BUNDLE_MAIN : RAW_PREFIX + '/v' + tag + '/dist/command-maker.js';
}

module.exports = {
    VERSION,
    REPOSITORY,
    LATEST_RELEASE_API,
    LATEST_TAGS_API,
    LATEST_RAW,
    BUNDLE_MAIN,
    bundleUrl
};