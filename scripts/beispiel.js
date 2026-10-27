#!/usr/bin/env node
/* Writes examples/beispielbetrieb.json: an invented business (no client data,
 * software-landkarte.r.keine-mandantendaten) with 8 systems and 25 tasks, the size the
 * walkthrough is measured at (software-landkarte.r.durchgangsdauer). Built through the
 * same functions the app uses, so it stays valid when the model changes. */
'use strict';
const fs = require('fs');
const path = require('path');
const SL = require('../src/core.js');
const { loadData } = require('./build.js');

function beispiel(data) {
  const s = SL.emptyState();
  s.meta.betrieb = 'Beispiel Haustechnik GmbH (erfunden)';
  s.meta.module = ['handwerk', 'ladengeschaeft'];
  const fw = SL.resolveFramework(data.prozesse, data.module, s.meta.module);
  const cat = SL.mergedCatalog(data.katalog, data.module, s.meta.module);
  const add = (id, tasks) => SL.addSystemFromCatalog(s, cat, id, fw, tasks);

  const tk = add('topkontor-handwerk');
  const duo = add('datev-duo', ['belege', 'ar-belege', 'freigabe', 'zahlen']);
  const bank = add('online-banking');
  const clock = add('clockodo');
  const kasse = add('ready2order');
  const excel = add('excel-liste', []);
  SL.updateSystem(s, excel.id, { name: 'Preisliste und offene Posten (Excel)', zweck: 'Einkaufs- und Verkaufspreise, dazu eine Liste offener Rechnungen', rollen: ['Inhaber', 'Büro'] });
  const papier = add('papier-arbeitsberichte');
  const post = add('postfach');

  SL.addTask(s, { name: 'Preise pflegen', systemId: excel.id, rolle: 'Inhaber', haeufigkeit: 'monatlich', schreibt: ['artikel'], schrittRef: 'o2c:angebot' }, fw);
  SL.addTask(s, { name: 'Offene Posten nachhalten', systemId: excel.id, rolle: 'Büro', haeufigkeit: 'woechentlich', liest: ['ausgangsrechnungen', 'zahlungen'], schrittRef: 'o2c:zahlungseingang' }, fw);
  SL.addTask(s, { name: 'Arbeitsberichte abtippen', systemId: tk.id, rolle: 'Büro', haeufigkeit: 'taeglich', liest: ['arbeitsberichte'], schreibt: ['arbeitsberichte'], schrittRef: 'einsatz:rapport' }, fw);
  SL.ensureObject(s, cat, 'lieferanten');

  const cells = {
    kunden: { [tk.id]: 'fuehrt', [post.id]: 'liest' },
    lieferanten: { [duo.id]: 'fuehrt' },
    artikel: { [tk.id]: 'fuehrt', [excel.id]: 'fuehrt', [kasse.id]: 'kopie' },
    angebote: { [tk.id]: 'fuehrt' },
    auftraege: { [tk.id]: 'fuehrt' },
    ausgangsrechnungen: { [tk.id]: 'fuehrt', [duo.id]: 'kopie', [bank.id]: 'liest', [excel.id]: 'kopie' },
    eingangsrechnungen: { [duo.id]: 'fuehrt', [post.id]: 'kopie' },
    zahlungen: { [bank.id]: 'fuehrt', [duo.id]: 'kopie', [excel.id]: 'liest' },
    bankumsaetze: { [bank.id]: 'fuehrt', [duo.id]: 'liest' },
    arbeitszeiten: { [clock.id]: 'fuehrt', [papier.id]: 'kopie' },
    arbeitsberichte: { [papier.id]: 'fuehrt', [tk.id]: 'kopie' },
    mitarbeiter: { [clock.id]: 'liest', [bank.id]: 'liest' },
    kasse: { [kasse.id]: 'fuehrt' },
  };
  for (const [o, row] of Object.entries(cells)) for (const [sys, v] of Object.entries(row)) SL.setCell(s, o, sys, v);

  SL.addFlow(s, { objectId: 'artikel', from: excel.id, to: kasse.id, art: 'manuell', haeufigkeit: 'woechentlich', aufwand: 60 });
  SL.addFlow(s, { objectId: 'arbeitsberichte', from: papier.id, to: tk.id, art: 'manuell', haeufigkeit: 'taeglich', aufwand: 240 });
  SL.addFlow(s, { objectId: 'arbeitszeiten', from: papier.id, to: clock.id, art: 'manuell', haeufigkeit: 'woechentlich', aufwand: 90 });
  SL.addFlow(s, { objectId: 'ausgangsrechnungen', from: tk.id, to: excel.id, art: 'manuell', haeufigkeit: 'woechentlich', aufwand: 45 });
  SL.addFlow(s, { objectId: 'ausgangsrechnungen', from: tk.id, to: duo.id, art: 'datei', haeufigkeit: 'monatlich' });
  SL.addFlow(s, { objectId: 'eingangsrechnungen', from: post.id, to: duo.id, art: 'datei', haeufigkeit: 'woechentlich' });
  SL.addFlow(s, { objectId: 'bankumsaetze', from: bank.id, to: duo.id, art: 'schnittstelle', haeufigkeit: 'taeglich' });

  const ziel = SL.addSystem(s, { name: 'weclapp', art: 'cloud', zweck: 'Neue Gesamtsoftware für Angebote, Aufträge, Material und Rechnungen', catalogId: 'weclapp' });
  SL.setZielsystem(s, ziel.id, true);
  const byName = (sys, name) => s.tasks.find((t) => t.systemId === sys.id && t.name === name).id;
  for (const n of ['Angebote schreiben', 'Aufträge anlegen', 'Ausgangsrechnungen schreiben', 'Kunden anlegen und pflegen']) SL.setTaskZiel(s, byName(tk, n), 'wandert');
  SL.setTaskZiel(s, byName(tk, 'Material zum Auftrag buchen'), 'unklar');
  SL.setTaskZiel(s, byName(tk, 'Arbeitsberichte abtippen'), 'entfaellt');
  SL.setTaskZiel(s, byName(excel, 'Preise pflegen'), 'wandert');
  SL.setTaskZiel(s, byName(excel, 'Offene Posten nachhalten'), 'entfaellt');
  for (const o of ['kunden', 'artikel', 'angebote', 'auftraege', 'ausgangsrechnungen']) SL.setZielFuehrend(s, o, ziel.id);

  // Stable ids and dates, so the file only changes when the example does.
  return stabilize(s);
}

function stabilize(state) {
  const map = new Map();
  const counters = {};
  const next = (id) => {
    if (!map.has(id)) { const p = id.split('-')[0]; counters[p] = (counters[p] || 0) + 1; map.set(id, `${p}-${counters[p]}`); }
    return map.get(id);
  };
  for (const k of ['systems', 'tasks', 'flows']) for (const x of state[k]) next(x.id);
  let text = JSON.stringify(state);
  for (const [from, to] of map) text = text.split(from).join(to);
  const out = JSON.parse(text);
  out.meta.erstellt = out.meta.geaendert = '2026-10-27';
  return out;
}

if (require.main === module) {
  const out = path.join(__dirname, '..', 'examples', 'beispielbetrieb.json');
  const data = loadData({ withoutExample: true });
  fs.writeFileSync(out, JSON.stringify(beispiel(data), null, 2) + '\n');
  console.log('examples/beispielbetrieb.json');
}
module.exports = { beispiel };
