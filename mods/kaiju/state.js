// Kaiju City pure logic: asset paths, day/night, space -> slot mapping, building damage
import { spaces, shared, setShared } from "herdr";
import M from "./manifest.js";

const ASSETS = "mods/kaiju/assets";
const MIN = 60 * 1000;
// How long of continuous working raises damage one level
export const LIGHT_AFTER = 2 * MIN;
export const HEAVY_AFTER = 8 * MIN;
// Repair interval per level after going back to idle
export const REPAIR_STEP = 650;

// Dark theme background -> night art
export function isNight(t) {
  const hex = (t.background ?? "#ffffff").slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

// Hard pixel shadow color
export const shadowColor = (t) => (isNight(t) ? "#00000099" : "#2b262033");

// Status -> face frame
export const FACE = { idle: "idle", working: "smash", done: "roar", blocked: "wave" };

// Find a node by id in the layout tree
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export const asset = (t, name) => `${ASSETS}/${isNight(t) ? "night" : "day"}/${name}`;

// Spaces take the first 8 slots in order; later ones aren't in the city
export function slotOf(spaceId) {
  const i = spaces().findIndex((s) => s.id === spaceId);
  return i >= 0 && i < M.slots.length ? i : null;
}

export const slotColor = (i) => (i != null && M.slots[i] ? M.slots[i].color : "#9b958c");

// Earliest working start time in a space
const workingSince = (s) => {
  const ts = s.tabs.map((t) => t.working_since).filter((v) => v != null);
  return ts.length ? Math.min(...ts) : null;
};

// Target damage from the statuses of a space's agents (not space.status: blocked would hide done):
// any done = 3 (ruin); working by duration 0/1/2; only blocked keeps the level; otherwise 0 (Damage repairs step by step)
function target(s, st, now, prev) {
  if (st.has("done")) return 3;
  if (st.has("working")) {
    const since = workingSince(s);
    const e = since == null ? 0 : now - since;
    return e >= HEAVY_AFTER ? 2 : e >= LIGHT_AFTER ? 1 : 0;
  }
  if (st.has("blocked")) return prev;
  return 0;
}

// Current damage per space; time-based changes wake a redraw with one-shot timer.after (never every)
export class Damage {
  constructor() {
    this.level = new Map();
    this.wakeAt = Infinity;
  }

  // Returns Map<spaceId, 0..3> and schedules the next redraw when needed
  // list: current agents (agents() or demo data)
  update(cx, list) {
    const now = Date.now();
    const bySpace = new Map();
    for (const a of list) {
      if (!bySpace.has(a.space)) bySpace.set(a.space, new Set());
      bySpace.get(a.space).add(a.status);
    }
    let next = Infinity;
    const live = new Set();
    for (const s of spaces()) {
      live.add(s.id);
      const prev = this.level.get(s.id) ?? 0;
      const st = bySpace.get(s.id) ?? new Set();
      const want = target(s, st, now, prev);
      let cur = want;
      if (want < prev && !st.has("working")) {
        // Repair: drop one level at a time, REPAIR_STEP each
        const at = this.repairAt?.get(s.id);
        if (at == null) {
          (this.repairAt ??= new Map()).set(s.id, now + REPAIR_STEP);
          cur = prev;
        } else if (now >= at) {
          cur = prev - 1;
          if (cur > want) this.repairAt.set(s.id, now + REPAIR_STEP);
          else this.repairAt.delete(s.id);
        } else {
          cur = prev;
        }
        if (cur > want) next = Math.min(next, this.repairAt.get(s.id));
      } else {
        this.repairAt?.delete(s.id);
      }
      if (st.has("working") && !st.has("done")) {
        const since = workingSince(s);
        if (since != null) {
          if (now - since < LIGHT_AFTER) next = Math.min(next, since + LIGHT_AFTER);
          else if (now - since < HEAVY_AFTER) next = Math.min(next, since + HEAVY_AFTER);
        }
      }
      this.level.set(s.id, cur);
    }
    for (const id of [...this.level.keys()]) if (!live.has(id)) this.level.delete(id);
    // Only schedule again when earlier than the pending one
    if (next < Infinity && next < this.wakeAt) {
      this.wakeAt = next;
      cx.timer.after(Math.max(16, next - now + 20), (cx) => {
        this.wakeAt = Infinity;
        cx.notify();
      });
    }
    return this.level;
  }
}

// ---------- Monsters ----------
export const STATUS_TEXT = { idle: "Asleep", working: "Smashing", done: "Razed", blocked: "Waiting" };
const MODE = { working: "smash", done: "roar", blocked: "wave" };
const BUBBLE = { roar: "bang", wave: "question" };
const KEY = "kaiju.monsters";

// Agents get roster monsters in order of appearance, cycling; kept in shared so every part sees the same one
export function assign(list) {
  const old = shared(KEY) ?? { map: {}, n: 0 };
  const map = {};
  let n = old.n ?? 0;
  let changed = false;
  for (const a of list) {
    if (old.map?.[a.address]) map[a.address] = old.map[a.address];
    else {
      map[a.address] = M.monsters[n % M.monsters.length].id;
      n += 1;
      changed = true;
    }
  }
  if (Object.keys(old.map ?? {}).some((k) => !(k in map))) changed = true;
  if (changed) setShared(KEY, { map, n });
  return new Map(Object.entries(map));
}

export const monsterOf = (id) => M.monsters.find((m) => m.id === id) ?? M.monsters[0];

// Where each visible monster goes: mode (smash/roar/wave), foot position spot, slot, head bubble
// idle, or space not in the city: slot = null, not shown
export function behaviors(list) {
  const out = new Map();
  const perSlot = new Map();
  for (const a of list) {
    const slot = slotOf(a.space);
    const mode = MODE[a.status] ?? null;
    if (mode == null || slot == null) {
      out.set(a.address, { mode: "idle", spot: null, slot: null, bubble: null });
      continue;
    }
    const k = perSlot.get(slot) ?? 0;
    perSlot.set(slot, k + 1);
    // Each building has 2-4 stands; extra monsters reuse them, each round a bit further forward (down)
    const st = M.slots[slot].stand;
    const p = st[k % st.length];
    const round = Math.floor(k / st.length);
    const spot = { x: p.x, y: p.y + round * 6, depth: p.depth + round * 12 };
    out.set(a.address, { mode, spot, slot, bubble: BUBBLE[mode] ?? null });
  }
  return out;
}
