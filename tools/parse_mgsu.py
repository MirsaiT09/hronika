"""Разбор PDF-расписания НИУ МГСУ (сетка «Дни · Часы · Пара · группы») в JSON.

Использует вывод tools/pdflines.swift: lines.json (текст с координатами) и pN.png (линии таблицы).
Верхняя половина разделённой ячейки — нечётная неделя, нижняя — чётная.

Запуск: python3 tools/parse_mgsu.py папка_с_выводом_swift > result.json
"""
import json
import re
import sys

import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None  # страницы больших PDF — честно большие картинки


START = {"08:30": 1, "10:00": 2, "11:30": 3, "13:00": 4, "14:30": 5, "16:00": 6, "18:10": 7, "19:40": 8}
MON = {m: i + 1 for i, m in enumerate(["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"])}
MON["май"] = 5


def runs(idx, gap=2):
    out = []
    for v in idx:
        if out and v - out[-1][1] <= gap:
            out[-1][1] = v
        else:
            out.append([v, v])
    return [((a + b) / 2) for a, b in out]


def page_grid(png, scale):
    dark = np.asarray(Image.open(png).convert("L")) < 140
    H, W = dark.shape
    vx = runs(np.where(dark.mean(0) > 0.45)[0])
    cols = [x / scale for x in vx]

    def hlines(x0, x1):
        a, b = int(x0 * scale) + 4, int(x1 * scale) - 4
        frac = dark[:, a:b].mean(1)
        return [y / scale for y in runs(np.where(frac > 0.85)[0])]

    return cols, hlines


def cell_text(lines, x0, x1, y0, y1):
    got = [l for l in lines if x0 <= (l["x0"] + l["x1"]) / 2 <= x1 and y0 <= (l["y0"] + l["y1"]) / 2 <= y1]
    got.sort(key=lambda l: (round(l["y0"]), l["x0"]))
    return " ".join(l["t"] for l in got).strip()


