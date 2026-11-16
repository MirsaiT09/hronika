/* =====================================================================
   КАЛЕНДАРЬ-ШТОРКА: нажали на номер недели → выезжает месяц, выбираете любой день.
   Работает и во вкладке «Пары», и в карточке преподавателя.
   Закрыть: крестик, тап по затемнению или свайп шторки вниз.
   ===================================================================== */
const cal = { open: false, month: null };
const calRoot = document.createElement('div');
calRoot.className = 'cal-root';
calRoot.setAttribute('data-noswipe', '');
calRoot.hidden = true;
document.body.appendChild(calRoot);

// какой день сейчас выбран (в «Парах» или у преподавателя)
const calCtx = () => (state.tab === 'teachers' && state.teacher ? 'teacher' : state.tab === 'skips' && state.sub === 'work' ? 'work' : 'pairs');
function calSelected() {
  if (calCtx() === 'work') return state.wSel ? fromIso(state.wSel) : addDays(baseMonday, state.wWeek * 7);
  const t = calCtx() === 'teacher';
  return addDays(baseMonday, (t ? state.tWeek : state.weekOffset) * 7 + (t ? state.tDay : state.day));
}
// сколько пар в этот день и есть ли пропуски
function calInfo(d) {
  if (calCtx() === 'work') { // «Работа»: можно ли взять смену в этот день
    if (d < SEM_START || d > SEM_END) return { n: 0, skip: 0 };
    const x = workDay(d);
    return { n: x.attend.length, skip: 0, w: x.shift ? 'w-shift' : x.kind === 'full' ? 'w-full' : x.kind === 'half' ? 'w-half' : '' };
  }
  if (d.getDay() === 0 || HOLIDAYS.has(iso(d)) || d < SEM_START || d > SEM_END) return { n: 0, skip: 0 };
  if (calCtx() === 'teacher') return { n: teacherDay(state.teacher, d).length, skip: 0 };
  const list = pairsFor(dow(d), weekNo(d));
  return { n: list.length, skip: list.filter(p => skips[iso(d) + '|' + p.n]).length };
}

function calHtml() {
  const m = cal.month, y = m.getFullYear(), mo = m.getMonth();
  const first = new Date(y, mo, 1), start = mondayOf(first);
  const sel = iso(calSelected()), td = iso(dayStart(now()));
  const minM = new Date(SEM_START.getFullYear(), SEM_START.getMonth(), 1);
  const maxM = new Date(SEM_END.getFullYear(), SEM_END.getMonth(), 1);
  let rows = '';
  for (let w = 0; w < 6; w++) {
    const mon = addDays(start, w * 7);
    if (w > 3 && mon.getMonth() !== mo) break;
    const wn = weekNo(mon);
    const inSem = addDays(mon, 6) >= SEM_START && mon <= SEM_END;
    let cells = `<span class="cal-wn ${inSem ? parityOf(wn) : ''}">${inSem ? wn : ''}</span>`;
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i), k = iso(d);
      const out = d.getMonth() !== mo, sun = i === 6, hol = HOLIDAYS.has(k);
      const work = calCtx() === 'work';
      const off = (sun && !work) || d < SEM_START || d > SEM_END;
      const info = calInfo(d);
      const cls = ['cal-d', out && 'out', off && 'off', hol && 'hol', k === td && 'today', k === sel && 'sel', info.skip && 'has-skip', info.w].filter(Boolean).join(' ');
      const dots = info.n ? `<span class="cal-dots">${'<i></i>'.repeat(Math.min(info.n, 4))}</span>` : '';
      cells += off ? `<span class="${cls}"><b>${d.getDate()}</b></span>`
        : `<button class="${cls}" data-calpick="${k}" aria-label="${d.getDate()} ${MONTHS[d.getMonth()]}${info.n ? ', пар: ' + info.n : ''}${hol ? ', праздник' : ''}"><b>${d.getDate()}</b>${dots}</button>`;
    }
    rows += `<div class="cal-row">${cells}</div>`;
  }
  return `<div class="cal-back" data-calclose></div>
  <section class="cal-sheet" role="dialog" aria-modal="true" aria-label="Календарь">
    <div class="cal-grab" aria-hidden="true"></div>
    <header class="cal-head">
      <button class="btn round sm" data-calmon="-1" aria-label="Предыдущий месяц" ${m <= minM ? 'disabled' : ''}>${ICON.left}</button>
      <h2>${MONTHS_NOM[mo]} <span>${y}</span></h2>
      <button class="btn round sm" data-calmon="1" aria-label="Следующий месяц" ${m >= maxM ? 'disabled' : ''}>${ICON.right}</button>
    </header>
    <div class="cal-row cal-dow"><span class="cal-wn">нед</span>${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(x => `<span>${x}</span>`).join('')}</div>
    ${rows}
    <footer class="cal-foot">
      ${calCtx() === 'work' ? '<span><i class="lg-wfull"></i>смена</span><span><i class="lg-whalf"></i>полсмены</span><span><i class="lg-pair"></i>пары</span>'
        : `<span><i class="lg-pair"></i>пары</span>${calCtx() === 'pairs' ? '<span><i class="lg-skip"></i>пропуск</span>' : ''}<span><i class="lg-hol"></i>праздник</span>`}
      <button class="btn" data-calpick="${td}">Сегодня</button>
    </footer>
  </section>`;
}

