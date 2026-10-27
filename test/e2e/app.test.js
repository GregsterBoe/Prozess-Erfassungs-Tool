'use strict';
// End-to-end tests of dist/software-landkarte.html, opened by file:// as a user would.
// Needs Playwright with Chromium (require('playwright')).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SL, example, ROOT } = require('../helpers.js');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }
const skip = chromium ? false : 'playwright is not installed';

const URL = 'file://' + path.join(ROOT, 'dist', 'software-landkarte.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'landkarte-'));
let browser;

test.before(async () => { if (chromium) browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

/** A fresh context that records every request leaving the machine and every page error. */
async function open(url = URL, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, ...options });
  const outside = [];
  const errors = [];
  context.on('request', (r) => { if (!/^(file|blob|data):/.test(r.url())) outside.push(r.url()); });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  return { context, page, outside, errors };
}

async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  const file = path.join(TMP, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
}

async function upload(page, selector, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(selector)]);
  await chooser.setFiles(file);
}

const tab = (page, id) => page.click(`[data-tab=${id}]`);

/** Puts a state into the office mode's storage before the page loads. */
async function withState(context, state) {
  await context.addInitScript((text) => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('software-landkarte:kanzlei', text); sessionStorage.setItem('seeded', '1'); }
  }, SL.toFile(state));
}

// ---------------------------------------------------------------- software-landkarte.r.lokal

test('lokal: opens from file:// without login and makes no network request through a full session', { skip }, async () => {
  const { context, page, outside, errors } = await open();
  assert.equal(await page.locator('input[type=password]').count(), 0, 'no login');
  await page.click('#load-example');
  for (const t of ['systeme', 'aufgaben', 'daten', 'fluesse', 'prozesse', 'zielbild', 'durchgang', 'bericht', 'betrieb']) {
    await tab(page, t);
    await page.waitForSelector('main section');
  }
  await tab(page, 'durchgang');
  const client = await download(page, '#make-client');
  await tab(page, 'bericht');
  await download(page, '#dl-report');
  await download(page, '#dl-matrix');
  const c = await open('file://' + client);
  await c.page.keyboard.press('1');
  assert.deepEqual(outside, []);
  assert.deepEqual(c.outside, []);
  assert.deepEqual([...errors, ...c.errors], []);
  await c.context.close();
  await context.close();
});

test('lokal: a Content-Security-Policy forbids every connection', { skip }, async () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'software-landkarte.html'), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  const { context, page } = await open();
  const blocked = await page.evaluate(async () => {
    try { await fetch('https://example.org/'); return false; } catch (e) { return true; }
  });
  assert.ok(blocked);
  await context.close();
});

// ---------------------------------------------------------------- office mode: capture

