'use strict';
const fs = require('fs');
const path = require('path');
const SL = require('../src/core.js');
const { loadData } = require('../scripts/build.js');

const ROOT = path.join(__dirname, '..');
const data = loadData();

/** A fresh copy of the invented example business. */
const example = () => SL.normalize(SL.clone(data.beispiel));
const fwFor = (state) => SL.resolveFramework(data.prozesse, data.module, state.meta.module);
const catFor = (state) => SL.mergedCatalog(data.katalog, data.module, state.meta.module);

module.exports = { SL, data, example, fwFor, catFor, ROOT, fs, path };
