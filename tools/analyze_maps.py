#!/usr/bin/env python3
"""
SUPERSEDED by tools/recompute_map_scores.mjs -- see README.md "Map-quality
scoring" for the gap-aware floor-penalty fix that replaces this file's
score_map() formula.

Parse every map .img.xml in Map.wz, extract foothold geometry + mob spawn life
entries, cluster footholds into "platforms", and score each map 1-5 for
Magic Claw training efficiency and Heal training efficiency.

Output: maplestory_map_scores.json  (keyed by mapId)
        maplestory_map_scores.csv   (flat summary for spot-checking)
"""
import xml.etree.ElementTree as ET
import json, csv, glob, os, math, sys, time

MAP_ROOT = "/home/claude/mapwz/Map.wz/Map"
OUT_JSON = "/home/claude/maplestory_map_scores.json"
OUT_CSV  = "/home/claude/maplestory_map_scores.csv"

# -- Tunable constants (documented assumptions, since exact v62 client values
#    aren't derivable from Map.wz geometry alone) -----------------------------
MC_RANGE_PX      = 425   # approx horizontal reach of Magic Claw, both directions is ~2x this
FLAT_TOL_Y       = 4     # max |y1-y2| for a foothold to count as "standable platform" surface
YBAND_MERGE_GAP  = 15    # merge foothold segments into the same y-band if within this px
XGAP_MERGE       = 60    # merge same-yband segments into one platform if x-gap <= this (walkable jump)
MIN_PLATFORM_LEN = 20    # ignore foothold slivers shorter than this (stair nubs, ladder catches)
HEAL_GAP_SATURATE = 400  # vertical gap (px) at which heal-stacking score bottoms out at 0
FLOOR_BONUS_SATURATE = 5 # number of distinct mob-bearing floors at which floor-count bonus maxes


def find_leaf(elem, tag_name):
    """Return the value of a direct child <TYPE name="tag_name" value="..."/>, or None."""
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


def collect_footholds(fh_root):
    """Recursively walk the foothold imgdir tree; yield (x1,y1,x2,y2) leaves."""
    segs = []
    def walk(node):
        # A leaf foothold has an int child named x1
        is_leaf = any(c.get("name") == "x1" for c in node if c.tag == "int")
        if is_leaf:
            x1 = find_leaf(node, "x1"); y1 = find_leaf(node, "y1")
            x2 = find_leaf(node, "x2"); y2 = find_leaf(node, "y2")
            if None not in (x1, y1, x2, y2):
                segs.append((x1, y1, x2, y2))
            return
        for c in node:
            if c.tag == "imgdir":
                walk(c)
    walk(fh_root)
    return segs


def collect_mobs(life_root):
    mobs = []
    for child in life_root:
        if child.tag != "imgdir":
            continue
        t = find_leaf(child, "type")
        if t != "m":
            continue
        x = find_leaf(child, "x")
        cy = find_leaf(child, "cy")
        if cy is None:
            cy = find_leaf(child, "y")
        mob_id = find_leaf(child, "id")
        if x is None or cy is None:
            continue
        mobs.append({"id": mob_id, "x": x, "cy": cy})
    return mobs