test('systeme and aufgaben: choose from the catalog, switch proposals off, add own system and task', { skip }, async () => {
  const { context, page, errors } = await open();
  await tab(page, 'systeme');
  await page.selectOption('#cat-system', 'lexware-office');
  await page.click('#add-cat-system');
  await page.waitForSelector('[data-system]');
  await page.fill('#free-system', 'Preisliste');
  await page.selectOption('#free-system-art', 'excel');
  await page.click('#add-free-system');
  await page.waitForFunction(() => document.querySelectorAll('[data-system]').length === 2);
  assert.equal(await page.locator('[data-system]').count(), 2);

  await tab(page, 'aufgaben');
  const sysId = await page.locator('[data-system-tasks]').first().getAttribute('data-system-tasks');
  assert.equal(await page.locator(`[data-system-tasks="${sysId}"] [data-task]`).count(), 4, 'proposed tasks');
  await page.uncheck(`[data-cat-task="${sysId}/bank"]`);
  await page.waitForFunction((id) => document.querySelectorAll(`[data-system-tasks="${id}"] [data-task]`).length === 3, sysId);
  await page.check(`[data-cat-task="${sysId}/bank"]`);
  await page.waitForFunction((id) => document.querySelectorAll(`[data-system-tasks="${id}"] [data-task]`).length === 4, sysId);

  const excel = await page.locator('[data-system-tasks]').nth(1).getAttribute('data-system-tasks');
  await page.fill(`[data-free-task="${excel}"]`, 'Preise eintragen');
  await page.click(`[data-add-task="${excel}"]`);
  await page.waitForSelector(`[data-system-tasks="${excel}"] [data-task]`);
  const task = page.locator(`[data-system-tasks="${excel}"] [data-task]`).first();
  await task.locator('select[aria-label="Häufigkeit"]').selectOption('monatlich');
  await task.locator('summary').click();
  await task.locator('label', { hasText: 'Artikel und Preise' }).nth(1).locator('input').check();
  await page.waitForTimeout(50);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('software-landkarte:kanzlei')));
  const t = saved.tasks.find((x) => x.name === 'Preise eintragen');
  assert.equal(t.haeufigkeit, 'monatlich');
  assert.deepEqual(t.schreibt, ['artikel']);

  await tab(page, 'daten');
  const [a, b] = saved.systems.map((s) => s.id);
  await page.selectOption(`[data-cell="artikel|${a}"]`, 'fuehrt');
  await page.selectOption(`[data-cell="artikel|${b}"]`, 'fuehrt');
  await page.waitForSelector('[data-object="artikel"] .badge.bad');
  assert.match(await page.textContent('[data-object="artikel"]'), /doppelte Pflege/);
  assert.match(await page.textContent('[data-object="kunden"]'), /kein führendes System/);
  // The Excel list only copies prices, but a task there writes them: a flow is proposed.
  await page.selectOption(`[data-cell="artikel|${b}"]`, 'kopie');
  await page.waitForFunction(() => !document.querySelector('[data-object="artikel"] .badge'));

  await tab(page, 'fluesse');
  await page.waitForSelector('#flow-suggestions');
  assert.equal(await page.getAttribute('[data-suggestion]', 'data-suggestion'), `artikel|${a}|${b}`);
  await page.locator('[data-suggestion] select').selectOption('manuell');
  await page.locator('[data-suggestion] button').first().click();
  await page.waitForSelector('[data-flow] [data-aufwand]');
  await page.fill('[data-aufwand]', '30');
  await page.press('[data-aufwand]', 'Tab');
  await page.waitForFunction(() => /30 Min\./.test(document.querySelector('main').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

test('prozess-baukasten: choosing a module shows its processes, removing it hides them', { skip }, async () => {
  const { context, page } = await open();
  await tab(page, 'prozesse');
  assert.equal(await page.locator('[data-process="lager"]').count(), 0);
  await tab(page, 'betrieb');
  await page.check('[data-modul="handel"]');
  await tab(page, 'prozesse');
  await page.waitForSelector('[data-process="lager"]');
  assert.match(await page.textContent('[data-process="o2c"]'), /Kommissionieren und versenden/);
  await tab(page, 'betrieb');
  await page.uncheck('[data-modul="handel"]');
  await tab(page, 'prozesse');
  assert.equal(await page.locator('[data-process="lager"]').count(), 0);
  await context.close();
});

test('prozesse: reorder in a process and assign the tasks without one', { skip }, async () => {
  const s = example();
  const sys = s.systems[0].id;
  SL.addTask(s, { name: 'Fahrzeuge betanken', systemId: sys }, null);
  const { context, page } = await open(URL, {});
  await withState(context, s);
  await page.reload();
  await tab(page, 'prozesse');
  const free = page.locator('[data-unassigned]', { hasText: 'Fahrzeuge betanken' });
  await free.waitFor();
  await free.locator('select').selectOption('o2c:leistung');
  await page.waitForFunction(() => !/Fahrzeuge betanken/.test(document.querySelector('#ohne-prozess').textContent));
  const o2c = page.locator('[data-process="o2c"]');
  assert.match(await o2c.locator('table.swimlane').first().textContent() + await o2c.textContent(), /Fahrzeuge betanken/);
  await o2c.locator('summary').click();
  const names = () => o2c.locator('[data-seq] .grow').allTextContents();
  const before = await names();
  const i = before.findIndex((n) => n.startsWith('Fahrzeuge betanken'));
  await o2c.locator('[data-seq]').nth(i).locator('button[aria-label="nach oben"]').click();
  await page.waitForTimeout(50);
  await page.locator('[data-process="o2c"] summary').click();
  const after = await page.locator('[data-process="o2c"] [data-seq] .grow').allTextContents();
  assert.ok(after[i - 1].startsWith('Fahrzeuge betanken'));
  await context.close();
});

// ---------------------------------------------------------------- software-landkarte.r.zwischenstand

test('zwischenstand: survives closing the browser, saves to a versioned file and reopens', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'profile-'));
  let context = await chromium.launchPersistentContext(dir, { acceptDownloads: true });
  let page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.click('#load-example');
  await page.fill('#betrieb', 'Erfundene Bäckerei');
  await page.press('#betrieb', 'Tab');
  await page.waitForFunction(() => /Erfundene Bäckerei/.test(document.querySelector('header').textContent));
  await context.close();

  context = await chromium.launchPersistentContext(dir, { acceptDownloads: true });
  page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  assert.match(await page.textContent('header'), /Erfundene Bäckerei/, 'state kept after the browser closed');

  const file = await download(page, '#save-json');
  assert.match(path.basename(file), /\.landkarte\.json$/);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.formatVersion, SL.FORMAT_VERSION);
  await page.click('#new-map');
  await page.waitForFunction(() => /neuer Betrieb/.test(document.querySelector('header').textContent));
  await upload(page, '#open-json', file);
  await page.waitForFunction(() => /Erfundene Bäckerei/.test(document.querySelector('header').textContent));
  await tab(page, 'systeme');
  assert.equal(await page.locator('[data-system]').count(), 9);
  await context.close();
});

