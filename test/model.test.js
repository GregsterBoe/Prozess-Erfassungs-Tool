'use strict';
// The data model behind the office mode. Each block names the blueprint item it tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { SL, data, example, fwFor, catFor, fs, path, ROOT } = require('./helpers.js');
const report = require('../src/report.js');

function fresh(module = []) {
  const s = SL.emptyState();
  s.meta.module = module;
  return { s, fw: fwFor(s), cat: catFor(s) };
}

// ---------------------------------------------------------------- software-landkarte.r.systeme

test('systeme: a system has name, kind, purpose and roles; all five kinds exist', () => {
  assert.deepEqual(Object.keys(SL.ARTEN), ['lokal', 'cloud', 'excel', 'papier', 'postfach']);
  const { s } = fresh();
  const x = SL.addSystem(s, { name: 'Preisliste', art: 'excel', zweck: 'Verkaufspreise', rollen: ['Inhaber'] });
  assert.deepEqual([x.name, x.art, x.zweck, x.rollen], ['Preisliste', 'excel', 'Verkaufspreise', ['Inhaber']]);
  assert.throws(() => SL.addSystem(s, { name: '' }), /Namen/);
  assert.throws(() => SL.addSystem(s, { name: 'X', art: 'fax' }), /Art/);
});

test('systeme: chosen from the catalog or created freely', () => {
  const { s, cat, fw } = fresh();
  const a = SL.addSystemFromCatalog(s, cat, 'clockodo', fw);
  const b = SL.addSystem(s, { name: 'Ordner Lieferscheine', art: 'papier' });
  assert.equal(a.catalogId, 'clockodo');
  assert.equal(a.art, 'cloud');
  assert.ok(a.rollen.length > 0, 'roles come from the catalog tasks');
  assert.equal(b.catalogId, null);
});

test('systeme: Excel lists, paper and mailboxes appear on the map like any software', () => {
  const { s } = fresh();
  const ids = ['lokal', 'excel', 'papier', 'postfach'].map((art) => SL.addSystem(s, { name: `S-${art}`, art }).id);
  const o = SL.addObject(s, { name: 'Preise' });
  ids.forEach((id, i) => SL.setCell(s, o.id, id, i === 0 ? 'fuehrt' : 'kopie'));
  const head = SL.matrixCsv(s).split('\r\n')[0];
  for (const art of ['lokal', 'excel', 'papier', 'postfach']) assert.ok(head.includes(`S-${art}`), art);
  const html = report.render(s, fwFor(s));
  for (const art of ['excel', 'papier', 'postfach']) assert.ok(html.includes(`S-${art}`));
});

// ---------------------------------------------------------------- software-landkarte.r.aufgaben

test('aufgaben: a catalog system proposes its typical tasks, each can be switched off and on', () => {
  const { s, cat, fw } = fresh();
  const sys = SL.addSystemFromCatalog(s, cat, 'lexware-office', fw);
  const proposed = SL.catalogTasksFor(cat, sys).map((t) => t.id);
  assert.deepEqual(proposed, ['angebot', 'rechnung', 'belege', 'bank']);
  assert.equal(s.tasks.length, 4);
  SL.toggleCatalogTask(s, cat, sys.id, 'bank', false, fw);
  assert.equal(s.tasks.length, 3);
  assert.ok(!s.tasks.some((t) => t.catalogRef === 'lexware-office/bank'));
  SL.toggleCatalogTask(s, cat, sys.id, 'bank', true, fw);
  SL.toggleCatalogTask(s, cat, sys.id, 'bank', true, fw);
  assert.equal(s.tasks.length, 4, 'switching on twice adds once');
  const partial = SL.addSystemFromCatalog(s, cat, 'sevdesk', fw, ['mahnung']);
  assert.equal(s.tasks.filter((t) => t.systemId === partial.id).length, 1);
});

