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
  teacher: null, query: '', tWeek: 0, tDay: today.getDay() === 0 ? 0 : dow(today),
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
const bldgOf = room => { const code = (room.split('/')[1] || '').trim(); return BUILDINGS[code] ? { code, ...BUILDINGS[code] } : null; };
const ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="M8 5 4 9l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
};
const ORN = '<div class="orn" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2v20M5 9h14M12 2l2 3-2 3-2-3zM8.5 16 12 22l3.5-6"/></svg></div>';
const fmtDur = m => m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}`;
// стикеры — для светлой темы: 1–53 st1, 54–105 st2, 106–185 st3, 186–265 st4, 266–340 st5 (GitHub грузит не больше 100 файлов за раз)
const ST = n => `assets/st${n <= 53 ? 1 : n <= 105 ? 2 : n <= 185 ? 3 : n <= 265 ? 4 : 5}/${n}.webp`;
const STICKERS = [97, 59, 62, 94, 36, 72, 89, 31, 13, 39, 34, 96, 85, 37, 38, 20, 11, 2, 7, 33, 40, 54, 64, 86, 83, 88, 98, 103, 105, 4, 3, 65, 47, 56, 73, 26, 49, 75, 76, 79, 15, 16, 43, 9, 14, 41, 87, 61, 63, 55, 66, 67, 68, 71, 74, 77, 78, 80, 84, 90, 91, 93, 95, 99, 101, 102, 104, 1, 6, 8, 10, 12, 17, 19, 21, 22, 23, 24, 27, 28, 29, 30, 32, 35, 42, 44, 45, 46, 48, 50, 51, 52, 53, 57, 58, 60, 69, 70, 81, 82, 315, 170, 138, 272, 227, 310, 295, 220, 183, 303, 126, 130, 332, 128, 158, 124, 168, 339, 147, 125, 312, 279, 233, 292, 146, 190, 324, 185, 214, 239, 122, 199, 274, 154, 133, 210, 208, 326, 330, 276, 256, 287, 314, 282, 311, 164, 106, 172, 291, 231, 184, 229, 309, 228, 141, 283, 142, 316, 237, 171, 248, 116, 121, 299, 243, 123, 323, 331, 246, 319, 213, 252, 187, 161, 221, 340, 198, 241, 305, 257, 194, 195, 150, 226, 285, 202, 160, 118, 139, 250, 211, 176, 197, 271, 192, 174, 264, 119, 275, 251, 144, 165, 205, 301, 266, 166, 328, 268, 335, 131, 169, 155, 238, 108, 300, 117, 204, 322, 325, 113, 263, 265, 234, 107, 196, 135, 212, 280, 313, 209, 215, 307, 114, 224, 149, 207, 270, 143, 262, 167, 235, 137, 261, 145, 173, 298, 249, 320, 333, 247, 181, 327, 318, 193, 284, 179, 289, 178, 254, 304, 218, 132, 288, 136, 258, 157, 242, 191, 245, 286, 153, 148, 273, 281, 223, 334, 232, 152, 230, 317, 293, 189, 278, 180, 255, 302, 253, 201, 297, 162, 338, 151, 277, 203, 259, 115, 159, 120, 306, 329, 219, 296, 269, 240, 111, 216, 236, 290, 336, 134, 112, 225, 267, 163, 109, 222, 175, 156, 294, 140, 200, 244, 206, 217, 186, 260, 110, 127, 321, 337, 182, 308];
const dayIdx = d => Math.floor((dayStart(d) - new Date(2026, 0, 1)) / DAY_MS);
const stickerOfDay = (d = dayStart(now()), shift = 0) => ST(STICKERS[((dayIdx(d) + shift) % STICKERS.length + STICKERS.length) % STICKERS.length]);
// сдвиги в коллекции для каждого места: в один день все стикеры разные, в полночь меняются все
const stickerNow = shift => stickerOfDay(dayStart(now()), shift); // «сегодня» считается заново — после полуночи стикеры сменятся сами
const ST_SHIFT = { brand: 3, teachers: 11, where: 17, skips: 23, empty: 29, certs: 31, session: 37 };
const THEME_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor"/></svg>';
const brand = () => `<div class="brand"><img class="only-light brand-st" src="${stickerNow(ST_SHIFT.brand)}" alt="">
  <span class="brand-end"><span class="grp-chip only-light"><i></i>${esc(GROUP.inst || '')} · гр. ${esc(GROUP.group || '')}</span>
  <button class="theme-btn" data-themetoggle aria-label="Сменить тему">${THEME_ICON}</button></span></div>`;
// наклейка-«печать» пропуска: своя для каждой пары (по дате и номеру), не меняется при перерисовке
const stampOf = key => { let h = 7; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ST(STICKERS[h % STICKERS.length]); };
const sealSvg = (fresh, key) => `<div class="seal ${fresh ? 'fresh' : ''}">
  <img class="seal-st only-light" src="${stampOf(key)}" alt=""></div>`;
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
  let prev = null;
  list.forEach((p, idx) => {
    // «окно»: между парами пропущен хотя бы один номер пары
    if (prev && p.n - prev.n > 1) {
      const ws = at(date, BELLS[prev.n][1]), we = at(date, BELLS[p.n][0]);
      const mins = Math.round((we - ws) / 6e4);
      const nowWin = ws <= t0 && t0 < we;
      cards += `<div class="gap ${nowWin ? 'now' : ''}" role="note"><span class="gap-line"></span>
        <span class="gap-pill"><b>${nowWin ? 'Сейчас окно' : 'Окно'}</b> · ${fmtDur(mins)}<i>${BELLS[prev.n][1]} – ${BELLS[p.n][0]}</i></span><span class="gap-line"></span></div>`;
    }
    if (!prev || p.n !== prev.n) prev = p;
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
        <div class="pair-line"><span class="tag ${p.type}">${TYPES[p.type]}</span><span class="room">${esc(p.room)}</span>${b ? `<span class="bldg">${esc(b.name)}</span>` : ''}${weekNote(p) ? `<span class="bldg">${weekNote(p)}</span>` : ''}</div>
        ${t ? `<div class="pair-line"><button class="teacher-link" data-teacher="${p.t}">${t.rank} ${esc(t.name)}</button></div>` : ''}
        ${tn.length ? `<div class="pair-note">${esc(tn[tn.length - 1])}</div>` : ''}
      </div>
      <div class="pair-actions">
        <button class="btn ${sk ? 'accent' : ''}" data-skip="${key}" aria-pressed="${!!sk}">${sk ? ICON.undo + (past ? 'Был на паре' : 'Пойду') : ICON.x + (past ? 'Пропустил' : 'Не пойду')}</button>
        ${t ? `<button class="btn" data-teacher="${p.t}">${ICON.plus}Заметки${tn.length ? ` <span class="cnt">${tn.length}</span>` : ''}</button>` : ''}
      </div>
      ${sk ? `<div class="reasons" role="group" aria-label="Причина пропуска">${Object.entries(REASONS).map(([r, l]) =>
        `<button class="chip" data-reason="${key}|${r}" aria-pressed="${sk.r === r}">${l}</button>`).join('')}</div>` : ''}
      ${sk ? sealSvg(state.justStamped === key, key) : ''}
    </article>`;
  });
  if (!list.length) cards = `<div class="free glass"><img class="only-light free-st" src="${stickerOfDay(date, 7)}" alt=""><span class="big">${holiday ? 'Праздник' : 'Свобода'}</span><span>Пар нет. День твой.</span></div>`;
  const skippedToday = list.filter(p => skips[iso(date) + '|' + p.n]).length;
  return `
    ${brand()}
    <header class="hero">
      <div class="hero-row">
        <h1 class="title-h"><span class="kicker only-light">${DOW_LONG[state.day]}<b></b></span><span class="title-pix">Расписание</span></h1>
        
      </div>
      <div class="divider"></div>
      <span class="meta">${DOW_LONG[state.day]}, ${date.getDate()} ${MONTHS[date.getMonth()]} <i>·</i> ${GROUP.inst} <i>·</i> гр. ${GROUP.group}</span>
    </header>
    ${state.weekOffset === 0 && typeof nowCard === 'function' ? nowCard() : ''}
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
    ${list.length ? ORN : ''}
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
    <header class="page-title img-title"><div><h1><span class="title-pix">Преподы</span></h1><p>Где найти · когда ловить</p></div><img class="only-light pt-st" src="${stickerNow(ST_SHIFT.teachers)}" alt=""></header>
    <div class="search-wrap"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input class="search glass" id="tq" type="search" enterkeyhint="search" placeholder="Фамилия или предмет" value="${esc(state.query)}" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Поиск преподавателя"></div>
    <p class="hint" style="margin:0 4px">${q ? `Найдено: ${found.length}${found.length > 60 ? ' · показаны первые 60, уточните запрос' : ''}` : `Ваши преподаватели · поиск — по всем ${Object.keys(TEACHERS).length} преподавателям ${GROUP.inst}`}</p>
    <section class="list">${rows || `<div class="free glass"><span>Никого не нашёл по «${esc(state.query)}»</span></div>`}</section>`;
}

