#!/usr/bin/env python3
"""
Convert the MasterCook-style text exports in ../originals/ into docs/recipes.json
and docs/tips.json for the Grandmama's Recipes web app.

Usage:  python3 build/parse_recipes.py [--originals DIR] [--out DIR]

The originals are never modified. Typo fixes live in build/corrections.json.
Anything the parser is unsure about is written to build/warnings.txt.
"""
import argparse
import json
import re
import sys
from collections import Counter, OrderedDict
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# --------------------------------------------------------------------------
# Normalisation tables
# --------------------------------------------------------------------------

# raw unit (lower-cased) -> canonical unit key. The app owns display/pluralisation.
UNIT_MAP = {
    # volume
    "teaspoon": "tsp", "teaspoons": "tsp", "tsp": "tsp", "tsps": "tsp", "ts": "tsp", "tss": "tsp",
    "tablespoon": "tbsp", "tablespoons": "tbsp", "tbsp": "tbsp", "tbls": "tbsp", "tblsp": "tbsp",
    "tbs": "tbsp", "tbles": "tbsp", "tebls": "tbsp", "tablespoonsfuls": "tbsp", "tablespoonfuls": "tbsp",
    "cup": "cup", "cups": "cup",
    "pint": "pint", "pints": "pint",
    "quart": "quart", "quarts": "quart",
    "gallon": "gallon", "gallons": "gallon",
    "fluid ounce": "fl oz", "fluid ounces": "fl oz", "fl oz": "fl oz",
    "pony": "pony", "ponies": "pony",
    "dash": "dash", "dashes": "dash",
    "pinch": "pinch", "pinches": "pinch",
    "drop": "drop", "drops": "drop",
    # weight
    "ounce": "oz", "ounces": "oz", "oz": "oz", "ozs": "oz",
    "pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",
    # count-ish
    "whole": "whole",
    "small": "small", "sm": "small",
    "medium": "medium", "med": "medium",
    "large": "large", "lg": "large",
    "clove": "clove", "cloves": "clove",
    "can": "can", "cans": "can",
    "package": "package", "packages": "package", "pkg": "package", "pkgs": "package", "pks": "package",
    "stick": "stick", "sticks": "stick",
    "slice": "slice", "slices": "slice",
    "head": "head", "heads": "head",
    "bunch": "bunch", "bunches": "bunch",
    "dozen": "dozen",
    "batch": "batch", "batches": "batch",
    "leaf": "leaf", "leaves": "leaf",
    "sprig": "sprig", "sprigs": "sprig",
    "stalk": "stalk", "stalks": "stalk",
    "piece": "piece", "pieces": "piece",
    "jar": "jar", "jars": "jar",
    "bottle": "bottle", "bottles": "bottle",
    "box": "box", "boxes": "box",
    "bag": "bag", "bags": "bag",
    "envelope": "envelope", "envelopes": "envelope",
    "sheet": "sheet", "sheets": "sheet",
    "square": "square", "squares": "square",
    "cube": "cube", "cubes": "cube",
    "ear": "ear", "ears": "ear",
    "strip": "strip", "strips": "strip",
    "loaf": "loaf", "loaves": "loaf",
    "quarter": "quarter", "quarters": "quarter",
    "fillet": "fillet", "fillets": "fillet",
    "each": "each",
    "qt": "quart", "qts": "quart", "cps": "cup", "tb": "tbsp", "tbl": "tbsp",
    "x large": "extra large", "extra large": "extra large", "xl": "extra large",
    "packet": "packet", "packets": "packet",
    "container": "container", "containers": "container",
    "handful": "handful", "handfuls": "handful",
    "splash": "splash", "shavings": "shavings",
    "stem": "stem", "stems": "stem",
    "round": "round", "rounds": "round",
    "cake": "cake", "cakes": "cake",
    "spear": "spear", "spears": "spear",
}