test('aufgaben: a task has name, system, role, frequency and the objects it reads and writes', () => {
  assert.deepEqual(Object.values(SL.HAEUFIGKEITEN), ['täglich', 'wöchentlich', 'monatlich', 'jährlich', 'bei Bedarf']);
  const { s, cat, fw } = fresh();
  const sys = SL.addSystemFromCatalog(s, cat, 'lexware-office', fw, ['rechnung']);
  const t = s.tasks[0];
  assert.equal(t.name, 'Ausgangsrechnungen schreiben');
  assert.equal(t.systemId, sys.id);
  assert.equal(t.rolle, 'Büro');
  assert.equal(t.haeufigkeit, 'woechentlich');
  assert.deepEqual(t.liest, ['kunden', 'artikel']);
  assert.deepEqual(t.schreibt, ['ausgangsrechnungen']);
  assert.ok(SL.objById(s, 'ausgangsrechnungen'), 'its objects come along');
  assert.throws(() => SL.updateTask(s, t.id, { haeufigkeit: 'stündlich' }));
});

test('aufgaben: own tasks can be created freely', () => {
  const { s, fw } = fresh();
  const sys = SL.addSystem(s, { name: 'Notizbuch', art: 'papier' });
  const t = SL.addTask(s, { name: 'Bestellungen notieren', systemId: sys.id, rolle: 'Lager', haeufigkeit: 'taeglich' }, fw);
  assert.equal(t.catalogRef, null);
  assert.equal(t.prozess, null);
  assert.throws(() => SL.addTask(s, { name: '', systemId: sys.id }, fw));
});

test('aufgaben: a task can be split into steps where needed (two levels)', () => {
  const s = example();
  const fw = fwFor(s);
  const t = s.tasks.find((x) => x.name === 'Arbeitsberichte abtippen');
  assert.ok(SL.needsSteps(s, t), 'a media break suggests splitting');
  const plain = s.tasks.find((x) => x.name === 'Eingangsrechnungen freigeben');
  assert.ok(!SL.needsSteps(s, plain));
  SL.addStep(s, t.id, 'Zettel sortieren');
  const step = SL.addStep(s, t.id, 'Stunden in TopKontor tippen');
  assert.deepEqual(t.schritte.map((x) => x.name), ['Zettel sortieren', 'Stunden in TopKontor tippen']);
  SL.removeStep(s, t.id, step.id);
  assert.equal(t.schritte.length, 1);
  assert.match(SL.aufgabenCsv(s, fw), /Zettel sortieren/);
});

// ---------------------------------------------------------------- software-landkarte.r.datenobjekte

test('datenobjekte: the catalog proposes the common objects; own ones are possible', () => {
  const ids = data.katalog.datenobjekte.map((o) => o.name);
  for (const n of ['Kunden', 'Lieferanten', 'Artikel und Preise', 'Mitarbeiter', 'Aufträge', 'Ausgangsrechnungen', 'Eingangsrechnungen', 'Zahlungen', 'Arbeitszeiten', 'Kasse']) {
    assert.ok(ids.includes(n), n);
  }
  const { s } = fresh();
  const o = SL.addObject(s, { name: 'Wartungsverträge' });
  assert.ok(SL.objById(s, o.id));
});

test('datenobjekte: per object and system exactly one of führt, liest, Kopie, nicht vorhanden', () => {
  assert.deepEqual(Object.values(SL.ZELLEN), ['führt', 'liest', 'Kopie', 'nicht vorhanden']);
  const { s } = fresh();
  const a = SL.addSystem(s, { name: 'A' });
  const o = SL.addObject(s, { name: 'Kunden' });
  SL.setCell(s, o.id, a.id, 'liest');
  SL.setCell(s, o.id, a.id, 'fuehrt');
  assert.equal(SL.cell(s, o.id, a.id), 'fuehrt', 'one value per cell, the last one wins');
  SL.setCell(s, o.id, a.id, '');
  assert.equal(SL.cell(s, o.id, a.id), '');
  assert.throws(() => SL.setCell(s, o.id, a.id, 'vielleicht'));
});

