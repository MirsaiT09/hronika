/* «Хроника пар» — дополнения:
   сессия и зачёты · обновление расписания · серии и ачивки · анализ пропусков и справок · сравнение предметов.
   Использует данные и функции из app.js; отметки о пропусках берутся из того же hp.skips (новых копий не создаётся). */
'use strict';

/* ---------- общие помощники ---------- */
const MY_SUBJECTS = [...new Set(MINE.map(p => p.s))].sort((a, b) => a.localeCompare(b, 'ru'));
const fmtD = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmtDs = d => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
const spanDays = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY_MS) + 1; // включительно
const isoOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// прошедшие пары семестра (закончились к моменту t0)
const heldPairs = (t0 = now()) => occurrences(SEM_START, t0).filter(o => o.end <= t0);
// пропуски, отмеченные заранее («не пойду») — ещё не прошли
const plannedSkips = (t0 = now()) => occurrences(t0, SEM_END).filter(o => o.end > t0 && skips[o.key]);

/* ---------- подразделы «Прогулов» ---------- */
function skipsSubSeg() {
  return `<div class="seg glass sub-seg" role="group" aria-label="Раздел">${[['stats', 'Статистика'], ['certs', 'Справки'], ['cmp', 'Сравнение']]
    .map(([k, l]) => `<button data-sub="${k}" aria-pressed="${state.sub === k}">${l}</button>`).join('')}</div>`;
}
function renderSkipsSub() {
  return `${brand()}
    <header class="page-title img-title"><div><h1><img class="title-img" src="assets/title-progul.png" alt="Прогулы" width="1600" height="514"></h1><p>${state.sub === 'certs' ? 'Анализ пропусков' : 'Сравнение предметов'}</p></div><img class="ribs" src="${ACC.ribs}" alt=""></header>
    ${skipsSubSeg()}
    <div class="fade-in">${state.sub === 'certs' ? renderCerts() : renderCompare()}</div>`;
}

/* =====================================================================
   АНАЛИЗ ПРОПУСКОВ И СПРАВОК
   Справка покрывает непрерывный период ≤ 14 календарных дней.
   В период не попадают дни, когда вы были на парах (иначе справка противоречит посещению).
   ===================================================================== */
const CERT_MAX = 14;
let certs = store.get('hp.certs', []);        // оформленные: [{id, from, to, at}]
let certPlan = store.get('hp.certPlan', null); // ручной план [{from, to}] или null — автоподбор
const saveCerts = () => store.set('hp.certs', certs);
const saveCertPlan = () => store.set('hp.certPlan', certPlan);

function skipAnalysis(t0 = now()) {
  const held = heldPairs(t0);
  const days = {}; // iso → { skipped:[], attended:[] }
  held.forEach(o => {
    const k = iso(o.date);
    const d = days[k] = days[k] || { iso: k, date: o.date, skipped: [], attended: [] };
    (skips[o.key] ? d.skipped : d.attended).push(o);
  });
  const certOf = di => certs.find(c => c.from <= di && di <= c.to);
  const all = held.filter(o => skips[o.key]).map(o => {
    const di = iso(o.date), c = certOf(di);
    return { ...o, iso: di, cert: c || null, closed: c ? 'cert' : skips[o.key].r === 'valid' ? 'valid' : null };
  });
  const open = all.filter(x => !x.closed);
  const openDays = [...new Set(open.map(x => x.iso))].sort();
  const openSet = new Set(openDays);
  // «занятые» дни: были на парах и закрывать там нечего — справка не должна их захватывать
  const blocked = Object.values(days).filter(d => d.attended.length && !openSet.has(d.iso)).map(d => d.iso).sort();
  const partial = new Set(Object.values(days).filter(d => d.attended.length && openSet.has(d.iso)).map(d => d.iso));
  return { held, days, all, open, openDays, blocked, partial, planned: plannedSkips(t0) };
}

// Жадный подбор: от первого незакрытого дня тянем период как можно дальше (≤14 дней, без «занятых» дней).
// Для точек на прямой с запретными точками жадный алгоритм даёт минимальное число отрезков.
function autoPeriods(openDays, blocked) {
  const res = [];
  for (let i = 0; i < openDays.length;) {
    const from = openDays[i];
    let to = from, j = i + 1;
    for (; j < openDays.length; j++) {
      const d = openDays[j];
      if (spanDays(fromIso(from), fromIso(d)) > CERT_MAX) break;
      if (blocked.some(b => b > to && b < d)) break;
      to = d;
    }
    res.push({ from, to });
    i = j;
  }
  return res;
}

// Разбор плана: что покрывает каждый период, ошибки и предупреждения. Каждый пропуск учитывается один раз.
function evalPlan(A, plan) {
  const covered = new Set();
  const periods = plan.map((p, i) => {
    const errs = [], warns = [];
    const ok = isoOk(p.from) && isoOk(p.to);
    if (!ok) errs.push('Укажите обе даты');
    else if (p.to < p.from) errs.push('Дата окончания раньше начала');
    const len = ok && p.to >= p.from ? spanDays(fromIso(p.from), fromIso(p.to)) : 0;
    if (len > CERT_MAX) errs.push(`Период ${len} ${plural(len, 'день', 'дня', 'дней')} — больше 14`);
    const inside = ok ? A.open.filter(x => x.iso >= p.from && x.iso <= p.to) : [];
    const fresh = inside.filter(x => !covered.has(x.key));
    const dup = inside.length - fresh.length;
    if (!errs.length) fresh.forEach(x => covered.add(x.key));
    const busy = ok ? A.blocked.filter(d => d >= p.from && d <= p.to) : [];
    if (busy.length) warns.push(`Захватывает ${busy.length} ${plural(busy.length, 'день', 'дня', 'дней')}, когда вы были на парах: ${busy.map(d => fmtDs(fromIso(d))).join(', ')}`);
    if (ok && !errs.length && !inside.length) warns.push('В этих датах нет незакрытых пропусков');
    if (dup) warns.push(`${dup} ${plural(dup, 'пропуск уже покрыт', 'пропуска уже покрыты', 'пропусков уже покрыты')} другим периодом`);
    const part = [...new Set(inside.map(x => x.iso))].filter(d => A.partial.has(d));
    if (part.length) warns.push(`В ${part.map(d => fmtDs(fromIso(d))).join(', ')} часть пар вы посетили — уточните у врача/деканата`);
    return { ...p, i, len, inside, errs, warns: errs.length ? [] : warns };
  });
  const uncovered = A.open.filter(x => !covered.has(x.key));
  return { periods, covered, uncovered };
}

