/* =====================================================================
   ВЫБОР ГРУППЫ: тап по «ИИЭСМ · гр. 23» → шторка: институт → программа → курс → группа.
   «Моя группа» — приложение запоминает её насовсем (у каждой группы свои пропуски и справки).
   «Посмотреть» — открыть чужую группу, не меняя свою (до закрытия приложения или до «Вернуться»).
   ===================================================================== */
const CAT = D.catalog || [];
const PROGS = D.progs || {};
const gp = { open: false, inst: GROUP.inst, p: GROUP.prog || '', c: GROUP.course, id: GROUP.id };
const gpRoot = document.createElement('div');
gpRoot.className = 'cal-root gp-root';
gpRoot.setAttribute('data-noswipe', '');
gpRoot.hidden = true;
document.body.appendChild(gpRoot);

const instOf = k => CAT.find(i => i.key === k) || CAT[0];
const groupById = (inst, id) => (instOf(inst).groups || []).find(g => g.id === id);
const uniq = a => [...new Set(a)];

function gpFix() { // если в выбранном институте нет такой программы/курса — берём первые доступные
  const gs = instOf(gp.inst).groups;
  const progs = uniq(gs.map(g => g.p));
  if (!progs.includes(gp.p)) gp.p = progs[0];
  const courses = uniq(gs.filter(g => g.p === gp.p).map(g => g.c));
  if (!courses.includes(gp.c)) gp.c = courses[0];
  if (!groupById(gp.inst, gp.id) || groupById(gp.inst, gp.id).p !== gp.p || groupById(gp.inst, gp.id).c !== gp.c) gp.id = null;
}

function gpHtml() {
  gpFix();
  const gs = instOf(gp.inst).groups;
  const progs = uniq(gs.map(g => g.p));
  const courses = uniq(gs.filter(g => g.p === gp.p).map(g => g.c)).sort((a, b) => a - b);
  const list = gs.filter(g => g.p === gp.p && g.c === gp.c);
  const own = D.own || {};
  const ownG = groupById(own.inst, own.id);
  const sel = gp.id && groupById(gp.inst, gp.id);
  const isOwn = sel && gp.inst === own.inst && gp.id === own.id;
  const isCur = sel && gp.inst === GROUP.inst && gp.id === GROUP.id;
  return `<div class="cal-back" data-gpclose></div>
  <section class="cal-sheet gp-sheet" role="dialog" aria-modal="true" aria-label="Выбор группы">
    <div class="cal-grab" aria-hidden="true"></div>
    <header class="gp-head"><h2>Группа</h2><button class="btn round sm" data-gpclose aria-label="Закрыть">${ICON.x || '×'}</button></header>
    <div class="gp-scroll">
      <p class="gp-lbl">Институт</p>
      <div class="chips gp-chips">${CAT.map(i => `<button class="chip" data-gpinst="${esc(i.key)}" aria-pressed="${i.key === gp.inst}">${esc(i.key)}</button>`).join('')}</div>
      ${progs.length > 1 ? `<p class="gp-lbl">Программа</p>
      <div class="chips gp-chips">${progs.map(p => `<button class="chip" data-gpprog="${esc(p)}" aria-pressed="${p === gp.p}">${esc(PROGS[p] || p)}</button>`).join('')}</div>` : ''}
      <p class="gp-lbl">Курс</p>
      <div class="chips gp-chips">${courses.map(c => `<button class="chip" data-gpcourse="${c}" aria-pressed="${c === gp.c}">${c} курс</button>`).join('')}</div>
      <p class="gp-lbl">Группа <i>${list.length}</i></p>
      <div class="gp-grid">${list.map(g => `<button class="gp-g${own.inst === gp.inst && own.id === g.id ? ' own' : ''}" data-gpgroup="${esc(g.id)}" aria-pressed="${g.id === gp.id}">${esc(g.g)}</button>`).join('')}</div>
    </div>
    <footer class="gp-foot">
      ${sel ? `<p class="gp-sel">${esc(gp.inst)} · ${esc(grpLabel(sel.id))}${isOwn ? ' · <b>ваша</b>' : ''}</p>
        ${isOwn ? (D.viewing ? '<button class="btn accent wide" data-grpback>Вернуться к своей</button>' : '<p class="hint">Это ваша группа</p>')
          : `<div class="gp-act"><button class="btn accent" data-gpmine>Моя группа</button><button class="btn" data-gpview ${isCur ? 'disabled' : ''}>Посмотреть</button></div>
             <p class="hint">«Моя группа» — пропуски и справки ведутся для неё. «Посмотреть» — просто открыть расписание${ownG ? `, ваша останется ${esc(own.inst)} · ${esc(grpLabel(ownG.id))}` : ''}.</p>`}`
      : '<p class="hint">Выберите номер группы</p>'}
    </footer>
  </section>`;
}
const gpDraw = () => { const sc = gpRoot.querySelector('.gp-scroll'), y = sc ? sc.scrollTop : 0; gpRoot.innerHTML = gpHtml(); const s2 = gpRoot.querySelector('.gp-scroll'); if (s2) s2.scrollTop = y; };
function gpOpen() {
  Object.assign(gp, { open: true, inst: GROUP.inst, p: GROUP.prog || '', c: GROUP.course, id: GROUP.id });
  gpRoot.innerHTML = gpHtml();
  gpRoot.hidden = false;
  document.body.classList.add('cal-on');
  requestAnimationFrame(() => gpRoot.classList.add('show'));
}
function gpClose() {
  if (!gp.open) return;
  gp.open = false;
  gpRoot.classList.remove('show');
  document.body.classList.remove('cal-on');
  setTimeout(() => { if (!gp.open) { gpRoot.hidden = true; gpRoot.innerHTML = ''; } }, 320);
}
const gpGo = () => { toast('Открываю…'); setTimeout(() => location.reload(), 60); };