test('datenobjekte: more than one leading system is double maintenance, none is a gap; both in the report', () => {
  const s = example();
  assert.equal(SL.objectStatus(s, 'artikel'), 'doppelt');
  assert.equal(SL.objectStatus(s, 'mitarbeiter'), 'luecke');
  assert.equal(SL.objectStatus(s, 'kunden'), 'ok');
  const b = SL.befunde(s, fwFor(s));
  assert.deepEqual(b.doppelt.map((o) => o.id), ['artikel']);
  assert.ok(b.luecken.some((o) => o.id === 'mitarbeiter'));
  const html = report.render(s, fwFor(s));
  assert.match(html, /<h3>Doppelte Pflege<\/h3>\s*<ul><li>Artikel und Preise: führend in TopKontor Handwerk, Preisliste/);
  assert.match(html, /<h3>Kein führendes System<\/h3>\s*<ul>.*Mitarbeiter/s);
  assert.match(html, /⚠ doppelte Pflege/);
  assert.match(html, /⚠ kein führendes System/);
});

// ---------------------------------------------------------------- software-landkarte.r.datenfluesse

test('datenfluesse: a flow joins two systems for one object, with kind and frequency', () => {
  assert.deepEqual(Object.values(SL.FLUSSARTEN), ['Schnittstelle', 'Datei-Export und -Import', 'manuell abgetippt', 'Papier']);
  const { s } = fresh();
  const a = SL.addSystem(s, { name: 'A' });
  const b = SL.addSystem(s, { name: 'B' });
  const o = SL.addObject(s, { name: 'Kunden' });
  const f = SL.addFlow(s, { objectId: o.id, from: a.id, to: b.id, art: 'datei', haeufigkeit: 'monatlich' });
  assert.deepEqual([f.from, f.to, f.objectId, f.art, f.haeufigkeit], [a.id, b.id, o.id, 'datei', 'monatlich']);
  assert.throws(() => SL.addFlow(s, { objectId: o.id, from: a.id, to: a.id }), /zwei verschiedene/);
  assert.throws(() => SL.addFlow(s, { objectId: o.id, from: a.id, to: b.id, art: 'brieftaube' }));
});

test('datenfluesse: writing an object into a system that does not lead it proposes a flow from the leader', () => {
  const { s, fw } = fresh();
  const wawi = SL.addSystem(s, { name: 'Warenwirtschaft' });
  const kasse = SL.addSystem(s, { name: 'Kasse' });
  const o = SL.addObject(s, { name: 'Artikel' });
  SL.setCell(s, o.id, wawi.id, 'fuehrt');
  SL.setCell(s, o.id, kasse.id, 'kopie');
  SL.addTask(s, { name: 'Preise in der Kasse ändern', systemId: kasse.id, schreibt: [o.id] }, fw);
  SL.addTask(s, { name: 'Preise pflegen', systemId: wawi.id, schreibt: [o.id] }, fw);
  const sugg = SL.suggestFlows(s);
  assert.deepEqual(sugg.map((x) => [x.objectId, x.from, x.to]), [[o.id, wawi.id, kasse.id]]);
  SL.addFlow(s, { objectId: o.id, from: wawi.id, to: kasse.id, art: 'manuell' });
  assert.deepEqual(SL.suggestFlows(s), [], 'gone once the flow exists');
});

test('datenfluesse: manual and paper flows are media breaks and listed in the report', () => {
  const s = example();
  const mb = SL.medienbrueche(s).list;
  assert.equal(mb.length, 4);
  assert.ok(mb.every((f) => f.art === 'manuell' || f.art === 'papier'));
  assert.ok(!s.flows.filter((f) => f.art === 'datei' || f.art === 'schnittstelle').some(SL.isMedienbruch));
  const html = report.render(s, fwFor(s));
  const section = html.split('<h3>Medienbrüche</h3>')[1].split('<h3>')[0];
  assert.equal((section.match(/<tr><td>/g) || []).length, 4, 'one row per media break');
});

