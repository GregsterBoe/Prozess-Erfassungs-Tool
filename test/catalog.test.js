'use strict';
// software-landkarte.r.katalog-pflege, software-landkarte.r.prozess-baukasten,
// software-landkarte.d.katalog, software-landkarte.d.prozessbildung
const test = require('node:test');
const assert = require('node:assert/strict');
const { SL, data, fs, path, ROOT } = require('./helpers.js');

const core = data.prozesse;
const mod = (id) => SL.clone(data.module.find((m) => m.id === id));

test('catalog and process core are separate data files, not code', () => {
  for (const f of ['catalog/software.json', 'catalog/prozesse.json']) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')), f);
  }
  const modules = fs.readdirSync(path.join(ROOT, 'modules')).filter((f) => f.endsWith('.json'));
  assert.ok(modules.length >= 2);
});

test('the shipped catalog, core and every module are valid', () => {
  assert.deepEqual(SL.validateCore(core), []);
  assert.deepEqual(SL.validateModules(core, data.module), []);
  assert.deepEqual(SL.validateCatalog(data.katalog, core, data.module), []);
});

test('every module file on its own: required fields, unique ids, valid insertion points', () => {
  const dir = path.join(ROOT, 'modules');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(`${m.id}.json`, f, 'file name matches the module id');
    assert.deepEqual(SL.validateModule(m, core), [], f);
  }
});

test('the core has the four standard processes, each with ordered steps', () => {
  const names = Object.fromEntries(core.prozesse.map((p) => [p.name, p]));
  for (const n of ['Einkauf bis Zahlung', 'Auftrag bis Zahlungseingang', 'Personal und Lohn', 'Buchhaltung und Abschluss']) {
    assert.ok(names[n], n);
    assert.ok(names[n].schritte.length >= 3, `${n} has steps`);
  }
  const o2c = core.prozesse.find((p) => p.id === 'o2c').schritte.map((s) => s.id);
  assert.ok(o2c.indexOf('auftrag') < o2c.indexOf('rechnung'));
  assert.ok(o2c.indexOf('rechnung') < o2c.indexOf('zahlungseingang'));
});

test('at least two example modules ship: Handwerk and Handel', () => {
  const hw = data.module.find((m) => m.id === 'handwerk');
  const ha = data.module.find((m) => m.id === 'handel');
  assert.ok(hw && ha);
  assert.ok(hw.prozesse.some((p) => /Termin/.test(p.name)), 'Handwerk brings scheduling');
  assert.ok(hw.einhaengen.some((i) => i.schritte.some((s) => /Material/.test(s.name))), 'Handwerk hooks in material');
  assert.ok(ha.prozesse.some((p) => /Lager/.test(p.name) && p.schritte.some((s) => /Inventur/.test(s.name))), 'Handel brings stock and inventory');
});

test('a module brings processes, inserts steps at named points and suggests objects and software', () => {
  const fw = SL.resolveFramework(core, data.module, ['handwerk']);
  assert.ok(fw.prozess('einsatz'), 'own process');
  const o2c = fw.prozess('o2c').schritte.map((s) => s.id);
  assert.equal(o2c[o2c.indexOf('auftrag') + 1], 'material', 'inserted after the named step');
  const cat = SL.mergedCatalog(data.katalog, data.module, ['handwerk']);
  assert.ok(cat.datenobjekte.some((o) => o.id === 'einsatzplan'));
  assert.ok(cat.software.some((s) => s.id === 'hero'));
  const without = SL.mergedCatalog(data.katalog, data.module, []);
  assert.ok(!without.software.some((s) => s.id === 'hero'), 'module software only when chosen');
});

test('the office chooses one or more modules; only their processes and steps show', () => {
  const none = SL.resolveFramework(core, data.module, []);
  assert.deepEqual(none.prozesse.map((p) => p.id), ['p2p', 'o2c', 'h2r', 'r2r']);
  assert.ok(!none.hasStep('o2c', 'material'));
  const both = SL.resolveFramework(core, data.module, ['handwerk', 'handel']);
  assert.ok(both.prozess('einsatz') && both.prozess('lager'));
  const o2c = both.prozess('o2c').schritte.map((s) => s.id);
  assert.deepEqual(o2c.slice(o2c.indexOf('auftrag'), o2c.indexOf('auftrag') + 3), ['auftrag', 'material', 'kommissionieren'], 'both insertions, in module order');
  assert.ok(!SL.resolveFramework(core, data.module, ['handel']).prozess('einsatz'));
});