# Units that are true measures; everything else (including odd raw units like "8 oz can",
# "green", "ripe", '1/2"') is treated as a count of things and rounded to halves when scaled.
MEASURE_UNITS = {"tsp", "tbsp", "cup", "pint", "quart", "gallon", "fl oz", "oz", "lb", "pony", "dash", "pinch", "drop", "splash", "handful"}
# "Maddy's X" categories fold into the generic ones (decision 2026-09-06).
CATEGORY_MAP = {
    "Maddy's Desserts": "Desserts",
    "Maddy's Vegetables": "Vegetables",
    "Maddy's Main Meals": "Main Dishes",
    "Maddy's Breads": "Breads",
    "Maddy's Salads": "Salads",
    "Maddy's Appetizers": "Appetizers",
    "Maddy's Sauces": "Sauces",
    "Maddy's Pasta Dishes": "Pasta",
    "Maddy's Soups": "Soups & Stews",
    "Maddy's Low Carb": "Low Carb",
    "Maddy's Salad Dressings": "Salad Dressings",
    "Maddy's Snacks": "Appetizers",
    "Maddy's Stuffing": "Side Dishes",
}

# All-caps ingredient lines that are real ingredients, not section headers.
NOT_A_SECTION = {
    "COOKING SPRAY", "BUTTER SPRAY", "OLIVE OIL", "MELTED BUTTER", "SALT & PEPPER",
    "SALT & PEPPER TO TASTE", "SALT AND PEPPER", "SALT AND PEPPER TO TASTE", "PARSLEY GARNISH",
    "JUICE FROM 1/2 LIME", "OR APRICOTS", "CUT IN MATCHSTICK STRIPS", "MATCHSTICK STRIPS",
    "ASSORTED CUT UP FRESH VEGETABLES", "AND FRUITS; CARROTS, BELL PEPPERS",
    "CELERY, BROCCOLI, APPLES, GRAPES",
}

SMALL_WORDS = {"a", "an", "and", "the", "of", "with", "in", "on", "for", "to", "or", "de", "y", "la", "au", "al", "à", "et"}

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def load_corrections():
    with open(HERE / "corrections.json", encoding="utf-8") as fh:
        c = json.load(fh)
    words = {k.lower(): v for k, v in c.get("words", {}).items()}
    pattern = re.compile(r"\b(" + "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)) + r")\b", re.I)
    return c, words, pattern


def match_case(src, repl):
    if src.isupper() and len(src) > 1:
        return repl.upper()
    if src[0].isupper():
        return repl[0].upper() + repl[1:]
    return repl


def fix_text(s, corr):
    c, words, pattern = corr
    if not s:
        return s
    for a, b in c.get("phrases", {}).items():
        s = s.replace(a, b)
    return pattern.sub(lambda m: match_case(m.group(0), words[m.group(0).lower()]), s)


def smart_title(s):
    """Title-case: words that are all-lower or all-upper get capitalised (small words stay lower
    unless first); words with internal mixed case (L'Americaine, St.) are left alone."""
    out = []
    for i, w in enumerate(re.split(r"(\s+)", s)):
        if not w.strip():
            out.append(w)
            continue
        letters = [ch for ch in w if ch.isalpha()]
        if letters and not (all(ch.islower() for ch in letters) or all(ch.isupper() for ch in letters)):
            out.append(w)
            continue
        lw = w.lower()
        if i > 0 and lw.strip("()") in SMALL_WORDS:
            out.append(lw)
            continue
        # capitalise first letter after any leading punctuation, and after hyphens
        parts = lw.split("-")
        parts = [re.sub(r"^([^a-z]*)([a-z])", lambda m: m.group(1) + m.group(2).upper(), p) for p in parts]
        out.append("-".join(parts))
    return "".join(out)


def slugify(s):
    s = s.lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[''’]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def parse_qty(s):
    s = s.strip()
    if not s:
        return None
    try:
        return sum(Fraction(p) for p in s.split())
    except (ValueError, ZeroDivisionError):
        return None


