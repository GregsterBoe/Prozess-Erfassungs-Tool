/* Software-Landkarte: the user interface. One file, two modes
 * (software-landkarte.d.werkzeugform): the office mode to capture and evaluate, and the
 * client mode that only shows the walkthrough cards. */
(function () {
  'use strict';
  const SL = window.SL;
  const DATA = JSON.parse(document.getElementById('sl-data').textContent);
  const EMBED = JSON.parse(document.getElementById('sl-embed').textContent);
  // The untouched page, captured before anything renders: the client file is a copy of it.
  const PRISTINE = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  // Split so the closing tag never appears literally inside this inline script.
  const END = '</' + 'script>';
  const EMBED_TAG = `<script id="sl-embed" type="application/json">null${END}`;
  const app = document.getElementById('app');
  const reportStyle = document.createElement('style');
  reportStyle.textContent = SL.report.REPORT_CSS;
  document.head.append(reportStyle);

  // ------------------------------------------------------------ helpers

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else if (k === 'k') el.dataset.k = v;
      else if (k === 'html') el.innerHTML = v; // only for strings built by SL.report, which escapes
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }

  const options = (map, current, empty) => [
    empty != null ? h('option', { value: '' }, empty) : null,
    ...Object.entries(map).filter(([k]) => k !== '').map(([k, label]) => h('option', { value: k, selected: k === current }, label)),
  ];

  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = h('a', { href: URL.createObjectURL(blob), download: name, class: 'no-print' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function pickFile(accept, onText) {
    const input = h('input', { type: 'file', accept, style: 'display:none' });
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { onText(String(r.result)); } catch (e) { toast(e.message); } input.remove(); };
      r.readAsText(f);
    });
    document.body.append(input);
    input.click();
  }

  const slug = (s) => (s || 'landkarte').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 40) || 'landkarte';
  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: keep working without */ } },
  };

  if (EMBED && EMBED.mode === 'mandant') return walkthrough(EMBED.payload);
  office();

  // ------------------------------------------------------------ office mode

  function office() {
    const KEY = 'software-landkarte:kanzlei';
    let state = load();
    let tab = 'betrieb';
    let pending = null;

    function load() {
      const raw = storage.get(KEY);
      if (raw) { try { return SL.fromFile(raw); } catch (e) { /* fall through to a new map */ } }
      return SL.emptyState();
    }
    const fw = () => SL.resolveFramework(DATA.prozesse, DATA.module, state.meta.module);
    const cat = () => SL.mergedCatalog(DATA.katalog, DATA.module, state.meta.module);
    const save = () => storage.set(KEY, SL.toFile(state));

    // Re-render after the event, so a Tab key has already moved focus; focus is restored by data-k.
    function commit() {
      save();
      if (pending) return;
      pending = setTimeout(() => { pending = null; render(); }, 0);
    }
    const act = (fn) => (ev) => { try { fn(ev); commit(); } catch (e) { toast(e.message); } };
    const fileBase = () => `${slug(state.meta.betrieb)}-${SL.today()}`;

    const TABS = [
      ['betrieb', 'Betrieb'], ['systeme', 'Systeme'], ['aufgaben', 'Aufgaben'], ['daten', 'Daten'],
      ['fluesse', 'Flüsse'], ['prozesse', 'Prozesse'], ['zielbild', 'Zielbild'], ['durchgang', 'Durchgang'], ['bericht', 'Bericht'],
    ];

    function render() {
      const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
      const counts = {
        systeme: SL.istSystems(state).length, aufgaben: state.tasks.length, daten: state.objects.length, fluesse: state.flows.length,
      };
      const view = { betrieb, systeme, aufgaben, daten, fluesse, prozesse, zielbild, durchgang, bericht }[tab]();
      app.replaceChildren(
        h('header', { class: 'top' },
          h('h1', {}, 'Software-Landkarte'),
          h('span', { class: 'sub' }, state.meta.betrieb || 'neuer Betrieb', ` · Fassung ${state.meta.version} · Stand ${state.meta.geaendert}`)),
        h('nav', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', {
          role: 'tab', 'aria-selected': String(tab === id), 'data-tab': id,
          onclick: () => { tab = id; render(); window.scrollTo(0, 0); },
        }, label, counts[id] != null ? h('span', { class: 'count' }, counts[id]) : null))),
        h('main', {}, view),
      );
      if (focusKey) {
        const el = app.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
        if (el) el.focus();
      }
    }

    // --- Betrieb

    function betrieb() {
      return [
        h('section', { class: 'panel' },
          h('h2', {}, 'Betrieb'),
          h('div', { class: 'row' },
            h('label', { for: 'betrieb' }, 'Name des Betriebs'),
            h('input', { id: 'betrieb', k: 'betrieb', type: 'text', class: 'grow', value: state.meta.betrieb,
              onchange: act((e) => { state.meta.betrieb = e.target.value.trim(); }) })),
          h('p', { class: 'hint' }, 'Personen werden als Rollen erfasst (Buchhaltung, Inhaber), nicht mit Namen. Die Landkarte bleibt auf diesem Gerät, bis Sie sie speichern und weitergeben.')),
        h('section', { class: 'panel' },
          h('h2', {}, 'Branchenmodule'),
          h('p', { class: 'hint' }, 'Der Kern (Einkauf, Auftrag, Personal, Buchhaltung) gilt immer. Module bringen Prozesse, Schritte, Datenobjekte und Software ihrer Branche mit; mehrere sind möglich.'),
          DATA.module.map((m) => h('div', { class: 'row' }, h('label', {},
            h('input', { type: 'checkbox', 'data-modul': m.id, checked: state.meta.module.includes(m.id),
              onchange: act((e) => {
                const set = new Set(state.meta.module);
                if (e.target.checked) set.add(m.id); else set.delete(m.id);
                state.meta.module = DATA.module.map((x) => x.id).filter((id) => set.has(id));
              }) }),
            ' ', h('b', {}, m.name), m.beschreibung ? ` – ${m.beschreibung}` : '')))),
        h('section', { class: 'panel' },
          h('h2', {}, 'Datei'),
          h('div', { class: 'row' },
            h('button', { class: 'primary', id: 'save-json', onclick: () => download(`${fileBase()}.landkarte.json`, SL.toFile(state), 'application/json') }, 'Landkarte speichern'),
            h('button', { id: 'open-json', onclick: () => pickFile('.json,application/json', (text) => {
              state = SL.fromFile(text); commit(); toast('Landkarte geöffnet.');
            }) }, 'Landkarte öffnen …'),
            h('button', { id: 'new-map', onclick: () => { if (confirm('Neue, leere Landkarte beginnen? Der jetzige Stand geht verloren, wenn er nicht gespeichert ist.')) { state = SL.emptyState(); commit(); } } }, 'Neue Landkarte'),
            h('button', { id: 'load-example', onclick: () => { if (!state.systems.length || confirm('Den erfundenen Beispielbetrieb laden? Der jetzige Stand wird ersetzt.')) { state = SL.normalize(SL.clone(DATA.beispiel)); commit(); } } }, 'Beispielbetrieb laden')),
          h('p', { class: 'hint' }, 'Der Stand wird in diesem Browser automatisch gesichert. Die gespeicherte Datei (.landkarte.json) lässt sich jederzeit wieder öffnen, auch als Ausgangspunkt nach einer Umstellung.'),
          state.meta.vorgaenger.length ? h('div', {}, h('h3', {}, 'Frühere Fassungen'), h('ul', {}, state.meta.vorgaenger.map((v) =>
            h('li', {}, `Fassung ${v.version} bis ${v.bis}: ${v.systeme.length} Systeme`, v.abgeschaltet.length ? `, abgeschaltet: ${v.abgeschaltet.join(', ')}` : ''))))
            : null),
      ];
    }

    // --- Systeme (software-landkarte.r.systeme)

    function catalogSelect(id, filter) {
      const groups = {};
      for (const sw of cat().software.filter(filter || (() => true))) (groups[sw.kategorie] = groups[sw.kategorie] || []).push(sw);
      return h('select', { id, class: 'grow' }, h('option', { value: '' }, '– aus dem Katalog wählen –'),
        Object.entries(groups).map(([g, list]) => h('optgroup', { label: g }, list.map((sw) => h('option', { value: sw.id }, sw.name)))));
    }

    function rolesList() {
      return h('datalist', { id: 'rollen' }, (DATA.katalog.rollen || []).map((r) => h('option', { value: r })));
    }

    function durchgangBadge(item) {
      if (!item.durchgang) return null;
      const d = item.durchgang;
      const cls = d.wert === 'ok' ? 'ok' : d.wert === 'anders' ? 'bad' : 'warn';
      return h('span', { class: `badge ${cls}`, title: d.text || '' }, `Mandant: ${SL.ANTWORTEN[d.wert]}${d.text ? ` – ${d.text}` : ''}${d.erledigt ? ' (erledigt)' : ''}`);
    }

    function systeme() {
      const free = { name: '', art: 'lokal' };
      return [
        rolesList(),
        h('section', { class: 'panel' },
          h('h2', {}, 'System hinzufügen'),
          h('div', { class: 'row' }, catalogSelect('cat-system'),
            h('button', { class: 'primary', id: 'add-cat-system', onclick: act(() => {
              const v = document.getElementById('cat-system').value;
              if (!v) throw new Error('Bitte erst ein System aus dem Katalog wählen.');
              SL.addSystemFromCatalog(state, cat(), v, fw());
            }) }, 'Aus Katalog hinzufügen')),
          h('p', { class: 'hint' }, 'Mit einem Katalogsystem kommen seine typischen Aufgaben; im Reiter Aufgaben lassen sie sich einzeln ab- und anwählen.'),
          h('div', { class: 'row' },
            h('input', { type: 'text', id: 'free-system', class: 'grow', placeholder: 'Eigenes System, z. B. „Preisliste Excel“ oder „Ordner Lieferscheine“', oninput: (e) => { free.name = e.target.value; } }),
            h('select', { id: 'free-system-art', onchange: (e) => { free.art = e.target.value; } }, options(SL.ARTEN, 'lokal')),
            h('button', { id: 'add-free-system', onclick: act(() => SL.addSystem(state, free)) }, 'Anlegen'))),
        h('section', { class: 'panel' },
          h('h2', {}, `Systeme (${state.systems.length})`),
          state.systems.length ? null : h('p', { class: 'hint' }, 'Noch keine Systeme. Auch Excel-Listen, Papier und Postfächer zählen.'),
          state.systems.map((s) => h('div', { class: `card${s.durchgang ? ` flag-${s.durchgang.wert}` : ''}`, 'data-system': s.id },
            h('div', { class: 'row' },
              h('input', { type: 'text', k: `sys-name-${s.id}`, class: 'grow', value: s.name, 'aria-label': 'Name', onchange: act((e) => SL.updateSystem(state, s.id, { name: e.target.value.trim() || s.name })) }),
              h('select', { k: `sys-art-${s.id}`, 'aria-label': 'Art', onchange: act((e) => SL.updateSystem(state, s.id, { art: e.target.value })) }, options(SL.ARTEN, s.art)),
              s.zielsystem ? h('span', { class: 'badge ok' }, 'Zielsystem') : null,
              durchgangBadge(s),
              h('button', { class: 'danger', onclick: act(() => { if (confirm(`„${s.name}“ mit allen Aufgaben und Flüssen entfernen?`)) SL.removeSystem(state, s.id); }) }, 'Entfernen')),
            h('div', { class: 'row' },
              h('input', { type: 'text', k: `sys-zweck-${s.id}`, class: 'grow', value: s.zweck, placeholder: 'Zweck in einem Satz', 'aria-label': 'Zweck', onchange: act((e) => SL.updateSystem(state, s.id, { zweck: e.target.value })) }),
              h('input', { type: 'text', k: `sys-rollen-${s.id}`, class: 'grow', list: 'rollen', value: s.rollen.join(', '), placeholder: 'Rollen, mit Komma getrennt', 'aria-label': 'Rollen', onchange: act((e) => SL.updateSystem(state, s.id, { rollen: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })) }))))),
      ];
    }

    // --- Aufgaben (software-landkarte.r.aufgaben)

    function processSelect(t, f, k) {
      const el = h('select', { k, 'aria-label': 'Prozess und Schritt', 'data-prozess': t.id, onchange: act((e) => {
        const [p, s] = e.target.value.split(':');
        SL.assignTask(state, t.id, p || null, s || null);
      }) },
      h('option', { value: '' }, '– ohne Prozess –'),
      f.prozesse.map((p) => h('optgroup', { label: p.name },
        h('option', { value: `${p.id}:` }, `${p.name} (ohne Schritt)`),
        p.schritte.map((s) => h('option', { value: `${p.id}:${s.id}` }, s.name)))));
      el.value = t.prozess && SL.inFramework(t, f) ? `${t.prozess}:${t.schritt || ''}` : '';
      return el;
    }

    function objectChecks(t, field) {
      if (!state.objects.length) return h('span', { class: 'hint' }, 'Noch keine Datenobjekte (Reiter Daten).');
      return h('div', { class: 'checks' }, state.objects.map((o) => h('label', {},
        h('input', { type: 'checkbox', checked: t[field].includes(o.id), onchange: act((e) => {
          const set = new Set(t[field]);
          if (e.target.checked) set.add(o.id); else set.delete(o.id);
          SL.updateTask(state, t.id, { [field]: [...set] });
        }) }), ' ', o.name)));
    }

    function taskCard(t, f) {
      const breaks = SL.taskBreaks(state, t);
      const hint = SL.needsSteps(state, t);
      let stepName = '';
      return h('div', { class: `card${t.durchgang ? ` flag-${t.durchgang.wert}` : ''}`, 'data-task': t.id },
        h('div', { class: 'row' },
          h('input', { type: 'text', k: `task-name-${t.id}`, class: 'grow', value: t.name, 'aria-label': 'Bezeichnung', onchange: act((e) => SL.updateTask(state, t.id, { name: e.target.value.trim() || t.name })) }),
          h('input', { type: 'text', k: `task-rolle-${t.id}`, list: 'rollen', value: t.rolle, placeholder: 'Rolle', 'aria-label': 'Rolle', size: 12, onchange: act((e) => SL.updateTask(state, t.id, { rolle: e.target.value.trim() })) }),
          h('select', { k: `task-hf-${t.id}`, 'aria-label': 'Häufigkeit', onchange: act((e) => SL.updateTask(state, t.id, { haeufigkeit: e.target.value })) }, options(SL.HAEUFIGKEITEN, t.haeufigkeit)),
          processSelect(t, f, `task-proc-${t.id}`),
          breaks.length ? h('span', { class: 'badge bad' }, `Medienbruch (${breaks.length})`) : null,
          durchgangBadge(t),
          h('button', { class: 'danger', 'aria-label': `Aufgabe ${t.name} entfernen`, onclick: act(() => SL.removeTask(state, t.id)) }, '×')),
        h('details', {},
          h('summary', {}, `Daten und Schritte${t.schritte.length ? ` (${t.schritte.length} Schritte)` : ''}`, hint ? h('span', { class: 'badge warn' }, 'Zerlegen empfohlen') : null),
          h('div', {}, h('b', {}, 'Liest: '), objectChecks(t, 'liest')),
          h('div', {}, h('b', {}, 'Schreibt: '), objectChecks(t, 'schreibt')),
          h('div', {}, h('b', {}, 'Schritte '), h('span', { class: 'hint' }, 'nur, wo ein Medienbruch oder doppelte Pflege genauer angesehen werden muss'),
            h('ol', {}, t.schritte.map((s) => h('li', {}, s.name, ' ', h('button', { class: 'link', onclick: act(() => SL.removeStep(state, t.id, s.id)) }, 'entfernen')))),
            h('div', { class: 'row' },
              h('input', { type: 'text', class: 'grow', placeholder: 'Schritt, z. B. „Preis aus der Excel-Liste abtippen“', 'data-step-input': t.id, oninput: (e) => { stepName = e.target.value; } }),
              h('button', { 'data-add-step': t.id, onclick: act(() => SL.addStep(state, t.id, stepName)) }, 'Schritt hinzufügen')))));
    }

    function aufgaben() {
      const f = fw();
      const c = cat();
      const systems = SL.istSystems(state);
      if (!systems.length) return h('section', { class: 'panel' }, h('p', {}, 'Bitte zuerst Systeme erfassen.'));
      return [rolesList(), systems.map((s) => {
        const proposals = SL.catalogTasksFor(c, s);
        const tasks = state.tasks.filter((t) => t.systemId === s.id);
        let name = '';
        return h('section', { class: 'panel', 'data-system-tasks': s.id },
          h('h2', {}, s.name, h('span', { class: 'badge' }, SL.ARTEN[s.art])),
          proposals.length ? h('div', {}, h('h3', {}, 'Typische Aufgaben aus dem Katalog'),
            h('div', { class: 'checks' }, proposals.map((p) => h('label', {},
              h('input', { type: 'checkbox', 'data-cat-task': `${s.id}/${p.id}`, checked: tasks.some((t) => t.catalogRef === `${s.catalogId}/${p.id}`),
                onchange: act((e) => SL.toggleCatalogTask(state, c, s.id, p.id, e.target.checked, f)) }), ' ', p.name)))) : null,
          h('h3', {}, `Aufgaben (${tasks.length})`),
          tasks.map((t) => taskCard(t, f)),
          h('div', { class: 'row' },
            h('input', { type: 'text', class: 'grow', placeholder: 'Eigene Aufgabe', 'data-free-task': s.id, oninput: (e) => { name = e.target.value; } }),
            h('button', { 'data-add-task': s.id, onclick: act(() => SL.addTask(state, { name, systemId: s.id }, f)) }, 'Aufgabe anlegen')));
      })];
    }

    // --- Daten (software-landkarte.r.datenobjekte)

    function daten() {
      const c = cat();
      const sys = SL.istSystems(state);
      const free = { name: '', art: 'stamm' };
      const status = (st) => (st === 'doppelt' ? h('span', { class: 'badge bad' }, 'doppelte Pflege') : st === 'luecke' ? h('span', { class: 'badge warn' }, 'kein führendes System') : null);
      return [
        h('section', { class: 'panel' },
          h('h2', {}, 'Datenobjekte'),
          h('div', { class: 'checks' }, c.datenobjekte.map((o) => h('label', {},
            h('input', { type: 'checkbox', 'data-cat-object': o.id, checked: !!SL.objById(state, o.id), onchange: act((e) => {
              if (e.target.checked) SL.ensureObject(state, c, o.id); else SL.removeObject(state, o.id);
            }) }), ' ', o.name))),
          h('div', { class: 'row' },
            h('input', { type: 'text', id: 'free-object', class: 'grow', placeholder: 'Eigenes Datenobjekt', oninput: (e) => { free.name = e.target.value; } }),
            h('select', { onchange: (e) => { free.art = e.target.value; } }, options(SL.OBJEKTARTEN, 'stamm')),
            h('button', { id: 'add-object', onclick: act(() => SL.addObject(state, free)) }, 'Anlegen'))),
        h('section', { class: 'panel' },
          h('h2', {}, 'Landkarte: wo liegen die Daten?'),
          h('p', { class: 'hint' }, 'Je Datenobjekt genau ein führendes System: dort wird angelegt und geändert. Alle anderen lesen oder haben eine Kopie.'),
          state.objects.length && sys.length ? h('div', { class: 'scroll' }, h('table', { class: 'grid', id: 'matrix' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Datenobjekt'), sys.map((s) => h('th', {}, s.name)), h('th', {}, 'Befund'))),
            h('tbody', {}, state.objects.map((o) => {
              const st = SL.objectStatus(state, o.id);
              return h('tr', { 'data-object': o.id }, h('td', {}, o.name),
                sys.map((s) => {
                  const v = SL.cell(state, o.id, s.id);
                  return h('td', { class: v === 'fuehrt' ? (st === 'doppelt' ? 'dup' : 'lead') : '' },
                    h('select', { k: `cell-${o.id}-${s.id}`, 'data-cell': `${o.id}|${s.id}`, 'aria-label': `${o.name} in ${s.name}`, onchange: act((e) => SL.setCell(state, o.id, s.id, e.target.value)) },
                      Object.entries(SL.ZELLEN).map(([k, label]) => h('option', { value: k, selected: k === v }, k ? label : '–'))));
                }),
                h('td', {}, status(st), h('button', { class: 'link', onclick: act(() => SL.removeObject(state, o.id)) }, 'entfernen')));
            }))))
            : h('p', { class: 'hint' }, 'Erst Systeme und Datenobjekte anlegen.')),
      ];
    }

    // --- Flüsse (software-landkarte.r.datenfluesse, software-landkarte.r.aufwand)

    function sysOptions(current) { return SL.istSystems(state).map((s) => h('option', { value: s.id, selected: s.id === current }, s.name)); }
    function objOptions(current) { return state.objects.map((o) => h('option', { value: o.id, selected: o.id === current }, o.name)); }

    function fluesse() {
      const sugg = SL.suggestFlows(state);
      const sys = SL.istSystems(state);
      const draft = { objectId: (state.objects[0] || {}).id, from: (sys[0] || {}).id, to: (sys[1] || {}).id, art: 'manuell', haeufigkeit: 'monatlich' };
      const mb = SL.medienbrueche(state);
      return [
        sugg.length ? h('section', { class: 'panel', id: 'flow-suggestions' },
          h('h2', {}, `Vorgeschlagene Flüsse (${sugg.length})`),
          h('p', { class: 'hint' }, 'Eine Aufgabe schreibt hier ein Datenobjekt in ein System, das es nicht führt. Wie kommen die Daten vom führenden System dorthin?'),
          sugg.map((s) => {
            let art = 'manuell';
            return h('div', { class: 'row card', 'data-suggestion': `${s.objectId}|${s.from}|${s.to}` },
              h('span', { class: 'grow' }, h('b', {}, SL.objById(state, s.objectId).name), `: ${SL.sysById(state, s.from).name} → ${SL.sysById(state, s.to).name}`,
                h('span', { class: 'hint' }, ` (Aufgabe „${(SL.taskById(state, s.taskId) || {}).name}“)`)),
              h('select', { onchange: (e) => { art = e.target.value; } }, options(SL.FLUSSARTEN, 'manuell')),
              h('button', { class: 'primary', onclick: act(() => SL.addFlow(state, { objectId: s.objectId, from: s.from, to: s.to, art })) }, 'Übernehmen'));
          })) : null,
        h('section', { class: 'panel' },
          h('h2', {}, `Datenflüsse (${state.flows.length})`, mb.list.length ? h('span', { class: 'badge bad' }, `${mb.list.length} Medienbrüche${mb.summe ? `, ${mb.summe} Min./Monat` : ''}`) : null),
          state.flows.length ? h('div', { class: 'scroll' }, h('table', { class: 'grid', id: 'flows' },
            h('thead', {}, h('tr', {}, ['Datenobjekt', 'Von', 'Nach', 'Art', 'Häufigkeit', 'Aufwand Min./Monat', ''].map((x) => h('th', {}, x)))),
            h('tbody', {}, state.flows.map((fl) => h('tr', { 'data-flow': fl.id, class: SL.isMedienbruch(fl) ? 'dup' : '' },
              h('td', {}, h('select', { k: `fl-o-${fl.id}`, onchange: act((e) => SL.updateFlow(state, fl.id, { objectId: e.target.value })) }, objOptions(fl.objectId))),
              h('td', {}, h('select', { k: `fl-f-${fl.id}`, onchange: act((e) => SL.updateFlow(state, fl.id, { from: e.target.value })) }, sysOptions(fl.from))),
              h('td', {}, h('select', { k: `fl-t-${fl.id}`, onchange: act((e) => SL.updateFlow(state, fl.id, { to: e.target.value })) }, sysOptions(fl.to))),
              h('td', {}, h('select', { k: `fl-a-${fl.id}`, onchange: act((e) => SL.updateFlow(state, fl.id, { art: e.target.value })) }, options(SL.FLUSSARTEN, fl.art)),
                SL.isMedienbruch(fl) ? h('span', { class: 'badge bad' }, 'Medienbruch') : null),
              h('td', {}, h('select', { k: `fl-h-${fl.id}`, onchange: act((e) => SL.updateFlow(state, fl.id, { haeufigkeit: e.target.value })) }, options(SL.HAEUFIGKEITEN, fl.haeufigkeit))),
              h('td', {}, SL.isMedienbruch(fl) ? h('input', { type: 'number', min: 0, step: 5, k: `fl-m-${fl.id}`, 'data-aufwand': fl.id, value: fl.aufwand == null ? '' : fl.aufwand, 'aria-label': 'Aufwand in Minuten pro Monat',
                onchange: act((e) => SL.updateFlow(state, fl.id, { aufwand: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })) }) : h('span', { class: 'hint' }, '–')),
              h('td', {}, h('button', { class: 'danger', onclick: act(() => SL.removeFlow(state, fl.id)) }, '×'))))))) : h('p', { class: 'hint' }, 'Noch keine Flüsse.'),
          state.objects.length && sys.length > 1 ? h('div', { class: 'row', id: 'new-flow' },
            h('select', { 'aria-label': 'Datenobjekt', onchange: (e) => { draft.objectId = e.target.value; } }, objOptions(draft.objectId)),
            h('select', { 'aria-label': 'Von', onchange: (e) => { draft.from = e.target.value; } }, sysOptions(draft.from)), '→',
            h('select', { 'aria-label': 'Nach', onchange: (e) => { draft.to = e.target.value; } }, sysOptions(draft.to)),
            h('select', { 'aria-label': 'Art', onchange: (e) => { draft.art = e.target.value; } }, options(SL.FLUSSARTEN, draft.art)),
            h('select', { 'aria-label': 'Häufigkeit', onchange: (e) => { draft.haeufigkeit = e.target.value; } }, options(SL.HAEUFIGKEITEN, draft.haeufigkeit)),
            h('button', { onclick: act(() => SL.addFlow(state, draft)) }, 'Fluss anlegen')) : null),
      ];
    }

    // --- Prozesse (software-landkarte.r.prozesse, software-landkarte.d.darstellung)

    function prozesse() {
      const f = fw();
      const none = SL.unassigned(state, f);
      return [
        h('section', { class: 'panel', id: 'ohne-prozess' },
          h('h2', {}, `Ohne Prozess (${none.length})`),
          h('p', { class: 'hint' }, 'Was in keinen Prozess passt, bleibt hier sichtbar: Kandidat für ein neues Branchenmodul.'),
          none.map((t) => {
            const sug = SL.suggestProcess(t.schrittRef, f);
            return h('div', { class: 'row card', 'data-unassigned': t.id },
              h('span', { class: 'grow' }, t.name, h('span', { class: 'hint' }, ` (${SL.sysById(state, t.systemId).name})`)),
              sug ? h('button', { onclick: act(() => SL.assignTask(state, t.id, sug.prozess, sug.schritt)) }, `Vorschlag: ${f.prozess(sug.prozess).name}`) : null,
              processSelect(t, f, `un-${t.id}`));
          })),
        f.prozesse.map((p) => {
          const seq = SL.sequence(state, f, p.id);
          return h('section', { class: 'panel', 'data-process': p.id },
            h('h2', {}, p.name, p.modul ? h('span', { class: 'badge' }, `Modul ${p.modul}`) : null),
            h('p', { class: 'hint' }, 'Schritte: ', p.schritte.map((s) => s.name).join(' → ')),
            h('div', { class: 'report scroll', html: SL.report.swimlane(state, f, p.id) }),
            seq.length ? h('details', { class: 'no-print' }, h('summary', {}, 'Reihenfolge und Zuordnung ändern'),
              h('ol', { class: 'seq' }, seq.map((t, i) => h('li', { 'data-seq': t.id }, h('div', { class: 'row' },
                h('button', { 'aria-label': 'nach oben', disabled: i === 0, onclick: act(() => SL.moveInSequence(state, f, p.id, t.id, -1)) }, '↑'),
                h('button', { 'aria-label': 'nach unten', disabled: i === seq.length - 1, onclick: act(() => SL.moveInSequence(state, f, p.id, t.id, 1)) }, '↓'),
                h('span', { class: 'grow' }, t.name, h('span', { class: 'hint' }, ` (${SL.sysById(state, t.systemId).name})`)),
                processSelect(t, f, `seq-${t.id}`)))))) : null);
        }),
      ];
    }

    // --- Zielbild (software-landkarte.r.zielbild)

    function zielbild() {
      const ziel = SL.zielsysteme(state);
      const ist = SL.istSystems(state);
      const free = { name: '' };
      const tasks = state.tasks.filter((t) => !(SL.sysById(state, t.systemId) || {}).zielsystem);
      const targetOf = (t) => (t.ziel === 'wandert' ? (ziel[0] || {}).name : t.ziel === 'entfaellt' ? '–' : t.ziel === 'bleibt' ? SL.sysById(state, t.systemId).name : '?');
      return [
        h('section', { class: 'panel' },
          h('h2', {}, 'Neue Software'),
          h('p', { class: 'hint' }, 'Das Werkzeug entscheidet nichts, es macht die Entscheidung vollständig: je Aufgabe wandert, bleibt, entfällt oder unklar, je Datenobjekt das künftig führende System.'),
          h('div', { class: 'row' }, catalogSelect('cat-ziel'),
            h('button', { id: 'add-ziel-cat', onclick: act(() => {
              const v = document.getElementById('cat-ziel').value;
              if (!v) throw new Error('Bitte erst eine Software wählen.');
              const sw = cat().software.find((x) => x.id === v);
              const s = SL.addSystem(state, { name: sw.name, art: sw.art, zweck: sw.zweck, catalogId: sw.id });
              SL.setZielsystem(state, s.id, true);
            }) }, 'Als Zielsystem anlegen')),
          h('div', { class: 'row' },
            h('input', { type: 'text', id: 'ziel-name', class: 'grow', placeholder: 'oder Name der neuen Software', oninput: (e) => { free.name = e.target.value; } }),
            h('button', { id: 'add-ziel', onclick: act(() => { const s = SL.addSystem(state, { name: free.name, art: 'cloud' }); SL.setZielsystem(state, s.id, true); }) }, 'Als Zielsystem anlegen')),
          h('div', { class: 'checks' }, state.systems.map((s) => h('label', {},
            h('input', { type: 'checkbox', 'data-ziel-system': s.id, checked: !!s.zielsystem, onchange: act((e) => SL.setZielsystem(state, s.id, e.target.checked)) }), ' ', s.name, ' ist Zielsystem')))),
        ziel.length ? [
          h('section', { class: 'panel' },
            h('h2', {}, 'Aufgaben: Ist und Ziel'),
            h('div', { class: 'scroll' }, h('table', { class: 'grid', id: 'ziel-aufgaben' },
              h('thead', {}, h('tr', {}, ['Aufgabe', 'Ist: System', 'Entscheidung', 'Ziel: System'].map((x) => h('th', {}, x)))),
              h('tbody', {}, tasks.map((t) => h('tr', { 'data-ziel-task': t.id },
                h('td', {}, t.name), h('td', {}, SL.sysById(state, t.systemId).name),
                h('td', {}, h('select', { k: `ziel-${t.id}`, onchange: act((e) => SL.setTaskZiel(state, t.id, e.target.value)) }, options(SL.ZIELE, t.ziel || '', '– offen –'))),
                h('td', { class: t.ziel === 'wandert' ? 'lead' : '' }, targetOf(t)))))))),
          h('section', { class: 'panel' },
            h('h2', {}, 'Datenobjekte: heute und künftig führend'),
            h('div', { class: 'scroll' }, h('table', { class: 'grid', id: 'ziel-objekte' },
              h('thead', {}, h('tr', {}, ['Datenobjekt', 'Ist: führend', 'Ziel: führend'].map((x) => h('th', {}, x)))),
              h('tbody', {}, state.objects.map((o) => h('tr', { 'data-ziel-object': o.id },
                h('td', {}, o.name),
                h('td', {}, SL.leaders(state, o.id).map((id) => SL.sysById(state, id).name).join(', ') || h('span', { class: 'badge warn' }, 'keines')),
                h('td', {}, h('select', { k: `zf-${o.id}`, onchange: act((e) => SL.setZielFuehrend(state, o.id, e.target.value)) },
                  h('option', { value: '' }, '– offen –'),
                  [...ziel, ...ist].map((s) => h('option', { value: s.id, selected: o.zielFuehrend === s.id }, s.name + (s.zielsystem ? ' (neu)' : ''))))))))))),
          h('section', { class: 'panel' },
            h('div', { class: 'report', id: 'umstellung', html: SL.report.umstellung(state) }),
            h('div', { class: 'row no-print' }, h('button', { id: 'adopt', onclick: act(() => {
              const u = SL.umstellungsliste(state);
              const msg = (u.vollstaendig ? '' : 'Es sind noch Fragen offen. ') + 'Nach der Umstellung das Zielbild als neue Ist-Landkarte übernehmen? Speichern Sie vorher die jetzige Landkarte, wenn Sie sie aufheben wollen.';
              if (confirm(msg)) { state = SL.adoptTarget(state); toast('Neue Fassung angelegt.'); }
            }) }, 'Zielbild als neue Ist-Landkarte übernehmen'))),
        ] : h('section', { class: 'panel' }, h('p', { class: 'hint' }, 'Noch kein Zielsystem: Legen Sie die neue Software oben an oder markieren Sie ein System.')),
      ];
    }

    // --- Durchgang (software-landkarte.r.mandanten-durchgang)

    function durchgang() {
      const d = SL.durchgangBefunde(state);
      const n = SL.istSystems(state).length + state.tasks.filter((t) => !(SL.sysById(state, t.systemId) || {}).zielsystem).length;
      const done = (item) => act(() => { item.durchgang.erledigt = true; });
      return [
        h('section', { class: 'panel' },
          h('h2', {}, '1. Mandanten-Datei erzeugen'),
          h('p', { class: 'hint' }, `Die Datei zeigt nur die Karten: ${n} Karten zu Systemen und Aufgaben und eine Frage nach weiteren Programmen. Sie läuft offline im Browser des Mandanten.`),
          h('button', { class: 'primary', id: 'make-client', disabled: !state.systems.length, onclick: act(() => {
            const payload = SL.clientPayload(state);
            const html = PRISTINE.replace(EMBED_TAG, `<script id="sl-embed" type="application/json">${SL.scriptJson({ mode: 'mandant', payload })}${END}`);
            download(`${fileBase()}.mandant.html`, html, 'text/html');
          }) }, 'Mandanten-Datei erzeugen'),
          state.durchgang ? h('p', { class: 'hint' }, `Zuletzt erzeugt: ${state.durchgang.erzeugt || '–'}${state.durchgang.eingelesen ? ` · Ergebnis eingelesen: ${state.durchgang.eingelesen}` : ''}`) : null),
        h('section', { class: 'panel' },
          h('h2', {}, '2. Ergebnis des Mandanten einlesen'),
          h('button', { id: 'import-result', onclick: () => pickFile('.json,application/json', (text) => {
            let data;
            try { data = JSON.parse(text); } catch (e) { throw new Error('Die Datei ist kein gültiges JSON.'); }
            const r = SL.importResult(state, data);
            commit();
            toast(`${r.uebernommen} Antworten und ${r.ergaenzungen} Ergänzungen übernommen.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`);
          }) }, 'Ergebnis einlesen …')),
        h('section', { class: 'panel', id: 'durchgang-befunde' },
          h('h2', {}, 'Was der Mandant anders sieht'),
          h('h3', {}, `Anders (${d.anders.length})`),
          d.anders.map((x) => h('div', { class: 'card flag-anders', 'data-anders': x.item.id }, h('div', { class: 'row' },
            h('span', { class: 'grow' }, h('b', {}, x.label), `: ${x.item.durchgang.text || '(ohne Text)'}`),
            h('button', { onclick: done(x.item) }, 'Erledigt')))),
          h('h3', {}, `Unsicher (${d.unsicher.length})`),
          d.unsicher.map((x) => h('div', { class: 'card flag-unsicher', 'data-unsicher': x.item.id }, h('div', { class: 'row' },
            h('span', { class: 'grow' }, x.label), h('button', { onclick: done(x.item) }, 'Geklärt')))),
          h('h3', {}, `Ergänzungen (${d.ergaenzungen.length})`),
          d.ergaenzungen.map((e) => h('div', { class: 'card', 'data-ergaenzung': e.id }, h('div', { class: 'row' },
            h('span', { class: 'grow' }, e.text),
            h('button', { onclick: act(() => { SL.addSystem(state, { name: e.text, art: 'lokal', zweck: 'vom Mandanten ergänzt' }); e.erledigt = true; }) }, 'Als System anlegen'),
            h('button', { onclick: act(() => { e.erledigt = true; }) }, 'Erledigt'))))),
      ];
    }

    // --- Bericht (software-landkarte.r.bericht, software-landkarte.d.ergebnisformat)

    function bericht() {
      const f = fw();
      const bom = '﻿';
      return [
        h('section', { class: 'panel no-print' },
          h('h2', {}, 'Bericht und Export'),
          h('div', { class: 'row' },
            h('button', { class: 'primary', id: 'print', onclick: () => window.print() }, 'Drucken'),
            h('button', { id: 'dl-report', onclick: () => download(`${fileBase()}.bericht.html`, SL.report.reportDocument(state, f), 'text/html') }, 'Bericht als HTML'),
            h('button', { id: 'dl-matrix', onclick: () => download(`${fileBase()}-matrix.csv`, bom + SL.matrixCsv(state), 'text/csv') }, 'Matrix als CSV'),
            h('button', { id: 'dl-tasks', onclick: () => download(`${fileBase()}-aufgaben.csv`, bom + SL.aufgabenCsv(state, f), 'text/csv') }, 'Aufgaben als CSV'),
            h('button', { onclick: () => download(`${fileBase()}.landkarte.json`, SL.toFile(state), 'application/json') }, 'Landkarte speichern (JSON)'))),
        h('section', { class: 'panel', id: 'report-preview', html: SL.report.render(state, f) }),
      ];
    }

    render();
  }

  // ------------------------------------------------------------ client mode

  function walkthrough(payload) {
    const KEY = `software-landkarte:durchgang:${payload.fileId}`;
    const list = SL.cards(payload);
    let saved = {};
    try { saved = JSON.parse(storage.get(KEY) || '{}'); } catch (e) { saved = {}; }
    const st = { answers: saved.answers || {}, ergaenzungen: saved.ergaenzungen || [], index: Math.min(saved.index || 0, list.length - 1), editing: false };
    const save = () => storage.set(KEY, JSON.stringify({ answers: st.answers, ergaenzungen: st.ergaenzungen, index: st.index }));
    document.title = 'Ihre Software-Landkarte';

    function go(i) { st.index = Math.max(0, Math.min(list.length - 1, i)); st.editing = false; save(); render(); }
    function choose(wert) {
      const c = list[st.index];
      if (c.kind === 'ergaenzungen') return;
      if (wert === 'anders') {
        const prev = st.answers[c.key];
        SL.answer(st.answers, c.key, 'anders', prev && prev.wert === 'anders' ? prev.text : '');
        st.editing = true; save(); render();
        const ta = document.getElementById('anders-text');
        if (ta) ta.focus();
        return;
      }
      SL.answer(st.answers, c.key, wert);
      save();
      go(st.index + 1);
    }

    function render() {
      const c = list[st.index];
      const p = SL.progress(payload, st.answers);
      const a = st.answers[c.key];
      let body;
      if (c.kind === 'ergaenzungen') {
        let draft = '';
        const add = () => { if (draft.trim()) { st.ergaenzungen.push(draft.trim()); save(); render(); const i = document.getElementById('erg-input'); if (i) i.focus(); } };
        const firstOpen = list.findIndex((x) => x.kind !== 'ergaenzungen' && !st.answers[x.key]);
        body = [
          h('div', { class: 'kicker' }, 'Zum Schluss'),
          h('div', { class: 'title' }, 'Welche Programme, Listen oder Ordner nutzen Sie noch?'),
          h('p', { class: 'intro' }, 'Alles, was oben nicht vorkam: auch Excel-Listen, Papierordner, Notizbücher oder Postfächer.'),
          h('ul', { id: 'erg-list' }, st.ergaenzungen.map((e, i) => h('li', {}, e, ' ', h('button', { class: 'link', 'aria-label': `${e} entfernen`, onclick: () => { st.ergaenzungen.splice(i, 1); save(); render(); } }, 'entfernen')))),
          h('div', { class: 'row' },
            h('input', { type: 'text', id: 'erg-input', class: 'grow', placeholder: 'z. B. Excel-Liste mit Preisen', oninput: (e) => { draft = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } } }),
            h('button', { id: 'erg-add', onclick: add }, 'Hinzufügen')),
          h('hr', {}),
          firstOpen >= 0 ? h('p', {}, `Noch ${p.total - p.done} Karten ohne Antwort. `, h('button', { class: 'link', id: 'goto-open', onclick: () => go(firstOpen) }, 'Zur ersten offenen Karte')) : h('p', {}, 'Alle Karten sind beantwortet. Danke!'),
          h('button', { class: 'primary', id: 'save-result', onclick: () => {
            const result = SL.clientResult(payload, st.answers, st.ergaenzungen);
            download(`durchgang-${SL.today()}.durchgang.json`, JSON.stringify(result, null, 2), 'application/json');
            toast('Ergebnis gespeichert. Bitte schicken Sie die Datei an Ihre Kanzlei.');
          } }, 'Ergebnis speichern'),
          h('p', { class: 'intro' }, 'Es entsteht eine Datei, die Sie Ihrer Kanzlei schicken. Nichts wird automatisch übertragen.'),
        ];
      } else {
        const s = c.system;
        body = [
          c.kind === 'system'
            ? [h('div', { class: 'kicker' }, `Programm oder Ablage · ${SL.ARTEN[s.art]}`),
              h('div', { class: 'title' }, s.name),
              s.zweck ? h('p', {}, h('b', {}, 'Wofür: '), s.zweck) : null,
              s.rollen.length ? h('p', {}, h('b', {}, 'Wer arbeitet damit: '), s.rollen.join(', ')) : null,
              h('p', { class: 'intro' }, 'Nutzen Sie das so?')]
            : [h('div', { class: 'kicker' }, `Aufgabe in ${s.name}`),
              h('div', { class: 'title' }, c.task.name),
              h('p', {}, h('b', {}, 'Wer: '), c.task.rolle || '–', ' · ', h('b', {}, 'Wie oft: '), SL.HAEUFIGKEITEN[c.task.haeufigkeit]),
              h('p', { class: 'intro' }, `Erledigen Sie das so in ${s.name}?`)],
          h('div', { class: 'answers', role: 'group', 'aria-label': 'Antwort' },
            h('button', { 'data-answer': 'ok', 'aria-pressed': String(!!a && a.wert === 'ok'), onclick: () => choose('ok') }, '✓ So ist es'),
            h('button', { 'data-answer': 'anders', 'aria-pressed': String(!!a && a.wert === 'anders'), onclick: () => choose('anders') }, '✗ Anders'),
            h('button', { 'data-answer': 'unsicher', 'aria-pressed': String(!!a && a.wert === 'unsicher'), onclick: () => choose('unsicher') }, '? Unsicher')),
          a && a.wert === 'anders' ? h('div', {},
            h('label', { for: 'anders-text' }, 'Was ist anders? (kurz)'),
            h('textarea', { id: 'anders-text', value: a.text || '', oninput: (e) => { SL.answer(st.answers, c.key, 'anders', e.target.value); save(); },
              onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(st.index + 1); } } })) : null,
          a ? h('p', {}, h('button', { class: 'link', id: 'retract', onclick: () => { SL.answer(st.answers, c.key, null); save(); render(); } }, 'Antwort zurücknehmen')) : null,
        ];
      }
      app.replaceChildren(h('div', { class: 'walk' },
        h('h1', {}, 'Ihre Software-Landkarte'),
        h('p', { class: 'intro' }, payload.betrieb ? `${payload.betrieb}: ` : '', 'Ihre Kanzlei hat eingetragen, was sie über Ihre Programme und Abläufe weiß. Bestätigen Sie jede Karte oder sagen Sie, was anders ist. Ihr Stand bleibt in diesem Browser gespeichert; Sie können jederzeit unterbrechen.'),
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Fortschritt', 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.done },
          h('div', { style: `width:${p.percent}%` })),
        h('div', { class: 'keys', id: 'progress-text' }, `${p.done} von ${p.total} beantwortet · Karte ${st.index + 1} von ${list.length}`),
        h('div', { class: 'bigcard', 'data-card': c.key }, body),
        h('div', { class: 'nav' },
          h('button', { id: 'prev', disabled: st.index === 0, onclick: () => go(st.index - 1) }, '← Zurück'),
          h('span', { class: 'keys' }, 'Tasten: 1 = so ist es, 2 = anders, 3 = unsicher, Pfeile = blättern'),
          h('button', { id: 'next', disabled: st.index === list.length - 1, onclick: () => go(st.index + 1) }, 'Weiter →'))));
    }

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || e.altKey || e.ctrlKey || e.metaKey) return;
      const map = { 1: 'ok', j: 'ok', 2: 'anders', a: 'anders', 3: 'unsicher', u: 'unsicher' };
      if (map[e.key.toLowerCase()]) { e.preventDefault(); choose(map[e.key.toLowerCase()]); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(st.index + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(st.index - 1); }
    });
    render();
  }
})();
