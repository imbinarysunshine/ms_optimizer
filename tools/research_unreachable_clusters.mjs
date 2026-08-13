// Research tool (not part of the regular data pipeline): for every mob-bearing
// map currently flagged unreachable in mapScores.js, find its connected
// component in the FULL portal graph (undirected, every real edge regardless of
// pt type) and report whether that component has exactly one plausible external
// "entry" edge -- a script-type portal (pt 7/8/9/11, tm=999999999, unresolvable
// from Map.wz alone) sitting on a map that's otherwise reachable, or one already
// reaching INTO the component from a reachable map.
//
// Why this exists: verified by hand (see MANUAL_EXTRA_EDGES in
// extract_portals.mjs) that Kerning City Subway's entire 8-map cluster
// (103000100-105, 200-202) was unreachable because its ONLY external edge is a
// pt=7 Script portal (103000100's "in00") with no destination stored in Map.wz --
// confirmed against the user's own game knowledge that it leads to 103000102
// ("Transfer Area"), which then fans out to Line 1/2 via normal Map.wz-encoded
// portals. That pattern -- one script portal gating an otherwise fully-linked,
// mob-bearing cluster -- is exactly the kind of case worth surfacing for manual
// review, as opposed to the ~2,477 other script portals in the dataset, most of
// which are Party Quest stage-clear triggers or dialogue/UI hooks (not map
// transitions at all) that can't be resolved this way regardless.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_ROOT = "G:\\git-clones\\Cosmic\\wz\\Map.wz\\Map";
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");
const NO_TARGET = 999999999;
const SCRIPT_TYPES = new Set([7, 8, 9, 11]);
// Common non-transition trigger names (dialogue/tutorial/quest/PQ-stage/UI hooks
// that reuse the portal object mechanism) -- see this file's header comment.
const NOISE_NAME_RE = /^(clear|tuto|glbmsg|advicemap|advcie|jobin|market|rank|quest|tutorial|highposition|minar|floor|morph)/i;