def normalise_cook(raw):
    """Return (cook, attribution). Attribution is any parenthetical source note."""
    raw = raw.strip()
    attrib = None
    m = re.match(r"^(.*?)\s*\((.*)\)\s*$", raw)
    if m:
        raw, attrib = m.group(1).strip(), m.group(2).strip()
    low = raw.lower()
    if "powell" in low:
        return "Elizabeth Powell", attrib
    if "madel" in low or "heal" in low:
        return "Madeline Healey", attrib
    return smart_title(raw) if raw else "Unknown", attrib


def sentence_case(text):
    """For recipes typed entirely in capitals: lower-case, then capitalise line and sentence starts."""
    text = text.lower()
    text = re.sub(r"(^|[.!?]\s+|\n\s*)([a-z])", lambda m: m.group(1) + m.group(2).upper(), text)
    return text


DANGLING = re.compile(r"(,|\b(and|or|with|the|a|an|of|to|in|on|for|until|into|over|at|about|approximately|up|is|are|be|but))$", re.I)
WRAP_WIDTH = 64  # MasterCook hard-wraps at ~72 columns; in wrapped prose a line this long continues on the next


def paragraphs_to_steps(text, warn, name):
    """Turn the free-text directions into a list of {heading} / {text} steps.

    Two styles coexist: Elizabeth's hard-wrapped paragraphs and Maddy's one-step-per-line lists
    with no blank lines. Rule: a line joins the previous one when the previous line was long
    enough to have been wrapped, ends with a dangling word/comma, or this line starts lowercase;
    otherwise it starts a new step.
    """
    letters = [c for c in text if c.isalpha()]
    was_caps = bool(letters) and sum(c.isupper() for c in letters) / len(letters) > 0.8
    if was_caps:
        text = sentence_case(text)
    lines = [ln.rstrip() for ln in text.split("\n")]
    paras, cur = [], []
    for ln in lines:
        if not ln.strip():
            if cur:
                paras.append(cur)
                cur = []
            continue
        if cur and re.match(r"^ {3,}\S", ln):
            paras.append(cur)
            cur = []
        cur.append(ln)
    if cur:
        paras.append(cur)

    steps = []
    for p in paras:
        # wrapped prose (Elizabeth) has mostly long lines; step lists (Maddy) mostly short ones
        prose = sum(len(ln.rstrip()) >= WRAP_WIDTH for ln in p) / len(p) >= 0.5
        wrap_at = WRAP_WIDTH if prose else 72
        merged = []  # list of [text, raw_len_of_last_line]
        for raw in p:
            ln = raw.strip()
            numbered = bool(re.match(r"^\d+[.)]\s", ln))
            if merged and not numbered:
                prev_text, prev_len = merged[-1]
                dangling = bool(DANGLING.search(prev_text))
                if prev_len >= wrap_at or ln[:1].islower() or dangling:
                    if was_caps and dangling and ln[:1].isupper():
                        ln = ln[0].lower() + ln[1:]
                    merged[-1] = [prev_text + " " + ln, len(raw)]
                    continue
            merged.append([ln, len(raw)])
        for u, _ in merged:
            u = re.sub(r"\s+", " ", u).strip()
            u = re.sub(r"^\d+[.)]\s*", "", u)
            if not u:
                continue
            if u.isupper() and len(u) < 50 and not re.search(r"\d", u):
                steps.append({"heading": smart_title(u.rstrip(":"))})
            else:
                steps.append({"text": u})
    return steps