document.addEventListener('click', e => {
  const t = e.target.closest('[data-grp], [data-grpback], [data-gpclose], [data-gpinst], [data-gpprog], [data-gpcourse], [data-gpgroup], [data-gpmine], [data-gpview]');
  if (!t) return;
  const ds = t.dataset;
  if ('grp' in ds) { gpOpen(); return; }
  if ('grpback' in ds) { try { sessionStorage.removeItem('hp.view'); } catch (e2) {} gpGo(); return; }
  if ('gpclose' in ds) { gpClose(); return; }
  if (ds.gpinst) { gp.inst = ds.gpinst; gp.id = null; gpDraw(); return; }
  if (ds.gpprog != null) { gp.p = ds.gpprog; gp.id = null; gpDraw(); return; }
  if (ds.gpcourse) { gp.c = +ds.gpcourse; gp.id = null; gpDraw(); return; }
  if (ds.gpgroup) { gp.id = ds.gpgroup; gpDraw(); if (navigator.vibrate) navigator.vibrate(8); return; }
  if ('gpmine' in ds && gp.id) {
    try { localStorage.setItem('hp.group', JSON.stringify({ inst: gp.inst, id: gp.id })); sessionStorage.removeItem('hp.view'); } catch (e2) {}
    gpGo(); return;
  }
  if ('gpview' in ds && gp.id) {
    try { sessionStorage.setItem('hp.view', JSON.stringify({ inst: gp.inst, id: gp.id })); } catch (e2) {}
    gpGo();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') gpClose(); });

// свайп шторки вниз — закрыть (только за «ручку» и заголовок, чтобы не мешать прокрутке списка)
let gd = null;
gpRoot.addEventListener('touchstart', e => {
  const sh = e.target.closest('.cal-sheet');
  if (!sh || e.target.closest('.gp-scroll')) return;
  gd = { y: e.touches[0].clientY, t: Date.now(), sh, dy: 0 };
}, { passive: true });
gpRoot.addEventListener('touchmove', e => {
  if (!gd) return;
  gd.dy = Math.max(0, e.touches[0].clientY - gd.y);
  gd.sh.style.transition = 'none';
  gd.sh.style.transform = `translateY(${gd.dy}px)`;
}, { passive: true });
gpRoot.addEventListener('touchend', () => {
  if (!gd) return;
  const v = gd.dy / Math.max(1, Date.now() - gd.t);
  gd.sh.style.transition = '';
  if (gd.dy > 110 || (v > 0.6 && gd.dy > 30)) { gd.sh.style.transform = ''; gpClose(); } else gd.sh.style.transform = '';
  gd = null;
}, { passive: true });

// в режиме просмотра — плашка сверху на всех экранах
AFTER_RENDER.push(() => {
  if (!D.viewing) return;
  app.insertAdjacentHTML('afterbegin', `<div class="view-bar glass"><span>Смотрите: <b>${esc(GROUP.inst)} · ${esc(grpLabel(GROUP.id))}</b></span><button class="link-btn" data-grpback>к своей</button></div>`);
});