test('a module can hide core steps; with several modules a step hides only if all hide it', () => {
  const shop = SL.resolveFramework(core, data.module, ['ladengeschaeft']);
  assert.ok(!shop.hasStep('o2c', 'angebot'));
  assert.ok(!shop.hasStep('o2c', 'mahnung'));
  const mixed = SL.resolveFramework(core, data.module, ['handwerk', 'ladengeschaeft']);
  assert.ok(mixed.hasStep('o2c', 'angebot'), 'Handwerk mit Ladengeschäft keeps the offer step');
});

test('a module cannot rename or delete core steps', () => {
  const rename = { ...mod('handwerk'), umbenennen: [{ prozess: 'o2c', schritt: 'auftrag', name: 'Job' }] };
  assert.match(SL.validateModule(rename, core).join('\n'), /unbekanntes Feld „umbenennen“/);
  const del = { ...mod('handwerk'), loeschen: [{ prozess: 'o2c', schritt: 'auftrag' }] };
  assert.match(SL.validateModule(del, core).join('\n'), /unbekanntes Feld „loeschen“/);
  const shadow = mod('handwerk');
  shadow.einhaengen[0].schritte = [{ id: 'rechnung', name: 'Eigene Rechnung' }];
  assert.match(SL.validateModule(shadow, core).join('\n'), /doppelt/, 'reusing a core step id would rename it');
  const ownCore = mod('handel');
  ownCore.prozesse[0].id = 'o2c';
  assert.match(SL.validateModule(ownCore, core).join('\n'), /doppelt/, 'a module process cannot replace a core process');
  // Resolution keeps every core step name as it is.
  const fw = SL.resolveFramework(core, data.module, data.module.map((m) => m.id));
  for (const p of core.prozesse) for (const s of p.schritte) {
    const r = fw.prozess(p.id).schritte.find((x) => x.id === s.id);
    if (r) assert.equal(r.name, s.name);
  }
});

test('the module check finds missing fields, duplicate ids and invalid insertion points', () => {
  assert.match(SL.validateModule({ name: 'x' }, core).join('\n'), /id fehlt/);
  assert.match(SL.validateModule({ id: 'x' }, core).join('\n'), /name fehlt/);
  const badPoint = { id: 'x', name: 'X', einhaengen: [{ prozess: 'o2c', nach: 'gibtsnicht', schritte: [{ id: 'a', name: 'A' }] }] };
  assert.match(SL.validateModule(badPoint, core).join('\n'), /Einhängepunkt „o2c:gibtsnicht“/);
  const badProc = { id: 'x', name: 'X', einhaengen: [{ prozess: 'nix', nach: 'a', schritte: [{ id: 'a', name: 'A' }] }] };
  assert.match(SL.validateModule(badProc, core).join('\n'), /unbekanntem Kernprozess/);
  const badHide = { id: 'x', name: 'X', ausblenden: [{ prozess: 'o2c', schritt: 'nix' }] };
  assert.match(SL.validateModule(badHide, core).join('\n'), /auszublendender Kernschritt/);
  const dupSteps = { id: 'x', name: 'X', prozesse: [{ id: 'neu', name: 'Neu', schritte: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }] };
  assert.match(SL.validateModule(dupSteps, core).join('\n'), /Schritt-id „a“ doppelt/);
  const twice = SL.validateModules(core, [mod('handwerk'), mod('handwerk')]).join('\n');
  assert.match(twice, /Modul-id „handwerk“ doppelt/);
  assert.match(twice, /mehreren Modulen eingehängt/);
});