def parse(folder):
    meta = json.load(open(f"{folder}/lines.json", encoding="utf-8"))
    scale = meta["scale"]
    result = []
    for pg in range(meta["pages"]):
        lines = [l for l in meta["lines"] if l["page"] == pg]
        cols, hlines = page_grid(f"{folder}/p{pg + 1}.png", scale)
        if len(cols) < 5:
            continue
        # где кончаются служебные колонки (Дни · Пара · Часы) и начинаются группы:
        # бывает «Дни|Часы|Пара», «Дни|Пара|Часы» и «Дни|Часы» (номер пары внутри «Часов»)
        # первая колонка группы — та, в заголовке которой «1к 23», «3к 5 bo …»
        def is_group(i):
            return any(re.search(r"\d\s*к\s+\S+", l["t"]) for l in lines if cols[i] <= (l["x0"] + l["x1"]) / 2 <= cols[i + 1])
        gi = next((i for i in range(1, min(5, len(cols) - 1)) if is_group(i)), 3)
        pair_col = (cols[gi - 1], cols[gi])
        # строки пар: горизонтальные линии в последней служебной колонке
        ys = hlines(*pair_col)
        rows = []
        for a, b in zip(ys, ys[1:]):
            t = cell_text(lines, cols[0], cols[gi], a, b)
            m = re.search(r"(\d{1,2})[.:](\d{2})", t)
            if not m:
                continue
            hhmm = f"{int(m.group(1)):02d}:{m.group(2)}"
            num = re.search(r"(?<![\d.:\-])\b([1-8])\b(?![.:]\d)", re.sub(r"\d{1,2}[.:]\d{2}", " ", t))
            n = START.get(hhmm) or (int(num.group(1)) if num else None)
            if n:  # вечерние пары (магистратура): номер — из колонки «Пара»
                rows.append({"n": n, "y0": a, "y1": b, "tm": hhmm})
        # заочка: вместо дней недели — конкретные даты («05.окт.26»), блок даты отделён линией в 1-й колонке
        dates = []
        for l in lines:
            dm = re.search(r"(\d{1,2})\.\s*([а-я]{3})[а-я]*\.?\s*(\d{2,4})", l["t"])
            if dm and (l["x0"] + l["x1"]) / 2 < cols[gi] and dm.group(2) in MON:
                y = int(dm.group(3)); y = y + 2000 if y < 100 else y
                dates.append(((l["y0"] + l["y1"]) / 2, f"{y}-{MON[dm.group(2)]:02d}-{int(dm.group(1)):02d}"))
        if dates:
            bounds = hlines(cols[0], cols[1])
            for r in rows:
                c = (r["y0"] + r["y1"]) / 2
                top = max([b for b in bounds if b <= c] or [0]); bot = min([b for b in bounds if b > c] or [1e9])
                hit = [dt for y, dt in dates if top <= y <= bot]
                r["date"] = hit[0] if hit else None
            rows = [r for r in rows if r["date"]]
            for r in rows:
                yy, mm, dd = map(int, r["date"].split("-"))
                import datetime as _dt
                r["d"] = _dt.date(yy, mm, dd).weekday()
        else:
            day, prev = -1, 99
            for r in rows:
                if r["n"] <= prev:
                    day += 1
                prev = r["n"]
                r["d"] = day
        header_y = rows[0]["y0"] if rows else 60
        for gx0, gx1 in zip(cols[gi:], cols[gi + 1:]):
            head = cell_text(lines, gx0, gx1, 0, header_y)
            m = re.search(r"(\d+)\s*к\s+(\S+)", head)
            if not m:
                continue
            group, course = m.group(2), m.group(1)
            gl = hlines(gx0, gx1)
            has_line = lambda y: any(abs(y - g) < 1.2 for g in gl)
            # склеиваем пары, если между ними нет линии в колонке группы (объединённая ячейка)
            blocks = []
            for r in rows:
                if blocks and blocks[-1][-1]["d"] == r["d"] and blocks[-1][-1].get("date") == r.get("date") and not has_line(r["y0"]):
                    blocks[-1].append(r)
                else:
                    blocks.append([r])
            for blk in blocks:
                y0, y1 = blk[0]["y0"], blk[-1]["y1"]
                if len(blk) > 1:
                    t = cell_text(lines, gx0, gx1, y0, y1)
                    if t:
                        for r in blk:
                            result.append({"g": group, "d": r["d"], "n": r["n"], "w": "both", "raw": t, "head": head, "c": course, "tm": r["tm"], "date": r.get("date")})
                    continue
                inner = [g for g in gl if y0 + 1.5 < g < y1 - 1.5]
                if inner:
                    mid = min(inner, key=lambda g: abs(g - (y0 + y1) / 2))
                    parts = [("odd", y0, mid), ("even", mid, y1)]
                else:
                    parts = [("both", y0, y1)]
                for w, a, b in parts:
                    t = cell_text(lines, gx0, gx1, a, b)
                    if t:
                        result.append({"g": group, "d": blk[0]["d"], "n": blk[0]["n"], "w": w, "raw": t, "head": head, "c": course, "tm": blk[0]["tm"], "date": blk[0].get("date")})
    return result


RANKS = r"(ст\.\s?преп\.|ст\.\s?пр\.|преп\.|доц\.|проф\.|асс\.|асп\.|зав\.\s?каф\.|д\.т\.н\.|к\.т\.н\.)"
TEACHER = re.compile(RANKS + r"\s*([А-ЯЁ][а-яё\-]+(?:\s+[А-ЯЁ]\.\s?[А-ЯЁ]?\.?)?)")
ROOM = re.compile(r"(\d{2,4}\s?[А-ЯЁ]?\s*/\s*[А-ЯЁ]{2,4}|\d{1,4}[а-я]?\s?[А-ЯЁ]?\s+(?:КПА|УЛК|УЛБ|КМК|НТБ|КМ|ГК)\b|СОК|ВУЦ[^,;]*)")
WEEKS = re.compile(r"((?:\d+\s*,\s*)+\d+)\s*нед|\bсо?\s*(\d+)\s*нед|до\s*(\d+)\s*нед|по\s*(\d+)\s*нед")
COMBO = re.compile(r"(лаб|пр|л)\.\s*(до|со?|по)\s*(\d+)\s*нед\.?")
TYPES = [("лаб.", "lab"), ("л.", "lec"), ("пр.", "pr"), ("КРП", "kp"), ("КОП", "kp"), ("КП ", "kp")]


