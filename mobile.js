/* =====================================================================
   iPhone: клавиатура, подсказка об установке, возврат из фона
   ===================================================================== */
// 1) Пока открыта клавиатура, прячем нижнее меню — иначе iOS поднимает его над клавиатурой и оно закрывает поле
const isField = el => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');
document.addEventListener('focusin', e => { if (isField(e.target)) document.body.classList.add('kb'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('kb'); }, 80));
// поле не прячется под клавиатурой: когда меняется видимая область, докручиваем к активному полю
if (window.visualViewport) {
  visualViewport.addEventListener('resize', () => {
    const el = document.activeElement;
    if (isField(el)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

// 2) Подсказка «Добавить на экран Домой» — только в Safari на iPhone/iPad и только если ещё не установлено
(function installHint() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!ios || standalone || store.get('hp.a2hs', 0) > Date.now()) return;
  const SHARE = '<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v9.5h14V11h-1"/></svg>';
  setTimeout(() => {
    const el = document.createElement('div');
    el.className = 'a2hs glass';
    el.setAttribute('role', 'dialog');
    el.innerHTML = `<img src="icons/apple-touch-icon.png" alt=""><div><b>Установите как приложение</b>
      <span>Нажмите ${SHARE} «Поделиться» внизу Safari, затем «На экран „Домой“»</span></div>
      <button aria-label="Скрыть подсказку">×</button>`;
    el.querySelector('button').onclick = () => { store.set('hp.a2hs', Date.now() + 14 * 864e5); el.remove(); };
    document.body.appendChild(el);
  }, 2500);
})();

// 3) Возврат из фона / после блокировки экрана — обновить «сейчас идёт», не теряя вкладку
addEventListener('pageshow', e => { if (e.persisted) render(); });
