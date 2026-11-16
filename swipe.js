/* =====================================================================
   СВАЙПЫ МЕЖДУ ВКЛАДКАМИ + СКОЛЬЗЯЩАЯ «ТАБЛЕТКА» В НИЖНЕМ МЕНЮ
   Свайп влево — следующая вкладка, вправо — предыдущая.
   Во время свайпа таблетка едет за пальцем, после — пружинит на место.
   ===================================================================== */
const TAB_ORDER = ['pairs', 'teachers', 'skips', 'session'];
const navIn = document.querySelector('.nav-in');
const tabBtns = () => [...navIn.querySelectorAll('.tab')];
const ind = document.createElement('span');
ind.className = 'tab-ind';
ind.setAttribute('aria-hidden', 'true');
navIn.prepend(ind);

// положение таблетки: под вкладкой i (можно дробное — между двумя вкладками)
// geo — размеры вкладок, замеренные один раз на жест (замер на каждом кадре заставлял iPhone пересчитывать раскладку)
const tabGeo = () => tabBtns().map(b => ({ l: b.offsetLeft, w: b.offsetWidth, t: b.offsetTop, h: b.offsetHeight }));
function placeInd(pos, animate = true, geo) {
  const b = geo || tabGeo();
  if (!b.length) return;
  const i0 = Math.max(0, Math.min(b.length - 1, Math.floor(pos))), i1 = Math.min(b.length - 1, i0 + 1), f = pos - i0;
  const x = b[i0].l + (b[i1].l - b[i0].l) * f;
  const w = b[i0].w + (b[i1].w - b[i0].w) * f;
  ind.classList.toggle('instant', !animate);
  ind.style.transform = `translate3d(${x}px,0,0)`;
  ind.style.width = `${w}px`;
  if (!geo) { ind.style.top = `${b[i0].t}px`; ind.style.height = `${b[i0].h}px`; }
  // растяжка во время движения — «живая» таблетка
  ind.classList.toggle('moving', !animate && f > 0.02 && f < 0.98);
}
const tabIdx = () => Math.max(0, TAB_ORDER.indexOf(state.tab));

// направление анимации экрана при смене вкладки (и тапом, и свайпом)
let prevTab = state.tab;
let swipeNav = false; // экран сменили свайпом — въезжает весь экран целиком, без отдельного сдвига карточек
AFTER_RENDER.push(() => {
  const a = TAB_ORDER.indexOf(prevTab), b = TAB_ORDER.indexOf(state.tab);
  app.classList.remove('slide-l', 'slide-r');
  app.classList.toggle('swiped', swipeNav);
  if (!swipeNav && a !== b && a >= 0 && b >= 0) { void app.offsetWidth; app.classList.add(b > a ? 'slide-r' : 'slide-l'); }
  swipeNav = false;
  prevTab = state.tab;
  placeInd(tabIdx(), true);
});
addEventListener('resize', () => placeInd(tabIdx(), false));
app.addEventListener('animationend', e => { if (e.target.parentElement === app) placeInd(tabIdx(), true); });
// слой для движения экрана держим только пока он едет — постоянный слой на всю страницу съедает память iPhone
app.addEventListener('transitionend', e => { if (e.target === app && !app.classList.contains('dragging')) app.classList.remove('moving'); });
document.fonts && document.fonts.ready.then(() => placeInd(tabIdx(), false));
requestAnimationFrame(() => placeInd(tabIdx(), false));

/* ---------- жест ---------- */
// где свайп не нужен: поля ввода, ползунки и всё, что само прокручивается вбок
function noSwipe(el) {
  if (el.closest('input, textarea, select, .nav, [data-noswipe]')) return true;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 2) { const ox = getComputedStyle(n).overflowX; if (ox === 'auto' || ox === 'scroll') return true; }
  }
  return false;
}
let g = null;
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1 || noSwipe(e.target)) { g = null; return; }
  const t = e.touches[0];
  g = { x: t.clientX, y: t.clientY, t: Date.now(), dir: null, dx: 0 };
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!g) return;
  const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
  if (!g.dir) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    g.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'h' : 'v';
    if (g.dir === 'h') { app.classList.add('dragging', 'moving'); g.geo = tabGeo(); }
  }
  if (g.dir !== 'h') return;
  const i = tabIdx(), W = innerWidth;
  const back = dx > 0 && state.tab === 'teachers' && state.teacher; // из карточки преподавателя — назад к списку
  const hasNext = back || (dx < 0 ? i < TAB_ORDER.length - 1 : i > 0);
  // у края — сопротивление, как у резинки
  g.dx = hasNext ? dx : dx * 0.25;
  app.style.transform = `translate3d(${g.dx * (hasNext ? 0.6 : 0.5)}px,0,0)`;
  app.style.opacity = String(1 - Math.min(Math.abs(g.dx) / W, 1) * (hasNext ? 0.35 : 0.05));
  const prog = hasNext && !back ? Math.min(Math.abs(dx) / (W * 0.6), 1) : 0;
  placeInd(i + (dx < 0 ? prog : -prog), false, g.geo);
}, { passive: true });

// dir = 1 — новый экран въезжает справа, -1 — слева
function commitSwipe(dir, change) {
  app.classList.add('dragging', 'moving'); // без анимации ставим новый экран сбоку…
  swipeNav = true;
  change();
  app.style.transform = `translate3d(${dir * Math.min(110, innerWidth * 0.28)}px,0,0)`;
  app.style.opacity = '0';
  void app.offsetWidth;
  app.classList.remove('dragging');        // …и плавно доводим его в центр
  app.style.transform = ''; app.style.opacity = '';
  settle();
}
const settle = () => setTimeout(() => { if (!app.classList.contains('dragging')) app.classList.remove('moving'); }, 650); // если transitionend не придёт
function endSwipe() {
  if (!g || g.dir !== 'h') { g = null; return; }
  const i = tabIdx(), W = innerWidth, v = Math.abs(g.dx) / Math.max(1, Date.now() - g.t);
  const next = g.dx < 0 ? i + 1 : i - 1;
  const far = Math.abs(g.dx) > W * 0.22 || (v > 0.45 && Math.abs(g.dx) > 30);
  if (far && g.dx > 0 && state.tab === 'teachers' && state.teacher) {
    g = null;
    commitSwipe(-1, () => { state.teacher = null; render(); window.scrollTo(0, 0); }); // «назад», как в iOS
    return;
  }
  const go = far && next >= 0 && next < TAB_ORDER.length;
  const dir = g.dx < 0 ? 1 : -1;
  g = null;
  if (go) {
    commitSwipe(dir, () => { state.tab = TAB_ORDER[next]; state.teacher = null; window.scrollTo(0, 0); render(); });
    if (navigator.vibrate) navigator.vibrate(8);
  } else {
    app.classList.remove('dragging');
    app.style.transform = ''; app.style.opacity = '';   // не дотянули — мягко возвращаемся
    placeInd(i, true);
    settle();
  }
}
document.addEventListener('touchend', endSwipe, { passive: true });
document.addEventListener('touchcancel', endSwipe, { passive: true });