function calOpen() {
  const s = calSelected();
  cal.month = new Date(s.getFullYear(), s.getMonth(), 1);
  cal.open = true;
  calRoot.innerHTML = calHtml();
  calRoot.hidden = false;
  document.body.classList.add('cal-on');
  requestAnimationFrame(() => calRoot.classList.add('show'));
}
function calClose() {
  if (!cal.open) return;
  cal.open = false;
  calRoot.classList.remove('show');
  document.body.classList.remove('cal-on');
  const sh = calRoot.querySelector('.cal-sheet'); if (sh) sh.style.transform = '';
  setTimeout(() => { if (!cal.open) { calRoot.hidden = true; calRoot.innerHTML = ''; } }, 320);
}
function calPick(k) {
  if (calCtx() === 'work') { // окно «Работы» — 2 недели: если день уже виден, только выбираем его
    const d = fromIso(k), off = Math.round((mondayOf(d) - baseMonday) / (7 * DAY_MS));
    if (off !== state.wWeek && off !== state.wWeek + 1) state.wWeek = off;
    state.wSel = k; state.wDup = null;
    calClose(); render();
    if (navigator.vibrate) navigator.vibrate(8);
    return;
  }
  let d = fromIso(k);
  if (d.getDay() === 0) d = addDays(d, 1); // в воскресенье пар нет — открываем понедельник
  const off = Math.round((mondayOf(d) - baseMonday) / (7 * DAY_MS));
  if (calCtx() === 'teacher') { state.tWeek = off; state.tDay = dow(d); }
  else { state.weekOffset = off; state.day = dow(d); }
  calClose();
  render();
  if (navigator.vibrate) navigator.vibrate(8);
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-cal], [data-calclose], [data-calmon], [data-calpick]');
  if (!t) return;
  if ('cal' in t.dataset) { calOpen(); return; }
  if ('calclose' in t.dataset) { calClose(); return; }
  if (t.dataset.calmon) { cal.month = new Date(cal.month.getFullYear(), cal.month.getMonth() + +t.dataset.calmon, 1); calRoot.innerHTML = calHtml(); return; }
  if (t.dataset.calpick) calPick(t.dataset.calpick);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') calClose(); });

// свайп шторки вниз — закрыть
let cd = null;
calRoot.addEventListener('touchstart', e => {
  const sh = e.target.closest('.cal-sheet');
  if (!sh) return;
  cd = { y: e.touches[0].clientY, x: e.touches[0].clientX, t: Date.now(), sh, dy: 0, lock: null };
}, { passive: true });
calRoot.addEventListener('touchmove', e => {
  if (!cd) return;
  const dy = e.touches[0].clientY - cd.y, dx = e.touches[0].clientX - cd.x;
  if (!cd.lock) { if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return; cd.lock = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h'; }
  if (cd.lock !== 'v') return;
  cd.dy = Math.max(0, dy);
  cd.sh.style.transition = 'none';
  cd.sh.style.transform = `translateY(${cd.dy}px)`;
  calRoot.style.setProperty('--fade', String(Math.max(0, 1 - cd.dy / 400)));
}, { passive: true });
calRoot.addEventListener('touchend', () => {
  if (!cd) return;
  const v = cd.dy / Math.max(1, Date.now() - cd.t);
  cd.sh.style.transition = '';
  calRoot.style.removeProperty('--fade');
  if (cd.dy > 110 || (v > 0.6 && cd.dy > 30)) calClose(); else cd.sh.style.transform = '';
  cd = null;
}, { passive: true });
// при смене вкладки календарь не должен висеть поверх
AFTER_RENDER.push(() => { if (cal.open && !document.querySelector('[data-cal]')) calClose(); });