// ---------------------------------------------------------------- software-landkarte.r.aufwand

test('aufwand: minutes per month per media break; the report sorts by effort and shows the sum', () => {
  const s = example();
  const { list, summe } = SL.medienbrueche(s);
  assert.deepEqual(list.map((f) => f.aufwand), [240, 90, 60, 45]);
  assert.equal(summe, 435);
  const html = report.render(s, fwFor(s));
  const section = html.split('<h3>Medienbrüche</h3>')[1].split('<h3>')[0];
  const numbers = [...section.matchAll(/<td class="num">(\d+)<\/td>/g)].map((m) => Number(m[1]));
  assert.deepEqual(numbers, [240, 90, 60, 45]);
  assert.match(section, /Summe<\/th><th class="num">435/);
});

// ---------------------------------------------------------------- software-landkarte.r.prozesse

test('prozesse: every task can be assigned to a process and ordered in it', () => {
  const s = example();
  const fw = fwFor(s);
  const seq = () => SL.sequence(s, fw, 'o2c').map((t) => t.name);
  const before = seq();
  assert.ok(before.indexOf('Angebote schreiben') < before.indexOf('Ausgangsrechnungen schreiben'), 'step order first');
  const id = s.tasks.find((t) => t.name === 'Kunden anlegen und pflegen').id;
  const at = before.indexOf('Kunden anlegen und pflegen');
  SL.moveInSequence(s, fw, 'o2c', id, -1);
  SL.moveInSequence(s, fw, 'o2c', id, -1);
  assert.equal(seq().indexOf('Kunden anlegen und pflegen'), at - 2);
  assert.equal(seq().length, before.length);
  SL.moveInSequence(s, fw, 'o2c', seq()[0] && s.tasks.find((t) => t.name === seq()[0]).id, -1);
  assert.equal(seq().length, before.length, 'moving the first task up does nothing');
  const free = SL.addTask(s, { name: 'Lieferschein drucken', systemId: s.systems[0].id }, fw);
  SL.assignTask(s, free.id, 'o2c', 'leistung');
  assert.ok(seq().includes('Lieferschein drucken'), 'new task joins at its step');
  assert.ok(seq().indexOf('Lieferschein drucken') > seq().indexOf('Material zum Auftrag buchen'));
});

test('prozesse: per process a swimlane shows which task runs in which system in which order, media breaks marked', () => {
  const s = example();
  const fw = fwFor(s);
  const sl = SL.swimlane(s, fw, 'einsatz');
  assert.deepEqual(sl.lanes.map((l) => l.name), ['TopKontor Handwerk', 'Arbeitsberichte auf Papier']);
  const items = sl.columns.flatMap((c) => c.items);
  const typed = items.find((i) => i.task.name === 'Arbeitsberichte abtippen');
  assert.equal(typed.breaks.length, 1, 'typing from paper is a media break');
  const html = report.swimlane(s, fw, 'einsatz');
  assert.match(html, /class="box mb">Arbeitsberichte abtippen/);
  assert.match(html, /⚠ Arbeitsberichte: manuell abgetippt aus Arbeitsberichte auf Papier/);
  assert.match(html, /<td class="lane">TopKontor Handwerk<\/td>/);
});

test('prozesse: tasks without a process are visible as such', () => {
  const s = example();
  const fw = fwFor(s);
  const t = SL.addTask(s, { name: 'Fahrzeuge betanken', systemId: s.systems[0].id }, fw);
  assert.ok(SL.unassigned(s, fw).some((x) => x.id === t.id));
  assert.match(report.render(s, fw), /<h3>Ohne Prozess<\/h3>\s*<ul><li>Fahrzeuge betanken/);
  assert.match(SL.aufgabenCsv(s, fw), /Fahrzeuge betanken;[^\r\n]*;ohne Prozess;/);
  // Deselecting a module drops its process: its tasks become unassigned, not lost.
  s.meta.module = ['ladengeschaeft'];
  const fw2 = fwFor(s);
  assert.ok(SL.unassigned(s, fw2).some((x) => x.name === 'Monteure einplanen' || x.name === 'Stunden und Material auf dem Zettel notieren'));
});