function dayStrip(p, A) {
  if (!isoOk(p.from) || !isoOk(p.to) || p.to < p.from || p.len > 31) return '';
  const cells = [];
  for (let d = fromIso(p.from); iso(d) <= p.to; d = addDays(d, 1)) {
    const k = iso(d), info = A.days[k];
    const cls = A.blocked.includes(k) ? 's-busy' : A.openDays.includes(k) ? (A.partial.has(k) ? 's-skip s-part' : 's-skip') : info ? 's-closed' : 's-free';
    cells.push(`<i class="${cls}" title="${fmtD(d)}"><b>${d.getDate()}</b></i>`);
  }
  return `<div class="strip">${cells.join('')}</div>`;
}

function lessonList(list) {
  return `<div class="lessons">${list.map(x => `<div class="ls"><span class="ls-d">${fmtDs(x.date)} · ${DOW_SHORT[x.p.d]}</span><span class="ls-s">${esc(x.p.s)}<small>${x.p.n} пара · ${TYPES[x.p.type].toLowerCase()}${x.closed === 'valid' ? ' · уважительная' : ''}</small></span></div>`).join('')}</div>`;
}

function renderCerts() {
  const A = skipAnalysis();
  const auto = autoPeriods(A.openDays, A.blocked);
  const manual = Array.isArray(certPlan);
  const plan = manual ? certPlan : auto;
  const E = evalPlan(A, plan);
  const closed = A.all.filter(x => x.closed);
  const need = E.periods.filter(p => !p.errs.length && p.inside.length).length;
  const total = A.all.length;
  const pc = n => total ? n / total * 100 : 0;

  const summary = `<div class="card glass">
    <div class="kpis kpis4">
      <div class="kpi"><b>${total}</b><span>${plural(total, 'пропуск', 'пропуска', 'пропусков')} всего</span></div>
      <div class="kpi"><b>${closed.length}</b><span>закрыто</span></div>
      <div class="kpi"><b class="rose">${A.open.length}</b><span>не закрыто</span></div>
      <div class="kpi"><b>${manual ? need : auto.length}</b><span>${plural(manual ? need : auto.length, 'справка нужна', 'справки нужно', 'справок нужно')}</span></div>
    </div>
    ${total ? `<div class="stack" role="img" aria-label="Закрыто ${closed.length}, войдут в справки ${E.covered.size}, без справки ${E.uncovered.length}">
      <i class="st-closed" style="width:${pc(closed.length)}%"></i><i class="st-plan" style="width:${pc(E.covered.size)}%"></i><i class="st-open" style="width:${pc(E.uncovered.length)}%"></i></div>
    <div class="legend"><span><i class="st-closed"></i>закрыто · ${closed.length}</span><span><i class="st-plan"></i>нужна справка · ${E.covered.size}</span>${E.uncovered.length ? `<span><i class="st-open"></i>не покрыто · ${E.uncovered.length}</span>` : ''}</div>` : ''}
    ${A.planned.length ? `<p class="hint">${A.planned.length} ${plural(A.planned.length, 'запланированный пропуск', 'запланированных пропуска', 'запланированных пропусков')} ещё не наступили — в анализ не входят.</p>` : ''}
  </div>`;

  if (!total) {
    return `${summary}<div class="card glass"><div class="empty"><img class="empty-acc" src="${ACC.star}" alt=""><br>Пропусков пока нет — справки не нужны</div></div>${certDisclaimer()}`;
  }

  const periodCards = E.periods.map((p, n) => {
    const editing = state.certEdit === p.i;
    const bad = p.errs.length;
    const range = isoOk(p.from) && isoOk(p.to)
      ? `${fmtD(fromIso(p.from))}${p.from !== p.to ? ' – ' + fmtD(fromIso(p.to)) : ''}` : 'Период не задан';
    return `<div class="card glass cert ${bad ? 'bad' : ''}">
      <div class="cert-head"><span class="cert-no">Справка ${n + 1}</span>${!bad ? `<span class="cert-len">${p.len} ${plural(p.len, 'день', 'дня', 'дней')} из 14</span>` : ''}</div>
      <div class="cert-range">${range}</div>
      ${!bad && p.inside.length ? `<p class="cert-sub">Закроет ${p.inside.length} ${plural(p.inside.length, 'пропуск', 'пропуска', 'пропусков')} за ${new Set(p.inside.map(x => x.iso)).size} ${plural(new Set(p.inside.map(x => x.iso)).size, 'день', 'дня', 'дней')}</p>` : ''}
      ${dayStrip(p, A)}
      ${editing ? `<div class="cert-edit">
          <label class="field"><span>С</span><input type="date" data-cp="${p.i}|from" value="${esc(p.from || '')}" min="${iso(SEM_START)}" max="${iso(SEM_END)}"></label>
          <label class="field"><span>По</span><input type="date" data-cp="${p.i}|to" value="${esc(p.to || '')}" min="${iso(SEM_START)}" max="${iso(SEM_END)}"></label>
        </div>` : ''}
      ${p.errs.map(e => `<p class="msg err">${esc(e)}</p>`).join('')}${p.warns.map(w => `<p class="msg warn">${esc(w)}</p>`).join('')}
      ${p.inside.length && !bad ? `<details class="cert-more"><summary>Какие пары покрывает</summary>${lessonList(p.inside)}</details>` : ''}
      <div class="cert-actions">
        ${editing ? `<button class="btn" data-cpdel="${p.i}">Удалить</button><button class="btn accent" data-cpedit="-1">Готово</button>`
          : `<button class="btn" data-cpedit="${p.i}">Изменить</button>${!bad && p.inside.length ? `<button class="btn accent" data-cpdone="${p.i}">Справка получена</button>` : ''}`}
      </div></div>`;
  }).join('');

  const uncoveredCard = E.uncovered.length ? `<div class="card glass"><h3>Не покрыто справками<i>${E.uncovered.length}</i></h3>${lessonList(E.uncovered)}
      <p class="hint">Добавьте период или верните автоподбор.</p></div>` : '';

  const certList = certs.slice().sort((a, b) => a.from.localeCompare(b.from)).map(c => {
    const n = A.all.filter(x => x.cert && x.cert.id === c.id).length;
    return `<div class="hrow"><span class="hd"><b>${fromIso(c.from).getDate()}</b>${MONTHS[fromIso(c.from).getMonth()].slice(0, 3)}</span>
      <span class="hs">${fmtD(fromIso(c.from))}${c.from !== c.to ? ' – ' + fmtD(fromIso(c.to)) : ''}<span>${spanDays(fromIso(c.from), fromIso(c.to))} дн. · закрывает ${n} ${plural(n, 'пропуск', 'пропуска', 'пропусков')}</span></span>
      <button class="btn" data-certdel="${c.id}" aria-label="Удалить справку">${ICON.x}</button></div>`;
  }).join('');
  const valid = closed.filter(x => x.closed === 'valid');

  return `${summary}
    <div class="sec-head"><h2>${manual ? 'Ваш план справок' : 'Рекомендуемые справки'}</h2>
      ${manual ? '<button class="link-btn" data-cpauto>вернуть автоподбор</button>' : ''}</div>
    ${A.open.length ? `<p class="hint sec-hint">${manual ? 'Ручной план: пересчёт идёт сразу после каждого изменения.' : 'Минимум справок: близкие даты объединены, каждая — не больше 14 дней, дни, когда вы были на парах, не захватываются.'} В полосе дней: бордовый — пропуск, светлый — уже закрыт, пустой — пар не было.</p>` : ''}
    ${periodCards || `<div class="card glass"><div class="empty">Все пропуски закрыты</div></div>`}
    ${A.open.length || manual ? `<button class="btn add-period" data-cpadd>${ICON.plus} Добавить период</button>` : ''}
    ${uncoveredCard}
    ${closed.length ? `<div class="card glass"><h3>Закрыто<i>${closed.length}</i></h3>
      ${certList ? `<div class="hist">${certList}</div>` : ''}
      ${valid.length ? `<p class="hint">${valid.length} ${plural(valid.length, 'пропуск закрыт', 'пропуска закрыты', 'пропусков закрыто')} с причиной «Уважительная».</p>` : ''}</div>` : ''}
    ${certDisclaimer()}`;
}
const certDisclaimer = () => `<p class="hint disclaimer">Это инструмент планирования: он показывает, как ваши реальные пропуски сгруппировать по справкам. Справку выдаёт врач по факту болезни — приложение не создаёт документы и оснований для них.</p>`;

