/* Software-Landkarte: data model and rules. No DOM, so the same file runs in the
 * browser (as window.SL) and in Node tests (module.exports).
 * Design: knowledge base blueprint software-landkarte.blueprint; item ids are noted
 * where a function implements one. */
(function (root) {
  'use strict';

  const FORMAT = 'software-landkarte';
  const FORMAT_VERSION = 1;
  const CLIENT_FORMAT = 'software-landkarte-mandant';
  const RESULT_FORMAT = 'software-landkarte-durchgang';

  const ARTEN = { lokal: 'Software (lokal)', cloud: 'Software (Cloud)', excel: 'Excel-Liste', papier: 'Papier', postfach: 'Postfach' };
  const HAEUFIGKEITEN = { taeglich: 'täglich', woechentlich: 'wöchentlich', monatlich: 'monatlich', jaehrlich: 'jährlich', bedarf: 'bei Bedarf' };
  const ZELLEN = { fuehrt: 'führt', liest: 'liest', kopie: 'Kopie', '': 'nicht vorhanden' };
  const FLUSSARTEN = { schnittstelle: 'Schnittstelle', datei: 'Datei-Export und -Import', manuell: 'manuell abgetippt', papier: 'Papier' };
  const MEDIENBRUCH = new Set(['manuell', 'papier']);
  const ZIELE = { wandert: 'wandert', bleibt: 'bleibt', entfaellt: 'entfällt', unklar: 'unklar' };
  const ANTWORTEN = { ok: 'So ist es', anders: 'Anders', unsicher: 'Unsicher' };
  const OBJEKTARTEN = { stamm: 'Stammdaten', bewegung: 'Bewegungsdaten' };

  let counter = 0;
  function uid(prefix) {
    counter += 1;
    return prefix + '-' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // ---------------------------------------------------------------- catalog and framework

  const SLUG = /^[a-z0-9][a-z0-9-]*$/;
  const MODULE_KEYS = ['id', 'name', 'beschreibung', 'prozesse', 'einhaengen', 'ausblenden', 'datenobjekte', 'software'];
  const SOFTWARE_KEYS = ['id', 'name', 'kategorie', 'art', 'zweck', 'aufgaben'];
  const TASK_KEYS = ['id', 'name', 'rolle', 'haeufigkeit', 'liest', 'schreibt', 'schritt'];
  const OBJECT_KEYS = ['id', 'name', 'art'];
  // Patterns that would only appear if someone put client details into a catalog.
  const PERSONAL = [/@[a-z0-9-]+\./i, /\bDE\d{2}\s?\d{4}/, /\+?\d[\d /-]{8,}\d/];

  function unknownKeys(obj, allowed, where, errors) {
    for (const k of Object.keys(obj || {})) if (!allowed.includes(k)) errors.push(`${where}: unbekanntes Feld „${k}“`);
  }

  function checkProcesses(list, where, errors, seen) {
    if (!Array.isArray(list)) { errors.push(`${where}: prozesse muss eine Liste sein`); return; }
    for (const p of list) {
      if (!p || !SLUG.test(p.id || '')) { errors.push(`${where}: Prozess ohne gültige id`); continue; }
      if (seen.has(p.id)) errors.push(`${where}: Prozess-id „${p.id}“ doppelt`);
      seen.add(p.id);
      unknownKeys(p, ['id', 'name', 'schritte'], `${where}/${p.id}`, errors);
      if (!p.name) errors.push(`${where}/${p.id}: name fehlt`);
      if (!Array.isArray(p.schritte) || !p.schritte.length) { errors.push(`${where}/${p.id}: keine Schritte`); continue; }
      checkSteps(p.schritte, `${where}/${p.id}`, errors, new Set());
    }
  }

  function checkSteps(steps, where, errors, seen) {
    for (const s of steps) {
      if (!s || !SLUG.test(s.id || '')) { errors.push(`${where}: Schritt ohne gültige id`); continue; }
      unknownKeys(s, ['id', 'name'], `${where}:${s.id}`, errors);
      if (seen.has(s.id)) errors.push(`${where}: Schritt-id „${s.id}“ doppelt`);
      seen.add(s.id);
      if (!s.name) errors.push(`${where}:${s.id}: name fehlt`);
    }
  }

  function validateCore(core) {
    const errors = [];
    if (!core || !Array.isArray(core.prozesse)) return ['Kern: prozesse fehlt'];
    unknownKeys(core, ['prozesse'], 'Kern', errors);
    checkProcesses(core.prozesse, 'Kern', errors, new Set());
    return errors;
  }

  /** One module against the core. A module may add processes, insert steps after named
   * core steps and hide core steps. It has no way to rename or delete one
   * (software-landkarte.r.prozess-baukasten). */
  function validateModule(mod, core) {
    const errors = [];
    const where = `Modul ${mod && mod.id ? mod.id : '?'}`;
    if (!mod || typeof mod !== 'object') return [`${where}: kein Objekt`];
    unknownKeys(mod, MODULE_KEYS, where, errors);
    if (!SLUG.test(mod.id || '')) errors.push(`${where}: id fehlt oder ist ungültig`);
    if (!mod.name) errors.push(`${where}: name fehlt`);
    const coreIds = new Set(core.prozesse.map((p) => p.id));
    checkProcesses(mod.prozesse || [], where, errors, new Set(coreIds));
    for (const ins of mod.einhaengen || []) {
      unknownKeys(ins, ['prozess', 'nach', 'schritte'], `${where}/einhaengen`, errors);
      const p = core.prozesse.find((x) => x.id === ins.prozess);
      if (!p) { errors.push(`${where}: Einhängepunkt in unbekanntem Kernprozess „${ins.prozess}“`); continue; }
      if (!p.schritte.some((s) => s.id === ins.nach)) errors.push(`${where}: Einhängepunkt „${ins.prozess}:${ins.nach}“ gibt es nicht`);
      if (!Array.isArray(ins.schritte) || !ins.schritte.length) { errors.push(`${where}: Einhängen ohne Schritte`); continue; }
      checkSteps(ins.schritte, `${where}/${ins.prozess}`, errors, new Set(p.schritte.map((s) => s.id)));
    }
    for (const a of mod.ausblenden || []) {
      unknownKeys(a, ['prozess', 'schritt'], `${where}/ausblenden`, errors);
      const p = core.prozesse.find((x) => x.id === a.prozess);
      if (!p || !p.schritte.some((s) => s.id === a.schritt)) errors.push(`${where}: auszublendender Kernschritt „${a.prozess}:${a.schritt}“ gibt es nicht`);
    }
    return errors;
  }

  /** All modules together: unique ids across modules, no two modules inserting the same step. */
  function validateModules(core, modules) {
    const errors = [];
    const ids = new Set();
    const procs = new Set(core.prozesse.map((p) => p.id));
    const inserted = new Set();
    for (const m of modules) {
      errors.push(...validateModule(m, core));
      if (ids.has(m.id)) errors.push(`Modul-id „${m.id}“ doppelt`);
      ids.add(m.id);
      for (const p of m.prozesse || []) {
        if (procs.has(p.id)) errors.push(`Prozess-id „${p.id}“ in mehreren Modulen oder im Kern`);
        procs.add(p.id);
      }
      for (const ins of m.einhaengen || []) for (const s of ins.schritte || []) {
        const key = `${ins.prozess}:${s.id}`;
        if (inserted.has(key)) errors.push(`Schritt „${key}“ wird von mehreren Modulen eingehängt`);
        inserted.add(key);
      }
    }
    return errors;
  }

  /** The processes the office sees for one client: the core plus the chosen modules.
   * A core step is hidden only when every chosen module hides it, so "Handwerk mit
   * Ladengeschäft" keeps the Angebot step the Ladengeschäft module would drop. */
  function resolveFramework(core, modules, selected) {
    const chosen = (selected || []).map((id) => modules.find((m) => m.id === id)).filter(Boolean);
    const prozesse = core.prozesse.map((p) => ({
      id: p.id, name: p.name, modul: null,
      schritte: p.schritte.map((s) => ({ id: s.id, name: s.name, modul: null })),
    }));
    for (const m of chosen) {
      for (const ins of m.einhaengen || []) {
        const p = prozesse.find((x) => x.id === ins.prozess);
        if (!p) continue;
        let i = p.schritte.findIndex((s) => s.id === ins.nach && !s.modul);
        if (i < 0) continue;
        while (i + 1 < p.schritte.length && p.schritte[i + 1].nach === ins.nach) i += 1;
        p.schritte.splice(i + 1, 0, ...ins.schritte.map((s) => ({ id: s.id, name: s.name, modul: m.id, nach: ins.nach })));
      }
      for (const p of m.prozesse || []) {
        prozesse.push({ id: p.id, name: p.name, modul: m.id, schritte: p.schritte.map((s) => ({ id: s.id, name: s.name, modul: m.id })) });
      }
    }
    if (chosen.length) {
      const hiddenBy = (key) => chosen.every((m) => (m.ausblenden || []).some((a) => `${a.prozess}:${a.schritt}` === key));
      for (const p of prozesse) p.schritte = p.schritte.filter((s) => s.modul || !hiddenBy(`${p.id}:${s.id}`));
    }
    const fw = { module: chosen.map((m) => m.id), prozesse };
    fw.prozess = (id) => prozesse.find((p) => p.id === id) || null;
    fw.hasStep = (pid, sid) => { const p = fw.prozess(pid); return !!p && p.schritte.some((s) => s.id === sid); };
    return fw;
  }

  /** Catalog entries plus what the chosen modules suggest. */
  function mergedCatalog(catalog, modules, selected) {
    const chosen = modules.filter((m) => (selected || []).includes(m.id));
    return {
      rollen: catalog.rollen || [],
      datenobjekte: [...catalog.datenobjekte, ...chosen.flatMap((m) => (m.datenobjekte || []).map((o) => ({ ...o, modul: m.id })))],
      software: [...catalog.software, ...chosen.flatMap((m) => (m.software || []).map((s) => ({ ...s, modul: m.id })))],
    };
  }

  /** Catalog file check: required fields, duplicates, valid references, and nothing that
   * looks like client data (software-landkarte.r.katalog-pflege). Module suggestions are
   * checked the same way. */
  function validateCatalog(catalog, core, modules) {
    const errors = [];
    unknownKeys(catalog, ['rollen', 'datenobjekte', 'software'], 'Katalog', errors);
    const rollen = new Set(catalog.rollen || []);
    if (!rollen.size) errors.push('Katalog: rollen fehlt');
    const all = { datenobjekte: [...(catalog.datenobjekte || [])], software: [] };
    for (const m of modules) all.datenobjekte.push(...(m.datenobjekte || []));
    const objIds = new Set();
    const objNames = new Set();
    for (const o of all.datenobjekte) {
      unknownKeys(o, OBJECT_KEYS, `Datenobjekt ${o.id}`, errors);
      if (!SLUG.test(o.id || '') || !o.name) { errors.push(`Datenobjekt ohne id oder name: ${JSON.stringify(o)}`); continue; }
      if (!OBJEKTARTEN[o.art]) errors.push(`Datenobjekt ${o.id}: art muss stamm oder bewegung sein`);
      if (objIds.has(o.id)) errors.push(`Datenobjekt-id „${o.id}“ doppelt`);
      if (objNames.has(o.name.toLowerCase())) errors.push(`Datenobjekt „${o.name}“ doppelt`);
      objIds.add(o.id); objNames.add(o.name.toLowerCase());
    }
    const fwAll = resolveFramework(core, modules, modules.map((m) => m.id));
    // Steps hidden by every module are still valid references.
    const allSteps = new Set();
    for (const p of core.prozesse) for (const s of p.schritte) allSteps.add(`${p.id}:${s.id}`);
    for (const p of fwAll.prozesse) for (const s of p.schritte) allSteps.add(`${p.id}:${s.id}`);
    const swIds = new Set();
    const swNames = new Set();
    const lists = [['Katalog', catalog.software || []], ...modules.map((m) => [`Modul ${m.id}`, m.software || []])];
    for (const [where, list] of lists) for (const sw of list) {
      const w = `${where}/${sw.id}`;
      unknownKeys(sw, SOFTWARE_KEYS, w, errors);
      for (const k of ['id', 'name', 'kategorie', 'art', 'zweck']) if (!sw[k]) errors.push(`${w}: ${k} fehlt`);
      if (sw.art && !ARTEN[sw.art]) errors.push(`${w}: unbekannte art „${sw.art}“`);
      if (swIds.has(sw.id)) errors.push(`Software-id „${sw.id}“ doppelt`);
      if (sw.name && swNames.has(sw.name.toLowerCase())) errors.push(`Software „${sw.name}“ doppelt`);
      swIds.add(sw.id); if (sw.name) swNames.add(sw.name.toLowerCase());
      for (const text of [sw.name, sw.zweck]) if (PERSONAL.some((re) => re.test(text || ''))) errors.push(`${w}: sieht nach Kontaktdaten aus`);
      if (!Array.isArray(sw.aufgaben) || !sw.aufgaben.length) { errors.push(`${w}: keine Aufgaben`); continue; }
      const tIds = new Set();
      for (const t of sw.aufgaben) {
        const tw = `${w}/${t.id}`;
        unknownKeys(t, TASK_KEYS, tw, errors);
        if (!t.id || !t.name) errors.push(`${tw}: id oder name fehlt`);
        if (tIds.has(t.id)) errors.push(`${w}: Aufgaben-id „${t.id}“ doppelt`);
        tIds.add(t.id);
        if (!rollen.has(t.rolle)) errors.push(`${tw}: Rolle „${t.rolle}“ steht nicht in rollen`);
        if (!HAEUFIGKEITEN[t.haeufigkeit]) errors.push(`${tw}: unbekannte Häufigkeit „${t.haeufigkeit}“`);
        for (const o of [...(t.liest || []), ...(t.schreibt || [])]) if (!objIds.has(o)) errors.push(`${tw}: unbekanntes Datenobjekt „${o}“`);
        if (t.schritt && !allSteps.has(t.schritt)) errors.push(`${tw}: unbekannter Prozessschritt „${t.schritt}“`);
      }
    }
    return errors;
  }

  // ---------------------------------------------------------------- state

  function emptyState() {
    const d = today();
    return {
      format: FORMAT, formatVersion: FORMAT_VERSION,
      meta: { betrieb: '', module: [], erstellt: d, geaendert: d, version: 1, vorgaenger: [] },
      systems: [], objects: [], matrix: {}, tasks: [], flows: [], order: {},
      durchgang: null,
    };
  }

  function normalize(s) {
    const base = emptyState();
    const out = { ...base, ...s, meta: { ...base.meta, ...(s.meta || {}) } };
    for (const k of ['systems', 'objects', 'tasks', 'flows']) out[k] = Array.isArray(out[k]) ? out[k] : [];
    out.matrix = out.matrix || {};
    out.order = out.order || {};
    out.tasks.forEach((t) => { t.liest = t.liest || []; t.schreibt = t.schreibt || []; t.schritte = t.schritte || []; });
    out.systems.forEach((x) => { x.rollen = x.rollen || []; });
    out.format = FORMAT; out.formatVersion = FORMAT_VERSION;
    return out;
  }

  /** Result file with a format version (software-landkarte.r.zwischenstand). */
  function toFile(state) {
    return JSON.stringify({ ...state, format: FORMAT, formatVersion: FORMAT_VERSION }, null, 2);
  }

  function fromFile(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Die Datei ist kein gültiges JSON.'); }
    if (!data || data.format !== FORMAT) throw new Error('Die Datei ist keine Software-Landkarte.');
    if (typeof data.formatVersion !== 'number') throw new Error('Die Datei hat keine Formatversion.');
    if (data.formatVersion > FORMAT_VERSION) throw new Error(`Die Datei hat Formatversion ${data.formatVersion}; dieses Werkzeug kennt nur bis ${FORMAT_VERSION}.`);
    return normalize(data);
  }

  const touch = (state) => { state.meta.geaendert = today(); return state; };
  const istSystems = (state) => state.systems.filter((s) => !s.zielsystem);
  const sysById = (state, id) => state.systems.find((s) => s.id === id);
  const objById = (state, id) => state.objects.find((o) => o.id === id);
  const taskById = (state, id) => state.tasks.find((t) => t.id === id);

  // Systems (software-landkarte.r.systeme)
  function addSystem(state, { name, art = 'lokal', zweck = '', rollen = [], catalogId = null }) {
    if (!name || !String(name).trim()) throw new Error('Ein System braucht einen Namen.');
    if (!ARTEN[art]) throw new Error(`Unbekannte Art „${art}“.`);
    const sys = { id: uid('sys'), name: String(name).trim(), art, zweck, rollen: [...rollen], catalogId, zielsystem: false, durchgang: null };
    state.systems.push(sys);
    touch(state);
    return sys;
  }

  function updateSystem(state, id, patch) {
    const sys = sysById(state, id);
    if (patch.art && !ARTEN[patch.art]) throw new Error(`Unbekannte Art „${patch.art}“.`);
    Object.assign(sys, patch);
    return touch(state), sys;
  }

  function removeSystem(state, id) {
    state.systems = state.systems.filter((s) => s.id !== id);
    state.tasks = state.tasks.filter((t) => t.systemId !== id);
    state.flows = state.flows.filter((f) => f.from !== id && f.to !== id);
    for (const row of Object.values(state.matrix)) delete row[id];
    for (const o of state.objects) if (o.zielFuehrend === id) o.zielFuehrend = null;
    touch(state);
  }

  function ensureObject(state, cat, objId) {
    let obj = objById(state, objId);
    if (obj) return obj;
    const entry = cat.datenobjekte.find((o) => o.id === objId);
    if (!entry) throw new Error(`Unbekanntes Datenobjekt „${objId}“.`);
    obj = { id: entry.id, name: entry.name, art: entry.art, catalogId: entry.id, zielFuehrend: null };
    state.objects.push(obj);
    return obj;
  }

  function addObject(state, { name, art = 'stamm' }) {
    if (!name || !String(name).trim()) throw new Error('Ein Datenobjekt braucht einen Namen.');
    const obj = { id: uid('obj'), name: String(name).trim(), art, catalogId: null, zielFuehrend: null };
    state.objects.push(obj);
    touch(state);
    return obj;
  }

  function removeObject(state, id) {
    state.objects = state.objects.filter((o) => o.id !== id);
    delete state.matrix[id];
    state.flows = state.flows.filter((f) => f.objectId !== id);
    for (const t of state.tasks) { t.liest = t.liest.filter((x) => x !== id); t.schreibt = t.schreibt.filter((x) => x !== id); }
    touch(state);
  }

  /** Adds a catalog system; its typical tasks come along unless a subset is given. */
  function addSystemFromCatalog(state, cat, softwareId, fw, taskIds) {
    const sw = cat.software.find((s) => s.id === softwareId);
    if (!sw) throw new Error(`Unbekannte Software „${softwareId}“.`);
    const rollen = [...new Set(sw.aufgaben.map((t) => t.rolle))];
    const sys = addSystem(state, { name: sw.name, art: sw.art, zweck: sw.zweck, rollen, catalogId: sw.id });
    for (const t of sw.aufgaben) if (!taskIds || taskIds.includes(t.id)) addCatalogTask(state, cat, sys.id, t.id, fw);
    return sys;
  }

  function catalogTasksFor(cat, sys) {
    const sw = sys && sys.catalogId ? cat.software.find((s) => s.id === sys.catalogId) : null;
    return sw ? sw.aufgaben : [];
  }

  /** Where the catalog points a task to a process step, the tool proposes that
   * assignment (software-landkarte.r.prozess-baukasten). */
  function suggestProcess(ref, fw) {
    if (!ref || !fw) return null;
    const [pid, sid] = ref.split(':');
    return fw.hasStep(pid, sid) ? { prozess: pid, schritt: sid } : null;
  }

  // Tasks (software-landkarte.r.aufgaben)
  function addTask(state, { name, systemId, rolle = '', haeufigkeit = 'bedarf', liest = [], schreibt = [], catalogRef = null, schrittRef = null }, fw) {
    if (!name || !String(name).trim()) throw new Error('Eine Aufgabe braucht eine Bezeichnung.');
    if (!sysById(state, systemId)) throw new Error('Unbekanntes System.');
    if (!HAEUFIGKEITEN[haeufigkeit]) throw new Error(`Unbekannte Häufigkeit „${haeufigkeit}“.`);
    const sug = suggestProcess(schrittRef, fw);
    const task = {
      id: uid('task'), name: String(name).trim(), systemId, rolle, haeufigkeit,
      liest: [...liest], schreibt: [...schreibt], schritte: [],
      prozess: sug ? sug.prozess : null, schritt: sug ? sug.schritt : null,
      catalogRef, schrittRef, ziel: null, durchgang: null, quelle: 'kanzlei',
    };
    state.tasks.push(task);
    touch(state);
    return task;
  }

  function addCatalogTask(state, cat, systemId, catTaskId, fw) {
    const sys = sysById(state, systemId);
    const t = catalogTasksFor(cat, sys).find((x) => x.id === catTaskId);
    if (!t) throw new Error(`Unbekannte Katalogaufgabe „${catTaskId}“.`);
    const ref = `${sys.catalogId}/${t.id}`;
    const existing = state.tasks.find((x) => x.systemId === systemId && x.catalogRef === ref);
    if (existing) return existing;
    for (const o of [...(t.liest || []), ...(t.schreibt || [])]) ensureObject(state, cat, o);
    return addTask(state, {
      name: t.name, systemId, rolle: t.rolle, haeufigkeit: t.haeufigkeit,
      liest: t.liest || [], schreibt: t.schreibt || [], catalogRef: ref, schrittRef: t.schritt || null,
    }, fw);
  }

  /** Switches one proposed catalog task on or off. */
  function toggleCatalogTask(state, cat, systemId, catTaskId, on, fw) {
    const sys = sysById(state, systemId);
    const ref = `${sys.catalogId}/${catTaskId}`;
    if (on) return addCatalogTask(state, cat, systemId, catTaskId, fw);
    state.tasks.filter((t) => t.systemId === systemId && t.catalogRef === ref).forEach((t) => removeTask(state, t.id));
    return null;
  }

  function updateTask(state, id, patch) {
    const t = taskById(state, id);
    if (patch.haeufigkeit && !HAEUFIGKEITEN[patch.haeufigkeit]) throw new Error('Unbekannte Häufigkeit.');
    Object.assign(t, patch);
    return touch(state), t;
  }

  function removeTask(state, id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    for (const k of Object.keys(state.order)) state.order[k] = state.order[k].filter((x) => x !== id);
    touch(state);
  }

  /** Second level of a task, only where needed (software-landkarte.d.aufgabentiefe). */
  function addStep(state, taskId, name) {
    const t = taskById(state, taskId);
    if (!name || !String(name).trim()) throw new Error('Ein Schritt braucht eine Bezeichnung.');
    const step = { id: uid('step'), name: String(name).trim() };
    t.schritte.push(step);
    return touch(state), step;
  }

  function removeStep(state, taskId, stepId) {
    const t = taskById(state, taskId);
    t.schritte = t.schritte.filter((s) => s.id !== stepId);
    touch(state);
  }

  // Data objects and leading system (software-landkarte.r.datenobjekte)
  function setCell(state, objId, sysId, value) {
    if (!(value in ZELLEN)) throw new Error(`Unbekannter Wert „${value}“.`);
    const row = state.matrix[objId] || (state.matrix[objId] = {});
    if (value) row[sysId] = value; else delete row[sysId];
    touch(state);
  }

  const cell = (state, objId, sysId) => (state.matrix[objId] || {})[sysId] || '';

  function leaders(state, objId) {
    return istSystems(state).filter((s) => cell(state, objId, s.id) === 'fuehrt').map((s) => s.id);
  }

  /** ok, doppelt (more than one leading system) or luecke (none). */
  function objectStatus(state, objId) {
    const n = leaders(state, objId).length;
    return n > 1 ? 'doppelt' : n === 0 ? 'luecke' : 'ok';
  }

  // Flows and media breaks (software-landkarte.r.datenfluesse)
  function addFlow(state, { objectId, from, to, art = 'schnittstelle', haeufigkeit = 'monatlich', aufwand = null }) {
    if (!objById(state, objectId)) throw new Error('Unbekanntes Datenobjekt.');
    if (!sysById(state, from) || !sysById(state, to)) throw new Error('Unbekanntes System.');
    if (from === to) throw new Error('Ein Fluss verbindet zwei verschiedene Systeme.');
    if (!FLUSSARTEN[art]) throw new Error(`Unbekannte Art „${art}“.`);
    const flow = { id: uid('flow'), objectId, from, to, art, haeufigkeit, aufwand };
    state.flows.push(flow);
    return touch(state), flow;
  }

  function updateFlow(state, id, patch) {
    const f = state.flows.find((x) => x.id === id);
    Object.assign(f, patch);
    return touch(state), f;
  }

  function removeFlow(state, id) {
    state.flows = state.flows.filter((f) => f.id !== id);
    touch(state);
  }

  const isMedienbruch = (flow) => MEDIENBRUCH.has(flow.art);

  /** A task writes an object into a system that does not lead it: the data has to come
   * from the leading system, so propose that flow unless it is already there. */
  function suggestFlows(state) {
    const out = [];
    const seen = new Set();
    for (const t of state.tasks) {
      const sys = sysById(state, t.systemId);
      if (!sys || sys.zielsystem) continue;
      for (const o of t.schreibt) {
        if (cell(state, o, t.systemId) === 'fuehrt') continue;
        for (const l of leaders(state, o)) {
          const key = `${o}|${l}|${t.systemId}`;
          if (l === t.systemId || seen.has(key)) continue;
          if (state.flows.some((f) => f.objectId === o && f.from === l && f.to === t.systemId)) continue;
          seen.add(key);
          out.push({ objectId: o, from: l, to: t.systemId, taskId: t.id });
        }
      }
    }
    return out;
  }

  /** Media breaks, largest effort first, with the monthly sum (software-landkarte.r.aufwand). */
  function medienbrueche(state) {
    const list = state.flows.filter(isMedienbruch).slice()
      .sort((a, b) => (Number(b.aufwand) || 0) - (Number(a.aufwand) || 0));
    const summe = list.reduce((n, f) => n + (Number(f.aufwand) || 0), 0);
    return { list, summe };
  }

  /** Media breaks a task runs into: manual or paper flows arriving in its system for an
   * object it reads or writes. */
  function taskBreaks(state, task) {
    const objs = new Set([...task.liest, ...task.schreibt]);
    return state.flows.filter((f) => isMedienbruch(f) && f.to === task.systemId && objs.has(f.objectId));
  }

  /** Where the second level pays off: a media break or double maintenance. */
  function needsSteps(state, task) {
    return taskBreaks(state, task).length > 0 || task.schreibt.some((o) => objectStatus(state, o) === 'doppelt');
  }

  // Processes (software-landkarte.r.prozesse)
  function assignTask(state, taskId, prozess, schritt) {
    const t = taskById(state, taskId);
    for (const k of Object.keys(state.order)) state.order[k] = state.order[k].filter((x) => x !== taskId);
    t.prozess = prozess || null;
    t.schritt = prozess ? schritt || null : null;
    touch(state);
  }

  function inFramework(task, fw) {
    const p = fw.prozess(task.prozess);
    return !!p && (!task.schritt || p.schritte.some((s) => s.id === task.schritt));
  }

  /** Tasks of one process in order: by step, then by the office's own order. */
  function sequence(state, fw, procId) {
    const p = fw.prozess(procId);
    if (!p) return [];
    const tasks = state.tasks.filter((t) => t.prozess === procId && inFramework(t, fw) && !(sysById(state, t.systemId) || {}).zielsystem);
    const idx = (t) => { const i = p.schritte.findIndex((s) => s.id === t.schritt); return i < 0 ? p.schritte.length : i; };
    const order = state.order[procId] || [];
    const listed = order.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
    const rest = tasks.filter((t) => !order.includes(t.id)).sort((a, b) => idx(a) - idx(b));
    for (const r of rest) {
      const at = listed.findIndex((l) => idx(l) > idx(r));
      if (at < 0) listed.push(r); else listed.splice(at, 0, r);
    }
    return listed;
  }

  function moveInSequence(state, fw, procId, taskId, delta) {
    const seq = sequence(state, fw, procId).map((t) => t.id);
    const i = seq.indexOf(taskId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= seq.length) return;
    [seq[i], seq[j]] = [seq[j], seq[i]];
    state.order[procId] = seq;
    touch(state);
  }

  /** "Sonstiges": tasks that fit no process of the chosen framework stay visible. */
  function unassigned(state, fw) {
    return state.tasks.filter((t) => !inFramework(t, fw) && !(sysById(state, t.systemId) || {}).zielsystem);
  }

  /** Swimlane data for one process (software-landkarte.d.darstellung): systems as lanes,
   * steps as columns in order (tasks of the same step in different systems share one),
   * media breaks marked. */
  function swimlane(state, fw, procId) {
    const seq = sequence(state, fw, procId);
    const used = new Set(seq.map((t) => t.systemId));
    const lanes = state.systems.filter((s) => used.has(s.id));
    const columns = [];
    for (const t of seq) {
      const last = columns[columns.length - 1];
      const item = { task: t, breaks: taskBreaks(state, t) };
      if (last && t.schritt && last.schritt === t.schritt && !last.items.some((i) => i.task.systemId === t.systemId)) {
        last.items.push(item);
        continue;
      }
      let uebergang = null;
      const prev = last ? last.items.map((i) => i.task.systemId).filter((id) => id !== t.systemId) : [];
      if (prev.length && last.items.every((i) => i.task.systemId !== t.systemId)) {
        const flows = state.flows.filter((f) => prev.includes(f.from) && f.to === t.systemId);
        uebergang = { from: prev, to: t.systemId, flows, medienbruch: flows.some(isMedienbruch) };
      }
      columns.push({ schritt: t.schritt, items: [item], uebergang });
    }
    return { prozess: fw.prozess(procId), lanes, columns };
  }

  // Target picture (software-landkarte.r.zielbild, software-landkarte.d.zielbild)
  const zielsysteme = (state) => state.systems.filter((s) => s.zielsystem);

  function setZielsystem(state, sysId, on) {
    const sys = sysById(state, sysId);
    sys.zielsystem = !!on;
    if (on) {
      // A target system is not in use yet: it holds no current data.
      for (const row of Object.values(state.matrix)) delete row[sysId];
    }
    touch(state);
  }

  function setTaskZiel(state, taskId, ziel) {
    if (ziel && !ZIELE[ziel]) throw new Error(`Unbekannter Wert „${ziel}“.`);
    taskById(state, taskId).ziel = ziel || null;
    touch(state);
  }

  function setZielFuehrend(state, objId, sysId) {
    objById(state, objId).zielFuehrend = sysId || null;
    touch(state);
  }

  /** The changeover list: what moves, which flows need an interface, which systems can
   * be switched off, and what is still open. */
  function umstellungsliste(state) {
    const ziel = zielsysteme(state);
    const zielIds = new Set(ziel.map((s) => s.id));
    const ist = istSystems(state);
    const tasks = state.tasks.filter((t) => !zielIds.has(t.systemId));
    const leadsInTarget = (sysId) => state.objects.some((o) => o.zielFuehrend === sysId);
    const abschalten = ist.filter((s) => {
      const own = tasks.filter((t) => t.systemId === s.id);
      return own.length > 0 && own.every((t) => t.ziel === 'wandert' || t.ziel === 'entfaellt') && !leadsInTarget(s.id);
    });
    const off = new Set(abschalten.map((s) => s.id));
    const bleiben = ist.filter((s) => !off.has(s.id));
    // Where each task runs in the target picture.
    const target = (t) => (t.ziel === 'entfaellt' ? null : t.ziel === 'wandert' ? (ziel[0] || {}).id || null : t.systemId);
    const schnittstellen = [];
    for (const o of state.objects) {
      const f = o.zielFuehrend;
      if (!f) continue;
      const users = new Set();
      for (const t of tasks) {
        const where = target(t);
        if (where && where !== f && !off.has(where) && (t.liest.includes(o.id) || t.schreibt.includes(o.id))) users.add(where);
      }
      for (const to of users) {
        const besteht = state.flows.some((x) => x.objectId === o.id && x.from === f && x.to === to && x.art === 'schnittstelle');
        schnittstellen.push({ objectId: o.id, from: f, to, besteht });
      }
    }
    const umziehenObjekte = state.objects
      .filter((o) => o.zielFuehrend && zielIds.has(o.zielFuehrend))
      .map((o) => ({ objectId: o.id, von: leaders(state, o.id), nach: o.zielFuehrend }));
    const offenAufgaben = tasks.filter((t) => !t.ziel || t.ziel === 'unklar');
    const offenObjekte = state.objects.filter((o) => !o.zielFuehrend);
    return {
      zielsysteme: ziel,
      umziehen: { aufgaben: tasks.filter((t) => t.ziel === 'wandert'), datenobjekte: umziehenObjekte },
      bleiben: { aufgaben: tasks.filter((t) => t.ziel === 'bleibt'), systeme: bleiben },
      entfallen: tasks.filter((t) => t.ziel === 'entfaellt'),
      abschalten,
      schnittstellen,
      offen: { aufgaben: offenAufgaben, datenobjekte: offenObjekte },
      vollstaendig: offenAufgaben.length === 0 && offenObjekte.length === 0,
    };
  }

  /** After the changeover the target picture becomes the new current map
   * (software-landkarte.r.zwischenstand: the old map is the starting point). */
  function adoptTarget(state) {
    const ziel = zielsysteme(state);
    if (!ziel.length) throw new Error('Es gibt kein Zielsystem.');
    const u = umstellungsliste(state);
    const next = clone(state);
    const off = new Set(u.abschalten.map((s) => s.id));
    next.meta.vorgaenger = [...(state.meta.vorgaenger || []), {
      version: state.meta.version, bis: today(),
      systeme: istSystems(state).map((s) => s.name), abgeschaltet: u.abschalten.map((s) => s.name),
    }];
    next.meta.version = (state.meta.version || 1) + 1;
    next.tasks = next.tasks.filter((t) => t.ziel !== 'entfaellt' && !off.has(t.systemId));
    for (const t of next.tasks) {
      if (t.ziel === 'wandert') t.systemId = ziel[0].id;
      t.ziel = null; t.durchgang = null;
    }
    next.systems = next.systems.filter((s) => !off.has(s.id));
    for (const s of next.systems) { s.zielsystem = false; s.durchgang = null; }
    next.flows = next.flows.filter((f) => !off.has(f.from) && !off.has(f.to));
    for (const row of Object.values(next.matrix)) for (const id of off) delete row[id];
    for (const o of next.objects) {
      if (!o.zielFuehrend) continue;
      const row = next.matrix[o.id] || (next.matrix[o.id] = {});
      for (const [sid, v] of Object.entries(row)) if (v === 'fuehrt' && sid !== o.zielFuehrend) row[sid] = 'liest';
      row[o.zielFuehrend] = 'fuehrt';
      o.zielFuehrend = null;
    }
    for (const sx of u.schnittstellen) {
      if (sx.besteht || off.has(sx.from) || off.has(sx.to)) continue;
      next.flows.push({ id: uid('flow'), objectId: sx.objectId, from: sx.from, to: sx.to, art: 'schnittstelle', haeufigkeit: 'taeglich', aufwand: null });
    }
    next.durchgang = null;
    next.order = {};
    return touch(next);
  }

  // Client walkthrough (software-landkarte.r.mandanten-durchgang)
  /** What goes into the client file: only systems and tasks for the cards. */
  function clientPayload(state) {
    const fileId = uid('dg');
    const systems = istSystems(state).map((s) => ({ id: s.id, name: s.name, art: s.art, zweck: s.zweck, rollen: s.rollen }));
    const ids = new Set(systems.map((s) => s.id));
    const tasks = state.tasks.filter((t) => ids.has(t.systemId))
      .map((t) => ({ id: t.id, name: t.name, systemId: t.systemId, rolle: t.rolle, haeufigkeit: t.haeufigkeit }));
    state.durchgang = { fileId, erzeugt: today(), eingelesen: null, ergaenzungen: [] };
    touch(state);
    return { format: CLIENT_FORMAT, formatVersion: FORMAT_VERSION, fileId, betrieb: state.meta.betrieb, erzeugt: today(), systems, tasks };
  }

  /** Cards: one per system, then its tasks, then the closing question. */
  function cards(payload) {
    const out = [];
    for (const s of payload.systems) {
      out.push({ key: `system:${s.id}`, kind: 'system', system: s });
      for (const t of payload.tasks.filter((x) => x.systemId === s.id)) out.push({ key: `task:${t.id}`, kind: 'task', task: t, system: s });
    }
    out.push({ key: 'ergaenzungen', kind: 'ergaenzungen' });
    return out;
  }

  function answer(answers, key, wert, text) {
    if (!wert) { delete answers[key]; return answers; }
    if (!ANTWORTEN[wert]) throw new Error(`Unbekannte Antwort „${wert}“.`);
    answers[key] = wert === 'anders' ? { wert, text: text || '' } : { wert };
    return answers;
  }

  function progress(payload, answers) {
    const all = cards(payload).filter((c) => c.kind !== 'ergaenzungen');
    const done = all.filter((c) => answers[c.key]).length;
    return { done, total: all.length, percent: all.length ? Math.round((100 * done) / all.length) : 100 };
  }

  function clientResult(payload, answers, ergaenzungen) {
    return {
      format: RESULT_FORMAT, formatVersion: FORMAT_VERSION, fileId: payload.fileId, betrieb: payload.betrieb,
      datum: today(), antworten: clone(answers), ergaenzungen: (ergaenzungen || []).filter((e) => String(e).trim()),
    };
  }

  /** Reads the client's answers back into the office's map, so deviations, additions
   * and "unsicher" show up marked. */
  function importResult(state, result) {
    if (!result || result.format !== RESULT_FORMAT) throw new Error('Die Datei ist kein Ergebnis eines Durchgangs.');
    if (result.formatVersion > FORMAT_VERSION) throw new Error('Das Ergebnis stammt aus einer neueren Version.');
    const warnings = [];
    if (!state.durchgang || state.durchgang.fileId !== result.fileId) warnings.push('Das Ergebnis gehört zu einer anderen Mandanten-Datei als der zuletzt erzeugten. Übernommen wird, was zu den vorhandenen Systemen und Aufgaben passt.');
    let n = 0;
    for (const [key, a] of Object.entries(result.antworten || {})) {
      const [kind, id] = key.split(':');
      const target = kind === 'system' ? sysById(state, id) : kind === 'task' ? taskById(state, id) : null;
      if (!target) continue;
      target.durchgang = { wert: a.wert, text: a.text || '', erledigt: false };
      n += 1;
    }
    state.durchgang = state.durchgang || { fileId: result.fileId, erzeugt: null, ergaenzungen: [] };
    state.durchgang.eingelesen = today();
    state.durchgang.ergaenzungen = [
      ...(state.durchgang.ergaenzungen || []),
      ...(result.ergaenzungen || []).map((text) => ({ id: uid('erg'), text: String(text), erledigt: false })),
    ];
    touch(state);
    return { uebernommen: n, ergaenzungen: (result.ergaenzungen || []).length, warnings };
  }

  function durchgangBefunde(state) {
    const items = [
      ...state.systems.map((s) => ({ kind: 'system', item: s, label: s.name })),
      ...state.tasks.map((t) => ({ kind: 'task', item: t, label: `${t.name} (${(sysById(state, t.systemId) || {}).name || '?'})` })),
    ].filter((x) => x.item.durchgang && !x.item.durchgang.erledigt);
    return {
      anders: items.filter((x) => x.item.durchgang.wert === 'anders'),
      unsicher: items.filter((x) => x.item.durchgang.wert === 'unsicher'),
      ergaenzungen: ((state.durchgang && state.durchgang.ergaenzungen) || []).filter((e) => !e.erledigt),
    };
  }

  // Findings for the report (software-landkarte.r.bericht)
  function befunde(state, fw) {
    const mb = medienbrueche(state);
    const dg = durchgangBefunde(state);
    return {
      medienbrueche: mb.list, aufwandSumme: mb.summe,
      doppelt: state.objects.filter((o) => objectStatus(state, o.id) === 'doppelt'),
      luecken: state.objects.filter((o) => objectStatus(state, o.id) === 'luecke'),
      offeneFragen: [
        ...dg.unsicher.map((x) => ({ quelle: 'Durchgang', text: `Unsicher: ${x.label}` })),
        ...dg.ergaenzungen.map((e) => ({ quelle: 'Durchgang', text: `Ergänzung des Mandanten: ${e.text}` })),
      ],
      abweichungen: dg.anders,
      ohneProzess: unassigned(state, fw),
    };
  }

  // CSV for Excel (software-landkarte.d.ergebnisformat): semicolon, as German Excel expects.
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';

  function matrixCsv(state) {
    const sys = istSystems(state);
    const ziel = zielsysteme(state).length > 0;
    const head = ['Datenobjekt', 'Art', ...sys.map((s) => s.name), 'Befund', ...(ziel ? ['Künftig führend'] : [])];
    const label = { ok: '', doppelt: 'doppelte Pflege', luecke: 'kein führendes System' };
    const rows = state.objects.map((o) => [
      o.name, OBJEKTARTEN[o.art] || '', ...sys.map((s) => (cell(state, o.id, s.id) ? ZELLEN[cell(state, o.id, s.id)] : '')),
      label[objectStatus(state, o.id)], ...(ziel ? [(sysById(state, o.zielFuehrend) || {}).name || 'offen'] : []),
    ]);
    return csvRows([head, ...rows]);
  }

  function aufgabenCsv(state, fw) {
    const name = (id) => (objById(state, id) || {}).name || id;
    const head = ['Aufgabe', 'System', 'Rolle', 'Häufigkeit', 'Liest', 'Schreibt', 'Prozess', 'Schritt', 'Teilschritte', 'Zielbild', 'Durchgang'];
    const rows = state.tasks.filter((t) => !(sysById(state, t.systemId) || {}).zielsystem).map((t) => {
      const p = inFramework(t, fw) ? fw.prozess(t.prozess) : null;
      const step = p && t.schritt ? (p.schritte.find((s) => s.id === t.schritt) || {}).name : '';
      return [
        t.name, (sysById(state, t.systemId) || {}).name, t.rolle, HAEUFIGKEITEN[t.haeufigkeit],
        t.liest.map(name).join(', '), t.schreibt.map(name).join(', '), p ? p.name : 'ohne Prozess', step || '',
        t.schritte.map((s) => s.name).join(' → '), t.ziel ? ZIELE[t.ziel] : '',
        t.durchgang ? ANTWORTEN[t.durchgang.wert] + (t.durchgang.text ? `: ${t.durchgang.text}` : '') : '',
      ];
    });
    return csvRows([head, ...rows]);
  }

  /** JSON inside an inline script element: escape every "<" so no closing tag or comment can end it. */
  const scriptJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

  const SL = {
    FORMAT, FORMAT_VERSION, CLIENT_FORMAT, RESULT_FORMAT,
    ARTEN, HAEUFIGKEITEN, ZELLEN, FLUSSARTEN, ZIELE, ANTWORTEN, OBJEKTARTEN,
    uid, today, clone, scriptJson,
    validateCore, validateModule, validateModules, validateCatalog, resolveFramework, mergedCatalog,
    emptyState, normalize, toFile, fromFile,
    istSystems, sysById, objById, taskById,
    addSystem, updateSystem, removeSystem, addSystemFromCatalog, catalogTasksFor,
    ensureObject, addObject, removeObject,
    addTask, addCatalogTask, toggleCatalogTask, updateTask, removeTask, addStep, removeStep, suggestProcess,
    setCell, cell, leaders, objectStatus,
    addFlow, updateFlow, removeFlow, isMedienbruch, suggestFlows, medienbrueche, taskBreaks, needsSteps,
    assignTask, inFramework, sequence, moveInSequence, unassigned, swimlane,
    zielsysteme, setZielsystem, setTaskZiel, setZielFuehrend, umstellungsliste, adoptTarget,
    clientPayload, cards, answer, progress, clientResult, importResult, durchgangBefunde,
    befunde, matrixCsv, aufgabenCsv,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SL;
  else root.SL = SL;
})(typeof globalThis !== 'undefined' ? globalThis : this);
