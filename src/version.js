'use strict';

/**
 * Single source of truth for the installed plugin version and where to look for
 * a newer one. `tools/build.mjs` fails the build when VERSION and package.json
 * disagree.
 */
const VERSION = '1.0.0';
const REPOSITORY = 'https://github.com/J0nan/Trilium-Command-Maker-Plugin';
const LATEST_TAG_API = REPOSITORY + '/api/v1/repos/J0nan/Trilium-command-maker/tags?limit=50';
const LATEST_RAW = REPOSITORY + '/raw/branch/main/package.json';

module.exports = {
    VERSION,
    REPOSITORY,
    LATEST_TAG_API,
    LATEST_RAW
};