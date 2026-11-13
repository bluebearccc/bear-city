#!/bin/sh
# Install the kaiju layout into the Herdr GUI config folder (overwrites only this layout's own files)
set -e
cd "$(dirname "$0")"
H="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$H/layouts" "$H/themes" "$H/mods/kaiju"
cp layouts/kaiju.json layouts/kaiju.svg "$H/layouts/"
cp themes/kaiju.json themes/kaiju-night.json "$H/themes/"
rsync -a --delete --exclude jsconfig.json --exclude '*.d.ts' mods/kaiju/ "$H/mods/kaiju/"

# Merge the layout's key bindings; if a key is already bound to something else, ask (default: keep it)
python3 -I - "$H/keys.json" mods/kaiju/keys.json <<'EOF'
import json, os, shutil, sys, time
dst, src = sys.argv[1], sys.argv[2]
mine = json.load(open(src))
cur = json.load(open(dst)) if os.path.exists(dst) else {}
changed = False
for section, binds in mine.items():
    sec = cur.setdefault(section, {})
    for key, action in binds.items():
        if sec.get(key) == action:
            continue
        if key in sec:
            print(f"[{section}] {key} is bound to {sec[key]}, change it to {action}? [y/N] ", end="", flush=True)
            try:
                reply = open("/dev/tty").readline().strip().lower()
            except OSError:
                reply = ""
            if reply != "y":
                print("keeping the existing binding")
                continue
        sec[key] = action
        changed = True
if changed:
    if os.path.exists(dst):
        shutil.copy(dst, f"{dst}.bak-{time.strftime('%Y%m%d%H%M%S')}")
    json.dump(cur, open(dst, "w"), indent=2, ensure_ascii=False)
    print("merged kaiju keys into keys.json")
EOF
echo "installed to $H"
