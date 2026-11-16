"""Обновляет расписание в приложении из PDF-файлов на сайте НИУ МГСУ — для ВСЕХ институтов и групп.

Что делает:
  1. открывает страницу «Файлы расписания для скачивания» на mgsu.ru;
  2. скачивает PDF всех институтов и курсов (бакалавриат, специалитет, магистратура, ИДО);
     файлы сессий, практик и аспирантуры пропускает — это не расписание пар;
  3. разбирает таблицы (tools/pdflines.swift + tools/parse_mgsu.py);
  4. записывает:
       app/data.js            — общее: звонки, семестр, список институтов и групп;
       app/data/<институт>.js — пары всех групп института и его преподаватели.
     Приложение подгружает только файл института выбранной группы.

Запуск (из папки проекта):  python3 tools/update_schedule.py
Своя группа по умолчанию:   python3 tools/update_schedule.py --inst ИИЭСМ --course 3 --group 23
Повторно без скачивания:    python3 tools/update_schedule.py --work папка   (PDF и разбор берутся из папки, если уже есть)
"""
import argparse
import datetime
import html
import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import parse_mgsu  # noqa: E402

LIST_URL = "https://mgsu.ru/student/Raspisanie_zanyatii_i_ekzamenov/fayly-raspisaniya-dlya-skachivaniya/"
UA = {"User-Agent": "Mozilla/5.0 (schedule-app)"}

BELLS = {1: ["08:30", "09:50"], 2: ["10:00", "11:20"], 3: ["11:30", "12:50"],
         4: ["13:00", "14:20"], 5: ["14:30", "15:50"], 6: ["16:00", "17:20"],
         7: ["18:10", "19:30"], 8: ["19:40", "21:00"]}

INSTITUTES = ["ИИЭСМ", "ИЦТМС", "ИПГС", "ИАГ", "ИГЭС", "ИЭУКСН", "ИДО"]
# у части файлов на сайте пустая подпись — институт узнаём по имени файла
HREF_INST = {"IIESM": "ИИЭСМ", "IZTMS": "ИЦТМС", "IPGS": "ИПГС", "PGS": "ИПГС", "IAG": "ИАГ", "IGES": "ИГЭС",
             "IEUKSN": "ИЭУКСН", "EYKSN": "ИЭУКСН", "IDO": "ИДО"}