test('prozess-baukasten: the tool proposes the process from the catalog step pointer', () => {
  const { s, cat, fw } = fresh(['handwerk']);
  SL.addSystemFromCatalog(s, cat, 'hero', fw);
  const t = s.tasks.find((x) => x.name === 'Monteure einplanen');
  assert.deepEqual([t.prozess, t.schritt], ['einsatz', 'planen']);
  // Without the module the step does not exist, so nothing is proposed.
  const plain = fresh([]);
  const sys = SL.addSystem(plain.s, { name: 'X' });
  const u = SL.addTask(plain.s, { name: 'Monteure einplanen', systemId: sys.id, schrittRef: 'einsatz:planen' }, plain.fw);
  assert.equal(u.prozess, null);
  assert.deepEqual(SL.suggestProcess('einsatz:planen', fwFor({ meta: { module: ['handwerk'] } })), { prozess: 'einsatz', schritt: 'planen' });
});

// ---------------------------------------------------------------- software-landkarte.r.zielbild

test('zielbild: a system can be marked as the new target system', () => {
  const s = example();
  const ziel = SL.zielsysteme(s);
  assert.deepEqual(ziel.map((x) => x.name), ['weclapp']);
  assert.ok(!SL.istSystems(s).includes(ziel[0]), 'the target is not part of the current map');
  SL.setZielsystem(s, ziel[0].id, false);
  assert.equal(SL.zielsysteme(s).length, 0);
});

test('zielbild: per task wandert, bleibt, entfällt, unklar; per object the future leading system', () => {
  assert.deepEqual(Object.values(SL.ZIELE), ['wandert', 'bleibt', 'entfällt', 'unklar']);
  const s = example();
  const t = s.tasks[0];
  for (const z of Object.keys(SL.ZIELE)) { SL.setTaskZiel(s, t.id, z); assert.equal(t.ziel, z); }
  assert.throws(() => SL.setTaskZiel(s, t.id, 'vielleicht'));
  SL.setZielFuehrend(s, 'zahlungen', SL.zielsysteme(s)[0].id);
  assert.equal(SL.objById(s, 'zahlungen').zielFuehrend, SL.zielsysteme(s)[0].id);
});

test('zielbild: the changeover list says what moves, which flows need an interface, what can be switched off', () => {
  const s = example();
  const u = SL.umstellungsliste(s);
  const weclapp = SL.zielsysteme(s)[0].id;
  assert.ok(u.umziehen.aufgaben.some((t) => t.name === 'Angebote schreiben'));
  assert.ok(u.umziehen.datenobjekte.some((x) => x.objectId === 'kunden' && x.nach === weclapp));
  assert.deepEqual(u.abschalten.map((x) => x.name), ['Preisliste und offene Posten (Excel)']);
  assert.ok(u.schnittstellen.some((x) => x.from === weclapp && x.objectId === 'artikel'), 'the till still needs prices from the new system');
  assert.ok(u.offen.aufgaben.some((t) => t.name === 'Material zum Auftrag buchen'), 'unklar stays open');
  assert.ok(!u.vollstaendig);
  const html = report.render(s, fwFor(s));
  assert.match(html, /<h2>Umstellungsliste: weclapp<\/h2>/);
  assert.match(html, /<h3>Kann abgeschaltet werden<\/h3>\s*<ul><li>Preisliste und offene Posten \(Excel\)/);
  assert.match(html, /<h3>Braucht eine Schnittstelle<\/h3>/);
  assert.match(html, /<th>Heute führend<\/th><th>Künftig führend<\/th>/, 'current and target side by side');
});

