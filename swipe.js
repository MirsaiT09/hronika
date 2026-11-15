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
function placeInd(pos, animate = true) {
  const b = tabBtns();
  if (!b.length) return;
  const i0 = Math.max(0, Math.min(b.length - 1, Math.floor(pos))), i1 = Math.min(b.length - 1, i0 + 1), f = pos - i0;
  const x = b[i0].offsetLeft + (b[i1].offsetLeft - b[i0].offsetLeft) * f;
  const w = b[i0].offsetWidth + (b[i1].offsetWidth - b[i0].offsetWidth) * f;
  ind.classList.toggle('instant', !animate);
  ind.style.transform = `translateX(${x}px)`;
  ind.style.width = `${w}px`;
  ind.style.top = `${b[i0].offsetTop}px`;
  ind.style.height = `${b[i0].offsetHeight}px`;
  // растяжка во время движения — «живая» таблетка
  ind.classList.toggle('moving', !animate && f > 0.02 && f < 0.98);
}
const tabIdx = () => Math.max(0, TAB_ORDER.indexOf(state.tab));

// направление анимации экрана при смене вкладки (и тапом, и свайпом)
let prevTab = state.tab;
AFTER_RENDER.push(() => {
  const a = TAB_ORDER.indexOf(prevTab), b = TAB_ORDER.indexOf(state.tab);
  app.classList.remove('slide-l', 'slide-r');
  if (a !== b && a >= 0 && b >= 0) { void app.offsetWidth; app.classList.add(b > a ? 'slide-r' : 'slide-l'); }
  prevTab = state.tab;
  placeInd(tabIdx(), true);
});
addEventListener('resize', () => placeInd(tabIdx(), false));
app.addEventListener('animationend', e => { if (e.target.parentElement === app) placeInd(tabIdx(), true); });
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
    if (g.dir === 'h') app.classList.add('dragging');
  }
  if (g.dir !== 'h') return;
  const i = tabIdx(), W = innerWidth;
  const back = dx > 0 && state.tab === 'teachers' && state.teacher; // из карточки преподавателя — назад к списку
  const hasNext = back || (dx < 0 ? i < TAB_ORDER.length - 1 : i > 0);
  // у края — сопротивление, как у резинки
  g.dx = hasNext ? dx : dx * 0.25;
  app.style.transform = `translateX(${g.dx * (hasNext ? 0.35 : 0.5)}px)`;
  app.style.opacity = String(1 - Math.min(Math.abs(g.dx) / W, 1) * (hasNext ? 0.5 : 0.1));
  const prog = hasNext && !back ? Math.min(Math.abs(dx) / (W * 0.6), 1) : 0;
  placeInd(i + (dx < 0 ? prog : -prog), false);
}, { passive: true });

function endSwipe() {
  if (!g || g.dir !== 'h') { g = null; return; }
  const i = tabIdx(), W = innerWidth, v = Math.abs(g.dx) / Math.max(1, Date.now() - g.t);
  const next = g.dx < 0 ? i + 1 : i - 1;
  const far = Math.abs(g.dx) > W * 0.22 || (v > 0.45 && Math.abs(g.dx) > 30);
  if (far && g.dx > 0 && state.tab === 'teachers' && state.teacher) {
    app.classList.remove('dragging'); app.style.transform = ''; app.style.opacity = ''; g = null;
    state.teacher = null; prevTab = 'session'; // экран въедет слева, как «назад» в iOS
    render(); window.scrollTo(0, 0); return;
  }
  const go = far && next >= 0 && next < TAB_ORDER.length;
  app.classList.remove('dragging');
  app.style.transform = ''; app.style.opacity = '';
  g = null;
  if (go) {
    state.tab = TAB_ORDER[next]; state.teacher = null;
    window.scrollTo(0, 0);
    render();
    if (navigator.vibrate) navigator.vibrate(8);
  } else {
    placeInd(i, true);
  }
}
document.addEventListener('touchend', endSwipe, { passive: true });
document.addEventListener('touchcancel', endSwipe, { passive: true });
