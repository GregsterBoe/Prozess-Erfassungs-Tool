#!/usr/bin/env node
/* Builds dist/software-landkarte.html: one file with the code, the catalog, the process
 * core, every module in modules/ and the example inlined, so it opens by double-click
 * (software-landkarte.r.lokal). A new module is a new JSON file, no code change
 * (software-landkarte.r.prozess-baukasten). The build refuses invalid catalog data. */
'use strict';
const fs = require('fs');
const path = require('path');
const SL = require('../src/core.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

function loadData(opts = {}) {
  const prozesse = json('catalog/prozesse.json');
  const katalog = json('catalog/software.json');
  const module = fs.readdirSync(path.join(ROOT, 'modules')).filter((f) => f.endsWith('.json')).sort()
    .map((f) => json(`modules/${f}`));
  const beispiel = opts.withoutExample ? null : json('examples/beispielbetrieb.json');
  return { prozesse, katalog, module, beispiel };
}

function validate(data) {
  return [
    ...SL.validateCore(data.prozesse),
    ...SL.validateModules(data.prozesse, data.module),
    ...SL.validateCatalog(data.katalog, data.prozesse, data.module),
  ];
}

function build() {
  const data = loadData();
  const errors = validate(data);
  if (errors.length) throw new Error('Katalog oder Module ungültig:\n  ' + errors.join('\n  '));
  const parts = {
    STYLES: read('src/styles.css'),
    DATA: SL.scriptJson(data),
    CORE: read('src/core.js'),
    REPORT: read('src/report.js'),
    APP: read('src/app.js'),
  };
  let html = read('src/index.html');
  for (const [k, v] of Object.entries(parts)) {
    if (/<\/script/i.test(v) && k !== 'DATA') throw new Error(`${k} contains </script>`);
    html = html.split(`@@${k}@@`).join(v);
  }
  return html;
}

module.exports = { build, loadData, validate, OUT: path.join(ROOT, 'dist', 'software-landkarte.html') };

if (require.main === module) {
  const html = build();
  fs.mkdirSync(path.dirname(module.exports.OUT), { recursive: true });
  fs.writeFileSync(module.exports.OUT, html);
  console.log(`dist/software-landkarte.html (${Math.round(html.length / 1024)} KB)`);
}