// ---------------------------------------------------------------- software-landkarte.r.zielbild

test('zielbild: decisions per task and object, changeover list, current and target side by side, adopt as new map', { skip }, async () => {
  const { context, page } = await open();
  await page.click('#load-example');
  await tab(page, 'zielbild');
  const heads = await page.locator('#ziel-aufgaben th').allTextContents();
  assert.deepEqual(heads, ['Aufgabe', 'Ist: System', 'Entscheidung', 'Ziel: System']);
  assert.deepEqual(await page.locator('#ziel-objekte th').allTextContents(), ['Datenobjekt', 'Ist: führend', 'Ziel: führend']);
  const row = page.locator('#ziel-aufgaben tr', { hasText: 'Material zum Auftrag buchen' });
  await row.locator('select').selectOption('wandert');
  await page.waitForFunction(() => /Material zum Auftrag buchen/.test(document.querySelector('#umstellung').textContent.split('Braucht eine Schnittstelle')[0]));
  assert.match(await page.textContent('#umstellung'), /Kann abgeschaltet werden/);
  await page.click('#adopt');
  await page.waitForFunction(() => /Fassung 2/.test(document.querySelector('header').textContent));
  await tab(page, 'betrieb');
  assert.match(await page.textContent('main'), /Fassung 1 bis/);
  await context.close();
});

// ---------------------------------------------------------------- software-landkarte.r.mandanten-durchgang

async function clientFile() {
  const { context, page } = await open();
  await page.click('#load-example');
  await tab(page, 'durchgang');
  const file = await download(page, '#make-client');
  return { context, page, file };
}

test('durchgang: the client file shows only the walkthrough', { skip }, async () => {
  const office = await clientFile();
  assert.match(path.basename(office.file), /\.mandant\.html$/);
  const c = await open('file://' + office.file);
  await c.page.waitForSelector('.walk');
  assert.equal(await c.page.locator('nav.tabs').count(), 0);
  assert.equal(await c.page.locator('#matrix, #report-preview, [data-tab]').count(), 0);
  assert.match(await c.page.textContent('[data-card]'), /TopKontor Handwerk/);
  assert.match(await c.page.textContent('#progress-text'), /0 von 33 beantwortet · Karte 1 von 34/);
  await c.context.close();
  await office.context.close();
});

