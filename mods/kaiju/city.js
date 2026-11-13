// City diorama: plate + 8 building slots (space = building) + monsters (agents); a floating arrow over the current roof
//   click a building to switch space, click a monster to jump to its pane
import { div, image } from "gpui-kit";
import { spaces, agents, setAgentOrder, run, props, shared, setShared } from "herdr";
import M from "./manifest.js";
import { asset, assign, behaviors, monsterOf, STATUS_TEXT } from "./state.js";
// Monsters and buildings are stacked by depth; only working / done / blocked monsters appear

const W = M.canvas.w;
const H = M.canvas.h;
const SP = M.sprite;
const RISE = 40;
const WALK = 900;

// Write each building's damage into shared state for the roster's damage bar; only when it changes
function shareDamage(level) {
  const obj = Object.fromEntries(level);
  const old = shared("kaiju.damage") ?? {};
  const same = Object.keys(obj).length === Object.keys(old).length && Object.entries(obj).every(([k, v]) => old[k] === v);
  if (!same) setShared("kaiju.damage", obj);
}

// One full-canvas layer
const layer = (t, name) => image(asset(t, name)).absolute().left(0).top(0).w(W).h(H);

const fx = (t, name) => {
  const [w, h] = M.fxSize[name];
  return image(asset(t, M.fx[name])).w(w).h(h);
};

// Remember seen spaces: a new building rises from the ground (ones present on first render don't)
function rising(view, list, cx) {
  const c = (view.city ??= { known: null, rising: new Set() });
  const ids = list.map((s) => s.id);
  if (c.known == null) {
    c.known = new Set(ids);
    return c.rising;
  }
  const fresh = ids.filter((id) => !c.known.has(id));
  if (fresh.length) {
    fresh.forEach((id) => { c.known.add(id); c.rising.add(id); });
    // Draw it low first, back in place next frame; the spring makes it rise
    cx.timer.after(40, (cx) => { c.rising.clear(); cx.notify(); });
  }
  for (const id of [...c.known]) if (!ids.includes(id)) c.known.delete(id);
  return c.rising;
}

// Monster enter / move / leave:
//   a new one is drawn at the sea entry point, moved to its stand after 40ms, and the transition walks it there (walk frame)
//   a changed position walks the same way; one that no longer appears (idle or gone) walks back to the entry and is removed on arrival
//   all wake-ups use one-shot timer.after, never every
function moves(view, active, beh, cx) {
  const st = (view.walk ??= { map: new Map(), init: false });
  const now = Date.now();
  const entry = M.entry;
  let wake = 0;
  let enter = false;
  const out = [];
  const live = new Set();
  for (const a of active) {
    const b = beh.get(a.address);
    live.add(a.address);
    let e = st.map.get(a.address);
    if (!e || e.leaving) {
      // Already working on first render: stand in place, no entrance
      e = { x: b.spot.x, y: b.spot.y, until: 0, enter: st.init, leaving: false };
      if (e.enter) enter = true;
      st.map.set(a.address, e);
    } else if (e.x !== b.spot.x || e.y !== b.spot.y) {
      e.x = b.spot.x; e.y = b.spot.y; e.until = now + WALK;
      wake = Math.max(wake, WALK + 20);
    }
    if (e.needWake) { e.needWake = false; wake = Math.max(wake, WALK + 20); }
    e.agent = a;
    const pos = e.enter ? entry : b.spot;
    out.push({ a, b, pos, walking: e.enter || e.until > now });
  }
  for (const [addr, e] of [...st.map]) {
    if (live.has(addr)) continue;
    if (!e.leaving) { e.leaving = true; e.until = now + WALK; wake = Math.max(wake, WALK + 20); }
    if (e.until <= now) { st.map.delete(addr); continue; }
    out.push({ a: e.agent, b: { mode: "leave", spot: entry, slot: null, bubble: null }, pos: entry, walking: true });
  }
  if (enter) {
    cx.timer.after(40, (cx) => {
      for (const e of st.map.values()) if (e.enter) { e.enter = false; e.until = Date.now() + WALK; e.needWake = true; }
      cx.notify();
    });
  }
  if (wake) cx.timer.after(wake, (cx) => cx.notify());
  st.init = true;
  return out;
}

// props().demo.agents: fake agents for screenshot checks, [{address, space: index, status, name}]
function agentList() {
  const demo = props()?.demo?.agents;
  if (!demo) return agents();
  const sp = spaces();
  return demo.map((d) => ({
    address: d.address, pane: null, status: d.status, focused: false,
    space: sp[d.space]?.id ?? "", program: { name: d.name ?? "agent" },
  }));
}

function monster(t, it, mid) {
  const { a, b, pos, walking } = it;
  const m = monsterOf(mid);
  const frame = walking ? "walk" : b.mode;
  let body = div().id(`mon-body-${a.address}`).absolute().left(0).top(0).w(SP.w).h(SP.h)
    .child(image(asset(t, m.frames[frame])).w(SP.w).h(SP.h));
  if (!walking && b.mode === "smash") body = body.loop("left", { from: -1, to: 1, period: 180 });
  const el = div().id(`mon-${a.address}`).absolute().left(pos.x - SP.ax).top(pos.y - SP.ay).w(SP.w).h(SP.h)
    .transition("left", { duration: WALK, easing: "ease-in-out" })
    .transition("top", { duration: WALK, easing: "ease-in-out" })
    .child(body);
  if (b.bubble && !walking) {
    const [, bh] = M.fxSize[b.bubble];
    el.child(div().absolute().left(SP.ax + 14).top(m.top - bh - 2).child(fx(t, b.bubble)));
  }
  return el;
}