test('zielbild: without a target system the report has no changeover list', () => {
  const s = example();
  SL.setZielsystem(s, SL.zielsysteme(s)[0].id, false);
  assert.doesNotMatch(report.render(s, fwFor(s)), /Umstellungsliste/);
});

// ---------------------------------------------------------------- software-landkarte.r.zwischenstand

test('zwischenstand: the result file carries a format version and reopens unchanged', () => {
  const s = example();
  const text = SL.toFile(s);
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, 'software-landkarte');
  assert.equal(parsed.formatVersion, SL.FORMAT_VERSION);
  assert.deepEqual(SL.fromFile(text), SL.normalize(SL.clone(s)));
  assert.throws(() => SL.fromFile(JSON.stringify({ ...parsed, formatVersion: SL.FORMAT_VERSION + 1 })), /Formatversion/);
  assert.throws(() => SL.fromFile(JSON.stringify({ ...parsed, formatVersion: undefined })), /Formatversion/);
  assert.throws(() => SL.fromFile('{"format":"etwas anderes","formatVersion":1}'), /keine Software-Landkarte/);
  assert.throws(() => SL.fromFile('kein json'), /JSON/);
});

test('zwischenstand: after a changeover the old map is the starting point of the new one', () => {
  const s = example();
  const weclapp = SL.zielsysteme(s)[0].id;
  const next = SL.adoptTarget(s);
  assert.equal(next.meta.version, 2);
  assert.equal(next.meta.vorgaenger.length, 1);
  assert.ok(next.meta.vorgaenger[0].abgeschaltet.includes('Preisliste und offene Posten (Excel)'));
  assert.ok(!next.systems.some((x) => x.name === 'Preisliste und offene Posten (Excel)'));
  assert.equal(SL.zielsysteme(next).length, 0, 'the target is now current');
  assert.equal(next.tasks.find((t) => t.name === 'Angebote schreiben').systemId, weclapp);
  assert.ok(!next.tasks.some((t) => t.name === 'Arbeitsberichte abtippen'), 'entfällt is gone');
  assert.deepEqual(SL.leaders(next, 'kunden'), [weclapp]);
  assert.equal(SL.objectStatus(next, 'artikel'), 'ok', 'double maintenance resolved by the target');
  assert.ok(next.tasks.every((t) => t.ziel === null));
  assert.equal(s.meta.version, 1, 'the old map is untouched');
  assert.throws(() => SL.adoptTarget(SL.emptyState()), /kein Zielsystem/);
  assert.doesNotThrow(() => SL.fromFile(SL.toFile(next)));
});

// ---------------------------------------------------------------- software-landkarte.r.mandanten-durchgang

test('durchgang: the client payload holds only what the cards need', () => {
  const s = example();
  const p = SL.clientPayload(s);
  assert.equal(p.format, SL.CLIENT_FORMAT);
  assert.deepEqual(Object.keys(p).sort(), ['betrieb', 'erzeugt', 'fileId', 'format', 'formatVersion', 'systems', 'tasks']);
  assert.ok(!p.systems.some((x) => x.name === 'weclapp'), 'no target system');
  assert.ok(p.tasks.every((t) => Object.keys(t).sort().join() === 'haeufigkeit,id,name,rolle,systemId'));
  assert.equal(s.durchgang.fileId, p.fileId);
});

test('durchgang: one card per system and per task, then the closing question', () => {
  const s = example();
  const list = SL.cards(SL.clientPayload(s));
  assert.equal(list.filter((c) => c.kind === 'system').length, 8);
  assert.equal(list.filter((c) => c.kind === 'task').length, 25);
  assert.equal(list[list.length - 1].kind, 'ergaenzungen');
  assert.equal(list[0].kind, 'system');
  assert.equal(list[1].system.id, list[0].system.id, 'a system is followed by its tasks');
});