test('durchgang: answer, deviate with text, unsure, go back, take back, add, save, read back in the office', { skip }, async () => {
  const office = await clientFile();
  const c = await open('file://' + office.file);
  const p = c.page;
  await p.waitForSelector('.walk');
  await p.keyboard.press('1'); // ✓ on the first system card, moves on
  await p.click('[data-answer="anders"]');
  await p.fill('#anders-text', 'Angebote schreibt der Inhaber in Word');
  await p.click('#next');
  await p.keyboard.press('3'); // ? unsicher
  assert.equal(await p.getAttribute('[role=progressbar]', 'aria-valuenow'), '3');
  await p.keyboard.press('ArrowLeft');
  assert.equal(await p.getAttribute('[data-answer="unsicher"]', 'aria-pressed'), 'true');
  await p.click('#retract');
  assert.equal(await p.getAttribute('[role=progressbar]', 'aria-valuenow'), '2');
  await p.click('[data-answer="unsicher"]');
  // Autosave: reload keeps answers and position.
  await p.reload();
  await p.waitForSelector('.walk');
  assert.match(await p.textContent('#progress-text'), /3 von 33/);
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowLeft');
  assert.equal(await p.inputValue('#anders-text'), 'Angebote schreibt der Inhaber in Word');
  await p.click('#next');
  await p.click('#next');
  for (let i = 3; i < 33; i += 1) await p.keyboard.press('1');
  assert.match(await p.textContent('[data-card]'), /Welche Programme, Listen oder Ordner nutzen Sie noch\?/);
  await p.fill('#erg-input', 'Fahrtenbuch-App');
  await p.press('#erg-input', 'Enter');
  await p.fill('#erg-input', 'Notizbuch im Lager');
  await p.click('#erg-add');
  assert.equal(await p.locator('#erg-list li').count(), 2);
  assert.match(await p.textContent('[data-card]'), /Alle Karten sind beantwortet/);
  const result = await download(p, '#save-result');
  assert.match(path.basename(result), /\.durchgang\.json$/);

  const o = office.page;
  await upload(o, '#import-result', result);
  await o.waitForSelector('[data-anders]');
  const box = await o.textContent('#durchgang-befunde');
  assert.match(box, /Anders \(1\)/);
  assert.match(box, /Angebote schreibt der Inhaber in Word/);
  assert.match(box, /Unsicher \(1\)/);
  assert.match(box, /Ergänzungen \(2\)/);
  assert.match(box, /Fahrtenbuch-App/);
  await o.locator('[data-ergaenzung]', { hasText: 'Fahrtenbuch-App' }).locator('button', { hasText: 'Als System anlegen' }).click();
  await tab(o, 'systeme');
  assert.ok(await o.locator('[data-system]', { hasText: 'Mandant: So ist es' }).count() >= 1, 'answers shown on the systems');
  assert.equal(await o.locator('input[aria-label=Name]').evaluateAll((els) => els.filter((e) => e.value === 'Fahrtenbuch-App').length), 1);
  await tab(o, 'bericht');
  assert.match(await o.textContent('#report-preview'), /Offene Fragen[\s\S]*Unsicher: /);
  await c.context.close();
  await office.context.close();
});