test('a new module comes in without a code change: drop a JSON file into modules/', () => {
  const extra = {
    id: 'gastro', name: 'Gastronomie',
    prozesse: [{ id: 'kueche', name: 'Küche und Wareneinsatz', schritte: [{ id: 'rezept', name: 'Rezepturen pflegen' }, { id: 'einsatz', name: 'Wareneinsatz erfassen' }] }],
    einhaengen: [{ prozess: 'r2r', nach: 'kasse', schritte: [{ id: 'trinkgeld', name: 'Trinkgeld verteilen' }] }],
  };
  const file = path.join(ROOT, 'modules', 'gastro.json');
  fs.writeFileSync(file, JSON.stringify(extra));
  try {
    const { loadData, validate, build } = require('../scripts/build.js');
    const d = loadData();
    assert.ok(d.module.some((m) => m.id === 'gastro'));
    assert.deepEqual(validate(d), []);
    assert.match(build(), /Küche und Wareneinsatz/);
    const fw = SL.resolveFramework(d.prozesse, d.module, ['gastro']);
    assert.ok(fw.prozess('kueche'));
    assert.ok(fw.hasStep('r2r', 'trinkgeld'));
  } finally {
    fs.unlinkSync(file);
  }
});

test('catalog tasks can point to process steps; every pointer resolves', () => {
  const all = [...data.katalog.software, ...data.module.flatMap((m) => m.software || [])];
  const withStep = all.flatMap((s) => s.aufgaben).filter((t) => t.schritt);
  assert.ok(withStep.length > 20);
  const bad = { ...SL.clone(data.katalog) };
  bad.software[0].aufgaben[0].schritt = 'o2c:gibtsnicht';
  assert.match(SL.validateCatalog(bad, core, data.module).join('\n'), /unbekannter Prozessschritt/);
});

test('the catalog check finds missing fields and duplicates', () => {
  const c = SL.clone(data.katalog);
  delete c.software[0].zweck;
  c.software.push(SL.clone(c.software[1]));
  c.datenobjekte.push({ id: 'kunden', name: 'Kunden', art: 'stamm' });
  c.software[2].aufgaben[0].liest = ['gibtsnicht'];
  c.software[3].aufgaben[0].rolle = 'Frau Beispiel';
  const errors = SL.validateCatalog(c, core, data.module).join('\n');
  assert.match(errors, /zweck fehlt/);
  assert.match(errors, /Software-id „datev-lohn“ doppelt/);
  assert.match(errors, /Software „DATEV Lohn und Gehalt“ doppelt/);
  assert.match(errors, /Datenobjekt-id „kunden“ doppelt/);
  assert.match(errors, /unbekanntes Datenobjekt „gibtsnicht“/);
  assert.match(errors, /Rolle „Frau Beispiel“ steht nicht in rollen/);
});

test('a new system with tasks and objects is added in the catalog file alone', () => {
  const c = SL.clone(data.katalog);
  c.datenobjekte.push({ id: 'fahrzeuge', name: 'Fahrzeuge', art: 'stamm' });
  c.software.push({
    id: 'fuhrpark', name: 'Fuhrparkverwaltung', kategorie: 'Fuhrpark', art: 'cloud', zweck: 'Fahrzeuge und Fahrtenbücher',
    aufgaben: [{ id: 'fahrten', name: 'Fahrtenbuch führen', rolle: 'Monteure', haeufigkeit: 'taeglich', liest: [], schreibt: ['fahrzeuge'] }],
  });
  assert.deepEqual(SL.validateCatalog(c, core, data.module), []);
  const s = SL.emptyState();
  const sys = SL.addSystemFromCatalog(s, SL.mergedCatalog(c, data.module, []), 'fuhrpark', SL.resolveFramework(core, data.module, []));
  assert.equal(s.tasks.filter((t) => t.systemId === sys.id).length, 1);
  assert.ok(SL.objById(s, 'fahrzeuge'));
});

test('the catalog holds product names and typical tasks only, no client details', () => {
  const allowed = new Set(['rollen', 'datenobjekte', 'software']);
  assert.deepEqual(Object.keys(data.katalog).filter((k) => !allowed.has(k)), []);
  const c = SL.clone(data.katalog);
  c.software[0].zweck = 'Ansprechpartner: buchhaltung@beispiel-gmbh.de';
  assert.match(SL.validateCatalog(c, core, data.module).join('\n'), /Kontaktdaten/);
  const c2 = SL.clone(data.katalog);
  c2.software[0].mandant = 'Müller GmbH';
  assert.match(SL.validateCatalog(c2, core, data.module).join('\n'), /unbekanntes Feld „mandant“/);
});
