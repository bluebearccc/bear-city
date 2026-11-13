// Part dispatch for the Kaiju City layout; props() picks what to draw:
//   city: top-left city diorama (space = building, agent = monster), see city.js
//   roster: bottom-left monster roster cards; a narrow rail when the sidebar is collapsed, see roster.js
//   top: top bar space capsule + tab pills
//   news: bottom-right kaiju news
//   pane header: when props has pane

import { View, div } from "gpui-kit";
import { props, theme, nextCommand } from "herdr";
import { Damage } from "./state.js";
import { city } from "./city.js";
import { roster, toggleSidebar } from "./roster.js";
import { top } from "./top.js";
import { paneHeader } from "./pane.js";
import { news } from "./news.js";

export default class Kaiju extends View {
  init(_props, cx) {
    this.damage = new Damage();
    // Only the roster copy takes key commands (keys.json: "cmd-b": "kaiju.toggle") so copies don't compete
    if (props()?.part === "roster") {
      cx.spawn(async (cx) => {
        for (;;) {
          const c = await nextCommand();
          if (c.endsWith("toggle")) toggleSidebar();
          cx.notify();
        }
      });
    }
  }

  render(cx) {
    const t = theme();
    if (props()?.pane) return paneHeader(this, t);
    const part = props()?.part;
    if (part === "city") return city(this, t, cx);
    if (part === "roster") return roster(this, t, cx);
    if (part === "top") return top(this, t);
    if (part === "news") return news(this, t, cx);
    return div();
  }
}
