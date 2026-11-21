#!/usr/bin/env bash
# Installs the launcher + menu entry for the current user (no root needed).
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.local/bin ~/.local/share/applications
cat > ~/.local/bin/orrery <<SH
#!/usr/bin/env bash
cd "$REPO" && exec python3 -m orrery "\$@"
SH
chmod +x ~/.local/bin/orrery
install -m644 "$REPO/data/com.github.sarwaruddin.orrery.desktop" ~/.local/share/applications/
update-desktop-database ~/.local/share/applications 2>/dev/null || true
kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
echo "installed: ~/.local/bin/orrery + menu entry (Education/Science)"
