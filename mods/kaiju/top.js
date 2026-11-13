// Top bar: current space capsule (2px border in the building color + building icon + name) + tab pills + Files / Changes toggles on the right
//   each tab pill starts with the head of the tab's first agent (expression follows status), or a brick when it has none
//   current tab fill = building color mixed 2:8 with the chrome color
import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, shared, layout } from "herdr";
import M from "./manifest.js";
import { asset, assign, monsterOf, slotOf, slotColor, shadowColor, FACE, find } from "./state.js";
import { miniBuilding, BADGE } from "./roster.js";

const stop = (_e, cx) => cx.stop_propagation();

// Mix two #rrggbb colors, k = share of b
export function mix(a, b, k) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v * (1 - k) + y[i] * k).toString(16).padStart(2, "0")).join("");
}

// Monster head or brick: head art is 48px, shown at 24 for an exact multiple
export function headIcon(t, a) {
  if (!a) {
    const [w, h] = M.fxSize.brick;
    return div().size(24).flex_none().flex().items_center().justify_center().child(image(asset(t, M.fx.brick)).w(w).h(h));
  }
  const mid = assign(agents()).get(a.address);
  return image(asset(t, monsterOf(mid).heads[FACE[a.status] ?? "idle"])).size(24).flex_none();
}

// Tab name: default names (1, tb2…) become the program name
function tabName(c, ps) {
  if (!/^(tb)?\d+$/.test(c.name)) return c.name;
  const program = ps.find((p) => p.tab === c.id && p.program?.agent)?.program ?? ps.find((p) => p.tab === c.id)?.program;
  return program?.name ?? "Terminal";
}

export function top(view, t) {
  const space = spaces().find((s) => s.active);
  const tabs = space?.tabs ?? [];
  const ps = panes();
  const ags = agents();
  const color = slotColor(space ? slotOf(space.id) : null);
  const shadow = shadowColor(t);

  // Wrap in a hard pixel shadow offset 2px down-right
  const hard = (id, el) => div().id(id).relative().flex_none().pr(2).pb(2)
    .child(div().absolute().left(2).top(2).right(0).bottom(0).bg(shadow))
    .child(el);

  const pill = space
    ? hard("kj-space", h_flex().h(32).pl(8).pr(12).gap(8).items_center().bg(t.surface).border(2).border_color(color)
        .cursor_pointer().tooltip("Click to rename")
        .on_mouse_down("left", stop)
        .on_click(() => run("space.rename", { id: space.id }))
        .child(miniBuilding(color, 20))
        .child(div().max_w(220).truncate().text_size(12).text_color(t.foreground).child(space.name)))
    : div();

  const cur = mix(color, t.chrome, 0.8);
  const tab = (c, i) => {
    const a = ags.find((x) => x.tab === c.id);
    return h_flex().id(`kj-tab-${c.id}`).h(30).pl(4).pr(10).gap(6).flex_none().items_center()
      .text_size(12).cursor_pointer().border(2)
      .when(c.active, (el) => el.bg(cur).border_color(color).text_color(t.foreground))
      .when(!c.active, (el) => el.border_color(t.chrome).text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)))
      .on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        view.pressed = i;
        if (e.click_count === 2) run("tab.rename", { id: c.id });
      })
      .on_mouse_up("left", () => {
        const from = view.pressed;
        view.pressed = null;
        if (from != null && from !== i) run("tab.move", { id: tabs[from].id, index: i + 1 });
        else run("tab.select", { id: c.id });
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } });
      })
      .child(headIcon(t, a))
      .child(div().max_w(150).truncate().child(c.zoomed ? `${tabName(c, ps)} Z` : tabName(c, ps)))
      .when(c.status === "blocked", (el) => el.child(div().size(6).bg(BADGE.blocked)));
  };

  const iconButton = (id, icon, tip, on, action) => div().id(id).size(30).flex_none().flex().items_center().justify_center()
    .cursor_pointer().border(2).text_color(on ? t.foreground : t.muted)
    .border_color(on ? t.input : t.chrome)
    .hover((st) => st.bg(t.hover).text_color(t.foreground))
    .tooltip(tip).on_mouse_down("left", stop).on_click(action)
    .child(svg(icon).size(16));

  const root = layout();
  const panel = find(root, "panel");
  const body = find(root, "panel-body");
  const enabled = shared("workspace.panels") ?? ["files", "changes"];
  const panelButton = (id, icon, tip) => {
    const on = Boolean(panel && !panel.hidden && body?.active === id);
    return iconButton(`kj-panel-${id}`, icon, tip, on, () => {
      if (on) run("layout.hide", { id: "panel" });
      else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
    });
  };

  return h_flex().size_full().relative().bg(t.canvas).items_center().justify_center().px(90)
    .on_mouse_up("left", () => { view.pressed = null; })
    .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
    .child(h_flex().min_w(0).gap(6).items_center()
      .child(pill)
      .child(h_flex().id("kj-tabs").min_w(0).gap(4).items_center().overflow_x_scrollbar().children(tabs.map(tab)))
      .child(iconButton("kj-tab-new", "mods/workspace-chrome/plus.svg", "New tab", false,
        () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))))
    .child(h_flex().absolute().right(12).top(0).bottom(0).gap(4).items_center()
      .when(enabled.includes("files"), (el) => el.child(panelButton("files", "mods/files/file.svg", "Files")))
      .when(enabled.includes("changes"), (el) => el.child(panelButton("changes", "mods/changes/changes.svg", "Changes"))));
}
