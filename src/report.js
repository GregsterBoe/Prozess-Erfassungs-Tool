/* Software-Landkarte: the report for the conversation with the client
 * (software-landkarte.r.bericht). Builds an HTML string from the state, so it works in
 * the browser without a server and in Node tests. Starts with the findings, then the
 * full lists. */
(function (root) {
  'use strict';
  const SL = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.SL;

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Short cell codes keep the matrix within an A4 page even with 15 systems.
  const CODES = { fuehrt: 'F', liest: 'L', kopie: 'K' };
  const SWIM_COLUMNS = 5;

  const REPORT_CSS = `
.report { font: 10.5pt/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d232a; }
.report h1 { font-size: 18pt; margin: 0 0 .2em; }
.report h2 { font-size: 13pt; margin: 1.4em 0 .4em; border-bottom: 1px solid #c9d1d9; padding-bottom: .15em; break-after: avoid; }
.report h3 { font-size: 11pt; margin: 1em 0 .3em; break-after: avoid; }
.report .meta { color: #57606a; margin: 0 0 1em; }
.report table { width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed; margin: .3em 0 .8em; break-inside: auto; }
.report th, .report td { border: 1px solid #c9d1d9; padding: 3px 5px; vertical-align: top; text-align: left; overflow-wrap: anywhere; word-break: break-word; hyphens: auto; }
.report th { background: #f0f3f6; font-weight: 600; }
.report tr { break-inside: avoid; }
.report .num { text-align: right; white-space: nowrap; }
.report .c { text-align: center; }
.report .tiles { display: flex; flex-wrap: wrap; gap: 8px; margin: .5em 0 1em; }
.report .tile { border: 1px solid #c9d1d9; border-radius: 6px; padding: 6px 10px; min-width: 110px; }
.report .tile b { display: block; font-size: 16pt; }
.report .warn { color: #9a3412; }
.report .bad { background: #fde8e8; }
.report .lead { background: #e6f4ea; font-weight: 700; }
.report .muted { color: #57606a; }
.report .box { border: 1px solid #8c959f; border-radius: 4px; padding: 3px 5px; background: #fff; }
.report .box.mb { border: 2px solid #b42318; background: #fff4f2; }
.report .lane { font-weight: 600; background: #f6f8fa; }
.report ul { margin: .2em 0 .8em; padding-left: 1.3em; }
.report .legend { font-size: 9pt; color: #57606a; }
@media print { .report h2 { break-before: auto; } .report .tile { break-inside: avoid; } }
`;

  function names(state, ids) { return ids.map((id) => (SL.sysById(state, id) || {}).name || '?').join(', '); }
  const objName = (state, id) => (SL.objById(state, id) || {}).name || id;
  const sysName = (state, id) => (SL.sysById(state, id) || {}).name || '?';

  function tile(n, label, bad) {
    return `<div class="tile${bad && n ? ' warn' : ''}"><b>${esc(n)}</b>${esc(label)}</div>`;
  }

  function list(items, empty) {
    return items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="muted">${esc(empty)}</p>`;
  }

  function matrixTable(state) {
    const sys = SL.istSystems(state);
    if (!state.objects.length || !sys.length) return '<p class="muted">Noch keine Datenobjekte oder Systeme.</p>';
    const head = sys.map((s, i) => `<th class="c" title="${esc(s.name)}">${i + 1}</th>`).join('');
    const rows = state.objects.map((o) => {
      const st = SL.objectStatus(state, o.id);
      const flag = st === 'doppelt' ? ' <span class="warn">⚠ doppelte Pflege</span>' : st === 'luecke' ? ' <span class="warn">⚠ kein führendes System</span>' : '';
      const cells = sys.map((s) => {
        const v = SL.cell(state, o.id, s.id);
        const cls = v === 'fuehrt' ? (st === 'doppelt' ? 'c bad' : 'c lead') : 'c';
        return `<td class="${cls}">${CODES[v] || ''}</td>`;
      }).join('');
      return `<tr><td>${esc(o.name)}${flag}</td>${cells}</tr>`;
    }).join('');
    const legend = sys.map((s, i) => `${i + 1} = ${esc(s.name)}`).join(' · ');
    return `<table class="matrix"><colgroup><col style="width:34%">${sys.map(() => '<col>').join('')}</colgroup>
<thead><tr><th>Datenobjekt</th>${head}</tr></thead><tbody>${rows}</tbody></table>
<p class="legend">F = führt · L = liest · K = Kopie · leer = nicht vorhanden. Systeme: ${legend}</p>`;
  }

  function swimlaneTables(state, fw, procId) {
    const sl = SL.swimlane(state, fw, procId);
    if (!sl.columns.length) return '<p class="muted">Noch keine Aufgaben in diesem Prozess.</p>';
    let html = '';
    for (let start = 0; start < sl.columns.length; start += SWIM_COLUMNS) {
      const cols = sl.columns.slice(start, start + SWIM_COLUMNS);
      const p = sl.prozess;
      const head = cols.map((c, i) => {
        const step = c.schritt ? (p.schritte.find((s) => s.id === c.schritt) || {}).name : '';
        const mark = c.uebergang && c.uebergang.medienbruch ? ' <span class="warn" title="Medienbruch beim Übergang">↯</span>' : '';
        return `<th>${start + i + 1}. ${esc(step || 'ohne Schritt')}${mark}</th>`;
      }).join('');
      const rows = sl.lanes.map((lane) => {
        const cells = cols.map((c) => {
          const items = c.items.filter((x) => x.task.systemId === lane.id);
          return `<td>${items.map((x) => {
            const br = x.breaks.map((f) => `<div class="warn">⚠ ${esc(objName(state, f.objectId))}: ${esc(SL.FLUSSARTEN[f.art])} aus ${esc(sysName(state, f.from))}</div>`).join('');
            return `<div class="box${x.breaks.length ? ' mb' : ''}">${esc(x.task.name)}<div class="muted">${esc(x.task.rolle)}</div>${br}</div>`;
          }).join('')}</td>`;
        }).join('');
        return `<tr><td class="lane">${esc(lane.name)}</td>${cells}</tr>`;
      }).join('');
      html += `<table class="swimlane"><colgroup><col style="width:20%">${cols.map(() => '<col>').join('')}</colgroup><thead><tr><th>System</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    return html;
  }

  function umstellung(state) {
    const u = SL.umstellungsliste(state);
    const z = u.zielsysteme.map((s) => esc(s.name)).join(', ');
    const objRows = state.objects.map((o) => `<tr><td>${esc(o.name)}</td><td>${esc(names(state, SL.leaders(state, o.id))) || '<span class="warn">keines</span>'}</td><td>${o.zielFuehrend ? esc(sysName(state, o.zielFuehrend)) : '<span class="warn">offen</span>'}</td></tr>`).join('');
    return `<h2>Umstellungsliste: ${z}</h2>
<h3>Zieht in die neue Software um</h3>
${list([
    ...u.umziehen.aufgaben.map((t) => `Aufgabe: ${esc(t.name)} <span class="muted">(bisher ${esc(sysName(state, t.systemId))})</span>`),
    ...u.umziehen.datenobjekte.map((x) => `Führend für ${esc(objName(state, x.objectId))} <span class="muted">(bisher ${esc(names(state, x.von)) || 'keines'})</span>`),
  ], 'Nichts.')}
<h3>Braucht eine Schnittstelle</h3>
${list(u.schnittstellen.map((x) => `${esc(objName(state, x.objectId))}: ${esc(sysName(state, x.from))} → ${esc(sysName(state, x.to))}${x.besteht ? ' <span class="muted">(besteht schon)</span>' : ''}`), 'Keine.')}
<h3>Kann abgeschaltet werden</h3>
${list(u.abschalten.map((s) => esc(s.name)), 'Keines.')}
<h3>Entfällt</h3>
${list(u.entfallen.map((t) => `${esc(t.name)} <span class="muted">(${esc(sysName(state, t.systemId))})</span>`), 'Nichts.')}
<h3>Noch offen: Fragen an den Anbieter</h3>
${list([
    ...u.offen.aufgaben.map((t) => `Aufgabe ${esc(t.name)} <span class="muted">(${esc(sysName(state, t.systemId))})</span>: ${t.ziel === 'unklar' ? 'unklar' : 'noch nicht entschieden'}`),
    ...u.offen.datenobjekte.map((o) => `Welches System führt künftig ${esc(o.name)}?`),
  ], 'Alles entschieden.')}
<h3>Ist und Ziel</h3>
<table><colgroup><col style="width:34%"><col><col></colgroup><thead><tr><th>Datenobjekt</th><th>Heute führend</th><th>Künftig führend</th></tr></thead><tbody>${objRows}</tbody></table>`;
  }

  /** The report body; wrap it with reportDocument() for a standalone file. */
  function render(state, fw) {
    const b = SL.befunde(state, fw);
    const sys = SL.istSystems(state);
    const hasZiel = SL.zielsysteme(state).length > 0;
    const mbRows = b.medienbrueche.map((f) => `<tr><td>${esc(objName(state, f.objectId))}</td><td>${esc(sysName(state, f.from))} → ${esc(sysName(state, f.to))}</td><td>${esc(SL.FLUSSARTEN[f.art])}</td><td>${esc(SL.HAEUFIGKEITEN[f.haeufigkeit] || '')}</td><td class="num">${f.aufwand ? esc(f.aufwand) : '–'}</td></tr>`).join('');
    const procs = fw.prozesse.map((p) => `<h3>${esc(p.name)}${p.modul ? ` <span class="muted">(Modul ${esc(p.modul)})</span>` : ''}</h3>${swimlaneTables(state, fw, p.id)}`).join('');
    const sysRows = sys.map((s, i) => `<tr><td class="c">${i + 1}</td><td>${esc(s.name)}</td><td>${esc(SL.ARTEN[s.art])}</td><td>${esc(s.zweck)}</td><td>${esc(s.rollen.join(', '))}</td></tr>`).join('');
    const taskRows = state.tasks.filter((t) => !(SL.sysById(state, t.systemId) || {}).zielsystem).map((t) => {
      const p = SL.inFramework(t, fw) ? fw.prozess(t.prozess) : null;
      const steps = t.schritte.length ? `<div class="muted">${t.schritte.map((s) => esc(s.name)).join(' → ')}</div>` : '';
      return `<tr><td>${esc(t.name)}${steps}</td><td>${esc(sysName(state, t.systemId))}</td><td>${esc(t.rolle)}</td><td>${esc(SL.HAEUFIGKEITEN[t.haeufigkeit])}</td><td>${p ? esc(p.name) : '<span class="warn">ohne Prozess</span>'}</td></tr>`;
    }).join('');
    return `<div class="report">
<h1>Software-Landkarte${state.meta.betrieb ? `: ${esc(state.meta.betrieb)}` : ''}</h1>
<p class="meta">Stand ${esc(state.meta.geaendert)} · Fassung ${esc(state.meta.version)}${state.meta.module.length ? ` · Module: ${esc(state.meta.module.join(', '))}` : ''}</p>
<h2>Befunde</h2>
<div class="tiles">${tile(b.medienbrueche.length, 'Medienbrüche', true)}${tile(b.doppelt.length, 'doppelte Pflege', true)}${tile(b.luecken.length, 'ohne führendes System', true)}${tile(b.offeneFragen.length, 'offene Fragen', true)}${b.aufwandSumme ? tile(b.aufwandSumme, 'Minuten im Monat für Medienbrüche', true) : ''}</div>
<h3>Medienbrüche</h3>
${b.medienbrueche.length ? `<table><colgroup><col style="width:22%"><col style="width:30%"><col style="width:20%"><col style="width:14%"><col style="width:14%"></colgroup><thead><tr><th>Datenobjekt</th><th>Weg</th><th>Art</th><th>Häufigkeit</th><th class="num">Min./Monat</th></tr></thead><tbody>${mbRows}</tbody>${b.aufwandSumme ? `<tfoot><tr><th colspan="4">Summe</th><th class="num">${esc(b.aufwandSumme)}</th></tr></tfoot>` : ''}</table>` : '<p class="muted">Keine.</p>'}
<h3>Doppelte Pflege</h3>
${list(b.doppelt.map((o) => `${esc(o.name)}: führend in ${esc(names(state, SL.leaders(state, o.id)))}`), 'Keine.')}
<h3>Kein führendes System</h3>
${list(b.luecken.map((o) => esc(o.name)), 'Keine Lücken.')}
<h3>Offene Fragen</h3>
${list(b.offeneFragen.map((q) => esc(q.text)), 'Keine.')}
${b.abweichungen.length ? `<h3>Abweichungen aus dem Durchgang</h3>${list(b.abweichungen.map((x) => `${esc(x.label)}: ${esc(x.item.durchgang.text || 'anders')}`), '')}` : ''}
${hasZiel ? umstellung(state) : ''}
<h2>Landkarte: wo liegen die Daten?</h2>
${matrixTable(state)}
<h2>Prozesse</h2>
${procs}
<h3>Ohne Prozess</h3>
${list(b.ohneProzess.map((t) => `${esc(t.name)} <span class="muted">(${esc(sysName(state, t.systemId))})</span>`), 'Jede Aufgabe gehört zu einem Prozess.')}
<h2>Systeme</h2>
${sys.length ? `<table><colgroup><col style="width:6%"><col style="width:24%"><col style="width:16%"><col style="width:34%"><col style="width:20%"></colgroup><thead><tr><th>Nr.</th><th>System</th><th>Art</th><th>Zweck</th><th>Rollen</th></tr></thead><tbody>${sysRows}</tbody></table>` : '<p class="muted">Keine.</p>'}
<h2>Aufgaben</h2>
${taskRows ? `<table><colgroup><col style="width:34%"><col style="width:20%"><col style="width:14%"><col style="width:12%"><col style="width:20%"></colgroup><thead><tr><th>Aufgabe</th><th>System</th><th>Rolle</th><th>Häufigkeit</th><th>Prozess</th></tr></thead><tbody>${taskRows}</tbody></table>` : '<p class="muted">Keine.</p>'}
</div>`;
  }

  /** A standalone file: no scripts, no network (software-landkarte.r.lokal). */
  function reportDocument(state, fw) {
    return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bericht Software-Landkarte${state.meta.betrieb ? ` – ${esc(state.meta.betrieb)}` : ''}</title>
<style>@page { size: A4; margin: 15mm; } body { margin: 0 auto; max-width: 180mm; padding: 10mm 0; background: #fff; }${REPORT_CSS}</style>
</head><body>${render(state, fw)}</body></html>`;
  }

  const api = { esc, render, reportDocument, REPORT_CSS, swimlane: swimlaneTables, umstellung, matrix: matrixTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SL.report = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