test('durchgang: answers ✓ / ✗ with text / ?, can be taken back; progress counts them', () => {
  const s = example();
  const p = SL.clientPayload(s);
  const [a, b, c] = SL.cards(p);
  const ans = {};
  SL.answer(ans, a.key, 'ok');
  SL.answer(ans, b.key, 'anders', 'machen wir in Excel');
  SL.answer(ans, c.key, 'unsicher');
  assert.deepEqual(ans[b.key], { wert: 'anders', text: 'machen wir in Excel' });
  assert.deepEqual(SL.progress(p, ans), { done: 3, total: 33, percent: 9 });
  SL.answer(ans, c.key, null);
  assert.equal(SL.progress(p, ans).done, 2);
  assert.throws(() => SL.answer(ans, a.key, 'egal'));
});

test('durchgang: reading the result back marks deviations, additions and "unsicher"', () => {
  const s = example();
  const p = SL.clientPayload(s);
  const list = SL.cards(p);
  const ans = {};
  const sysCard = list.find((c) => c.kind === 'system');
  const t1 = list.filter((c) => c.kind === 'task')[0];
  const t2 = list.filter((c) => c.kind === 'task')[1];
  SL.answer(ans, sysCard.key, 'ok');
  SL.answer(ans, t1.key, 'anders', 'macht der Inhaber selbst');
  SL.answer(ans, t2.key, 'unsicher');
  const result = SL.clientResult(p, ans, ['Fahrtenbuch-App', '  ']);
  assert.equal(result.format, SL.RESULT_FORMAT);
  assert.deepEqual(result.ergaenzungen, ['Fahrtenbuch-App']);
  const r = SL.importResult(s, JSON.parse(JSON.stringify(result)));
  assert.deepEqual([r.uebernommen, r.ergaenzungen, r.warnings.length], [3, 1, 0]);
  const d = SL.durchgangBefunde(s);
  assert.deepEqual(d.anders.map((x) => x.item.id), [t1.task.id]);
  assert.deepEqual(d.unsicher.map((x) => x.item.id), [t2.task.id]);
  assert.deepEqual(d.ergaenzungen.map((e) => e.text), ['Fahrtenbuch-App']);
  assert.equal(SL.sysById(s, sysCard.system.id).durchgang.wert, 'ok');
  // "unsicher" answers are open questions in the report.
  const html = report.render(s, fwFor(s));
  assert.match(html, new RegExp(`<h3>Offene Fragen</h3>\\s*<ul><li>Unsicher: ${t2.task.name}`));
  assert.match(html, /Ergänzung des Mandanten: Fahrtenbuch-App/);
  assert.match(html, /macht der Inhaber selbst/);
  // A result for another file is still read, with a warning.
  const other = { ...result, fileId: 'dg-anders' };
  assert.equal(SL.importResult(s, other).warnings.length, 1);
  assert.throws(() => SL.importResult(s, { format: 'x' }), /kein Ergebnis/);
});

// ---------------------------------------------------------------- software-landkarte.r.bericht

