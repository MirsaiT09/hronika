/* «Хроника пар» — расписание, пропуски, статистика, поиск преподавателей.
   Все отметки и заметки хранятся только на этом телефоне (localStorage). */
'use strict';

const D = window.DATA;
const GROUP = D.group;
const BELLS = D.bells;
const TYPES = D.types;
const TEACHERS = D.teachers;
const SCHEDULE = D.schedule;
const BUILDINGS = D.buildings || {};
const HOLIDAYS = new Set(D.holidays || []);
const SEM_START = new Date(...D.semester.week1Monday);
const SEM_END = new Date(...D.semester.lastDay);
const LIMIT = 0.25; // доля пропусков, после которой предмет «горит»

/* ---------- хранилище ---------- */
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let skips = store.get('hp.skips', null);
if (!skips) { // перенос отметок из прототипа
  const old = store.get('skips', {});
  skips = {};
  Object.keys(old).forEach(k => { skips[k] = { r: 'none', at: Date.now() }; });
}
let notes = store.get('hp.notes', null) || store.get('notes_v2', {});
const saveSkips = () => store.set('hp.skips', skips);
const saveNotes = () => store.set('hp.notes', notes);
const REASONS = { none: 'Без причины', ill: 'Болезнь', valid: 'Уважительная' };

