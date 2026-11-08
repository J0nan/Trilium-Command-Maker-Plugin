'use strict';

/**
 * Single source of truth for the installed plugin version and where to look for
 * a newer one. `tools/build.mjs` fails the build when VERSION and package.json
 * disagree.
 */
const VERSION = '1.0';
const REPOSITORY = 'https://github.com/J0nan/Trilium-Command-Maker-Plugin';
const LATEST_RELEASE_API = 'https://api.github.com/repos/J0nan/Trilium-Command-Maker-Plugin/releases/latest';
const LATEST_TAGS_API = 'https://api.github.com/repos/J0nan/Trilium-Command-Maker-Plugin/tags?per_page=50';
const LATEST_RAW = 'https://raw.githubusercontent.com/J0nan/Trilium-Command-Maker-Plugin/main/package.json';

module.exports = {
    VERSION,
    REPOSITORY,
    LATEST_RELEASE_API,
    LATEST_TAGS_API,
    LATEST_RAW
};