def cluster_platforms(footholds):
    """Group near-horizontal foothold segments into platform intervals.
    Returns list of dicts: {y, xmin, xmax, len}"""
    flats = []
    for (x1, y1, x2, y2) in footholds:
        if abs(y1 - y2) > FLAT_TOL_Y:
            continue
        xlo, xhi = min(x1, x2), max(x1, x2)
        if xhi - xlo < 1:
            continue
        yavg = (y1 + y2) / 2.0
        flats.append((yavg, xlo, xhi))
    if not flats:
        return []

    flats.sort(key=lambda t: t[0])

    # 1) bucket into y-bands
    bands = []  # each: {"y_lo":, "y_hi":, "segs": [(xlo,xhi), ...]}
    for (y, xlo, xhi) in flats:
        placed = False
        for b in bands:
            if abs(y - b["y_mean"]) <= YBAND_MERGE_GAP:
                b["segs"].append((xlo, xhi))
                b["ys"].append(y)
                b["y_mean"] = sum(b["ys"]) / len(b["ys"])
                placed = True
                break
        if not placed:
            bands.append({"y_mean": y, "ys": [y], "segs": [(xlo, xhi)]})

    # re-pass merge of bands themselves in case ordering caused near-duplicate bands
    bands.sort(key=lambda b: b["y_mean"])
    merged_bands = []
    for b in bands:
        if merged_bands and abs(b["y_mean"] - merged_bands[-1]["y_mean"]) <= YBAND_MERGE_GAP:
            mb = merged_bands[-1]
            mb["segs"].extend(b["segs"])
            mb["ys"].extend(b["ys"])
            mb["y_mean"] = sum(mb["ys"]) / len(mb["ys"])
        else:
            merged_bands.append(b)

    # 2) within each band, merge x-intervals into platforms
    platforms = []
    for b in merged_bands:
        segs = sorted(b["segs"])
        cur_lo, cur_hi = segs[0]
        for (xlo, xhi) in segs[1:]:
            if xlo - cur_hi <= XGAP_MERGE:
                cur_hi = max(cur_hi, xhi)
            else:
                if cur_hi - cur_lo >= MIN_PLATFORM_LEN:
                    platforms.append({"y": b["y_mean"], "xmin": cur_lo, "xmax": cur_hi, "len": cur_hi - cur_lo})
                cur_lo, cur_hi = xlo, xhi
        if cur_hi - cur_lo >= MIN_PLATFORM_LEN:
            platforms.append({"y": b["y_mean"], "xmin": cur_lo, "xmax": cur_hi, "len": cur_hi - cur_lo})

    return platforms


def assign_mobs_to_platforms(platforms, mobs):
    for p in platforms:
        p["mobCount"] = 0
    unassigned = 0
    for m in mobs:
        best = None
        best_d = None
        for p in platforms:
            if p["xmin"] - 60 <= m["x"] <= p["xmax"] + 60:
                d = abs(m["cy"] - p["y"])
                if d <= 60 and (best_d is None or d < best_d):
                    best = p
                    best_d = d
        if best is not None:
            best["mobCount"] += 1
        else:
            unassigned += 1
    return unassigned


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def score_map(platforms, vr_top, vr_bottom, total_mobs):
    """Return (mcScore 1-5, healScore 1-5, metrics dict)."""
    mob_platforms = [p for p in platforms if p["mobCount"] > 0]
    used = mob_platforms if mob_platforms else platforms

    if not used:
        return None, None, {"platformCount": 0, "floors": 0}

    n_floors = len(used)
    lengths = [p["len"] for p in used]
    avg_len = sum(lengths) / len(lengths)

    vertical_span = (vr_bottom - vr_top) if (vr_top is not None and vr_bottom is not None) else None
    if vertical_span is None:
        ys = [p["y"] for p in used]
        vertical_span = (max(ys) - min(ys)) if ys else 0

    # ---- Magic Claw scoring ----
    length_score = clamp(avg_len / (MC_RANGE_PX * 2), 0, 1)
    floor_penalty = 1.0 / (1.0 + (max(0, n_floors - 1)) * 0.4)
    mobs_per_platform = (total_mobs / n_floors) if n_floors else 0
    density_score = clamp(mobs_per_platform / 3.0, 0, 1)
    mc_raw = 0.45 * length_score + 0.35 * floor_penalty + 0.20 * density_score
    mc_score = int(round(1 + mc_raw * 4))
    mc_score = clamp(mc_score, 1, 5)

    # ---- Heal scoring ----
    ys_sorted = sorted(set(round(p["y"]) for p in used))
    if len(ys_sorted) >= 2:
        gaps = [ys_sorted[i+1] - ys_sorted[i] for i in range(len(ys_sorted)-1)]
        avg_gap = sum(gaps) / len(gaps)
    else:
        avg_gap = HEAL_GAP_SATURATE  # single floor -> no stacking possible, treat as max gap
    gap_score = clamp(1 - (avg_gap / HEAL_GAP_SATURATE), 0, 1)

    # horizontal alignment: average overlap fraction between vertically-adjacent platforms
    used_sorted = sorted(used, key=lambda p: p["y"])
    overlaps = []
    for i in range(len(used_sorted) - 1):
        a, b = used_sorted[i], used_sorted[i+1]
        ov = max(0, min(a["xmax"], b["xmax"]) - max(a["xmin"], b["xmin"]))
        denom = min(a["len"], b["len"]) or 1
        overlaps.append(clamp(ov / denom, 0, 1))
    align_score = (sum(overlaps) / len(overlaps)) if overlaps else 0.0

    floor_bonus = clamp(n_floors / FLOOR_BONUS_SATURATE, 0, 1)

    heal_raw = 0.45 * gap_score + 0.30 * align_score + 0.25 * floor_bonus
    heal_score = int(round(1 + heal_raw * 4))
    heal_score = clamp(heal_score, 1, 5)

    metrics = {
        "platformCount": len(platforms),
        "mobBearingFloors": n_floors,
        "avgPlatformLenPx": round(avg_len, 1),
        "verticalSpanPx": round(vertical_span, 1),
        "avgFloorGapPx": round(avg_gap, 1),
        "platformAlignment": round(align_score, 3),
        "mobCount": total_mobs,
    }
    return mc_score, heal_score, metrics