test('bericht: findings first, then map, processes, systems and tasks', () => {
  const s = example();
  const html = report.render(s, fwFor(s));
  const order = ['<h2>Befunde', '<h3>Medienbrüche', '<h3>Doppelte Pflege', '<h3>Kein führendes System', '<h3>Offene Fragen',
    '<h2>Umstellungsliste', '<h2>Landkarte', '<h2>Prozesse', '<h2>Systeme', '<h2>Aufgaben'];
  const at = order.map((x) => html.indexOf(x));
  assert.ok(at.every((i) => i >= 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  for (const sys of SL.istSystems(s)) assert.ok(html.includes(report.esc(sys.name)), sys.name);
  for (const p of fwFor(s).prozesse) assert.ok(html.includes(report.esc(p.name)), p.name);
});

test('bericht: the standalone file needs no server and loads nothing', () => {
  const s = example();
  const doc = report.reportDocument(s, fwFor(s));
  assert.match(doc, /Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(doc, /<script|<link|src=|https?:\/\//i);
  assert.match(doc, /@page \{ size: A4/);
});

test('bericht: everything from the user is escaped', () => {
  const { s } = fresh();
  s.meta.betrieb = '<img src=x onerror=alert(1)>';
  SL.addSystem(s, { name: '<b>Kasse</b>' });
  const html = report.render(s, fwFor(s));
  assert.doesNotMatch(html, /<img|<b>Kasse/);
  assert.match(html, /&lt;b&gt;Kasse/);
});

// ---------------------------------------------------------------- software-landkarte.d.ergebnisformat

test('csv: matrix and task list for Excel, semicolon separated and safely quoted', () => {
  const s = example();
  const fw = fwFor(s);
  const m = SL.matrixCsv(s).split('\r\n');
  assert.equal(m[0].split(';')[0], 'Datenobjekt');
  assert.ok(m[0].endsWith('Befund;Künftig führend'));
  assert.ok(m.find((l) => l.startsWith('Artikel und Preise;')).includes('doppelte Pflege'));
  const a = SL.aufgabenCsv(s, fw).split('\r\n');
  assert.equal(a.length - 2, 25, 'one row per task of the current map');
  const { s: t } = fresh();
  SL.addSystem(t, { name: 'Liste; "alt"' });
  SL.addSystem(t, { name: '=HYPERLINK("x")' });
  SL.addObject(t, { name: 'Kunden' });
  const head = SL.matrixCsv(t).split('\r\n')[0];
  assert.ok(head.includes('"Liste; ""alt"""'));
  assert.ok(head.includes(`"'=HYPERLINK(""x"")"`), 'no formula injection');
});

// ---------------------------------------------------------------- software-landkarte.r.keine-mandantendaten

test('keine-mandantendaten: tests and examples use an invented business, people appear as roles', () => {
  const s = example();
  assert.match(s.meta.betrieb, /\(erfunden\)/);
  const roles = new Set(data.katalog.rollen);
  for (const sys of s.systems) for (const r of sys.rollen) assert.ok(roles.has(r), `role ${r}`);
  for (const t of s.tasks) assert.ok(roles.has(t.rolle), `role ${t.rolle}`);
  const text = fs.readFileSync(path.join(ROOT, 'examples', 'beispielbetrieb.json'), 'utf8');
  assert.doesNotMatch(text, /@[a-z0-9-]+\.[a-z]{2,}|\bDE\d{2}\s?\d{4}|\+49/i, 'no contact data');
});

test('keine-mandantendaten: result files are excluded by .gitignore', () => {
  const files = ['kunde-2026-10-27.landkarte.json', 'durchgang-2026-10-27.durchgang.json', 'kunde-2026-10-27.mandant.html',
    'kunde-2026-10-27.bericht.html', 'kunde-2026-10-27-matrix.csv', 'kunde-2026-10-27-aufgaben.csv', 'mandanten/x.json'];
  const out = execFileSync('git', ['check-ignore', '--no-index', ...files], { cwd: ROOT, encoding: 'utf8' });
  assert.deepEqual(out.trim().split('\n').sort(), [...files].sort());
  const kept = ['examples/beispielbetrieb.json', 'catalog/software.json', 'modules/handwerk.json', 'dist/software-landkarte.html'];
  for (const f of kept) {
    assert.throws(() => execFileSync('git', ['check-ignore', '--no-index', f], { cwd: ROOT, stdio: 'pipe' }), `${f} must stay tracked`);
  }
});

test('the example is what scripts/beispiel.js produces', () => {
  const { beispiel } = require('../scripts/beispiel.js');
  const { loadData } = require('../scripts/build.js');
  const fresh = beispiel(loadData({ withoutExample: true }));
  assert.deepEqual(fresh, data.beispiel);
});

test('dist is up to date with the sources', () => {
  const { build, OUT } = require('../scripts/build.js');
  assert.equal(fs.readFileSync(OUT, 'utf8'), build(), 'run npm run build');
});
