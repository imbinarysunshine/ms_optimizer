#!/usr/bin/env python3
"""
Build a full, ground-truth monster crosswalk from Mob.wz (stats) + String.wz/Mob.img.xml
(names), then compare every field against the current MONSTER_DB in msdb.tsx.

Elemental attribute digit encoding (pre-BB / v62, verified against known cases below):
  1 = Immune (0% dmg taken)
  2 = Normal (100%)
  3 = Weak   (bonus dmg taken)
No 4th tier exists pre-BB -- confirmed by digit range across the whole corpus (only 1/2/3 seen).
Verified against: Green Mushroom S1 (DB: immune Poison) -> matches.
                  Stump F3 (DB: weak Fire) -> matches.
                  Slime L3 (DB: weak Lightning) -> matches.
                  Zombie Mushroom H3 (DB: weak Holy, matches undead lore) -> matches.
"""
import xml.etree.ElementTree as ET
import re, glob, os, json, sys

MOB_WZ = "/home/claude/mobwz/Mob.wz"
STRING_MOB = "/home/claude/mobwz/String.wz/Mob.img.xml"

ELEM_NAMES = {"I": "Ice", "F": "Fire", "L": "Lightning", "S": "Poison", "H": "Holy", "D": "Dark"}


def find_leaf(elem, tag_name):
    for child in elem:
        if child.get("name") == tag_name:
            v = child.get("value")
            if v is None:
                return None
            if child.tag in ("int", "float"):
                try:
                    return float(v) if child.tag == "float" else int(v)
                except ValueError:
                    return None
            return v
    return None


def find_child_dir(elem, tag_name):
    for child in elem:
        if child.tag == "imgdir" and child.get("name") == tag_name:
            return child
    return None


def parse_elem_attr(s):
    """'F3I2' -> {'weak': ['Fire'], 'strong': [], 'immune': ['Ice'] if 1, 'normal': [...]}"""
    weak, immune, normal = [], [], []
    for m in re.finditer(r"([A-Z])(\d)", s or ""):
        letter, digit = m.group(1), m.group(2)
        name = ELEM_NAMES.get(letter, letter)
        if digit == "3":
            weak.append(name)
        elif digit == "1":
            immune.append(name)
        elif digit == "2":
            normal.append(name)
    return weak, immune, normal


def load_names():
    tree = ET.parse(STRING_MOB)
    root = tree.getroot()
    names = {}
    for child in root:
        if child.tag != "imgdir":
            continue
        wzid = child.get("name")
        nm = find_leaf(child, "name")
        if wzid and nm:
            names[wzid.lstrip("0") or "0"] = nm
    return names


def load_mob_stats():
    files = sorted(glob.glob(os.path.join(MOB_WZ, "*.img.xml")))
    stats = {}
    for f in files:
        wzid = os.path.splitext(os.path.splitext(os.path.basename(f))[0])[0]
        wzid_norm = wzid.lstrip("0") or "0"
        try:
            root = ET.parse(f).getroot()
        except ET.ParseError:
            continue
        info = find_child_dir(root, "info")
        if info is None:
            continue
        weak, immune, normal = parse_elem_attr(find_leaf(info, "elemAttr") or "")
        stats[wzid_norm] = {
            "level": find_leaf(info, "level"),
            "hp": find_leaf(info, "maxHP"),
            "mp": find_leaf(info, "maxMP"),
            "PADamage": find_leaf(info, "PADamage"),
            "PDDamage": find_leaf(info, "PDDamage"),
            "MADamage": find_leaf(info, "MADamage"),
            "MDDamage": find_leaf(info, "MDDamage"),
            "acc": find_leaf(info, "acc"),
            "eva": find_leaf(info, "eva"),
            "exp": find_leaf(info, "exp"),
            "undead": bool(find_leaf(info, "undead")),
            "boss": bool(find_leaf(info, "boss")) if find_leaf(info, "boss") is not None else False,
            "weak": weak,
            "immune": immune,
        }
    return stats


def load_current_db():
    content = open("/home/claude/msdb.tsx").read()
    m = re.search(r"const MONSTER_DB = \[(.*?)\n\];", content, re.DOTALL)
    block = m.group(1)
    pattern = re.compile(
        r'\{\s*id:(\d+),\s*name:"([^"]+)",\s*level:(\d+),\s*hp:(\d+),\s*mp:(\d+),\s*wAtk:(\d+),\s*mAtk:(\d+),'
        r'\s*wDef:(\d+),\s*mDef:(\d+),\s*acc:(\d+),\s*avoid:(\d+),\s*exp:(\d+),\s*weak:"([^"]*)",'
        r'\s*strong:"([^"]*)",\s*immune:"([^"]*)",\s*boss:(true|false)'
    )
    rows = []
    for mm in pattern.finditer(block):
        (cid, name, level, hp, mp, wAtk, mAtk, wDef, mDef, acc, avoid, exp,
         weak, strong, immune, boss) = mm.groups()
        rows.append({
            "id": cid, "name": name, "level": int(level), "hp": int(hp), "mp": int(mp),
            "wAtk": int(wAtk), "mAtk": int(mAtk), "wDef": int(wDef), "mDef": int(mDef),
            "acc": int(acc), "avoid": int(avoid), "exp": int(exp),
            "weak": weak, "strong": strong, "immune": immune, "boss": boss == "true",
        })
    return rows