def process_file(path):
    try:
        tree = ET.parse(path)
    except ET.ParseError as e:
        return None
    root = tree.getroot()
    name = root.get("name", "")
    try:
        map_id = int(os.path.splitext(os.path.splitext(name)[0])[0])
    except ValueError:
        map_id = None

    info = find_child_dir(root, "info")
    is_town = False
    vr_top = vr_bottom = vr_left = vr_right = None
    if info is not None:
        is_town = bool(find_leaf(info, "town"))
        vr_top = find_leaf(info, "VRTop")
        vr_bottom = find_leaf(info, "VRBottom")
        vr_left = find_leaf(info, "VRLeft")
        vr_right = find_leaf(info, "VRRight")

    fh_root = find_child_dir(root, "foothold")
    footholds = collect_footholds(fh_root) if fh_root is not None else []

    life_root = find_child_dir(root, "life")
    mobs = collect_mobs(life_root) if life_root is not None else []

    platforms = cluster_platforms(footholds)
    assign_mobs_to_platforms(platforms, mobs)

    mc_score, heal_score, metrics = score_map(platforms, vr_top, vr_bottom, len(mobs))

    return {
        "mapId": map_id,
        "isTown": is_town,
        "hasMobs": len(mobs) > 0,
        "footholdCount": len(footholds),
        "mcScore": mc_score,
        "healScore": heal_score,
        **metrics,
        "vr": {"top": vr_top, "left": vr_left, "bottom": vr_bottom, "right": vr_right},
    }


def main():
    files = sorted(glob.glob(os.path.join(MAP_ROOT, "Map*", "*.img.xml")))
    files = [f for f in files if os.path.basename(f) != "AreaCode.img.xml"]
    print(f"Found {len(files)} map files", file=sys.stderr)

    results = {}
    t0 = time.time()
    errors = 0
    for i, f in enumerate(files):
        r = process_file(f)
        if r is None or r["mapId"] is None:
            errors += 1
            continue
        results[r["mapId"]] = r
        if (i+1) % 500 == 0:
            print(f"  {i+1}/{len(files)} ({time.time()-t0:.1f}s)", file=sys.stderr)

    print(f"Done in {time.time()-t0:.1f}s, {errors} errors, {len(results)} maps scored", file=sys.stderr)

    with open(OUT_JSON, "w") as f:
        json.dump(results, f, separators=(",", ":"))

    fields = ["mapId","isTown","hasMobs","mcScore","healScore","platformCount",
              "mobBearingFloors","avgPlatformLenPx","verticalSpanPx","avgFloorGapPx",
              "platformAlignment","mobCount","footholdCount"]
    with open(OUT_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for mid in sorted(results.keys()):
            row = results[mid]
            w.writerow({k: row.get(k) for k in fields})

    print(f"Wrote {OUT_JSON} and {OUT_CSV}", file=sys.stderr)


if __name__ == "__main__":
    main()