function attr(line, name) {
  const m = line.match(new RegExp(`name="${name}"[^>]*value="(-?[0-9.]+)"`));
  return m ? Number(m[1]) : null;
}
function strAttr(line, name) {
  const m = line.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`));
  return m ? m[1] : null;
}
function extractBlock(lines, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const isOpen = /<imgdir /.test(lines[i]) && !lines[i].includes("/>");
    const isClose = /<\/imgdir>/.test(lines[i]);
    if (isOpen) depth++;
    if (isClose) { depth--; if (depth === 0) return lines.slice(startIdx, i + 1); }
  }
  return lines.slice(startIdx);
}
function parseFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  let isTown = false;
  const infoIdx = lines.findIndex(l => /<imgdir name="info">/.test(l));
  if (infoIdx !== -1) {
    const block = extractBlock(lines, infoIdx);
    isTown = block.some(l => /<int name="town" value="1"\/>/.test(l));
  }
  const portals = [];
  const portalIdx = lines.findIndex(l => /<imgdir name="portal">/.test(l));
  if (portalIdx !== -1) {
    const block = extractBlock(lines, portalIdx);
    let cur = null;
    for (const line of block) {
      if (/<imgdir name="\d+">/.test(line) && line !== block[0]) {
        cur = { pn: null, pt: null, x: null, y: null, tm: null };
      } else if (cur) {
        if (line.includes('name="pn"')) cur.pn = strAttr(line, "pn");
        else if (line.includes('name="pt"')) cur.pt = attr(line, "pt");
        else if (line.includes('name="x"')) cur.x = attr(line, "x");
        else if (line.includes('name="y"')) cur.y = attr(line, "y");
        else if (line.includes('name="tm"')) cur.tm = attr(line, "tm");
        else if (/<\/imgdir>/.test(line)) {
          if (cur.x !== null && cur.y !== null && cur.tm !== null) portals.push(cur);
          cur = null;
        }
      }
    }
  }
  return { isTown, portals };
}

function main() {
  const files = [];
  for (const sub of fs.readdirSync(MAP_ROOT)) {
    const subPath = path.join(MAP_ROOT, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;
    for (const f of fs.readdirSync(subPath)) {
      if (f.endsWith(".img.xml")) files.push(path.join(subPath, f));
    }
  }
  const maps = new Map();
  for (const f of files) {
    const mapId = Number(path.basename(f, ".img.xml"));
    if (!Number.isFinite(mapId)) continue;
    maps.set(mapId, parseFile(f));
  }
  console.error(`Parsed ${maps.size} maps`);

  // Reachability BFS (real edges only -- same as extract_portals.mjs)
  const roots = [...maps.entries()].filter(([, m]) => m.isTown).map(([id]) => id);
  const reachable = new Set(roots);
  let queue = [...roots];
  while (queue.length) {
    const id = queue.pop();
    const m = maps.get(id);
    if (!m) continue;
    for (const p of m.portals) {
      if (p.tm === NO_TARGET || !maps.has(p.tm)) continue;
      if (!reachable.has(p.tm)) { reachable.add(p.tm); queue.push(p.tm); }
    }
  }

  // Undirected connectivity graph (real edges only) for clustering
  const undirected = new Map();
  for (const [id, m] of maps) {
    if (!undirected.has(id)) undirected.set(id, new Set());
    for (const p of m.portals) {
      if (p.tm === NO_TARGET || !maps.has(p.tm)) continue;
      undirected.get(id).add(p.tm);
      if (!undirected.has(p.tm)) undirected.set(p.tm, new Set());
      undirected.get(p.tm).add(id);
    }
  }

  const src = fs.readFileSync(SCORES_PATH, "utf8");
  const scores = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
  const unreachableMobMaps = Object.entries(scores)
    .filter(([, e]) => e.hasMobs && e.reachable === false)
    .map(([id]) => Number(id));
  console.error(`${unreachableMobMaps.length} unreachable mob-bearing maps to cluster`);

  const visited = new Set();
  const clusters = [];
  for (const startId of unreachableMobMaps) {
    if (visited.has(startId)) continue;
    const component = new Set([startId]);
    const q = [startId];
    visited.add(startId);
    while (q.length) {
      const id = q.pop();
      for (const neighbor of (undirected.get(id) || [])) {
        if (!component.has(neighbor)) { component.add(neighbor); q.push(neighbor); visited.add(neighbor); }
      }
    }
    // Only components actually containing >=1 unreachable mob map matter (all do, by construction)
    // Find candidate entry portals: script-type, unresolved, sitting on a map OUTSIDE the
    // component that's itself reachable (i.e. plausibly "one script hop" from real territory).
    // Same-ID-prefix heuristic: MapleStory conventionally groups related maps
    // (a dungeon + its sub-areas, a subway line + its stops) under a shared
    // leading-digit range -- Kerning Subway is 103000100-103000202, all sharing
    // "1030001"/"1030002". Candidates outside that shared-prefix range are almost
    // always unrelated script triggers (dialogue/quest/PQ) that happen to sit on
    // some other reachable map -- not a real lead. clusterPrefixLen shrinks until
    // it finds a non-trivial (>=4 digit) common prefix across the WHOLE component,
    // so a single wide-ranging cluster doesn't just fail to match anything.
    const compIds = [...component].map(String);
    let prefixLen = Math.min(...compIds.map(s => s.length));
    outer: for (; prefixLen >= 4; prefixLen--) {
      const prefix = compIds[0].slice(0, prefixLen);
      for (const s of compIds) if (!s.startsWith(prefix)) continue outer;
      break;
    }
    const clusterPrefix = prefixLen >= 4 ? compIds[0].slice(0, prefixLen) : null;
    const candidates = [];
    for (const [id, m] of maps) {
      if (component.has(id)) continue;
      if (!reachable.has(id)) continue;
      if (clusterPrefix && !String(id).startsWith(clusterPrefix.slice(0, Math.max(4, clusterPrefix.length - 2)))) continue;
      for (const p of m.portals) {
        if (p.tm !== NO_TARGET || !SCRIPT_TYPES.has(p.pt)) continue;
        if (NOISE_NAME_RE.test(p.pn || "")) continue;
        candidates.push({ fromMapId: id, portalName: p.pn, pt: p.pt });
      }
    }
    clusters.push({
      component: [...component].sort((a, b) => a - b),
      mobBearingUnreachable: [...component].filter(id => scores[id]?.hasMobs && scores[id]?.reachable === false),
      candidateEntryPortals: candidates,
    });
  }

  console.error(`${clusters.length} distinct clusters`);
  const report = clusters
    .sort((a, b) => b.mobBearingUnreachable.length - a.mobBearingUnreachable.length)
    .map(c => ({
      size: c.component.length,
      mobBearingUnreachable: c.mobBearingUnreachable,
      names: c.component.map(id => ({ id, name: undefined })), // filled below if mapNames available
      candidateEntryPortals: c.candidateEntryPortals,
    }));

  fs.writeFileSync(path.join(__dirname, "unreachable_clusters_report.json"), JSON.stringify(report, null, 1));
  console.error(`Wrote tools/unreachable_clusters_report.json`);

  // Console summary: clusters with EXACTLY ONE candidate entry portal are the
  // strongest, most actionable leads (unambiguous single fix point, same shape
  // as the Kerning Subway case).
  const singleCandidate = report.filter(c => c.candidateEntryPortals.length === 1);
  const noCandidate = report.filter(c => c.candidateEntryPortals.length === 0);
  const multiCandidate = report.filter(c => c.candidateEntryPortals.length > 1);
  console.error(`\nClusters with exactly 1 candidate entry portal (strongest leads): ${singleCandidate.length}`);
  for (const c of singleCandidate.slice(0, 30)) {
    console.error(`  cluster[${c.mobBearingUnreachable.join(",")}] <- ${JSON.stringify(c.candidateEntryPortals[0])}`);
  }
  console.error(`\nClusters with 0 candidate entry portals (no script-portal lead at all -- likely genuinely isolated/unused data): ${noCandidate.length}`);
  console.error(`Clusters with >1 candidate (ambiguous, needs more evidence): ${multiCandidate.length}`);
}

main();