def split_entries(raw):
    """В одной половине ячейки бывает несколько занятий — делим по преподавателю."""
    parts, last = [], 0
    for m in TEACHER.finditer(raw):
        rest = raw[m.end():]
        room = ROOM.match(rest.strip())
        end = m.end() + (rest.find(room.group(0)) + len(room.group(0)) if room else 0)
        tail = re.match(r"\s*((?:(?:\d+\s*,\s*)+\d+|со?\s*\d+|до\s*\d+|по\s*\d+)\s*нед\.?)", raw[end:])
        if tail:
            end += tail.end()
        parts.append(raw[last:end].strip())
        last = end
    if raw[last:].strip():
        if parts:
            parts[-1] += " " + raw[last:].strip()
        else:
            parts.append(raw.strip())
    return parts


def entry(e):
    raw = re.sub(r"\s+", " ", e["raw"])
    out = []
    for part in split_entries(raw):
        x = {"g": e["g"], "d": e["d"], "n": e["n"], "w": e["w"], "tm": e.get("tm"), "c": e.get("c")}
        if e.get("date"):
            x["date"] = e["date"]
        typ = "pr"
        subj = part
        for pre, t in TYPES:
            if subj.startswith(pre):
                typ, subj = t, subj[len(pre):].strip()
                break
        # заочка: тип в конце названия — «Химия (Лекция)», «Логистика-Пр»
        sm = re.search(r"\s*(?:\((Лекция|Практика|Лабораторная работа|Лаб\.?\s*работа|Лаб|Лек|Пр|КРП|КОП)\)|-\s*(Лек|Пр|Лаб|КРП|КОП)\b)", subj)
        if sm:
            typ = {"Лекция": "lec", "Лек": "lec", "Практика": "pr", "Пр": "pr", "Лаб": "lab", "КРП": "kp", "КОП": "kp"}.get(sm.group(1) or sm.group(2), "lab")
            subj = (subj[:sm.start()] + " " + subj[sm.end():]).strip()
        if re.search(r"физическая культура", subj, re.I):
            typ = "pe"
        if re.search(r"военная подготовка", subj, re.I):
            typ = "mil"
        tm = TEACHER.search(subj)
        teacher = None
        if tm:
            teacher = {"rank": re.sub(r"\s", "", tm.group(1)), "name": re.sub(r"\.\s+(?=[А-ЯЁ]\.)", ".", re.sub(r"\s+", " ", tm.group(2))).strip()}
            after = subj[tm.end():]
            subj = subj[:tm.start()].strip()
        else:
            after = ""
        rm = ROOM.search(after) or ROOM.search(subj)
        room = ""
        if rm:
            room = re.sub(r"\s*/\s*", " / ", rm.group(0)).strip()
            if rm.re is ROOM and rm.string is subj:
                subj = (subj[:rm.start()] + subj[rm.end():]).strip()
        for m in WEEKS.finditer(part):
            if m.group(1):
                x["weeks"] = [int(v) for v in re.split(r"\s*,\s*", m.group(1))]
            elif m.group(2):
                x["from"] = int(m.group(2))
            elif m.group(3) or m.group(4):
                x["to"] = int(m.group(3) or m.group(4))
        subj = re.sub(WEEKS, "", subj).strip(" .,")
        subj = re.sub(r"\s+", " ", subj)
        if typ == "pe":
            subj = "Физическая культура и спорт"
            room = room or "СОК"
        if typ == "mil":
            tm2 = re.search(r"[сС]\s*(\d{1,2}[:.]\d{2})", part)
            subj, room = "Военная подготовка" + (f" (с {tm2.group(1).replace('.', ':')})" if tm2 else ""), "ВУЦ, г. Мытищи"
        x.update({"s": subj, "type": typ, "room": room, "t": teacher, "raw": part})
        # «пр. до 7 нед. лаб. с 9 нед.» — два разных вида занятий в одной ячейке
        combo = list(COMBO.finditer(part))
        if combo:
            x["s"] = re.sub(r"(\s+(?:пр|лаб|л)\.?\s*\.?)+\s*$", "", x["s"]).strip(" .,")
            for k in ("weeks", "from", "to"):
                x.pop(k, None)
            for m in combo:
                y = dict(x)
                y["type"] = {"л": "lec", "пр": "pr", "лаб": "lab"}[m.group(1)]
                if m.group(2) in ("с", "со"):
                    y["from"] = int(m.group(3))
                else:
                    y["to"] = int(m.group(3))
                out.append(y)
            continue
        out.append(x)
    return out


if __name__ == "__main__":
    cells = parse(sys.argv[1])
    items = [it for c in cells for it in entry(c)]
    json.dump(items, sys.stdout, ensure_ascii=False, indent=1)