/* =====================================================================
   СРАВНЕНИЕ 2–3 ПРЕДМЕТОВ
   ===================================================================== */
const CMP_PALETTE = ['#a9c8e8', '#b25a74', '#9a7fdc', '#d9a55b', '#5fc4b0', '#e6e9ef']; // серебристо-голубой, бордовый, фиолетовый, …
let cmpColors = store.get('hp.cmpColors', {});
let cmpSel = (store.get('hp.cmpSel', null) || []).filter(s => MY_SUBJECTS.includes(s));
if (!store.get('hp.cmpSel', null)) { // по умолчанию — два предмета с наибольшим числом пропусков
  const cnt = {};
  heldPairs().forEach(o => { if (skips[o.key]) cnt[o.p.s] = (cnt[o.p.s] || 0) + 1; });
  cmpSel = MY_SUBJECTS.slice().sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0)).slice(0, 2);
}
function cmpAssign() { // цвет закреплён за предметом; при конфликте — первый свободный
  const used = new Set();
  cmpSel.forEach(s => {
    let c = cmpColors[s];
    if (c == null || used.has(c)) { c = CMP_PALETTE.findIndex((_, i) => !used.has(i)); cmpColors[s] = c; }
    used.add(c);
  });
  store.set('hp.cmpColors', cmpColors); store.set('hp.cmpSel', cmpSel);
}
cmpAssign();
const cmpCol = s => CMP_PALETTE[cmpColors[s] || 0];

