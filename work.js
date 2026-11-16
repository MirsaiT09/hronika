/* =====================================================================
   РАБОТА: календарь на 2 недели — где учёба, где дорога, где «окна», где смена.
   Тап по дню → полоса дня (08:00–22:00) и пары: можно отметить «не иду» (с предложением
   продлить пропуск на следующие такие же пары) и поставить смену в свободное время.
   ===================================================================== */
const WORK_DEF = { from: '08:00', to: '22:00', road: 40, full: 8, half: 4, offDay: [], offWeek: [], shifts: {} };
let work = Object.assign({}, WORK_DEF, store.get('hp.work', {}));
work.shifts = work.shifts || {};
const saveWork = () => store.set('hp.work', work);
// пропуск ради работы: offDay — конкретная пара («2026-11-23|1»), offWeek — (старое) эта пара каждую неделю
const slotOf = p => [p.d, p.n, p.w, p.s, p.type].join('|');
const offMode = o => work.offDay.includes(o.key) ? 'day' : work.offWeek.includes(slotOf(o.p)) ? 'week' : '';
state.wWeek = 0;
state.wSel = null;   // выбранный день (iso)
state.wDup = null;   // пара, для которой предлагаем продлить пропуск
const W_DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const ddmm = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
const fmtH = m => { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} ч ${r} мин` : `${h} ч`; };

// сколько пар предмета за семестр и сколько уже пропущено — чтобы предупредить о лимите
let subjStatCache = null;
function subjStats() {
  if (subjStatCache) return subjStatCache;
  const st = {};
  occurrences(SEM_START, SEM_END).forEach(o => {
    const s = st[o.p.s] = st[o.p.s] || { total: 0, skip: 0 };
    s.total++; if (skips[o.key]) s.skip++;
  });
  return (subjStatCache = st);
}
AFTER_RENDER.push(() => { subjStatCache = null; });

/* ---------- день: полоса времени ---------- */
// сегменты: study — пары, road — дорога, gap — окно (сидишь в вузе: уехать на работу не успеть), free — свободно, shift — смена
function workDay(d) {
  const k = iso(d);
  const sunday = d.getDay() === 0;
  const pairs = sunday ? [] : occurrences(d, d);
  const goes = o => !skips[o.key] && !offMode(o);
  const attend = pairs.filter(goes);
  const missed = pairs.filter(o => !goes(o) && !skips[o.key]);
  const S = at(d, work.from), E = at(d, work.to), road = work.road * 6e4;
  const seg = [];
  const add = (a, b, t) => { a = new Date(Math.max(a, S)); b = new Date(Math.min(b, E)); if (b > a) seg.push({ a, b, t }); };
  // блоки «в вузе»: пары подряд; промежуток короче, чем съездить туда-обратно + час работы, — окно
  const blocks = [];
  attend.slice().sort((x, y) => x.start - y.start).forEach(o => {
    const last = blocks[blocks.length - 1];
    if (last && o.start - last.b < 2 * road + 60 * 6e4) { if (o.start > last.b) last.gaps.push([last.b, o.start]); last.b = new Date(Math.max(last.b, o.end)); last.items.push(o); }
    else blocks.push({ a: o.start, b: o.end, items: [o], gaps: [] });
  });
  const free = [];
  let cur = S;
  blocks.forEach(bl => {
    const ra = new Date(bl.a - road), rb = new Date(+bl.b + road);
    if (ra > cur) free.push([cur, ra]);
    add(ra, bl.a, 'road');
    bl.items.forEach(o => add(o.start, o.end, 'study'));
    bl.gaps.forEach(([a, b]) => add(a, b, 'gap'));
    add(bl.b, rb, 'road');
    if (rb > cur) cur = rb;
  });
  if (cur < E) free.push([cur, E]);
  const wins = free.filter(([a, b]) => b > a).map(([a, b]) => ({ a, b, m: Math.round((b - a) / 6e4) }));
  const best = wins.slice().sort((x, y) => y.m - x.m)[0] || null;
  const kind = !best ? 'no' : best.m >= work.full * 60 ? 'full' : best.m >= work.half * 60 ? 'half' : 'no';
  // смена, поставленная студентом
  const sh = work.shifts[k];
  let shift = null;
  if (sh) {
    const a = at(d, sh.from), b = at(d, sh.to);
    const fits = wins.some(w => a >= w.a && b <= w.b);
    shift = { a, b, fits, m: Math.round((b - a) / 6e4) };
  }
  wins.forEach(w => {
    if (shift && shift.a < w.b && shift.b > w.a) {
      add(w.a, shift.a, 'free'); add(shift.a, shift.b, 'shift'); add(shift.b, w.b, 'free');
    } else add(w.a, w.b, 'free');
  });
  if (shift && !shift.fits) add(shift.a, shift.b, 'clash');
  seg.sort((x, y) => x.a - y.a);
  let when = '';
  if (best && kind !== 'no') {
    const all = best.a <= S && best.b >= E;
    when = all ? 'весь день' : best.a <= S ? `до ${hm(best.b)}` : best.b >= E ? `с ${hm(best.a)}` : `${hm(best.a)}–${hm(best.b)}`;
  }
  return { d, k, kind, when, best, wins, seg, shift, attend, missed, pairs, S, E,
    holiday: HOLIDAYS.has(k), sunday, past: d < today };
}

const barHtml = (x, big) => {
  const span = x.E - x.S;
  const segs = x.seg.map(s => `<i class="wb-${s.t}" style="left:${((s.a - x.S) / span * 100).toFixed(2)}%;width:${((s.b - s.a) / span * 100).toFixed(2)}%"></i>`).join('');
  if (!big) return `<span class="wbar">${segs}</span>`;
  const h0 = Math.ceil(x.S.getHours() + x.S.getMinutes() / 60), h1 = Math.floor(x.E.getHours() + x.E.getMinutes() / 60);
  let ticks = '';
  for (let h = h0; h <= h1; h += 2) { const t = at(x.d, `${String(h).padStart(2, '0')}:00`); ticks += `<span style="left:${((t - x.S) / span * 100).toFixed(2)}%">${h}</span>`; }
  const tnow = now(), nowMark = iso(tnow) === x.k && tnow > x.S && tnow < x.E ? `<b class="wb-now" style="left:${((tnow - x.S) / span * 100).toFixed(2)}%"></b>` : '';
  return `<div class="wbar big">${segs}${nowMark}</div><div class="wticks">${ticks}</div>`;
};

function workCost(day) {
  if (!day.missed.length) return '';
  const st = subjStats();
  return [...new Set(day.missed.map(o => o.p.s))].map(s => {
    const x = st[s] || { total: 0, skip: 0 };
    const allow = Math.floor(x.total * LIMIT);
    const after = x.skip + day.missed.filter(o => o.p.s === s).length;
    const warn = after > allow ? 'over' : after >= allow - 1 ? 'near' : '';
    return `<span class="wk-cost ${warn}">${esc(s)} · ${after}/${allow}</span>`;
  }).join('');
}

// следующие такие же пары (тот же день недели, номер, предмет, тип) после даты
const sameNext = o => occurrences(addDays(o.date, 1), SEM_END).filter(x => slotOf(x.p) === slotOf(o.p) && !skips[x.key]);

function workText(days) {
  const sh = days.filter(x => !x.past && x.shift);
  if (sh.length) return 'Мои смены:\n' + sh.map(x => `${W_DOW[dow(x.d)]} ${ddmm(x.d)} — ${hm(x.shift.a)}–${hm(x.shift.b)}`).join('\n');
  const lines = days.filter(x => !x.past && x.kind !== 'no').map(x =>
    `${W_DOW[dow(x.d)]} ${ddmm(x.d)} — ${x.kind === 'full' ? 'полная смена' : 'полсмены'}, ${x.when}`);
  return lines.length ? 'Могу выйти на смену:\n' + lines.join('\n') : '';
}

/* ---------- карточка выбранного дня ---------- */
function dayCard(x) {
  const lbl = { full: 'можно полную смену', half: 'можно полсмены', no: 'смену не взять' };
  const dur = x.shift ? x.shift.m : 0;
  // варианты смены: в каждом окне — с начала окна; длительность — смена / полсмены
  const opts = [];
  x.wins.forEach(w => [work.full, work.half].forEach(h => { if (w.m >= h * 60) opts.push({ a: w.a, h }); }));
  const uniq = [...new Map(opts.map(o => [hm(o.a) + o.h, o])).values()].slice(0, 4);
  const shiftCtl = x.past ? '' : x.shift
    ? `<div class="wk-shift ${x.shift.fits ? '' : 'bad'}"><span><b>Смена ${hm(x.shift.a)}–${hm(x.shift.b)}</b> · ${fmtH(dur)}${x.shift.fits ? '' : ' · <em>пересекается с учёбой или дорогой</em>'}</span>
        <span class="wk-shift-act"><button class="btn round sm" data-wmove="-30" aria-label="На полчаса раньше">${ICON.left}</button><button class="btn round sm" data-wmove="30" aria-label="На полчаса позже">${ICON.right}</button><button class="link-btn" data-wshift="">убрать</button></span></div>`
    : uniq.length ? `<div class="wk-shift-opts"><span class="gp-lbl">Поставить смену</span>${uniq.map(o => `<button class="chip" data-wshift="${hm(o.a)}|${o.h}">${o.h === work.full ? 'Смена' : 'Полсмены'} с ${hm(o.a)} · ${o.h} ч</button>`).join('')}</div>`
    : '<p class="hint">Свободного времени под смену нет — отметьте пары, которые можно пропустить.</p>';
  const dup = state.wDup && state.wDup.k === x.k ? (() => {
    const o = x.pairs.find(p => p.key === state.wDup.key);
    if (!o || !offMode(o)) return '';
    const nx = sameNext(o).filter(q => !offMode(q));
    if (!nx.length) return '';
    const btn = (n, l) => `<button class="chip" data-wdup="${n}">${l}</button>`;
    return `<div class="wk-dup fold-in"><p><b>Не идти и на следующие такие пары?</b><br><small>${esc(o.p.s)} · ${W_DOW[o.p.d]}, ${o.p.n} пара${o.p.w !== 'both' ? ' · ' + (o.p.w === 'odd' ? 'нечётные' : 'чётные') + ' недели' : ''}</small></p>
      <div class="chips">${btn(1, `ещё ${ddmm(nx[0].date)}`)}${nx.length > 1 ? btn(2, `ещё 2 раза · до ${ddmm(nx[1].date)}`) : ''}${nx.length > 2 ? btn(nx.length, `до конца семестра · ${nx.length}`) : ''}<button class="link-btn" data-wdup="0">только этот раз</button></div></div>`;
  })() : '';
  const pairRow = o => {
    const m = skips[o.key] ? 'skip' : offMode(o);
    const lab = { '': 'иду', day: 'не иду', week: 'не иду (каждую неделю)', skip: 'отмечено «не пойду»' }[m];
    return `<button class="wk-pair ${m ? 'off ' + m : ''}" ${m === 'skip' || x.past ? 'disabled' : `data-woff="${o.key}"`}>
      <span class="wk-pt"><b>${BELLS[o.p.n][0]}</b>${o.p.n} пара</span>
      <span class="wk-ps"><span>${esc(o.p.s)}</span><small>${TYPES[o.p.type]}${o.p.room ? ' · ' + esc(o.p.room) : ''}${o.p.t && TEACHERS[o.p.t] ? ' · ' + esc(TEACHERS[o.p.t].name) : ''}</small></span>
      <span class="wk-pm">${lab}</span></button>`;
  };
  return `<div class="card glass wk-daycard fade-in">
    <h3>${DOW_LONG[dow(x.d)]}, ${x.d.getDate()} ${MONTHS[x.d.getMonth()]}<i class="wk-st ${x.shift ? 'shift' : x.kind}">${x.shift ? 'смена поставлена' : x.sunday ? 'выходной' : lbl[x.kind]}</i></h3>
    ${barHtml(x, true)}
    <div class="wk-legend wl"><span><i class="wb-study"></i>учёба</span><span><i class="wb-road"></i>дорога</span><span><i class="wb-gap"></i>окно</span><span><i class="wb-free"></i>свободно</span><span><i class="wb-shift"></i>смена</span></div>
    ${shiftCtl}
    ${x.pairs.length ? `<p class="gp-lbl">Пары · нажмите, чтобы пропустить</p><div class="wk-pairs">${x.pairs.map(pairRow).join('')}</div>` : `<p class="hint">${x.sunday ? 'Воскресенье — пар нет.' : x.holiday ? 'Праздник — пар нет.' : 'Пар нет.'}</p>`}
    ${dup}
    ${workCost(x) ? `<div class="wk-costs"><span class="gp-lbl">Пропуски по предмету</span>${workCost(x)}</div>` : ''}
  </div>`;
}

function renderWork() {
  const mon = addDays(baseMonday, state.wWeek * 7);
  const days = [];
  for (let i = 0; i < 14; i++) days.push(workDay(addDays(mon, i)));
  if (!state.wSel || !days.some(x => x.k === state.wSel)) state.wSel = (days.find(x => !x.past) || days[0]).k;
  const sel = days.find(x => x.k === state.wSel);
  const plan = days.filter(x => x.shift && !x.past);
  const nFull = days.filter(x => x.kind === 'full' && !x.past).length, nHalf = days.filter(x => x.kind === 'half' && !x.past).length;
  const hours = plan.reduce((a, x) => a + x.shift.m, 0);
  const cell = x => `<button class="wc ${x.kind}${x.shift ? ' has-shift' : ''}${x.past ? ' past' : ''}${x.k === state.wSel ? ' sel' : ''}${x.k === iso(today) ? ' today' : ''}" data-wsel="${x.k}" aria-pressed="${x.k === state.wSel}" aria-label="${x.d.getDate()} ${MONTHS[x.d.getMonth()]}">
      <span class="wc-d"><small>${W_DOW[dow(x.d)]}</small><b>${x.d.getDate()}</b></span>${barHtml(x, false)}<span class="wc-k">${x.shift ? hm(x.shift.a) : x.kind === 'full' ? 'смена' : x.kind === 'half' ? '½' : '—'}</span></button>`;
  const wn = weekNo(mon);
  const opt = (vals, cur, f = v => v) => vals.map(v => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${f(v)}</option>`).join('');
  const settings = `<div class="card glass fold-card ${isOpen('wset') ? 'open' : ''}">${foldHead('wset', 'Настройки', `${work.full} ч / ${work.half} ч`)}
    ${foldBody('wset', `
      <div class="wk-set">
        <label class="field"><span>Работаю с</span><input type="time" data-wset="from" value="${work.from}"></label>
        <label class="field"><span>до</span><input type="time" data-wset="to" value="${work.to}"></label>
        <label class="field"><span>Смена</span><select data-wset="full">${opt([6, 7, 8, 9, 10, 11, 12], work.full, v => v + ' ч')}</select></label>
        <label class="field"><span>Полсмены</span><select data-wset="half">${opt([3, 4, 5, 6], work.half, v => v + ' ч')}</select></label>
        <label class="field wide"><span>Дорога до работы</span><span class="wk-min"><input type="number" inputmode="numeric" min="0" max="240" step="1" data-wset="road" value="${work.road}" placeholder="0"><em>мин</em></span></label>
      </div>
      ${work.offWeek.length || work.offDay.length ? `<button class="link-btn" data-wreset>снова ходить на все пары</button>` : ''}
      ${Object.keys(work.shifts).length ? `<button class="link-btn" data-wclear>убрать все смены</button>` : ''}
      <p class="hint">«Окно» — промежуток между парами, за который не успеть съездить на работу и обратно.</p>`)}</div>`;
  const txt = workText(days);
  return `
    <div class="card glass wk-sum">
      <div class="kpis"><div class="kpi"><b>${plan.length}</b><span>${plural(plan.length, 'смена', 'смены', 'смен')} · ${fmtH(hours)}</span></div>
        <div class="kpi"><b>${nFull}<small> + ${nHalf}</small></b><span>можно: полных + половин</span></div></div>
    </div>
    <div class="week glass">
      <button class="week-label" data-cal aria-label="Открыть календарь"><span class="week-no">${wn}–${wn + 1}</span><span class="week-par">недели <i>· ${ddmm(days[0].d)}–${ddmm(days[13].d)}</i></span>${ICON.cal}</button>
      <div class="arrows">
        ${state.wWeek ? `<button class="btn round" data-wweek="0" aria-label="К текущей неделе">${ICON.undo}</button>` : ''}
        <button class="btn round" data-wweek="-1" aria-label="Раньше">${ICON.left}</button>
        <button class="btn round" data-wweek="1" aria-label="Позже">${ICON.right}</button>
      </div>
    </div>
    <div class="card glass wcal">
      <div class="wcal-grid">${days.map(cell).join('')}</div>
    </div>
    ${dayCard(sel)}
    ${txt ? `<button class="btn accent wide" data-wcopy>Скопировать для начальника</button>` : ''}
    ${icsCard()}
    ${settings}`;
}