export function city(view, t, cx) {
  const list = spaces();
  const demo = props()?.demo;
  const ags = agentList();
  const level = demo?.damage ? null : view.damage.update(cx, ags);
  if (level) shareDamage(level);
  const up = rising(view, list, cx);
  const dmgOf = (sp, s) => (demo?.damage ? demo.damage[s.i] ?? 0 : level.get(sp.id) ?? 0);

  if (!demo?.agents) setAgentOrder(ags.map((a) => a.address));
  const mids = assign(ags);
  // Only working / done / blocked monsters whose space is in the city appear; idle ones stay in the roster
  const beh = behaviors(ags);
  const shown = moves(view, ags.filter((a) => beh.get(a.address).slot != null), beh, cx);
  // Monster state per slot: smashing -> building shakes + dust; waiting -> roof siren
  const smashing = new Set();
  const waiting = new Set();
  for (const { b, walking } of shown) {
    if (b.slot == null || walking) continue;
    if (b.mode === "smash") smashing.add(b.slot);
    if (b.mode === "wave") waiting.add(b.slot);
  }

  // Buildings and monsters stack back to front by real depth: stand depth is precomputed (buildings hiding it come after, buildings it hides come before), feet on the ground
  const items = [];
  for (const s of M.slots) items.push({ depth: s.depth, order: 0, slot: s });
  // Walking monsters (enter, move, leave) cross blocks, so draw them on top to avoid ducking behind buildings mid-walk
  // Same depth: feet lower on screen (further forward) draw later
  for (const it of shown) items.push({ depth: it.walking ? Infinity : it.pos.depth, order: 1, y: it.pos.y, mon: it });
  items.sort((x, y) => x.depth - y.depth || x.order - y.order || (x.y ?? 0) - (y.y ?? 0));

  const stage = div().relative().w(W).h(H).child(layer(t, "plate.png"));
  for (const it of items) {
    if (it.mon) {
      stage.child(monster(t, it.mon, mids.get(it.mon.a.address)));
      continue;
    }
    const s = it.slot;
    const sp = list[s.i];
    if (!sp) {
      stage.child(layer(t, s.empty));
      continue;
    }
    const dmg = dmgOf(sp, s);
    // Clip the building above its own base so it doesn't show below ground while rising
    const bottom = s.hit.y + s.hit.h;
    let img = image(asset(t, s.layers[dmg])).absolute().left(0).w(W).h(H)
      .top(up.has(sp.id) ? RISE : 0).spring("top", { response: 520, damping: 0.62 });
    let box = div().id(`bld-${s.i}`).absolute().left(0).top(0).w(W).h(bottom).overflow_hidden();
    if (smashing.has(s.i)) box = box.loop("left", { from: 0, to: 1, period: 240 });
    stage.child(box.child(img));
    if (smashing.has(s.i)) {
      const [dw, dh] = M.fxSize.dust;
      stage.child(div().id(`dust-${s.i}`).absolute().left(s.hit.x + s.hit.w / 2 - dw / 2).top(bottom - dh - 2)
        .loop("opacity", { from: 0.4, to: 1, period: 700 }).child(fx(t, "dust")));
    }
    if (waiting.has(s.i)) {
      const [sw, sh] = M.fxSize.siren;
      stage.child(div().id(`siren-${s.i}`).absolute().left(s.roof.x - sw / 2).top(s.roofs[dmg] - sh - 1)
        .loop("opacity", { from: 0.2, to: 1, period: 500 }).child(fx(t, "siren")));
    }
  }

  // Floating arrow above the current space's roof
  const cur = list.findIndex((s) => s.active);
  if (cur >= 0 && cur < M.slots.length) {
    const s = M.slots[cur];
    const [aw, ah] = M.fxSize.arrow;
    const roofY = s.roofs[dmgOf(list[cur], s)];
    stage.child(div().id("kaiju-arrow-at").absolute().left(s.roof.x - aw / 2).top(roofY - 12 - ah).w(aw).h(ah)
      .transition("top", { duration: 400, easing: "ease-out" })
      .child(div().id("kaiju-arrow").absolute().left(0).top(0)
        .loop("top", { from: -3, to: 3, period: 900 })
        .child(fx(t, "arrow"))));
  }

  // Click areas stack in the same order as the picture (a building in front of a monster wins); walking monsters aren't clickable
  const stop = (_e, cx) => cx.stop_propagation();
  for (const it of items) {
    if (it.mon) {
      const { a, b, walking } = it.mon;
      if (walking) continue;
      const m = monsterOf(mids.get(a.address));
      const h = SP.h - m.top;
      stage.child(div().id(`mhit-${a.address}`).absolute().left(b.spot.x - 18).top(b.spot.y - h).w(36).h(h)
        .cursor_pointer().tooltip(`${m.name} · ${a.program?.name ?? a.app ?? "Agent"} · ${STATUS_TEXT[a.status] ?? ""}`)
        .on_mouse_down("left", stop)
        .on_click(() => a.pane && run("pane.focus", { pane: a.pane })));
      continue;
    }
    const s = it.slot;
    const sp = list[s.i];
    if (!sp) continue;
    stage.child(div().id(`hit-${s.i}`).absolute().left(s.hit.x).top(s.hit.y).w(s.hit.w).h(s.hit.h)
      .cursor_pointer().tooltip(sp.name)
      .on_mouse_down("left", stop)
      .on_click(() => run("space.select", { id: sp.id })));
  }
  return div().size_full().flex().justify_center().pt(8).child(stage);
}
