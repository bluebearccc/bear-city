# Kaiju City for Herdr

By [bluebearccc](https://github.com/bluebearccc). An English fork of [Jiqize/herdr-kaiju](https://github.com/Jiqize/herdr-kaiju), with a new Octopus monster and Windows support.

![Kaiju City](preview.png)

An isometric pixel-art layout for [Herdr](https://herdr.dev). A little city sits in the top-left corner: every space is a building, and every agent is an original cute monster. When an agent starts working, its monster walks out of the sea and starts smashing its building. When the agent finishes, the monster roars on the ruins; when it needs you, it waves and a siren lights up on the roof. Below the city, the monster roster shows a dossier card (or a small avatar) for each agent. A news card pops up when a background agent finishes, and in dark mode the city turns into a night scene with lit windows.

## Features

- 8 buildings and 9 original monsters (Lizard, Ape, Octopus, Crab, Axolotl, Yeti, Moth, Turtle, Bat)
- Buildings take damage the longer an agent works, and repair after you look
- Roster of dossier cards (task, timer, damage, record) or small avatars
- Top capsule and tabs with monster heads; pane headers with program and folder
- News card when a background agent is done or blocked
- Fusion Pixel font; light and dark themes follow the system

## Install

```sh
git clone https://github.com/bluebearccc/bear-city.git
cd bear-city
./install.sh
herdr-app do layout.switch '{"name":"kaiju"}'
```

`install.sh` copies only Kaiju's own files into `~/.config/herdr-app/` (and respects `HERDR_APP_HOME`). It merges `cmd-b` into `keys.json`, asks before replacing an existing binding (default: keep it), and backs the file up first. It needs nothing beyond Python and `rsync`; all art ships as ready-made PNGs.

**Windows:** `install.sh` needs `rsync`, which Git Bash doesn't have. Copy the files by hand instead, from Git Bash in the repo folder:

```sh
H=~/.config/herdr-app
cp layouts/kaiju.json layouts/kaiju.svg "$H/layouts/"
cp themes/kaiju.json themes/kaiju-night.json "$H/themes/"
rm -rf "$H/mods/kaiju" && cp -r mods/kaiju "$H/mods/kaiju"
herdr-app do layout.switch '{"name":"kaiju"}'
```

To collapse the sidebar on Windows, add `"layout:kaiju": {"ctrl-shift-b": "kaiju.toggle"}` to `~/.config/herdr-app/keys.json`.

## Keys

| Key | Action |
|---|---|
| `cmd-b` (Windows: `ctrl-shift-b`) | expand / collapse the sidebar |
| `ctrl-1…9` | go to space N |
| `cmd-1…9` | go to tab N |
| `ctrl-shift-l` | switch layout |
| click a building | select its space |
| click a monster or card | focus its pane |

## Swap the monsters

The roster lives in `art/roster.json`. Add a 5-pose sprite sheet (idle, walk, smash, roar, wave, in one row on white), add a line to the list, then run `python3 -I art/build_assets.py` (needs Pillow and numpy) and `./install.sh`. See [RECIPE.md](RECIPE.md).

## Uninstall

Switch away with `ctrl-shift-l`, then delete these files under `~/.config/herdr-app/`: `layouts/kaiju.json`, `layouts/kaiju.svg`, `themes/kaiju.json`, `themes/kaiju-night.json` and `mods/kaiju/`.

## Credits

- Original layout, code and art by [Jiqize](https://github.com/Jiqize/herdr-kaiju) (MIT, see `LICENSE`)
- Pixel font [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) (SIL Open Font License 1.1, see `mods/kaiju/fonts/OFL.txt`)
- Monster sprite sheets generated with Codex, then pixelized with `art/pixelize.py`; the city is drawn by `art/render.py`

Requires Herdr GUI (checked on 0.1.11 on macOS and 0.1.15 on Windows). Code: MIT License. Font: OFL 1.1.