def parse_file(path, corr, warn):
    raw = path.read_bytes().decode("cp1252").replace("\r", "")
    lines = raw.split("\n")
    if "Exported from MasterCook" not in raw:
        warn.append(f"{path.name}: not a MasterCook export, skipped")
        return None

    title_raw = lines[3].strip()
    title = corr[0].get("titles", {}).get(title_raw) or smart_title(fix_text(title_raw, corr))

    header = "\n".join(lines[4:])
    by = re.search(r"^Recipe By\s*:(.*)$", header, re.M)
    cook, attribution = normalise_cook(by.group(1) if by else "")
    attribution = fix_text(attribution, corr) if attribution else None
    ss = re.search(r"^Serving Size\s*:\s*(\d+)\s+Preparation Time\s*:(\d+):(\d+)", header, re.M)
    servings = int(ss.group(1)) if ss else None
    prep_min = int(ss.group(2)) * 60 + int(ss.group(3)) if ss else None
    if not servings:
        warn.append(f"{path.name}: no serving size")
    cm = re.search(r"^Categories\s*:(.*?)(?=\n\s*\n)", header, re.M | re.S)
    cats_raw = [c.strip() for c in re.split(r"\s{2,}|\n", cm.group(1)) if c.strip()] if cm else []
    cats = []
    for c in cats_raw:
        c2 = CATEGORY_MAP.get(c, c)
        if c2 not in cats:
            cats.append(c2)
    override = corr[0].get("categories", {}).get(title)
    if override:
        cats = override
    if not cats:
        warn.append(f"{path.name}: no categories")

    # ---- ingredient table -------------------------------------------------
    m = re.search(r"^-{8}  -{12}  -{32}\n", raw, re.M)
    if not m:
        warn.append(f"{path.name}: no ingredient table header")
        return None
    rest = raw[m.end():].split("\n")
    col = re.compile(r"^ {0,5}(\d+(?: \d+/\d+)?|\d+/\d+)?\s*$")
    ingredients, section, i = [], None, 0
    while i < len(rest):
        ln = rest[i]
        if not ln.strip():
            i += 1
            continue
        if len(ln) > 24 and ln[22:24] == "  " and col.match(ln[:8]):
            qty = parse_qty(ln[:8])
            unit_raw = ln[8:22].strip()
            item = ln[24:].strip()
            if qty is None and not unit_raw and item.isupper() and not re.search(r"\d", item) and item not in NOT_A_SECTION:
                section = smart_title(item.rstrip(":"))
                i += 1
                continue
            if qty is None and not item and unit_raw.isupper():
                section = smart_title(unit_raw.rstrip(":"))
                i += 1
                continue
            prep = None
            if " -- " in item:
                item, prep = [x.strip() for x in item.split(" -- ", 1)]
            item = fix_text(item, corr)
            prep = fix_text(prep, corr) if prep else None
            if item.isupper():
                item = item.lower()
            if prep and prep.isupper():
                prep = prep.lower()
            unit_key = UNIT_MAP.get(unit_raw.lower()) if unit_raw else None
            if unit_raw and unit_key is None:
                unit_key = unit_raw if not unit_raw.isupper() else unit_raw.lower()  # keep odd units ("10 oz pkgs", '1/2"') verbatim
                warn.append(f"{path.name}: unrecognised unit {unit_raw!r} kept as written ({item})")
            item = re.sub(r"\s+,", ",", item)
            ing = OrderedDict()
            if section:
                ing["section"] = section
            ing["qty"] = [qty.numerator, qty.denominator] if qty is not None else None
            ing["unit"] = unit_key
            ing["item"] = item
            if prep:
                ing["prep"] = prep
            if qty is not None and unit_key not in MEASURE_UNITS:
                ing["count"] = True
            ingredients.append(ing)
            i += 1
        else:
            break

    body = "\n".join(rest[i:])
    dm = re.search(r"\n\s*- - - - -[ -]*\n", body)
    if not dm:
        warn.append(f"{path.name}: no end-of-directions rule")
        directions_txt, tail = body, ""
    else:
        directions_txt, tail = body[:dm.start()], body[dm.end():]
    steps = paragraphs_to_steps(fix_text(directions_txt, corr), warn, path.name)

    def tail_field(label):
        mm = re.search(rf"^{label}\s*:(.*?)(?=\n\s*\n|\Z)", tail, re.M | re.S)
        if not mm:
            return None
        txt = re.sub(r"\s+", " ", mm.group(1)).strip()
        return fix_text(txt, corr) or None

    serving_ideas = tail_field("Serving Ideas")
    notes = tail_field("NOTES")
    yield_text = None
    ym = re.search(r"^\s*yields?\s*:?\s*(.+)$", (notes or "") + "\n" + directions_txt, re.M | re.I)
    if ym and len(ym.group(1)) < 60:
        yield_text = ym.group(1).strip().rstrip(".")

    rec = OrderedDict()
    rec["slug"] = slugify(title)
    rec["title"] = title
    rec["cook"] = cook
    if attribution:
        rec["attribution"] = attribution
    rec["servings"] = servings
    if yield_text:
        rec["yield"] = yield_text
    rec["prepMinutes"] = prep_min
    rec["categories"] = cats
    rec["ingredients"] = ingredients
    rec["steps"] = steps
    if serving_ideas:
        rec["servingIdeas"] = serving_ideas
    if notes:
        rec["notes"] = notes
    rec["source"] = f"originals/{path.name}"
    if not ingredients:
        warn.append(f"{path.name}: no ingredients parsed")
    if not steps:
        warn.append(f"{path.name}: no directions parsed")
    return rec