# программы: код в id группы и подпись в приложении
PROGS = {
    "": "Бакалавриат", "с": "Специалитет", "м": "Магистратура",
    "оз": "Бакалавриат, очно-заочно", "з": "Бакалавриат, заочно", "сз": "Специалитет, заочно",
    "мз": "Магистратура, заочно", "моз": "Магистратура, очно-заочно",
}
IDO_FORMS = {"boz": "оз", "bz": "з", "sz": "сз", "mz": "мз", "moz": "моз"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read()


def page_links():
    page = get(LIST_URL).decode("utf-8", "ignore")
    out = []
    for href, text in re.findall(r'<a [^>]*href="([^"]+\.pdf)"[^>]*>(.*?)</a>', page, re.S | re.I):
        label = html.unescape(re.sub("<[^>]+>", "", text)).strip()
        url = urllib.parse.urljoin(LIST_URL, urllib.parse.quote(href, safe="/:%"))
        out.append((label, href, url))
    return out


def classify(label, href):
    """(институт, код программы) или None, если файл — не расписание пар."""
    name = urllib.parse.unquote(href.rsplit("/", 1)[-1])
    low = (label + " " + name).lower()
    if re.search(r"сесси|экзам|зач[её]т|практик|нир|_ses(?![a-z])|_pr_|ppr|аспир|^асп|asp", low):
        return None
    inst = next((i for i in INSTITUTES if label.upper().startswith(i)), None)
    if not inst:
        m = re.match(r"([A-Z]+)", name)
        inst = m and next((v for k, v in HREF_INST.items() if m.group(1).startswith(k)), None)
    if not inst:
        return None
    if inst == "ИДО":
        f = re.search(r"_\dk_([a-z]+?)(?:_|\d|\.pdf)", name)
        return (inst, IDO_FORMS.get(f.group(1), "з")) if f else None
    if "маг" in low or re.match(r"[A-Z]+m_", name):
        return inst, "м"
    if "спец" in low or re.match(r"IPGSc_", name):
        return inst, "с"
    return inst, ""


def session_files(links):
    """PDF сессии: ключ — (институт, код программы, курс). Ищем и по подписи, и по имени файла."""
    out = {}
    for label, href, url in links:
        name = urllib.parse.unquote(href.rsplit("/", 1)[-1])
        low = (label + " " + name).lower()
        if not re.search(r"сесси|экзам|зач[её]т|_ses(?![a-z])|session|ekzam|zachet", low) or re.search(r"аспир|asp", low):
            continue
        inst = next((i for i in INSTITUTES if label.upper().startswith(i)), None)
        if not inst:
            m = re.match(r"([A-Z]+)", name)
            inst = m and next((v for k, v in HREF_INST.items() if m.group(1).startswith(k)), None)
        c = re.search(r"(\d)\s*курс", low) or re.search(r"_(\d)\s*k[_.]", low)
        if inst and c:
            prog = "м" if ("маг" in low or re.match(r"[A-Z]+m_", name)) else "с" if ("спец" in low or re.match(r"IPGSc_", name)) else ""
            out.setdefault((inst, prog, c.group(1)), {"label": label or f"{inst}, {c.group(1)} курс — сессия", "url": url})
    return out


def parse_pdf(i, label, url, work):
    d = Path(work) / f"f{i:03d}"
    d.mkdir(parents=True, exist_ok=True)
    if not (d / "s.pdf").exists():
        (d / "s.pdf").write_bytes(get(url))
    if not (d / "lines.json").exists():
        subprocess.run(["swift", str(ROOT / "tools/pdflines.swift"), str(d / "s.pdf"), str(d)],
                       check=True, capture_output=True, timeout=1200)
    cells = parse_mgsu.parse(str(d))
    return [it for c in cells for it in parse_mgsu.entry(c)]


def slug(name):
    tr = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
                  ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t",
                   "u", "f", "h", "c", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"]))
    return re.sub(r"[^a-z]+", "_", "".join(tr.get(c, c) for c in name.lower())).strip("_")


def natural(s):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", str(s))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inst", default="ИИЭСМ", help="группа по умолчанию: институт")
    ap.add_argument("--course", type=int, default=3)
    ap.add_argument("--group", default="23")
    ap.add_argument("--out", help="куда писать data.js и data/ (по умолчанию — папка app)")
    ap.add_argument("--min-groups", type=int, default=300,
                    help="если групп нашлось меньше — сайт МГСУ, видимо, сломался: ничего не записываем")
    ap.add_argument("--work", help="папка для PDF и промежуточных файлов (по умолчанию — временная)")
    ap.add_argument("--with-military", action="store_true",
                    help="оставить военную подготовку (по умолчанию убрана из расписания)")
    args = ap.parse_args()
    out = Path(args.out).resolve() if args.out else ROOT / "app"

    links = page_links()
    jobs = []
    for i, (label, href, url) in enumerate(links):
        k = classify(label, href)
        if k:
            jobs.append((i, label, url, k))
    tmp = None
    work = args.work
    if not work:
        tmp = tempfile.TemporaryDirectory()
        work = tmp.name

    def run(job):
        i, label, url, k = job
        try:
            return job, parse_pdf(i, label, url, work), None
        except Exception as e:  # один сломанный файл не должен ломать всё обновление
            return job, [], repr(e)[:200]

    with ThreadPoolExecutor(4) as ex:
        results = list(ex.map(run, jobs))

    sessions = session_files(links)
    insts = {}
    for (i, label, url, (inst, prog)), items, err in results:
        I = insts.setdefault(inst, {"rows": {}, "teachers": {}, "files": [], "groups": {}})
        I["files"].append({"label": label or inst, "url": url, "pairs": len(items), **({"error": err} if err else {})})
        print(f"{label or url}: {len(items)} занятий{' — ОШИБКА ' + err if err else ''}", file=sys.stderr)
        for it in items:
            c = it.get("c") or "0"
            gid = f"{prog}{c}-{it['g']}"
            I["groups"].setdefault(gid, {"id": gid, "g": it["g"], "c": int(c), "p": prog, "sec": f"{prog}{c}"})
            if it["type"] == "mil" and not args.with_military:
                continue
            tid = None
            if it.get("t"):
                tid = slug(it["t"]["name"])
                I["teachers"].setdefault(tid, {"name": it["t"]["name"], "rank": it["t"]["rank"]})
            row = {"d": it["d"], "n": it["n"], "w": it["w"], "s": it["s"], "type": it["type"], "room": it["room"],
                   "t": tid, "g": gid}
            for k in ("weeks", "from", "to", "date"):
                if it.get(k):
                    row[k] = it[k]
            key = json.dumps(row, ensure_ascii=False, sort_keys=True)
            I["rows"][key] = row  # один и тот же файл иногда выложен дважды — убираем повторы

    default = {"inst": args.inst, "id": f"{args.course}-{args.group}"}
    if default["id"] not in insts.get(args.inst, {}).get("groups", {}):
        sys.exit(f"Группа по умолчанию {args.group} ({args.course} курс, {args.inst}) в файлах не найдена")

    n_groups = sum(len(I["groups"]) for I in insts.values())
    if n_groups < args.min_groups:
        sys.exit(f"Нашлось только {n_groups} групп (меньше {args.min_groups}) — файлы не трогаю")
    (out / "data").mkdir(exist_ok=True)
    catalog = []
    total = 0
    for inst in INSTITUTES:
        I = insts.get(inst)
        if not I or not I["groups"]:
            continue
        file = slug(inst) + ".js"
        groups = sorted(I["groups"].values(), key=lambda g: (list(PROGS).index(g["p"]), g["c"], natural(g["g"])))
        catalog.append({"key": inst, "file": file, "groups": groups})
        sess = {}
        for g in groups:
            s = sessions.get((inst, g["p"], str(g["c"])))
            if s:
                sess[g["sec"]] = s
        rows = sorted(I["rows"].values(), key=lambda r: (natural(r["g"]), r.get("date", ""), r["d"], r["n"]))
        total += len(rows)
        data_i = {"teachers": I["teachers"], "files": I["files"], "sessions": sess, "schedule": rows}
        js = (f"/* Расписание {inst} (НИУ МГСУ). Файл создан автоматически: python3 tools/update_schedule.py */\n"
              "window.DATA_I = " + json.dumps(data_i, ensure_ascii=False, separators=(",", ":")) + ";\n")
        (out / "data" / file).write_text(js, encoding="utf-8")
        print(f"{inst}: групп {len(groups)}, записей {len(rows)}, преподавателей {len(I['teachers'])}", file=sys.stderr)

    # все преподаватели вуза и их пары — один файл, вкладка «Преподы» грузит его по требованию.
    # Группа записана как «институт|группа»; строки сжаты в массивы, названия предметов — словарём.
    all_t, subj, srows = {}, {}, []
    for inst in INSTITUTES:
        I = insts.get(inst)
        if not I:
            continue
        all_t.update(I["teachers"])
        for r in sorted(I["rows"].values(), key=lambda r: (r["t"] or "", r["d"], r["n"])):
            if not r["t"]:
                continue
            si = subj.setdefault(r["s"], len(subj))
            ext = {k: r[k] for k in ("weeks", "from", "to", "date") if k in r}
            row = [r["d"], r["n"], r["w"], si, r["type"], r["room"], r["t"], inst + "|" + r["g"]]
            if ext:
                row.append(ext)
            srows.append(row)
    tj = {"teachers": all_t, "subjects": list(subj), "rows": srows}
    (out / "data/teachers.js").write_text(
        "/* Все преподаватели НИУ МГСУ и их пары. Файл создан автоматически: python3 tools/update_schedule.py */\n"
        "window.DATA_T = " + json.dumps(tj, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Преподавателей всего: {len(all_t)}, их пар {len(srows)}", file=sys.stderr)

    data = {
        "demo": False,
        "source": {"site": LIST_URL, "updated": datetime.date.today().isoformat()},
        "defaultGroup": default,
        "progs": PROGS,
        "catalog": catalog,
        "semester": {"week1Monday": [2026, 7, 31], "lastDay": [2026, 11, 27]},
        "holidays": ["2026-11-04"],
        "bells": BELLS,
        "types": {"lec": "Лекция", "pr": "Практика", "lab": "Лаба", "kp": "Курсовой", "pe": "Физкультура", "mil": "Военка"},
        "buildings": {},
    }
    js = ("/* Расписание НИУ МГСУ: общие данные и список групп. Файл создан автоматически: python3 tools/update_schedule.py\n"
          "   Не правьте руками — изменения пропадут при следующем обновлении. Пары — в папке data/. */\n"
          "window.DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    (out / "data.js").write_text(js, encoding="utf-8")
    print(f"Готово: институтов {len(catalog)}, групп {sum(len(c['groups']) for c in catalog)}, записей {total}",
          file=sys.stderr)
    if tmp:
        tmp.cleanup()


if __name__ == "__main__":
    main()