// пары преподавателя на конкретную дату; потоковые пары (несколько групп в одной аудитории) — одной строкой
function teacherDay(id, d) {
  const by = {};
  occurrences(d, d, BY_T[id] || []).forEach(o => {
    const k = o.p.n + '|' + o.p.room + '|' + o.p.s + '|' + o.p.type;
    (by[k] = by[k] || { ...o, groups: [] }).groups.push(o.p.g);
  });
  return Object.values(by).sort((a, b) => a.p.n - b.p.n);
}
const groupsLabel = gs => gs.length === 1 ? grpLabel(gs[0]) : `${grpLabel(gs[0]).replace(/гр\. .*/, '')}гр. ${gs.map(g => String(g).split('-').pop()).join(', ')}`;

function renderTeacherCard(id) {
  const t = TEACHERS[id];
  const monday = addDays(baseMonday, state.tWeek * 7);
  const wn = weekNo(monday), parity = parityOf(wn);
  const date = addDays(monday, state.tDay);
  const t0 = now();
  const days = DOW_SHORT.map((lbl, i) => {
    const d = addDays(monday, i);
    const n = teacherDay(id, d).length;
    return `<button class="btn day ${i === state.tDay ? 'metal' : ''} ${iso(d) === iso(today) ? 'today' : ''}" data-tday="${i}" aria-pressed="${i === state.tDay}" aria-label="${DOW_LONG[i]}, ${d.getDate()}: ${n} ${plural(n, 'пара', 'пары', 'пар')}">
      <small>${lbl}</small><strong>${d.getDate()}</strong><span class="dots">${'<i></i>'.repeat(Math.min(n, 6))}</span></button>`;
  }).join('');
  const list = teacherDay(id, date);
  const slotHtml = list.map(o => {
    const cls = o.start <= t0 && t0 < o.end ? 'now' : o.end <= t0 ? 'past' : '';
    return `<div class="slot ${cls}">
      <span class="sd"><b>${BELLS[o.p.n][0]}</b>${o.p.n} пара${cls === 'now' ? ' · <em>сейчас</em>' : ''}</span>
      <span class="ss"><span>${esc(o.p.room || '—')} · ${groupsLabel(o.groups)}</span><span>${TYPES[o.p.type]} · ${esc(o.p.s)}</span></span></div>`;
  }).join('');
  const holiday = HOLIDAYS.has(iso(date));
  const w = teacherWhere(id);
  const lbl = { now: 'Сейчас на паре', break: 'Перерыв · следующая пара', today: 'Сегодня будет', later: 'Где поймать' };
  let where = '';
  if (w) {
    const b = bldgOf(w.o.p.room);
    where = `<div class="where glass"><span class="lbl">${lbl[w.mode]}</span>
      <span class="room-big">${esc(w.o.p.room)}</span>
      <span class="when">${dayLabel(w.o.date)}, ${BELLS[w.o.p.n][0]}–${BELLS[w.o.p.n][1]} · ${grpLabel(w.o.p.g)} · ${TYPES[w.o.p.type].toLowerCase()}</span>
      ${b ? `<span class="bl">${esc(b.name)} — ${esc(b.hint)}</span>` : ''}
      <img class="only-light where-st" src="${stickerNow(ST_SHIFT.where)}" alt=""></div>`;
  }
  const tn = notes[id] || [];
  return `
    <button class="btn round back" data-back aria-label="Назад к списку">${ICON.left}</button>
    <div class="t-hero"><span class="mono-ini">${initials(t.name)}</span><div><span class="rank">${t.rank}</span><h2>${esc(t.name)}</h2></div></div>
    ${where}
    ${t.dept || t.office ? `<div class="office glass">${t.dept ? `<span>${esc(t.dept)}</span>` : ''}${t.office ? `<span>Кабинет кафедры: <b>${esc(t.office)}</b> — если нет на паре</span>` : ''}</div>` : ''}
    <div class="sec-title">Расписание</div>
    <div class="week glass">
      <div class="week-label"><span class="week-no">${wn}</span>
        <span class="week-par">${parity === 'even' ? 'чётная' : 'нечётная'} <i>· неделя</i></span></div>
      <div class="arrows">
        ${state.tWeek ? `<button class="btn round" data-tweek="0" aria-label="К текущей неделе">${ICON.undo}</button>` : ''}
        <button class="btn round" data-tweek="-1" aria-label="Предыдущая неделя">${ICON.left}</button>
        <button class="btn round" data-tweek="1" aria-label="Следующая неделя">${ICON.right}</button>
      </div>
    </div>
    <nav class="days" aria-label="Дни недели">${days}</nav>
    <p class="t-date">${DOW_LONG[state.tDay]}, ${date.getDate()} ${MONTHS[date.getMonth()]}</p>
    <div class="slots glass">${slotHtml || `<p class="empty">${holiday ? 'Праздник — пар нет' : 'В этот день пар нет'}</p>`}</div>
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
    ${v > 0 ? `<circle cx="62" cy="62" r="${r}" fill="none" stroke="url(#gRing)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}"/>` : ''}
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
    <header class="page-title img-title"><div><h1><span class="title-pix">Прогулы</span></h1><p>Посещаемость и пропуски</p></div><img class="only-light pt-st" src="${stickerNow(ST_SHIFT.skips)}" alt=""></header>
    ${typeof skipsSubSeg === 'function' ? skipsSubSeg() : ''}
    <div class="period-tabs" role="group" aria-label="Период">
      ${[['week', 'Неделя'], ['month', 'Месяц'], ['sem', 'Семестр']].map(([k, l]) => `<button data-period="${k}" aria-pressed="${state.period === k}">${l}</button>`).join('')}
    </div>
    <div class="period-nav slim">
      ${state.period !== 'sem' ? `<button class="btn round sm" data-poff="-1" aria-label="Предыдущий период" ${canPrev ? '' : 'disabled'}>${ICON.left}</button>` : ''}
      <span class="lbl">${lbl}</span>
      ${state.period !== 'sem' ? `<button class="btn round sm" data-poff="1" aria-label="Следующий период" ${canNext ? '' : 'disabled'}>${ICON.right}</button>` : ''}
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
    <div class="card glass"><h3>Журнал пропусков<i>${rTotal}</i></h3>${hist ? `<div class="hist">${hist}</div>` : `<div class="empty"><img class="empty-acc only-light" src="${stickerNow(ST_SHIFT.empty)}" alt=""><br>Пропусков нет — так держать</div>`}</div>
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
let lastView = '';
function render() {
  const view = [state.tab, state.sub, state.day, state.weekOffset, state.teacher, state.tDay, state.tWeek, state.period, state.pOffset].join('|');
  app.classList.toggle('enter', view !== lastView);
  lastView = view;
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
  if (ds.teacher) { state.tab = 'teachers'; state.teacher = ds.teacher; state.tWeek = 0; state.tDay = today.getDay() === 0 ? 0 : dow(today); render(); window.scrollTo(0, 0); return; }
  if ('back' in ds) { state.teacher = null; render(); return; }
  if (ds.tday) { state.tDay = +ds.tday; render(); return; }
  if (ds.tweek) { state.tWeek = +ds.tweek === 0 ? 0 : state.tWeek + +ds.tweek; render(); return; }
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


// запуск — после загрузки всех скриптов (more.js дополняет разделы)
document.addEventListener('DOMContentLoaded', () => { render(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