def parse_tips(path, corr):
    raw = path.read_bytes().decode("cp1252").replace("\r", "")
    body = raw.split("--------  ------------  --------------------------------\n", 1)[1]
    body = re.split(r"\n\s*- - - - -", body)[0]
    tips, cur = [], ""
    for ln in body.split("\n"):
        if re.match(r"^\s*\d+\.\s", ln):
            if cur:
                tips.append(cur)
            cur = re.sub(r"^\s*\d+\.\s*", "", ln).strip()
        elif ln.strip():
            cur += " " + ln.strip()
    if cur:
        tips.append(cur)
    return [fix_text(re.sub(r"\s+", " ", t), corr) for t in tips]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--originals", default=str(ROOT / "originals"))
    ap.add_argument("--out", default=str(ROOT / "data"))
    args = ap.parse_args()
    src = Path(args.originals)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    corr = load_corrections()
    warn = []
    recipes, tips = [], []
    for path in sorted(src.glob("*.txt"), key=lambda p: p.name.lower()):
        if path.name.lower() == "maddy's hints.txt":
            tips = parse_tips(path, corr)
            continue
        rec = parse_file(path, corr, warn)
        if rec:
            recipes.append(rec)

    # de-duplicate slugs
    seen = Counter(r["slug"] for r in recipes)
    used = Counter()
    for r in recipes:
        if seen[r["slug"]] > 1:
            used[r["slug"]] += 1
            r["slug"] = f"{r['slug']}-{used[r['slug']]}"
            warn.append(f"duplicate title, slug became {r['slug']}")

    # resolve "see recipe" cross references
    by_title = {r["title"].lower(): r["slug"] for r in recipes}
    for r in recipes:
        refs = []
        for ing in r["ingredients"]:
            txt = (ing["item"] + " " + ing.get("prep", "")).lower()
            if "see recipe" in txt:
                name = re.sub(r"\(?see recipe\)?", "", ing["item"], flags=re.I).strip(" -,")
                hit = by_title.get(name.lower()) or next((s for t, s in by_title.items() if name.lower() in t), None)
                if hit:
                    ing["ref"] = hit
                    refs.append(hit)
                else:
                    warn.append(f"{r['source']}: unresolved cross-reference {name!r}")

    recipes.sort(key=lambda r: r["title"].lower())
    (out / "recipes.json").write_text(json.dumps(recipes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "tips.json").write_text(json.dumps(tips, ensure_ascii=False, indent=1), encoding="utf-8")
    (HERE / "warnings.txt").write_text("\n".join(warn) + ("\n" if warn else ""), encoding="utf-8")

    cats = Counter(c for r in recipes for c in r["categories"])
    print(f"{len(recipes)} recipes, {len(tips)} tips, {len(warn)} warnings -> {out}")
    print("categories:", ", ".join(f"{c} ({n})" for c, n in cats.most_common()))
    print("cooks:", dict(Counter(r["cook"] for r in recipes)))


if __name__ == "__main__":
    sys.exit(main())