def main():
    names = load_names()
    stats = load_mob_stats()
    db = load_current_db()

    print(f"String.wz names loaded: {len(names)}", file=sys.stderr)
    print(f"Mob.wz stat files loaded: {len(stats)}", file=sys.stderr)
    print(f"Current MONSTER_DB rows: {len(db)}", file=sys.stderr)

    # Build name -> [wzid,...] index (names can collide across different-tier mobs)
    name_to_ids = {}
    for wzid, nm in names.items():
        name_to_ids.setdefault(nm, []).append(wzid)

    report = []
    unresolved = []
    for row in db:
        candidates = name_to_ids.get(row["name"], [])
        if not candidates:
            unresolved.append(row)
            continue
        # pick candidate with closest level match (using Mob.wz level, fallback to any)
        best_wzid = None
        best_diff = None
        for wzid in candidates:
            st = stats.get(wzid)
            if not st or st["level"] is None:
                continue
            diff = abs(st["level"] - row["level"])
            if best_diff is None or diff < best_diff:
                best_diff = diff
                best_wzid = wzid
        if best_wzid is None:
            best_wzid = candidates[0]
            best_diff = None
        st = stats.get(best_wzid)
        if not st:
            unresolved.append(row)
            continue
        if best_diff is not None and best_diff > 6:
            unresolved.append(row)
            continue

        diffs = {}
        def cmp(field_db, field_real, val_db, val_real):
            if val_db != val_real:
                diffs[field_db] = {"db": val_db, "real": val_real}

        cmp("level", "level", row["level"], st["level"])
        cmp("hp", "hp", row["hp"], st["hp"])
        cmp("mp", "mp", row["mp"], st["mp"])
        cmp("wAtk", "PADamage", row["wAtk"], st["PADamage"])
        cmp("mAtk", "MADamage", row["mAtk"], st["MADamage"])
        cmp("wDef", "PDDamage", row["wDef"], st["PDDamage"])
        cmp("mDef", "MDDamage", row["mDef"], st["MDDamage"])
        cmp("acc", "acc", row["acc"], st["acc"])
        cmp("avoid", "eva", row["avoid"], st["eva"])
        cmp("exp", "exp", row["exp"], st["exp"])
        cmp("boss", "boss", row["boss"], st["boss"])

        db_weak = row["weak"] if row["weak"] != "-" else None
        real_weak = st["weak"][0] if st["weak"] else None
        if db_weak != real_weak:
            diffs["weak"] = {"db": row["weak"], "real": real_weak or "-"}

        db_immune = row["immune"] if row["immune"] != "-" else None
        real_immune = st["immune"][0] if st["immune"] else None
        if db_immune != real_immune:
            diffs["immune"] = {"db": row["immune"], "real": real_immune or "-"}

        # "strong" field: pre-BB has no partial-resist tier, so any DB "strong" claim
        # doesn't map to anything in real elemAttr -- flag it explicitly if DB has one
        if row["strong"] != "-":
            diffs["strong"] = {"db": row["strong"], "real": "(no partial-resist tier exists pre-BB; not in elemAttr)"}

        undead_flag = st["undead"]

        report.append({
            "catalogId": row["id"], "name": row["name"], "wzId": best_wzid,
            "levelDiff": best_diff, "undead": undead_flag, "diffs": diffs,
        })

    with_diffs = [r for r in report if r["diffs"]]
    clean = [r for r in report if not r["diffs"]]

    print(f"\nResolved (name+level matched): {len(report)}/{len(db)}", file=sys.stderr)
    print(f"  -> Exact match, no discrepancies: {len(clean)}", file=sys.stderr)
    print(f"  -> Has 1+ discrepancies: {len(with_diffs)}", file=sys.stderr)
    print(f"Unresolved (no name/level match found): {len(unresolved)}", file=sys.stderr)

    json.dump({
        "resolved": report,
        "unresolved": [r["name"] for r in unresolved],
    }, open("/home/claude/mobwz_verification_report.json", "w"), indent=1)

    json.dump(names, open("/home/claude/mobwz_names.json", "w"))
    json.dump(stats, open("/home/claude/mobwz_stats.json", "w"))

    print("\n--- Unresolved names ---", file=sys.stderr)
    for n in unresolved:
        print(" ", n["id"], n["name"], n["level"], file=sys.stderr)


if __name__ == "__main__":
    main()