function renderCompare() {
  const t0 = now();
  const chips = MY_SUBJECTS.map(s => {
    const on = cmpSel.includes(s);
    return `<button class="cmp-chip ${on ? 'on' : ''}" data-cmps="${esc(s)}" aria-pressed="${on}" ${on ? `style="--c:${cmpCol(s)}"` : ''}><i></i>${esc(s)}</button>`;
  }).join('');
  const head = `<div class="card glass"><h3>Предметы<i>${cmpSel.length} из 3</i></h3><div class="cmp-chips">${chips}</div>
    <p class="hint">Выберите 2–3 предмета. Цвет закрепляется за предметом.</p></div>`;
  if (cmpSel.length < 2) return head + `<div class="card glass"><div class="empty">Выберите ещё ${2 - cmpSel.length} ${plural(2 - cmpSel.length, 'предмет', 'предмета', 'предметов')} для сравнения</div></div>`;

  const lastWeek = Math.max(1, Math.min(weekNo(today.getDay() === 0 ? addDays(today, -1) : today), weekNo(SEM_END)));
  const occ = occurrences(SEM_START, addDays(SEM_START, lastWeek * 7 - 1)).filter(o => cmpSel.includes(o.p.s));
  const byDay = {};
  occ.forEach(o => {
    const d = byDay[iso(o.date)] = byDay[iso(o.date)] || {};
    const x = d[o.p.s] = d[o.p.s] || { skip: 0, att: 0, rest: 0, list: [] };
    x.list.push(o);
    if (skips[o.key]) x.skip++; else if (o.end <= t0) x.att++; else x.rest++;
  });
  const skipDays = s => Object.keys(byDay).filter(k => byDay[k][s] && byDay[k][s].skip);
  const ovCount = k => cmpSel.filter(s => byDay[k] && byDay[k][s] && byDay[k][s].skip).length;

  // сводка по предметам
  const stats = cmpSel.map(s => {
    const held = occ.filter(o => o.p.s === s && o.end <= t0);
    const sk = held.filter(o => skips[o.key]).length;
    const pct = held.length ? Math.round(sk / held.length * 100) : 0;
    return `<div class="cmp-stat" style="--c:${cmpCol(s)}"><div class="subj-top"><span><i class="sw"></i>${esc(s)}</span><span>${sk} из ${held.length} · ${pct}%</span></div>
      <div class="bar"><i style="width:${sk ? Math.max(3, pct) : 0}%"></i></div></div>`;
  }).join('');
  const pairs = [];
  for (let i = 0; i < cmpSel.length; i++) for (let j = i + 1; j < cmpSel.length; j++) {
    const b = new Set(skipDays(cmpSel[j]));
    pairs.push({ a: cmpSel[i], b: cmpSel[j], n: skipDays(cmpSel[i]).filter(k => b.has(k)).length });
  }
  const all3 = cmpSel.length === 3 ? Object.keys(byDay).filter(k => ovCount(k) === 3).length : null;
  const ovChips = pairs.map(p => `<span class="ov-chip"><i style="background:${cmpCol(p.a)}"></i><i style="background:${cmpCol(p.b)}"></i>${p.n} ${plural(p.n, 'день', 'дня', 'дней')}</span>`).join('')
    + (all3 != null ? `<span class="ov-chip three">${cmpSel.map(s => `<i style="background:${cmpCol(s)}"></i>`).join('')}все три · ${all3}</span>` : '');

  // календарная сетка: строки — недели, столбцы — дни недели
  const f = state.cmpFilter || 'all';
  const rowsHtml = [];
  for (let w = 1; w <= lastWeek; w++) {
    const mon = addDays(SEM_START, (w - 1) * 7);
    const cells = DOW_SHORT.map((_, c) => {
      const d = addDays(mon, c), k = iso(d), info = byDay[k] || {};
      const ov = ovCount(k);
      const dim = (f === 'ov2' && ov < 2) || (f === 'ov3' && ov < 3);
      const bars = cmpSel.map(s => {
        const x = info[s];
        if (!x) return '<i></i>';
        return `<i class="${x.skip ? 'sk' : x.rest ? 'fut' : 'at'}${x.skip > 1 ? ' x2' : ''}" style="--c:${cmpCol(s)}"></i>`;
      }).join('');
      const future = d > today;
      return `<button class="cg-cell ${ov >= 2 ? 'ov' + Math.min(ov, 3) : ''} ${dim ? 'dim' : ''} ${state.cmpCell === k ? 'sel' : ''} ${future ? 'fut' : ''} ${HOLIDAYS.has(k) ? 'hol' : ''}"
        data-cell="${k}" aria-label="${fmtD(d)}${ov ? `, пропусков по ${ov} ${plural(ov, 'предмету', 'предметам', 'предметам')}` : ''}"><span class="cg-d">${d.getDate()}</span><span class="cg-bars">${bars}</span></button>`;
    }).join('');
    rowsHtml.push(`<div class="cg-row"><span class="cg-w"><b>${w}</b>${fmtDs(mon).split(' ')[1]}</span>${cells}</div>`);
  }
  const grid = `<div class="cg" style="--n:${cmpSel.length}"><div class="cg-row cg-headrow"><span></span>${DOW_SHORT.map(d => `<span>${d}</span>`).join('')}</div>${rowsHtml.join('')}</div>`;

  // подробности выбранного дня
  let detail = '';
  if (state.cmpCell) {
    const d = fromIso(state.cmpCell), info = byDay[state.cmpCell] || {};
    const items = cmpSel.flatMap(s => (info[s] ? info[s].list : []).map(o => ({ o, s }))).sort((a, b) => a.o.p.n - b.o.p.n);
    detail = `<div class="cg-detail glass fade-in"><div class="cgd-head"><b>${DOW_LONG[dow(d)]}, ${fmtD(d)}</b><button class="btn round sm" data-cell="" aria-label="Закрыть">${ICON.x}</button></div>
      ${items.length ? items.map(({ o, s }) => `<div class="cgd-row" style="--c:${cmpCol(s)}"><i class="sw"></i><span>${esc(s)}<small>${o.p.n} пара · ${TYPES[o.p.type].toLowerCase()}${o.p.room ? ' · ' + esc(o.p.room) : ''}</small></span>
        <em class="${skips[o.key] ? 'sk' : ''}">${skips[o.key] ? (o.end > t0 ? 'не пойду' : 'пропуск') : o.end > t0 ? 'впереди' : 'был'}</em></div>`).join('')
        : '<p class="empty">В этот день выбранных предметов нет</p>'}</div>`;
  }

  return `${head}
    <div class="card glass"><h3>Пропуски<i>из прошедших</i></h3>${stats}<div class="ov-chips">${ovChips}</div></div>
    <div class="card glass cg-card"><h3>Календарь<i>неделя × день</i></h3>
      <div class="seg glass mini-seg" role="group" aria-label="Фильтр">${[['all', 'Все'], ['ov2', 'Совпадения'], ...(cmpSel.length === 3 ? [['ov3', 'Все три']] : [])]
        .map(([k, l]) => `<button data-cmpf="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
      ${grid}
      <div class="legend"><span><i class="lg-sk"></i>пропуск</span><span><i class="lg-at"></i>был</span><span><i class="lg-ov"></i>совпадение</span></div>
      ${detail}
      ${occ.some(o => skips[o.key]) ? '' : '<p class="hint">По выбранным предметам пропусков нет — в сетке видно только расписание.</p>'}
    </div>`;
}

/* =====================================================================
   СЕРИИ И АЧИВКИ
   ===================================================================== */
let exams = store.get('hp.exams', []);
const saveExams = () => store.set('hp.exams', exams);

function attendanceStats() {
  const t0 = now();
  const held = heldPairs(t0);
  let cur = 0, best = 0, early = 0, skipped = 0;
  held.forEach(o => {
    if (skips[o.key]) { cur = 0; skipped++; } else { cur++; best = Math.max(best, cur); if (o.p.n === 1) early++; }
  });
  // недели: только завершённые, с хотя бы одной парой
  const weeks = {};
  held.forEach(o => { const w = weekNo(o.date); (weeks[w] = weeks[w] || { held: 0, skip: 0 }); weeks[w].held++; if (skips[o.key]) weeks[w].skip++; });
  const curWeek = weekNo(today);
  const done = Object.keys(weeks).map(Number).filter(w => w < curWeek || (w === curWeek && today.getDay() === 0)).sort((a, b) => a - b);
  let wCur = 0, wBest = 0, clean = 0;
  done.forEach(w => { if (!weeks[w].skip) { wCur++; clean++; wBest = Math.max(wBest, wCur); } else wCur = 0; });
  const bySubj = {};
  held.forEach(o => { const s = bySubj[o.p.s] = bySubj[o.p.s] || { h: 0, k: 0 }; s.h++; if (skips[o.key]) s.k++; });
  const A = skipAnalysis(t0);
  return {
    held: held.length, skipped, pct: held.length ? (held.length - skipped) / held.length * 100 : 0,
    cur, best, early, wCur, wBest, clean,
    safe: Object.values(bySubj).every(s => s.k / s.h < LIMIT),
    allClosed: A.all.length > 0 && A.open.length === 0,
    passed: exams.filter(e => e.grade && e.grade !== '2' && e.grade !== 'nz').length,
    five: exams.some(e => e.grade === '5'),
  };
}
const ACHS = [
  { id: 's10', t: 'Разгон', d: '10 пар подряд без пропуска', goal: 10, v: s => s.best },
  { id: 's25', t: 'Железный ритм', d: '25 пар подряд без пропуска', goal: 25, v: s => s.best },
  { id: 's50', t: 'Несгибаемый', d: '50 пар подряд без пропуска', goal: 50, v: s => s.best },
  { id: 'w1', t: 'Чистая неделя', d: 'Неделя без единого пропуска', goal: 1, v: s => s.clean },
  { id: 'w4', t: 'Месяц без прогулов', d: '4 чистые недели подряд', goal: 4, v: s => s.wBest },
  { id: 'early', t: 'Ранняя пташка', d: '10 первых пар в 08:30', goal: 10, v: s => s.early },
  { id: 'p90', t: 'Девяносто', d: 'Посещаемость 90%+ после 40 пар', goal: 1, v: s => s.held >= 40 && s.pct >= 90 ? 1 : 0, p: s => `${Math.round(s.pct)}% · ${Math.min(s.held, 40)}/40 пар` },
  { id: 'safe', t: 'Без хвостов', d: 'Ни один предмет не за чертой 25% (после 30 пар)', goal: 1, v: s => s.held >= 30 && s.safe ? 1 : 0, p: s => s.safe ? `${Math.min(s.held, 30)}/30 пар` : 'есть предмет за чертой' },
  { id: 'paper', t: 'Бумаги в порядке', d: 'Все пропуски закрыты', goal: 1, v: s => s.allClosed ? 1 : 0, p: s => s.skipped ? 'есть незакрытые' : 'пока нет пропусков' },
  { id: 'exam1', t: 'Первая сдача', d: 'Сдать экзамен или зачёт', goal: 1, v: s => s.passed },
  { id: 'exam5', t: 'Отлично', d: 'Получить «5» в сессию', goal: 1, v: s => s.five ? 1 : 0 },
];
let achDone = store.get('hp.ach', null);
function checkAchievements() {
  const st = attendanceStats();
  const first = !achDone;
  achDone = achDone || {};
  const fresh = ACHS.filter(a => a.v(st) >= a.goal && !achDone[a.id]);
  if (!fresh.length && !first) return;
  fresh.forEach(a => { achDone[a.id] = iso(today); });
  store.set('hp.ach', achDone);
  if (!first && fresh.length) {
    toast(`Ачивка: ${fresh[0].t}${fresh.length > 1 ? ` и ещё ${fresh.length - 1}` : ''}`);
    state.achFresh = fresh.map(a => a.id);
    if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
  }
}
const achSeal = on => `<svg viewBox="-50 -50 100 100" aria-hidden="true"><use href="#burst" x="-50" y="-50" width="100" height="100" fill="${on ? '#642c3e' : 'rgba(255,255,255,.04)'}" stroke="${on ? '#d5d9de' : 'rgba(255,255,255,.22)'}" stroke-width="1.4"/>
  ${on ? '<path d="M-12 1 -3 10 14 -9" fill="none" stroke="#f5f6f7" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' : '<rect x="-9" y="-3" width="18" height="14" rx="3" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"/><path d="M-5 -3v-5a5 5 0 0 1 10 0v5" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"/>'}</svg>`;

function streakCard() {
  const st = attendanceStats();
  const got = ACHS.filter(a => (achDone && achDone[a.id]) || a.v(st) >= a.goal);
  const tiles = ACHS.map(a => {
    const v = a.v(st), on = (achDone && achDone[a.id]) || v >= a.goal;
    const prog = a.p ? a.p(st) : `${Math.min(v, a.goal)}/${a.goal}`;
    return `<div class="ach ${on ? 'on' : ''} ${state.achFresh && state.achFresh.includes(a.id) ? 'fresh' : ''}">${achSeal(on)}
      <div><b>${a.t}</b><span>${a.d}</span>${on ? `<em>получено${achDone && achDone[a.id] ? ' ' + fmtDs(fromIso(achDone[a.id])) : ''}</em>`
        : `<div class="bar"><i style="width:${a.goal > 1 ? Math.min(100, v / a.goal * 100) : 0}%"></i></div><em>${prog}</em>`}</div></div>`;
  }).join('');
  state.achFresh = null;
  return `<div class="card glass"><h3>Серии<i>без пропусков</i></h3>
    <div class="streaks">
      <div class="kpi"><b>${st.cur}</b><span>${plural(st.cur, 'пара', 'пары', 'пар')} подряд сейчас</span></div>
      <div class="kpi"><b>${st.best}</b><span>рекорд серии</span></div>
      <div class="kpi"><b>${st.wCur}</b><span>${plural(st.wCur, 'чистая неделя', 'чистые недели', 'чистых недель')} подряд</span></div>
    </div></div>
    <div class="card glass"><h3>Ачивки<i>${got.length} из ${ACHS.length}</i></h3><div class="ach-grid">${tiles}</div></div>`;
}

/* =====================================================================
   СЕССИЯ И ЗАЧЁТЫ
   ===================================================================== */
const KINDS = { exam: 'Экзамен', zach: 'Зачёт', dz: 'Диф. зачёт', kp: 'Защита курсовой' };
const GRADES = { 5: '5', 4: '4', 3: '3', 2: '2', z: 'зачёт', nz: 'незачёт' };
const gradeSet = k => (k === 'zach' ? ['z', 'nz'] : ['5', '4', '3', '2']);

function renderSession() {
  const t0 = now();
  const list = exams.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const upcoming = list.filter(e => !e.grade && fromIso(e.date) >= today);
  const next = upcoming[0];
  const dLeft = d => Math.round((fromIso(d) - today) / DAY_MS);
  const semLeft = Math.max(0, Math.round((SEM_END - today) / DAY_MS));
  const hero = next
    ? `<div class="card glass count-hero"><span class="ch-num">${dLeft(next.date) || '0'}</span>
        <div><small>${dLeft(next.date) === 0 ? 'сегодня' : plural(dLeft(next.date), 'день', 'дня', 'дней') + ' до'}</small><b>${esc(KINDS[next.kind])} · ${esc(next.s)}</b>
        <span>${fmtD(fromIso(next.date))}${next.time ? ', ' + next.time : ''}${next.room ? ' · ' + esc(next.room) : ''}</span></div></div>`
    : `<div class="card glass count-hero"><span class="ch-num">${semLeft}</span>
        <div><small>${plural(semLeft, 'день', 'дня', 'дней')} до конца семестра</small><b>${fmtD(SEM_END)}</b><span>Добавьте экзамены и зачёты — появится обратный отсчёт</span></div></div>`;

  const off = D.session
    ? `<a class="btn accent wide" href="${esc(D.session.url)}" target="_blank" rel="noopener">Открыть: ${esc(D.session.label)} ${ICON.right}</a>`
    : `<p class="cert-sub">Расписание зимней сессии для ${esc(GROUP.inst || '')} ${GROUP.course || ''} курса на mgsu.ru пока не опубликовано. Приложение проверит при следующем обновлении расписания.</p>
       ${D.source ? `<a class="link-btn" href="${esc(D.source.site)}" target="_blank" rel="noopener">страница расписаний на mgsu.ru</a>` : ''}`;

  // допуск: доля пропусков по предметам за прошедшие пары
  const by = {};
  heldPairs(t0).forEach(o => { const s = by[o.p.s] = by[o.p.s] || { held: 0, skip: 0 }; s.held++; if (skips[o.key]) s.skip++; });
  const risk = Object.entries(by).filter(([, v]) => v.skip / v.held >= LIMIT);
  const admit = rows(Object.entries(by).sort((a, b) => b[1].skip / b[1].held - a[1].skip / a[1].held || a[0].localeCompare(b[0], 'ru')));

  const items = list.map(e => {
    const d = fromIso(e.date), past = d < today, left = dLeft(e.date);
    return `<div class="exam ${e.grade ? 'done' : ''}">
      <span class="hd"><b>${d.getDate()}</b>${MONTHS[d.getMonth()].slice(0, 3)}</span>
      <span class="hs">${esc(e.s)}<span>${esc(KINDS[e.kind])}${e.time ? ' · ' + e.time : ''}${e.room ? ' · ' + esc(e.room) : ''}${!e.grade && !past ? ` · ${left === 0 ? 'сегодня' : 'через ' + left + ' ' + plural(left, 'день', 'дня', 'дней')}` : ''}</span></span>
      <button class="btn" data-exdel="${e.id}" aria-label="Удалить">${ICON.x}</button>
      ${past || e.grade ? `<div class="reasons">${gradeSet(e.kind).map(g => `<button class="chip" data-grade="${e.id}|${g}" aria-pressed="${e.grade === g}">${GRADES[g]}</button>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  const passed = list.filter(e => e.grade && e.grade !== '2' && e.grade !== 'nz').length;
  const subjOpts = MY_SUBJECTS.map(s => `<option>${esc(s)}</option>`).join('');

  return `${brand()}
    <header class="page-title img-title"><div><h1><img class="title-img" src="assets/title-sessia.png" alt="Сессия" width="1600" height="585"></h1><p>Экзамены и зачёты</p></div><img class="star" src="${ACC.star}" alt=""></header>
    ${hero}
    <div class="card glass"><h3>Официальное расписание</h3>${off}</div>
    <div class="card glass"><h3>Мои экзамены и зачёты<i>${list.length ? `сдано ${passed} из ${list.length}` : ''}</i></h3>
      ${items ? `<div class="hist">${items}</div>` : '<p class="empty">Пока пусто — добавьте первый экзамен ниже</p>'}</div>
    <form class="card glass xform" id="xf">
      <h3>Добавить</h3>
      <label class="field"><span>Предмет</span><select id="x-s">${subjOpts}<option value="">Другой…</option></select></label>
      <label class="field" id="x-own-wrap" hidden><span>Название</span><input id="x-own" autocomplete="off" placeholder="Название предмета"></label>
      <div class="seg glass" role="group" aria-label="Вид">${Object.entries(KINDS).map(([k, l], i) => `<button type="button" data-xkind="${k}" aria-pressed="${(state.xKind || 'exam') === k}">${l.replace('Защита курсовой', 'Курсовая')}</button>`).join('')}</div>
      <div class="two"><label class="field"><span>Дата</span><input type="date" id="x-d" required min="${iso(today)}"></label>
        <label class="field"><span>Время</span><input type="time" id="x-t" value="09:00"></label></div>
      <label class="field"><span>Аудитория</span><input id="x-r" autocomplete="off" placeholder="Например, 509 Г / УЛБ"></label>
      <button class="btn accent" type="submit">Добавить ${ICON.plus}</button>
    </form>
    <div class="card glass"><h3>Допуск<i>${risk.length ? `под угрозой: ${risk.length}` : 'по посещаемости'}</i></h3>${admit || '<p class="empty">Пары ещё не начались</p>'}
      <p class="hint">Бордовым — пропущено ${Math.round(LIMIT * 100)}% и больше прошедших пар. Уточняйте требования у преподавателя.</p></div>`;
}
VIEWS.session = renderSession;

/* =====================================================================
   ОБНОВЛЕНИЕ РАСПИСАНИЯ
   При запуске приложение сравнивает своё расписание с сохранённым снимком и показывает, что изменилось.
   Раз в 30 минут (и по кнопке) проверяет, не выложен ли на сервере новый data.js.
   ===================================================================== */
const sigOf = rows => rows.map(p => [p.d, p.n, p.w, p.s, p.type, p.room, p.t || '', (p.weeks || []).join(','), p.from || '', p.to || ''].join('~')).sort();
const CUR_SIG = sigOf(MINE);
let schedChanges = null, updateReady = null, updState = '';
(function diffSnapshot() {
  const snap = store.get('hp.schedSnap', null);
  if (!snap || !Array.isArray(snap.sig)) { store.set('hp.schedSnap', { sig: CUR_SIG, updated: D.source && D.source.updated }); return; }
  if (snap.sig.join('\n') === CUR_SIG.join('\n')) return;
  const a = new Set(snap.sig), b = new Set(CUR_SIG);
  schedChanges = { added: CUR_SIG.filter(x => !a.has(x)), removed: snap.sig.filter(x => !b.has(x)), from: snap.updated };
})();
const WN = { both: '', odd: 'нечёт.', even: 'чёт.' };
const sigLine = s => {
  const [d, n, w, subj, type, room, , weeks, from, to] = s.split('~');
  const wk = weeks ? `${weeks} нед.` : from && to ? `${from}–${to} нед.` : from ? `с ${from} нед.` : to ? `до ${to} нед.` : '';
  return `<b>${DOW_SHORT[d]}, ${n} пара</b> ${[WN[w], wk].filter(Boolean).join(' ')} · ${esc((TYPES[type] || '').toLowerCase())} ${esc(subj)}${room ? ' · ' + esc(room) : ''}`;
};
function changesCard() {
  if (updateReady) return `<div class="card glass upd fade-in"><h3>Новое расписание<i>${updateReady.updated ? updateReady.updated.split('-').reverse().join('.') : ''}</i></h3>
    <p class="cert-sub">На сервере лежит обновлённое расписание вашей группы.</p><button class="btn accent wide" data-reload>Обновить ${ICON.right}</button></div>`;
  if (!schedChanges) return '';
  const lim = 6, add = schedChanges.added, rem = schedChanges.removed;
  return `<div class="card glass upd fade-in"><h3>Расписание изменилось<i>${add.length + rem.length}</i></h3>
    ${add.slice(0, lim).map(s => `<p class="chg add">+ ${sigLine(s)}</p>`).join('')}${add.length > lim ? `<p class="hint">и ещё ${add.length - lim}</p>` : ''}
    ${rem.slice(0, lim).map(s => `<p class="chg rem">− ${sigLine(s)}</p>`).join('')}${rem.length > lim ? `<p class="hint">и ещё ${rem.length - lim}</p>` : ''}
    <p class="hint">Отметки о пропусках привязаны к дате и номеру пары — они сохранены.</p>
    <button class="btn wide" data-chok>Понятно</button></div>`;
}
async function checkUpdate(manual) {
  const last = store.get('hp.updChecked', 0);
  if (!manual && Date.now() - last < 30 * 60e3) return;
  store.set('hp.updChecked', Date.now());
  if (manual) toast('Проверяю…');
  try {
    const txt = await (await fetch('data.js?t=' + Date.now(), { cache: 'no-store' })).text();
    const m = txt.match(/window\.DATA\s*=\s*([\s\S]*?);?\s*$/);
    const nd = JSON.parse(m[1]);
    const id = nd.group.id || nd.group.group;
    const changed = sigOf(nd.schedule.filter(p => p.g === id)).join('\n') !== CUR_SIG.join('\n') || id !== MY;
    if (changed) { updateReady = { updated: nd.source && nd.source.updated }; if (state.tab === 'pairs') render(); if (manual) toast('Есть новое расписание'); }
    else if (manual) toast('Расписание актуально');
  } catch (e) { if (manual) toast('Не удалось проверить — нет связи'); }
}
AFTER_RENDER.push(() => {
  if (state.tab !== 'pairs') return;
  const html = changesCard();
  if (!html) return;
  const anchor = app.querySelector('.days') || app.firstElementChild;
  anchor.insertAdjacentHTML('beforebegin', html);
});
AFTER_RENDER.push(checkAchievements);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(false); });
setTimeout(() => checkUpdate(false), 4000);