/* ---------- в Календарь телефона (.ics) ----------
   Разовая выгрузка: iPhone показывает «Добавить все». У событий постоянные UID —
   при повторной выгрузке Календарь старается обновить их, а не создать новые. */
const futureShifts = () => Object.keys(work.shifts).filter(k => fromIso(k) >= today).sort();
const futurePairs = () => occurrences(today, SEM_END).filter(o => !skips[o.key] && !offMode(o) && o.end > now());
function icsCard() {
  const ns = futureShifts().length, np = futurePairs().length;
  return `<div class="card glass wk-ics">
    <h3>В Календарь телефона</h3>
    <div class="gp-act"><button class="btn accent" data-wics="s" ${ns ? '' : 'disabled'}>Смены · ${ns}</button><button class="btn" data-wics="p" ${ns + np ? '' : 'disabled'}>Смены и пары · ${ns + np}</button></div>
    <p class="hint">${ns ? '' : 'Сначала поставьте смены в календаре выше. '}Пары — только те, на которые идёте, с сегодняшнего дня до конца семестра. Поменяли смены — нажмите ещё раз.</p>
  </div>`;
}
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsT = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
const icsFold = line => { // строки ICS — не длиннее 75 байт, продолжение начинается с пробела
  const enc = new TextEncoder(), out = [];
  let cur = '', n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
};
function buildIcs(withPairs) {
  const stamp = new Date(), utc = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  let h = 5381; for (const c of GROUP.inst + '/' + GROUP.id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  const grp = h.toString(36); // латиницей: группа может называться «м3-1»
  const ev = (uid, a, b, sum, loc, desc) => ['BEGIN:VEVENT', `UID:${uid}@hronika`, `DTSTAMP:${utc}`,
    `DTSTART;TZID=Europe/Moscow:${icsT(a)}`, `DTEND;TZID=Europe/Moscow:${icsT(b)}`, `SUMMARY:${icsEsc(sum)}`,
    loc ? `LOCATION:${icsEsc(loc)}` : '', desc ? `DESCRIPTION:${icsEsc(desc)}` : '', 'END:VEVENT'].filter(Boolean);
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hronika//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Хроника пар', 'X-WR-TIMEZONE:Europe/Moscow',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Moscow', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'TZNAME:MSK', 'END:STANDARD', 'END:VTIMEZONE'];
  futureShifts().forEach(k => {
    const d = fromIso(k), s = work.shifts[k];
    L.push(...ev(`shift-${grp}-${k}`, at(d, s.from), at(d, s.to), 'Смена', '', 'Из «Хроники пар»'));
  });
  if (withPairs) futurePairs().forEach(o => {
    const t = o.p.t && TEACHERS[o.p.t] ? TEACHERS[o.p.t].name : '';
    L.push(...ev(`pair-${grp}-${o.key.replace('|', '-')}`, o.start, o.end, `${o.p.s} · ${TYPES[o.p.type] || ''}`.replace(/ · $/, ''),
      o.p.room || '', [`${o.p.n} пара`, t].filter(Boolean).join(' · ')));
  });
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}
function exportIcs(withPairs) {
  const txt = buildIcs(withPairs);
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) { // Safari на iPhone открывает data-ссылку календаря как окно «Добавить все в Календарь»
    location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(txt);
    return;
  }
  const url = URL.createObjectURL(new Blob([txt], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = withPairs ? 'hronika-smeny-i-pary.ics' : 'hronika-smeny.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Файл скачан — откройте его, чтобы добавить в календарь');
}

/* ---------- действия ---------- */
const occAt = key => { const d0 = fromIso(key.split('|')[0]); return occurrences(d0, d0).find(x => x.key === key); };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-wweek], [data-wsel], [data-woff], [data-wdup], [data-wshift], [data-wmove], [data-wreset], [data-wclear], [data-wcopy], [data-wics]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.wweek != null) { state.wWeek = ds.wweek === '0' ? 0 : state.wWeek + 2 * +ds.wweek; state.wSel = null; state.wDup = null; render(); return; }
  if (ds.wsel) { state.wSel = ds.wsel; state.wDup = null; render(); if (navigator.vibrate) navigator.vibrate(6); return; }
  if (ds.woff) { // иду ↔ не иду; после «не иду» — предложение продлить на следующие такие же пары
    const o = occAt(ds.woff);
    if (!o) return;
    if (offMode(o)) {
      work.offDay = work.offDay.filter(k => k !== o.key);
      if (work.offWeek.includes(slotOf(o.p))) { // старый режим «каждую неделю» → оставляем остальные даты отдельными отметками
        work.offWeek = work.offWeek.filter(k => k !== slotOf(o.p));
        sameNext(o).forEach(x => work.offDay.push(x.key));
      }
      state.wDup = null;
    } else {
      work.offDay.push(o.key);
      state.wDup = { k: iso(o.date), key: o.key };
    }
    saveWork(); render(); if (navigator.vibrate) navigator.vibrate(8); return;
  }
  if (ds.wdup != null) {
    const n = +ds.wdup, o = state.wDup && occAt(state.wDup.key);
    if (n && o) {
      const nx = sameNext(o).filter(q => !offMode(q)).slice(0, n);
      nx.forEach(x => work.offDay.push(x.key));
      toast(`Не идёте ещё ${nx.length} ${plural(nx.length, 'раз', 'раза', 'раз')} — до ${ddmm(nx[nx.length - 1].date)}`);
      saveWork();
    }
    state.wDup = null; render(); return;
  }
  if (ds.wshift != null) {
    if (!ds.wshift) delete work.shifts[state.wSel];
    else {
      const [from, h] = ds.wshift.split('|'), a = at(fromIso(state.wSel), from), b = new Date(+a + h * 36e5);
      work.shifts[state.wSel] = { from: hm(a), to: hm(b) };
      toast('Смена поставлена');
    }
    saveWork(); render(); return;
  }
  if (ds.wmove) {
    const sh = work.shifts[state.wSel];
    if (!sh) return;
    const d = fromIso(state.wSel), mv = +ds.wmove * 6e4;
    const a = new Date(+at(d, sh.from) + mv), b = new Date(+at(d, sh.to) + mv);
    if (a < at(d, '06:00') || b > at(d, '23:59') || a.getDate() !== d.getDate() || b.getDate() !== d.getDate()) return;
    work.shifts[state.wSel] = { from: hm(a), to: hm(b) };
    saveWork(); render(); return;
  }
  if (ds.wics) { exportIcs(ds.wics === 'p'); return; }
  if ('wreset' in ds) { work.offDay = []; work.offWeek = []; saveWork(); render(); toast('Снова ходите на все пары'); return; }
  if ('wclear' in ds) { work.shifts = {}; saveWork(); render(); toast('Смены убраны'); return; }
  if ('wcopy' in ds) {
    const mon = addDays(baseMonday, state.wWeek * 7), days = [];
    for (let i = 0; i < 14; i++) days.push(workDay(addDays(mon, i)));
    const txt = workText(days);
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Скопировано — вставьте в чат с начальником'), () => toast('Не удалось скопировать'));
  }
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.wset;
  if (!k) return;
  const v = e.target.value;
  if (k === 'from' || k === 'to') { if (/^\d{2}:\d{2}$/.test(v)) work[k] = v; } else if (k === 'road') { const m = Math.round(+v); work.road = Number.isFinite(m) ? Math.min(240, Math.max(0, m)) : WORK_DEF.road; } else work[k] = +v;
  if (work.from >= work.to) { toast('«С» должно быть раньше «до»'); Object.assign(work, { from: WORK_DEF.from, to: WORK_DEF.to }); }
  saveWork(); render();
});
