// Kaiju news: when a background agent is done or blocked, a news card floats up in the bottom right
//   same rules as the veggie harvest card: first sighting doesn't count; at most 3 rows; clicking a row jumps there and removes it;
//   rows leave on focus, status change or agent exit; × clears; nothing renders when empty
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, props, run } from "herdr";
import { asset, assign, monsterOf } from "./state.js";

const HOT = (s) => s === "done" || s === "blocked";
const MAX = 3;
const RED = "#d9573f";

// Update view.news from agents() changes (called on every render)
function track(view) {
  const n = (view.news ??= { items: [], last: new Map() });
  const list = agents();
  const live = new Map(list.map((a) => [a.address, a]));
  for (const a of list) {
    const prev = n.last.get(a.address);
    if (prev && !HOT(prev) && HOT(a.status) && !a.focused) {
      n.items = n.items.filter((it) => it.address !== a.address);
      n.items.unshift({ address: a.address, pane: a.pane, fresh: true });
    }
  }
  n.last = new Map(list.map((a) => [a.address, a.status]));
  n.items = n.items.filter((it) => {
    const a = live.get(it.address);
    return a && !a.focused && HOT(a.status);
  });
  return n;
}

// props().demo: fake rows for screenshot checks [{address, status, space_name, program: {name}, monster}]
export function news(view, t, cx) {
  const demo = props()?.demo;
  const n = demo ? { items: demo } : track(view);
  if (!n.items.length) return div();
  const live = new Map(agents().map((a) => [a.address, a]));
  const mids = demo ? null : assign(agents());
  // New rows draw a bit higher, drop back next frame; the spring adds the bounce
  if (!demo && n.items.some((it) => it.fresh)) {
    cx.timer.after(40, (cx) => { n.items.forEach((it) => (it.fresh = false)); cx.notify(); });
  }

  const row = (it) => {
    const a = live.get(it.address) ?? it;
    const m = monsterOf(demo ? it.monster : mids.get(it.address));
    const where = a.space_name ?? "";
    const title = a.status === "blocked" ? `${m.name} is waiting in ${where}` : `${m.name} razed ${where}`;
    return h_flex().id(`news-${it.address}`).h(48).px(6).gap(8).items_center().cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        if (demo) return;
        n.items = n.items.filter((x) => x.address !== it.address);
        run("pane.focus", { pane: it.pane });
        cx.notify();
      })
      .child(div().relative().size(32).flex_none()
        .child(div().absolute().left(0).top(it.fresh ? -12 : 0).spring("top", { response: 420, damping: 0.42 })
          .child(image(asset(t, m.face)).size(32))))
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().min_w(0).text_size(12)
          .child(div().flex_none().text_color(RED).child("NEWS | "))
          .child(div().min_w(0).truncate().text_color(t.foreground).child(title)))
        .child(div().truncate().text_size(12).text_color(t.dim).child(a.program?.name ?? a.app ?? "Agent")))
      .when(a.status === "blocked", (el) => el.child(div().size(6).flex_none().bg("#d8a548")));
  };

  const more = n.items.length - MAX;
  // Herdr draws the floating frame (background, border, corners, shadow); this draws only the content: a 3px red strip + rows
  return v_flex().w(286)
    .child(div().h(3).mx(6).bg(RED))
    .child(v_flex().p(4).gap(2)
      .child(h_flex().h(20).px(6).items_center().justify_between()
        .child(div().text_size(12).text_color(t.dim).child("Kaiju News"))
        .child(div().id("news-clear").p(3).cursor_pointer().text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { if (!demo) { n.items = []; cx.notify(); } })
          .child(svg("mods/workspace-chrome/x.svg").size(12))))
      .children(n.items.slice(0, MAX).map(row))
      .when(more > 0, (el) => el.child(div().px(6).pb(2).text_size(12).text_color(t.dim).child(`${more} more`))));
}