/* =====================================================================
   СОБЫТИЯ
   ===================================================================== */
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.sub) { state.sub = ds.sub; store.set('hp.skipsSub', ds.sub); state.certEdit = null; render(); return; }
  // справки
  if (ds.cpedit != null) {
    const i = +ds.cpedit;
    if (i >= 0 && !Array.isArray(certPlan)) { const A = skipAnalysis(); certPlan = autoPeriods(A.openDays, A.blocked); saveCertPlan(); }
    state.certEdit = i >= 0 ? i : null; render(); return;
  }
  if (ds.cpdel != null) { certPlan.splice(+ds.cpdel, 1); saveCertPlan(); state.certEdit = null; render(); toast('Период удалён'); return; }
  if ('cpadd' in ds) {
    const A = skipAnalysis();
    const plan = Array.isArray(certPlan) ? certPlan : autoPeriods(A.openDays, A.blocked);
    const E = evalPlan(A, plan);
    const start = E.uncovered[0] ? E.uncovered[0].iso : iso(today);
    certPlan = [...plan, { from: start, to: start }]; saveCertPlan();
    state.certEdit = certPlan.length - 1; render(); return;
  }
  if ('cpauto' in ds) { certPlan = null; saveCertPlan(); state.certEdit = null; render(); toast('Автоподбор включён'); return; }
  if (ds.cpdone != null) {
    const A = skipAnalysis();
    const plan = Array.isArray(certPlan) ? certPlan : autoPeriods(A.openDays, A.blocked);
    const p = plan[+ds.cpdone];
    if (!p) return;
    certs.push({ id: uid(), from: p.from, to: p.to, at: Date.now() }); saveCerts();
    if (Array.isArray(certPlan)) { certPlan.splice(+ds.cpdone, 1); saveCertPlan(); }
    state.certEdit = null; render(); toast('Справка отмечена — пропуски закрыты'); return;
  }
  if (ds.certdel) { certs = certs.filter(c => c.id !== ds.certdel); saveCerts(); render(); toast('Справка удалена'); return; }
  // сравнение
  if (ds.cmps) {
    const s = ds.cmps;
    if (cmpSel.includes(s)) cmpSel = cmpSel.filter(x => x !== s);
    else if (cmpSel.length >= 3) { toast('Не больше трёх предметов'); return; }
    else cmpSel = [...cmpSel, s];
    if (state.cmpFilter === 'ov3' && cmpSel.length < 3) state.cmpFilter = 'all';
    cmpAssign(); render(); return;
  }
  if (ds.cmpf) { state.cmpFilter = ds.cmpf; render(); return; }
  if (ds.cell != null) {
    state.cmpCell = ds.cell && ds.cell !== state.cmpCell ? ds.cell : null; render();
    const el = document.querySelector('.cg-detail');
    if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    return;
  }
  // сессия
  if (ds.xkind) { state.xKind = ds.xkind; t.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === t)); return; }
  if (ds.exdel) { exams = exams.filter(x => x.id !== ds.exdel); saveExams(); render(); toast('Удалено'); return; }
  if (ds.grade) {
    const [id, g] = ds.grade.split('|'); const x = exams.find(y => y.id === id);
    if (x) { x.grade = x.grade === g ? null : g; saveExams(); render(); }
    return;
  }
  // обновления
  if ('upd' in ds) { checkUpdate(true); return; }
  if ('reload' in ds) { location.reload(); return; }
  if ('chok' in ds) { store.set('hp.schedSnap', { sig: CUR_SIG, updated: D.source && D.source.updated }); schedChanges = null; render(); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.cp) {
    const [i, f] = el.dataset.cp.split('|');
    if (!certPlan || !certPlan[+i]) return;
    certPlan[+i][f] = el.value; saveCertPlan(); render();
    return;
  }
  if (el.id === 'x-s') document.getElementById('x-own-wrap').hidden = el.value !== '';
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'xf') return;
  e.preventDefault();
  const sel = document.getElementById('x-s').value;
  const s = (sel || document.getElementById('x-own').value).trim();
  const date = document.getElementById('x-d').value;
  if (!s) { toast('Укажите предмет'); return; }
  if (!isoOk(date)) { toast('Укажите дату'); return; }
  exams.push({ id: uid(), s, kind: state.xKind || 'exam', date, time: document.getElementById('x-t').value, room: document.getElementById('x-r').value.trim(), grade: null });
  saveExams(); render(); toast('Добавлено');
});