/* ---------- даты ---------- */
const DAY_MS = 864e5;
const DOW_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DOW_LONG = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => { const x = dayStart(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const weekNo = monday => Math.round((mondayOf(monday) - SEM_START) / (7 * DAY_MS)) + 1;
const parityOf = n => (n % 2 === 0 ? 'even' : 'odd');
const dow = d => (d.getDay() + 6) % 7; // 0 = пн
const at = (d, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const x = dayStart(d); x.setHours(h, m); return x; };
const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const now = () => new Date();

const today = dayStart(now());
const baseMonday = today.getDay() === 0 ? addDays(mondayOf(today), 7) : mondayOf(today);

const state = {
  tab: 'pairs', weekOffset: 0, day: today.getDay() === 0 ? 0 : dow(today),
  teacher: null, query: '', tParity: null,
  period: 'sem', pOffset: 0, justStamped: null,
  sub: store.get('hp.skipsSub', 'stats'), // Прогулы: stats | certs | cmp
};

/* ---------- расписание ---------- */
const MY = GROUP.id || GROUP.group;
// идёт ли занятие на неделе wn: чётность + пометки «с 3 нед.», «до 12 нед.», «1,3,5 нед.»
const active = (p, wn) => (p.w === 'both' || p.w === parityOf(wn)) && (!p.from || wn >= p.from) && (!p.to || wn <= p.to) && (!p.weeks || p.weeks.includes(wn));
const weekNote = p => p.weeks ? `${p.weeks.join(', ')} нед.` : p.from && p.to ? `${p.from}–${p.to} нед.` : p.from ? `с ${p.from} нед.` : p.to ? `до ${p.to} нед.` : '';
const grpLabel = g => { const [c, n] = String(g).split('-'); return n ? `${c.startsWith('м') ? 'маг ' + c.slice(1) : c} к · гр. ${n}` : `гр. ${g}`; };
const BY_T = {};
SCHEDULE.forEach(p => { if (p.t) (BY_T[p.t] = BY_T[p.t] || []).push(p); });
const MINE = SCHEDULE.filter(p => p.g === MY);
const pairsFor = (dayIdx, wn) => MINE.filter(p => p.d === dayIdx && active(p, wn)).sort((a, b) => a.n - b.n);

// Все пары группы между датами (включительно), с учётом чётности и праздников
function occurrences(from, to, list = MINE) {
  const out = [];
  const a = dayStart(from < SEM_START ? SEM_START : from);
  const b = dayStart(to > SEM_END ? SEM_END : to);
  for (let d = a; d <= b; d = addDays(d, 1)) {
    if (d.getDay() === 0 || HOLIDAYS.has(iso(d))) continue;
    const wn = weekNo(d);
    list.filter(p => p.d === dow(d) && active(p, wn)).sort((x, y) => x.n - y.n).forEach(p => {
      out.push({ date: d, p, key: iso(d) + '|' + p.n, start: at(d, BELLS[p.n][0]), end: at(d, BELLS[p.n][1]) });
    });
  }
  return out;
}

/* ---------- мелочи ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => name.split(' ')[0][0];
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const ACC = { eye: 'assets/eye.png', cross: 'assets/cross.png', star: 'assets/star.png', spike: 'assets/spike.png', ribs: 'assets/ribs.png' };
const bldgOf = room => { const code = (room.split('/')[1] || '').trim(); return BUILDINGS[code] ? { code, ...BUILDINGS[code] } : null; };
const ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="M8 5 4 9l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
};
const brand = () => `<div class="brand"><img src="${ACC.eye}" alt="">Панель студента</div>`;
const sealSvg = (fresh, text) => `<div class="seal ${fresh ? 'fresh' : ''}">
  <svg viewBox="-50 -50 100 100"><use href="#burst" fill="#642c3e" stroke="#d5d9de" stroke-width="1.2"/><circle r="26" fill="none" stroke="#d5d9de" stroke-opacity=".7" stroke-width="1" stroke-dasharray="2 3"/></svg>
  <span>${text}</span></div>`;
(function buildBurst() {
  let d = '';
  const spikes = 18;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? (i % 4 === 0 ? 50 : 44) : 33;
    d += (i ? 'L' : 'M') + (Math.cos(a) * r).toFixed(2) + ' ' + (Math.sin(a) * r).toFixed(2);
  }
  document.getElementById('burstPath').setAttribute('d', d + 'Z');
})();

/* =========================== 1. ПАРЫ =========================== */
function renderPairs() {
  const monday = addDays(baseMonday, state.weekOffset * 7);
  const wn = weekNo(monday);
  const parity = parityOf(wn);
  const date = addDays(monday, state.day);
  const holiday = HOLIDAYS.has(iso(date));
  const list = holiday ? [] : pairsFor(state.day, wn);
  const t0 = now();
  const days = DOW_SHORT.map((lbl, i) => {
    const d = addDays(monday, i);
    const dots = HOLIDAYS.has(iso(d)) ? '' : pairsFor(i, wn).map(p => `<i class="${skips[iso(d) + '|' + p.n] ? 'skip' : ''}"></i>`).join('');
    return `<button class="btn day ${i === state.day ? 'metal' : ''} ${iso(d) === iso(today) ? 'today' : ''}" data-day="${i}" aria-pressed="${i === state.day}" aria-label="${DOW_LONG[i]}, ${d.getDate()}">
      <small>${lbl}</small><strong>${d.getDate()}</strong><span class="dots">${dots}</span></button>`;
  }).join('');
  let cards = '';
  list.forEach((p, idx) => {
    const key = iso(date) + '|' + p.n;
    const sk = skips[key];
    const t = TEACHERS[p.t];
    const tn = notes[p.t] || [];
    const start = at(date, BELLS[p.n][0]), end = at(date, BELLS[p.n][1]);
    const isNow = start <= t0 && t0 < end;
    const past = end <= t0;
    const b = bldgOf(p.room);
    cards += `<article class="pair glass ${sk ? 'skipped' : ''} ${isNow && !sk ? 'now' : ''}">
      <div class="pair-time"><span class="start">${BELLS[p.n][0]}</span><span class="end">${BELLS[p.n][1]}</span><span class="no">${p.n} пара</span></div>
      <div class="pair-body">
        ${isNow ? '<span class="now-pill">идёт сейчас</span>' : ''}
        <h3 class="pair-title">${esc(p.s)}</h3>
        <div class="pair-line"><span class="tag ${p.type}">${TYPES[p.type]}</span><span class="room">${esc(p.room)}</span>${b ? `<span class="bldg">${esc(b.name)}</span>` : ''}</div>
        ${t ? `<div class="pair-line"><button class="teacher-link" data-teacher="${p.t}">${t.rank} ${esc(t.name)}</button>${weekNote(p) ? `<span class="bldg">${weekNote(p)}</span>` : ''}</div>` : weekNote(p) ? `<div class="pair-line"><span class="bldg">${weekNote(p)}</span></div>` : ''}
        ${tn.length ? `<div class="pair-note">${esc(tn[tn.length - 1])}</div>` : ''}
      </div>
      <div class="pair-actions">
        <button class="btn ${sk ? 'accent' : ''}" data-skip="${key}" aria-pressed="${!!sk}">${sk ? ICON.undo + (past ? 'Был на паре' : 'Пойду') : ICON.x + (past ? 'Пропустил' : 'Не пойду')}</button>
        ${t ? `<button class="btn" data-teacher="${p.t}">${ICON.plus}Заметки${tn.length ? ` <span class="cnt">${tn.length}</span>` : ''}</button>` : ''}
      </div>
      ${sk ? `<div class="reasons" role="group" aria-label="Причина пропуска">${Object.entries(REASONS).map(([r, l]) =>
        `<button class="chip" data-reason="${key}|${r}" aria-pressed="${sk.r === r}">${l}</button>`).join('')}</div>` : ''}
      ${sk ? sealSvg(state.justStamped === key, past ? 'про-<br>пуск' : 'не<br>пойду') : ''}
    </article>`;
  });
  if (!list.length) cards = `<div class="free glass"><img src="${ACC.star}" alt=""><span class="big">${holiday ? 'Праздник' : 'Свобода'}</span><span>Пар нет. День твой.</span></div>`;
  const skippedToday = list.filter(p => skips[iso(date) + '|' + p.n]).length;
  return `
    ${brand()}
    <header class="hero">
      <div class="hero-row">
        <h1 class="title-h"><img class="title-img" src="assets/title-raspisanie.png" alt="Расписание" width="1600" height="505"></h1>
        <img class="hero-cross float" src="${parity === 'even' ? ACC.cross : ACC.eye}" alt="${parity === 'even' ? 'Чётная неделя — крест' : 'Нечётная неделя — око'}">
      </div>
      <div class="divider"></div>
      <span class="meta">${DOW_LONG[state.day]}, ${date.getDate()} ${MONTHS[date.getMonth()]} <i>·</i> ${GROUP.inst} <i>·</i> гр. ${GROUP.group}</span>
    </header>
    <div class="week glass">
      <div class="week-label"><span class="week-no">${wn}</span>
        <span class="week-par">${parity === 'even' ? 'чётная' : 'нечётная'} <i>· неделя</i></span></div>
      <div class="arrows">
        ${state.weekOffset ? `<button class="btn round" data-week="0" aria-label="К текущей неделе">${ICON.undo}</button>` : ''}
        <button class="btn round" data-week="-1" aria-label="Предыдущая неделя">${ICON.left}</button>
        <button class="btn round" data-week="1" aria-label="Следующая неделя">${ICON.right}</button>
      </div>
    </div>
    <nav class="days" aria-label="Дни недели">${days}</nav>
    <section class="list" aria-live="polite">${cards}</section>
    <p class="foot">${list.length ? `${list.length} ${plural(list.length, 'пара', 'пары', 'пар')}${skippedToday ? ` · пропуск ${skippedToday}` : ''}` : ''}</p>
    ${D.demo ? '<p class="demo-note">Демо-данные: понедельник — со скриншота, остальное — пример</p>'
      : D.source ? `<p class="demo-note">Расписание с mgsu.ru · обновлено ${D.source.updated.split('-').reverse().join('.')} · <button class="link-btn" data-upd>проверить</button></p>` : ''}`;
}

/* =========================== 2. ПРЕПОДЫ =========================== */
// Где преподаватель сейчас или где его поймать в ближайшее время
function teacherWhere(tid) {
  const t0 = now();
  const occ = occurrences(dayStart(t0), addDays(t0, 14), BY_T[tid] || []);
  const cur = occ.find(o => o.start <= t0 && t0 < o.end);
  if (cur) return { o: cur, mode: 'now' };
  const next = occ.find(o => o.start > t0);
  if (!next) return null;
  const sameDay = iso(next.date) === iso(t0);
  const hadToday = occ.some(o => iso(o.date) === iso(t0) && o.end <= t0);
  return { o: next, mode: sameDay ? (hadToday ? 'break' : 'today') : 'later' };
}
const dayLabel = d => {
  const diff = Math.round((dayStart(d) - dayStart(now())) / DAY_MS);
  return diff === 0 ? 'сегодня' : diff === 1 ? 'завтра' : `${DOW_LONG[dow(d)].toLowerCase()}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

function renderTeachers() {
  if (state.teacher) return renderTeacherCard(state.teacher);
  const q = state.query.trim().toLowerCase();
  const mineT = new Set(MINE.map(p => p.t).filter(Boolean));
  const found = Object.entries(TEACHERS).filter(([id, t]) => {
    if (!q) return mineT.has(id);
    const subj = (BY_T[id] || []).map(p => p.s).join(' ').toLowerCase();
    return t.name.toLowerCase().includes(q) || subj.includes(q);
  });
  const rows = found.slice(0, 60).sort((a, b) => a[1].name.localeCompare(b[1].name, 'ru')).map(([id, t]) => {
    const w = teacherWhere(id);
    const on = w && w.mode === 'now';
    const subjects = [...new Set((BY_T[id] || []).map(p => p.s))];
    const sub = on ? `Сейчас: <b>${esc(w.o.p.room)}</b> до ${BELLS[w.o.p.n][1]}`
      : w ? `Далее: <b>${esc(w.o.p.room)}</b> · ${dayLabel(w.o.date)} ${BELLS[w.o.p.n][0]}`
      : esc(subjects.join(', '));
    return `<button class="t-row glass" data-teacher="${id}"><span class="mono-ini">${initials(t.name)}</span>
      <span class="t-info"><span class="t-name">${esc(t.name)}</span><span class="t-sub">${t.rank} · ${sub}</span></span>
      ${on ? '<span class="t-status on">на паре</span>' : ''}</button>`;
  }).join('');
  return `
    ${brand()}
    <header class="page-title img-title"><div><h1><img class="title-img" src="assets/title-prepody.png" alt="Преподы" width="1600" height="530"></h1><p>Где найти · когда ловить</p></div><img src="${ACC.eye}" alt=""></header>
    <div class="search-wrap"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input class="search glass" id="tq" type="search" enterkeyhint="search" placeholder="Фамилия или предмет" value="${esc(state.query)}" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Поиск преподавателя"></div>
    <p class="hint" style="margin:0 4px">${q ? `Найдено: ${found.length}${found.length > 60 ? ' · показаны первые 60, уточните запрос' : ''}` : `Ваши преподаватели · поиск — по всем ${Object.keys(TEACHERS).length} преподавателям ${GROUP.inst}`}</p>
    <section class="list">${rows || `<div class="free glass"><span>Никого не нашёл по «${esc(state.query)}»</span></div>`}</section>`;
}

function renderTeacherCard(id) {
  const t = TEACHERS[id];
  const curPar = parityOf(weekNo(now()));
  const parity = state.tParity || curPar;
  const w = teacherWhere(id);
  const todayDow = dow(now());
  const slots = (BY_T[id] || []).filter(p => p.w === 'both' || p.w === parity).sort((a, b) => a.d - b.d || a.n - b.n);
  const slotHtml = slots.map(p => {
    const isToday = parity === curPar && p.d === todayDow;
    return `<div class="slot"${isToday ? ' style="background:linear-gradient(90deg,rgba(100,44,62,.25),transparent);margin:0 -20px;padding-inline:20px"' : ''}>
      <span class="sd"><b>${BELLS[p.n][0]}</b>${DOW_SHORT[p.d]} · ${p.n} пара</span>
      <span class="ss"><span>${esc(p.room)} · ${grpLabel(p.g)}</span><span>${TYPES[p.type]} · ${esc(p.s)}${weekNote(p) ? ' · ' + weekNote(p) : ''}</span></span></div>`;
  }).join('');
  const lbl = { now: 'Сейчас на паре', break: 'Перерыв · следующая пара', today: 'Сегодня будет', later: 'Где поймать' };
  let where = '';
  if (w) {
    const b = bldgOf(w.o.p.room);
    where = `<div class="where glass"><span class="lbl">${lbl[w.mode]}</span>
      <span class="room-big">${esc(w.o.p.room)}</span>
      <span class="when">${dayLabel(w.o.date)}, ${BELLS[w.o.p.n][0]}–${BELLS[w.o.p.n][1]} · ${grpLabel(w.o.p.g)} · ${TYPES[w.o.p.type].toLowerCase()}</span>
      ${b ? `<span class="bl">${esc(b.name)} — ${esc(b.hint)}</span>` : ''}
      <img src="${ACC.spike}" alt=""></div>`;
  }
  const tn = notes[id] || [];
  return `
    <button class="btn round back" data-back aria-label="Назад к списку">${ICON.left}</button>
    <div class="t-hero"><span class="mono-ini">${initials(t.name)}</span><div><span class="rank">${t.rank}</span><h2>${esc(t.name)}</h2></div></div>
    ${where}
    ${t.dept || t.office ? `<div class="office glass">${t.dept ? `<span>${esc(t.dept)}</span>` : ''}${t.office ? `<span>Кабинет кафедры: <b>${esc(t.office)}</b> — если нет на паре</span>` : ''}</div>` : ''}
    <div class="sec-title">Расписание</div>
    <div class="seg glass" role="group" aria-label="Неделя">
      <button data-tpar="odd" aria-pressed="${parity === 'odd'}">Нечётная${curPar === 'odd' ? ' · сейчас' : ''}</button>
      <button data-tpar="even" aria-pressed="${parity === 'even'}">Чётная${curPar === 'even' ? ' · сейчас' : ''}</button>
    </div>
    <div class="slots glass">${slotHtml || '<p class="empty">На этой неделе пар нет</p>'}</div>
    <div class="sec-title">Заметки</div>
    ${tn.length ? `<div class="notes">${tn.map((n, i) => `<div class="note glass"><p>${esc(n)}</p><button class="del" data-del="${i}" aria-label="Удалить заметку">×</button></div>`).join('')}</div>`
      : `<p class="empty-notes">Заметок пока нет. Запишите, когда принимает долги или где его кафедра.</p>`}
    <form class="note-form" id="nf"><textarea class="glass" id="nt" placeholder="Новая заметка" aria-label="Новая заметка"></textarea>
      <button class="btn accent" type="submit">Добавить заметку ${ICON.right}</button></form>`;
}

/* =========================== 3–4. ПРОГУЛЫ И СТАТИСТИКА =========================== */
function periodRange() {
  const o = state.pOffset;
  if (state.period === 'week') {
    const m = addDays(baseMonday, o * 7);
    const wn = weekNo(m);
    const s = m, e = addDays(m, 5);
    const lbl = `${wn}-я неделя · ${s.getDate()}${s.getMonth() !== e.getMonth() ? ' ' + MONTHS[s.getMonth()] : ''}–${e.getDate()} ${MONTHS[e.getMonth()]}`;
    return { from: s, to: e, lbl };
  }
  if (state.period === 'month') {
    const s = new Date(today.getFullYear(), today.getMonth() + o, 1);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    return { from: s, to: e, lbl: `${MONTHS_NOM[s.getMonth()]} ${s.getFullYear()}` };
  }
  return { from: SEM_START, to: SEM_END, lbl: `Семестр · ${SEM_START.getDate()} ${MONTHS[SEM_START.getMonth()]} – ${SEM_END.getDate()} ${MONTHS[SEM_END.getMonth()]}` };
}

function ring(pct) {
  const r = 52, c = 2 * Math.PI * r;
  const v = pct == null ? 0 : pct;
  return `<div class="ring"><svg viewBox="0 0 124 124" aria-hidden="true">
    <circle cx="62" cy="62" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="10"/>
    <circle cx="62" cy="62" r="${r}" fill="none" stroke="url(#gRing)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}"/>
    ${v < 100 && pct != null ? `<circle cx="62" cy="62" r="${r}" fill="none" stroke="url(#gRose)" stroke-width="10" stroke-dasharray="${(c * (100 - v) / 100).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-c * v / 100).toFixed(1)}" opacity=".9"/>` : ''}
  </svg><div class="val"><div><b>${pct == null ? '—' : pct + '%'}</b><small>посещаемость</small></div></div></div>`;
}

// Столбики: посетил (серебро) + пропустил (бордо) + ещё впереди (пунктир)
function barChart(items) {
  const W = 320, H = 150, top = 16, bottom = 20, ch = H - top - bottom;
  const max = Math.max(1, ...items.map(i => i.att + i.skip + i.rest));
  const slot = W / items.length, bw = Math.min(28, slot * 0.62);
  const bars = items.map((it, i) => {
    const x = i * slot + (slot - bw) / 2;
    const hA = it.att / max * ch, hS = it.skip / max * ch, hR = it.rest / max * ch;
    let y = top + ch;
    let g = '';
    if (hA) { y -= hA; g += `<rect x="${x}" y="${y}" width="${bw}" height="${hA}" rx="3" fill="url(#gMetal)"/>`; }
    if (hS) { y -= hS; g += `<rect x="${x}" y="${y}" width="${bw}" height="${hS}" rx="3" fill="url(#gRose)"/>`; }
    if (hR) { y -= hR; g += `<rect x="${x + .5}" y="${y + .5}" width="${bw - 1}" height="${Math.max(0, hR - 1)}" rx="3" fill="none" stroke="rgba(255,255,255,.18)" stroke-dasharray="2 2"/>`; }
    if (it.skip) g += `<text class="v" x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" style="fill:#c77791">${it.skip}</text>`;
    g += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle"${it.hl ? ' style="fill:#f2b8ca"' : ''}>${it.label}</text>`;
    return g;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="График посещаемости">
    <line x1="0" x2="${W}" y1="${top + ch + .5}" y2="${top + ch + .5}" stroke="rgba(255,255,255,.1)"/>${bars}</svg>
    <div class="legend"><span><i style="background:var(--metal)"></i>был</span><span><i style="background:linear-gradient(90deg,var(--burgundy),var(--rose))"></i>пропуск</span><span><i style="border:1px dashed rgba(255,255,255,.3)"></i>впереди</span></div>`;
}

function rows(entries, fmt) {
  return entries.map(([name, v]) => {
    const pct = v.held ? Math.round(v.skip / v.held * 100) : 0;
    return `<div class="subj ${pct >= LIMIT * 100 ? 'warn' : ''}"><div class="subj-top"><span>${esc(name)}</span><span>${v.skip} из ${v.held}${v.held ? ` · ${pct}%` : ''}</span></div>
      <div class="bar"><i style="width:${v.skip ? Math.max(3, Math.min(100, pct)) : 0}%"></i></div>${fmt ? fmt(name, v) : ''}</div>`;
  }).join('');
}

function renderSkips() {
  if (state.sub !== 'stats' && typeof renderSkipsSub === 'function') return renderSkipsSub();
  const t0 = now();
  const { from, to, lbl } = periodRange();
  const occ = occurrences(from, to);
  const held = occ.filter(o => o.end <= t0);
  const skipped = held.filter(o => skips[o.key]);
  const planned = occ.filter(o => o.end > t0 && skips[o.key]);
  const pct = held.length ? Math.round((held.length - skipped.length) / held.length * 100) : null;

  // серия посещений подряд (по всему семестру, до текущего момента)
  const allHeld = occurrences(SEM_START, t0).filter(o => o.end <= t0);
  let streak = 0;
  for (let i = allHeld.length - 1; i >= 0 && !skips[allHeld[i].key]; i--) streak++;

  // график по времени
  let items;
  if (state.period === 'week') {
    items = DOW_SHORT.map((l, i) => ({ label: l, d: addDays(from, i) })).map(x => {
      const os = occ.filter(o => iso(o.date) === iso(x.d));
      return agg(os, t0, x.label, iso(x.d) === iso(today));
    });
  } else {
    const weeks = [];
    for (let m = mondayOf(from < SEM_START ? SEM_START : from); m <= (to > SEM_END ? SEM_END : to); m = addDays(m, 7)) weeks.push(m);
    items = weeks.map(m => agg(occ.filter(o => mondayOf(o.date).getTime() === m.getTime()), t0, String(weekNo(m)), m.getTime() === mondayOf(today).getTime()));
  }

  // по предметам — с запасом до 25% за весь семестр
  const semOcc = occurrences(SEM_START, SEM_END);
  const bySubj = {};
  occ.forEach(o => { const s = bySubj[o.p.s] = bySubj[o.p.s] || { held: 0, skip: 0 }; if (o.end <= t0) { s.held++; if (skips[o.key]) s.skip++; } });
  const subjRows = rows(Object.entries(bySubj).sort((a, b) => b[1].skip - a[1].skip || a[0].localeCompare(b[0], 'ru')), name => {
    const all = semOcc.filter(o => o.p.s === name);
    const marked = all.filter(o => skips[o.key]).length;
    const left = Math.floor(all.length * LIMIT) - marked;
    return `<span class="subj-sub">${all.length} ${plural(all.length, 'пара', 'пары', 'пар')} за семестр · ${left >= 0 ? `можно пропустить ещё ${left}` : `перебор на ${-left}`}</span>`;
  });

  const byDay = {}; DOW_SHORT.forEach((_, i) => { byDay[DOW_LONG[i]] = { held: 0, skip: 0 }; });
  const byType = {}; Object.values(TYPES).forEach(n => { byType[n] = { held: 0, skip: 0 }; });
  held.forEach(o => { const d = byDay[DOW_LONG[o.p.d]], ty = byType[TYPES[o.p.type]]; d.held++; ty.held++; if (skips[o.key]) { d.skip++; ty.skip++; } });
  const dayRows = rows(Object.entries(byDay).filter(([, v]) => v.held));
  const typeRows = rows(Object.entries(byType).filter(([, v]) => v.held));

  const reasonCnt = { none: 0, ill: 0, valid: 0 };
  [...skipped, ...planned].forEach(o => { reasonCnt[skips[o.key].r || 'none']++; });
  const rTotal = skipped.length + planned.length;
  const rColors = { none: 'linear-gradient(90deg,var(--burgundy),var(--rose))', ill: 'var(--metal)', valid: 'var(--metal-dark)' };
  const reasonBar = rTotal ? `<div class="bar" style="height:10px;display:flex;gap:2px;background:none;box-shadow:none">${Object.entries(reasonCnt).filter(([, n]) => n).map(([r, n]) =>
    `<i style="width:${n / rTotal * 100}%;background:${rColors[r]}"></i>`).join('')}</div>
    <div class="legend">${Object.entries(reasonCnt).map(([r, n]) => `<span><i style="background:${rColors[r]}"></i>${REASONS[r]} · ${n}</span>`).join('')}</div>` : '';

  const hist = [...skipped, ...planned].sort((a, b) => b.start - a.start).map(o => `<div class="hrow">
      <span class="hd"><b>${o.date.getDate()}</b>${MONTHS[o.date.getMonth()].slice(0, 3)} · ${DOW_SHORT[o.p.d]}</span>
      <span class="hs">${esc(o.p.s)}<span>${o.p.n} пара · ${TYPES[o.p.type].toLowerCase()} · ${o.end > t0 ? 'запланирован' : REASONS[skips[o.key].r || 'none'].toLowerCase()}</span></span>
      <button class="btn" data-undo="${o.key}" aria-label="Убрать пропуск">${ICON.undo}</button></div>`).join('');

  const canPrev = state.period !== 'sem' && from > SEM_START;
  const canNext = state.period !== 'sem' && to < SEM_END;
  return `
    ${brand()}
    <header class="page-title img-title"><div><h1><img class="title-img" src="assets/title-progul.png" alt="Прогулы" width="1600" height="514"></h1><p>Посещаемость и пропуски</p></div><img class="ribs" src="${ACC.ribs}" alt=""></header>
    ${typeof skipsSubSeg === 'function' ? skipsSubSeg() : ''}
    <div class="seg glass" role="group" aria-label="Период">
      ${[['week', 'Неделя'], ['month', 'Месяц'], ['sem', 'Семестр']].map(([k, l]) => `<button data-period="${k}" aria-pressed="${state.period === k}">${l}</button>`).join('')}
    </div>
    <div class="period-nav">
      <button class="btn round" data-poff="-1" aria-label="Предыдущий период" ${canPrev ? '' : 'disabled'}>${ICON.left}</button>
      <span class="lbl">${lbl}</span>
      <button class="btn round" data-poff="1" aria-label="Следующий период" ${canNext ? '' : 'disabled'}>${ICON.right}</button>
    </div>
    <div class="summary glass">
      ${ring(pct)}
      <div class="kpis">
        <div class="kpi"><b>${held.length}</b><span>${plural(held.length, 'пара прошла', 'пары прошло', 'пар прошло')}</span></div>
        <div class="kpi"><b class="rose">${skipped.length}</b><span>${plural(skipped.length, 'пропуск', 'пропуска', 'пропусков')}</span></div>
        <div class="kpi"><b>${skipped.length * 2}</b><span>академ. ${plural(skipped.length * 2, 'час', 'часа', 'часов')} пропущено</span></div>
        <div class="kpi"><b>${streak}</b><span>${plural(streak, 'пара', 'пары', 'пар')} подряд без пропуска</span></div>
      </div>
    </div>
    ${planned.length ? `<p class="hint" style="text-align:center;margin:0">Ещё ${planned.length} ${plural(planned.length, 'пару', 'пары', 'пар')} в этом периоде отметил «не пойду»</p>` : ''}
    ${typeof streakCard === 'function' ? streakCard() : ''}
    <div class="card glass"><h3>${state.period === 'week' ? 'По дням' : 'По неделям'}<i>${state.period === 'week' ? '' : 'номер недели'}</i></h3>${barChart(items)}</div>
    <div class="card glass"><h3>По предметам<i>пропущено из прошедших</i></h3>${subjRows || '<p class="empty">В этом периоде пар нет</p>'}
      <p class="hint">Бордовым — пропущено ${Math.round(LIMIT * 100)}% и больше. Запас считается от всех пар предмета за семестр.</p></div>
    ${dayRows ? `<div class="card glass"><h3>По дням недели</h3>${dayRows}</div>` : ''}
    ${typeRows ? `<div class="card glass"><h3>По виду занятий</h3>${typeRows}</div>` : ''}
    ${rTotal ? `<div class="card glass"><h3>Причины</h3>${reasonBar}</div>` : ''}
    <div class="card glass"><h3>Журнал пропусков<i>${rTotal}</i></h3>${hist ? `<div class="hist">${hist}</div>` : `<div class="empty"><img class="empty-acc" src="${ACC.star}" alt=""><br>Пропусков нет — так держать</div>`}</div>
    <p class="hint" style="text-align:center">Отмечайте пропуск кнопкой «Не пойду» / «Пропустил» на карточке пары.</p>`;
}
function agg(os, t0, label, hl) {
  const r = { label, hl, att: 0, skip: 0, rest: 0 };
  os.forEach(o => { if (o.end > t0) r.rest++; else if (skips[o.key]) r.skip++; else r.att++; });
  return r;
}

/* =========================== рендер и события =========================== */
const app = document.getElementById('app');
// разделы и обработчики «после отрисовки» — сюда добавляет свои more.js
const VIEWS = { pairs: () => renderPairs(), teachers: () => renderTeachers(), skips: () => renderSkips() };
const AFTER_RENDER = [];
function render() {
  app.innerHTML = (VIEWS[state.tab] || VIEWS.pairs)();
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
  state.justStamped = null;
  AFTER_RENDER.forEach(f => { try { f(); } catch (e) { console.error(e); } });
}
let toastTo;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTo); toastTo = setTimeout(() => el.classList.remove('show'), 1800);
}
function toggleSkip(k) {
  if (skips[k]) { delete skips[k]; toast('Пропуск убран'); }
  else { skips[k] = { r: 'none', at: Date.now() }; state.justStamped = k; toast('Пропуск отмечен'); if (navigator.vibrate) navigator.vibrate(15); }
  saveSkips();
}
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.tab) { state.tab = ds.tab; state.teacher = null; render(); window.scrollTo(0, 0); return; }
  if (ds.day) { state.day = +ds.day; render(); return; }
  if (ds.week) { state.weekOffset = +ds.week === 0 ? 0 : state.weekOffset + +ds.week; render(); return; }
  if (ds.skip) { toggleSkip(ds.skip); render(); return; }
  if (ds.undo) { toggleSkip(ds.undo); render(); return; }
  if (ds.reason) { const [d, n, r] = ds.reason.split('|'); const k = d + '|' + n; if (skips[k]) { skips[k].r = r; saveSkips(); render(); } return; }
  if (ds.teacher) { state.tab = 'teachers'; state.teacher = ds.teacher; state.tParity = null; render(); window.scrollTo(0, 0); return; }
  if ('back' in ds) { state.teacher = null; render(); return; }
  if (ds.tpar) { state.tParity = ds.tpar; render(); return; }
  if (ds.period) { state.period = ds.period; state.pOffset = 0; render(); return; }
  if (ds.poff) { state.pOffset += +ds.poff; render(); return; }
  if (ds.del) { notes[state.teacher].splice(+ds.del, 1); saveNotes(); render(); }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'nf') return;
  e.preventDefault();
  const v = document.getElementById('nt').value.trim();
  if (!v) return;
  (notes[state.teacher] = notes[state.teacher] || []).push(v);
  saveNotes(); render(); toast('Заметка сохранена');
});
document.addEventListener('input', e => {
  if (e.target.id !== 'tq') return;
  state.query = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const el = document.getElementById('tq'); el.focus(); el.setSelectionRange(pos, pos);
});
// раз в минуту обновляем «сейчас на паре», если пользователь ничего не печатает
setInterval(() => { const a = document.activeElement; if (!a || !/INPUT|TEXTAREA/.test(a.tagName)) render(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

/* ---------- фон: хромовые шёлковые ленты и бордовые блики ---------- */
function silk() {
  const cv = document.getElementById('silk');
  const ctx = cv.getContext('2d');
  function ribbon(pts, width, W, H, alpha) {
    const P = pts.map(([x, y]) => [x * W, y * H]);
    const Q = P.map(([x, y]) => [x + width, y]);
    const curve = (A, rev) => {
      const a = rev ? [...A].reverse() : A;
      if (!rev) ctx.moveTo(a[0][0], a[0][1]); else ctx.lineTo(a[0][0], a[0][1]);
      ctx.bezierCurveTo(a[1][0], a[1][1], a[2][0], a[2][1], a[3][0], a[3][1]);
    };
    ctx.beginPath(); curve(P, false); curve(Q, true); ctx.closePath();
    const g = ctx.createLinearGradient(P[0][0], 0, Q[0][0] + width, 0);
    g.addColorStop(0, `rgba(255,255,255,${alpha * .9})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fill();
    const sg = ctx.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, `rgba(255,255,255,${alpha * 7})`); sg.addColorStop(.55, `rgba(213,217,222,${alpha * 4})`); sg.addColorStop(1, `rgba(214,130,160,${alpha * 7})`);
    ctx.save(); ctx.shadowColor = 'rgba(255,255,255,.55)'; ctx.shadowBlur = 8;
    ctx.beginPath(); curve(P, false); ctx.strokeStyle = sg; ctx.lineWidth = 1.1; ctx.stroke(); ctx.restore();
  }
  function flare(x, y, r, strength) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(240,170,195,${.55 * strength})`); g.addColorStop(.25, `rgba(160,62,96,${.3 * strength})`); g.addColorStop(1, 'rgba(100,44,62,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.strokeStyle = `rgba(255,235,242,${.8 * strength})`; ctx.lineWidth = 1; ctx.shadowColor = '#f0aac3'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.moveTo(x - r * .9, y); ctx.lineTo(x + r * .9, y); ctx.moveTo(x, y - r * .6); ctx.lineTo(x, y + r * .6); ctx.stroke(); ctx.restore();
  }
  /* --- кибер-сигилы: острые хромовые шипы-тернии по краям (в духе cybersigilism) --- */
  const rnd = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bez = (P, n) => Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1), u = 1 - t;
    return [0, 1].map(j => u * u * u * P[0][j] + 3 * u * u * t * P[1][j] + 3 * u * t * t * P[2][j] + t * t * t * P[3][j]);
  });
  function taper(pts, w, prof) {
    const L = [], R = [], n = pts.length;
    pts.forEach(([x, y], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const ww = w * prof(i / (n - 1));
      L.push([x - dy / l * ww, y + dx / l * ww]); R.push([x + dy / l * ww, y - dx / l * ww]);
    });
    return L.concat(R.reverse());
  }
  function blade(poly, alpha, glow) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    poly.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`); g.addColorStop(.45, `rgba(120,126,136,${alpha * .35})`);
    g.addColorStop(.6, `rgba(235,238,242,${alpha * .8})`); g.addColorStop(1, `rgba(90,94,102,${alpha * .25})`);
    ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.save();
    if (glow) { ctx.shadowColor = 'rgba(199,119,145,.55)'; ctx.shadowBlur = 14; }
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = .6; ctx.strokeStyle = `rgba(255,255,255,${alpha * .9})`; ctx.stroke();
    ctx.restore();
  }
  function spike(x, y, ang, len, bend, w, alpha, glow) {
    const tx = x + Math.cos(ang) * len, ty = y + Math.sin(ang) * len;
    const cx = (x + tx) / 2 - Math.sin(ang) * bend * len, cy = (y + ty) / 2 + Math.cos(ang) * bend * len;
    const pts = Array.from({ length: 18 }, (_, i) => { const t = i / 17, u = 1 - t; return [u * u * x + 2 * u * t * cx + t * t * tx, u * u * y + 2 * u * t * cy + t * t * ty]; });
    blade(taper(pts, w, t => Math.pow(1 - t, 1.4)), alpha, glow);
  }
  function sigil(P, s, seed, alpha) {
    const r = rnd(seed);
    const pts = bez(P, 80);
    blade(taper(pts, 5 * s, t => Math.pow(Math.sin(Math.PI * t), .55) + .04), alpha, false);
    let side = 1;
    for (let i = 6; i < 74; i += 4 + Math.floor(r() * 6)) {
      const [x, y] = pts[i], [x2, y2] = pts[i + 1];
      const tan = Math.atan2(y2 - y, x2 - x);
      side = r() < .75 ? -side : side;
      const len = s * (26 + r() * 80) * (.35 + .65 * Math.sin(Math.PI * i / 80));
      const ang = tan + side * (Math.PI / 2 - .55 - r() * .75);
      spike(x, y, ang, len, -side * (.18 + r() * .22), 4.2 * s, alpha, r() < .3);
      if (r() < .5) spike(x, y, ang + side * .55, len * .5, -side * .25, 2.6 * s, alpha * .85, false);
    }
    [0, 79].forEach(i => { const [x, y] = pts[i], [x2, y2] = pts[i ? i - 1 : 1]; spike(x, y, Math.atan2(y - y2, x - x2), s * 60, .1, 4 * s, alpha, true); });
  }
  function paint() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const k = Math.min(1, W / 900);
    ribbon([[-.06, -.02], [.16, .22], [-.12, .5], [.05, 1.04]], 60 * k + 20, W, H, .05);
    ribbon([[-.02, .1], [.1, .35], [-.04, .62], [.08, 1.02]], 30 * k + 12, W, H, .035);
    ribbon([[1.06, -.02], [.84, .26], [1.12, .55], [.95, 1.04]], -(60 * k + 20), W, H, .05);
    const S = .7 + k * .6, at = (x, y) => [x * W, y * H];
    const mirror = (fn) => { fn(); ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); fn(); ctx.restore(); };
    mirror(() => sigil([at(.5, .02), at(.36, .1), at(.46, .2), at(.3, .3)], S * .9, 77, .1));
    mirror(() => sigil([at(.5, 1.0), at(.38, .92), at(.48, .84), at(.34, .76)], S * .8, 91, .08));
    sigil([at(.02, .06), at(.16, .16), at(-.04, .3), at(.07, .44)], S, 7, .3);
    sigil([at(.98, .38), at(.82, .5), at(1.06, .6), at(.93, .74)], S, 23, .28);
    sigil([at(.05, .66), at(.2, .74), at(-.02, .86), at(.12, .98)], S * .8, 41, .16);
    sigil([at(.9, .02), at(.8, .08), at(1.02, .14), at(.88, .2)], S * .6, 5, .14);
    const sheen = ctx.createLinearGradient(0, H * .2, W, H * .6);
    sheen.addColorStop(.35, 'rgba(255,255,255,0)'); sheen.addColorStop(.5, 'rgba(255,255,255,.025)'); sheen.addColorStop(.65, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, H);
    flare(W * .02, H * .8, 70 * k + 40, 1);
    flare(W * .985, H * .97, 60 * k + 36, .9);
    flare(W * .99, H * .03, 40 * k + 24, .55);
  }
  let to;
  addEventListener('resize', () => { clearTimeout(to); to = setTimeout(paint, 120); });
  paint();
}

// запуск — после загрузки всех скриптов (more.js дополняет разделы)
document.addEventListener('DOMContentLoaded', () => { render(); silk(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
