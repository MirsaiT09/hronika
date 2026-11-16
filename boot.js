/* =====================================================================
   ЗАГРУЗЧИК: выбирает группу (свою или ту, что смотрим), подгружает
   расписание только её института (data/<институт>.js) и запускает приложение.
   ===================================================================== */
(function () {
  const D = window.DATA;
  const get = (s, k) => { try { return JSON.parse(s.getItem(k)); } catch (e) { return null; } };
  const cat = D.catalog || [];
  const findInst = k => cat.find(i => i.key === k);
  const valid = g => g && findInst(g.inst) && findInst(g.inst).groups.some(x => x.id === g.id);

  let own = get(localStorage, 'hp.group');
  if (!valid(own)) own = D.defaultGroup;
  let view = get(sessionStorage, 'hp.view');
  if (!valid(view) || (view.inst === own.inst && view.id === own.id)) view = null;
  const cur = view || own;
  const inst = findInst(cur.inst);

  const load = src => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.body.appendChild(s);
  });
  D.booting = true;
  const APP = ['app.js', 'more.js', 'work.js', 'swipe.js', 'mobile.js', 'calendar.js', 'picker.js'];

  load('data/' + inst.file)
    .then(() => {
      const I = window.DATA_I, g = inst.groups.find(x => x.id === cur.id);
      D.teachers = I.teachers;
      D.schedule = I.schedule;
      D.source = Object.assign({}, D.source, { files: I.files });
      D.session = (I.sessions || {})[g.sec] || null;
      D.group = { inst: inst.key, id: g.id, group: g.g, course: g.c, prog: g.p, sec: g.sec };
      // у заочки занятия идут и после конца семестра очников — растягиваем семестр до последней даты группы
      const last = I.schedule.filter(p => p.g === g.id && p.date).map(p => p.date).sort().pop();
      if (last) { const [y, m, d] = last.split('-').map(Number), e = D.semester.lastDay; if (new Date(y, m - 1, d) > new Date(e[0], e[1], e[2])) D.semester.lastDay = [y, m - 1, d]; }
      D.own = own;
      D.viewing = !!view;
      // ключ хранилища своей группы: у группы по умолчанию — старые ключи, отметки не теряются
      D.ownKey = own.inst === D.defaultGroup.inst && own.id === D.defaultGroup.id ? '' : '@' + own.inst + '/' + own.id;
    })
    .catch(() => { // файл института не загрузился (нет сети и нет кэша) — откатываемся к своей группе
      if (view) { sessionStorage.removeItem('hp.view'); location.reload(); }
      else { localStorage.removeItem('hp.group'); if (own !== D.defaultGroup) location.reload(); }
      throw new Error('stop');
    })
    .then(() => APP.reduce((p, f) => p.then(() => load(f)), Promise.resolve()))
    .then(() => render())
    .catch(e => { if (e && e.message !== 'stop') console.error(e); });
})();