test('durchgang: works by touch', { skip }, async () => {
  const office = await clientFile();
  const c = await open('file://' + office.file, { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  await c.page.waitForSelector('.walk');
  await c.page.tap('[data-answer="ok"]');
  await c.page.tap('[data-answer="unsicher"]');
  await c.page.tap('#prev');
  assert.equal(await c.page.getAttribute('[data-answer="unsicher"]', 'aria-pressed'), 'true');
  await c.page.tap('#prev');
  assert.equal(await c.page.getAttribute('[data-answer="ok"]', 'aria-pressed'), 'true');
  assert.equal(await c.page.getAttribute('[role=progressbar]', 'aria-valuenow'), '2');
  const overflow = await c.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'no sideways scrolling on a phone');
  await c.context.close();
  await office.context.close();
});

// ---------------------------------------------------------------- software-landkarte.r.durchgangsdauer

test('durchgangsdauer: 8 systems and 25 tasks; a progress bar shows what is left', { skip }, async () => {
  // The 20-minute limit is measured with a test person (see README); this checks the
  // size and that the bar moves with every answer.
  const office = await clientFile();
  const c = await open('file://' + office.file);
  const p = c.page;
  await p.waitForSelector('[role=progressbar]');
  assert.equal(await p.getAttribute('[role=progressbar]', 'aria-valuemax'), '33');
  const widths = [];
  for (let i = 0; i < 33; i += 1) {
    widths.push(await p.$eval('.progress > div', (d) => parseFloat(d.style.width)));
    await p.keyboard.press('1');
  }
  widths.push(await p.$eval('.progress > div', (d) => parseFloat(d.style.width)));
  assert.equal(widths[0], 0);
  assert.equal(widths[widths.length - 1], 100);
  assert.ok(widths.every((w, i) => i === 0 || w >= widths[i - 1]));
  await c.context.close();
  await office.context.close();
});

// ---------------------------------------------------------------- software-landkarte.r.bericht

function bigState() {
  const s = example();
  for (let i = 1; i <= 7; i += 1) SL.addSystem(s, { name: `Zusatzsystem mit langem Namen Nummer ${i}`, art: i % 2 ? 'excel' : 'papier' });
  const ids = SL.istSystems(s).map((x) => x.id);
  for (const o of s.objects) SL.setCell(s, o.id, ids[ids.length - 1], 'kopie');
  return s;
}

async function tablesFit(page, scope) {
  return page.$$eval(`${scope} table`, (tables) => tables
    .map((t) => ({ w: t.scrollWidth, max: t.parentElement.clientWidth, text: t.textContent.slice(0, 40) }))
    .filter((x) => x.w > x.max + 1));
}

test('bericht: printable on A4 without cut-off tables, even with 15 systems', { skip }, async () => {
  const s = bigState();
  assert.equal(SL.istSystems(s).length, 15);
  // A4 portrait minus 15 mm margins: 180 mm ≈ 680 CSS px.
  const { context, page } = await open(URL, { viewport: { width: 680, height: 1000 } });
  await withState(context, s);
  await page.reload();
  await tab(page, 'bericht');
  await page.emulateMedia({ media: 'print' });
  assert.deepEqual(await tablesFit(page, '#report-preview'), []);
  assert.equal(await page.locator('nav.tabs').isVisible(), false, 'only the report prints');
  const pdf = await page.pdf({ format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } });
  assert.ok(pdf.length > 10000);

  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1280, height: 900 });
  const file = await download(page, '#dl-report');
  assert.match(path.basename(file), /\.bericht\.html$/);
  const r = await open('file://' + file, { viewport: { width: 680, height: 1000 } });
  await r.page.emulateMedia({ media: 'print' });
  assert.deepEqual(await tablesFit(r.page, '.report'), []);
  assert.match(await r.page.textContent('h2'), /Befunde/);
  assert.deepEqual(r.outside, []);
  await r.context.close();
  await context.close();
});

test('bericht and export: CSV for Excel and JSON are produced in the browser', { skip }, async () => {
  const { context, page } = await open();
  await page.click('#load-example');
  await tab(page, 'bericht');
  const matrix = fs.readFileSync(await download(page, '#dl-matrix'), 'utf8');
  assert.ok(matrix.startsWith('﻿Datenobjekt;'), 'BOM so Excel reads umlauts');
  assert.match(matrix, /Artikel und Preise;.*doppelte Pflege/);
  const tasks = fs.readFileSync(await download(page, '#dl-tasks'), 'utf8');
  assert.equal(tasks.trim().split('\r\n').length, 26);
  assert.match(await page.textContent('#report-preview'), /Umstellungsliste: weclapp/);
  await context.close();
});
