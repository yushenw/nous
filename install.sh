#!/usr/bin/env bash
# Nous installer
# Usage: curl -fsSL https://raw.githubusercontent.com/yushenw/nous/main/install.sh | sh

set -e

REPO="yushenw/nous"
DATA_DIR="${NOUS_DATA_DIR:-$HOME/.nous}"
SETTINGS="$HOME/.claude/settings.json"

# ── colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BOLD}[nous]${NC} $*"; }
success() { echo -e "${GREEN}[nous]${NC} $*"; }
warn()    { echo -e "${YELLOW}[nous]${NC} $*"; }
die()     { echo -e "${RED}[nous] error:${NC} $*" >&2; exit 1; }

# ── prerequisites ──────────────────────────────────────────────────────────────
check_node() {
  command -v node >/dev/null 2>&1 || die "Node.js not found. Install from https://nodejs.org (>= 18 required)"
  node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null || \
    die "Node.js >= 18 required. Current: $(node --version)"
}

check_claude() {
  [ -d "$HOME/.claude" ] || die "Claude Code not found. Install from https://claude.ai/download"
}

# ── download latest release ────────────────────────────────────────────────────
download_scripts() {
  info "Fetching latest release..."

  # Resolve latest release tag via GitHub API
  local api_url="https://api.github.com/repos/${REPO}/releases/latest"
  local tag

  if command -v curl >/dev/null 2>&1; then
    tag=$(curl -fsSL "$api_url" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  elif command -v wget >/dev/null 2>&1; then
    tag=$(wget -qO- "$api_url" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  else
    die "curl or wget is required"
  fi

  [ -n "$tag" ] || die "Could not determine latest release. Check https://github.com/${REPO}/releases"

  local url="https://github.com/${REPO}/releases/download/${tag}/scripts.tar.gz"
  local tmp
  tmp=$(mktemp -d)

  info "Downloading $tag..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp/scripts.tar.gz"
  else
    wget -qO "$tmp/scripts.tar.gz" "$url"
  fi

  mkdir -p "$DATA_DIR/scripts"
  tar -xzf "$tmp/scripts.tar.gz" -C "$DATA_DIR/scripts" --strip-components=1
  rm -rf "$tmp"
  success "Scripts installed to $DATA_DIR/scripts/"
}

# ── install native dependency ──────────────────────────────────────────────────
install_deps() {
  if [ -d "$DATA_DIR/node_modules/better-sqlite3" ]; then
    info "better-sqlite3 already installed, skipping"
    return
  fi
  info "Installing better-sqlite3 (native dependency)..."
  [ -f "$DATA_DIR/package.json" ] || echo '{"name":"nous-runtime","private":true}' > "$DATA_DIR/package.json"
  npm install better-sqlite3 --prefix "$DATA_DIR" --save --no-audit --no-fund --silent
  success "Dependencies installed"
}

# ── patch ~/.claude/settings.json ─────────────────────────────────────────────
patch_settings() {
  mkdir -p "$HOME/.claude"

  # Write existing settings to a temp file to avoid shell quoting issues with JSON
  local tmp_settings
  tmp_settings=$(mktemp)
  if [ -f "$SETTINGS" ]; then
    cp "$SETTINGS" "$tmp_settings"
  else
    echo '{}' > "$tmp_settings"
  fi

  # Use node to safely merge hooks into existing settings (preserves all other keys)
  node - "$SETTINGS" "$tmp_settings" <<'EOF'
const fs = require('fs');
const outPath = process.argv[1];
const tmpPath = process.argv[2];
const existing = JSON.parse(fs.readFileSync(tmpPath, 'utf8') || '{}');

const hooks = {
  SessionStart:     [{ matcher: '', hooks: [{ type: 'command', command: 'node ~/.nous/scripts/session-start.cjs' }] }],
  UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'node ~/.nous/scripts/user-prompt-submit.cjs' }] }],
  PostToolUse:      [{ matcher: '', hooks: [{ type: 'command', command: 'node ~/.nous/scripts/post-tool-use.cjs' }] }],
  Stop:             [{ matcher: '', hooks: [{ type: 'command', command: 'node ~/.nous/scripts/session-end.cjs' }] }],
  SessionEnd:       [{ matcher: '', hooks: [{ type: 'command', command: 'node ~/.nous/scripts/session-end.cjs' }] }],
};

// Merge: for each event, append nous hook only if not already present
const merged = { ...existing, hooks: { ...existing.hooks } };
for (const [event, entries] of Object.entries(hooks)) {
  const current = merged.hooks[event] ?? [];
  const cmd = entries[0].hooks[0].command;
  const alreadyInstalled = current.some(e => e.hooks?.some(h => h.command === cmd));
  if (!alreadyInstalled) {
    merged.hooks[event] = [...current, ...entries];
  }
}

fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
EOF

  rm -f "$tmp_settings"
  success "Hooks registered in $SETTINGS"
}

# ── main ───────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}Installing Nous — AI user perception for Claude Code${NC}"
  echo ""

  check_node
  check_claude
  download_scripts
  install_deps
  patch_settings

  echo ""
  echo -e "${GREEN}${BOLD}Installation complete.${NC}"
  echo ""
  echo "  Worker starts automatically when you open Claude Code."
  echo "  No further setup needed — just use Claude Code normally."
  echo ""
  echo "  Data directory : $DATA_DIR"
  echo "  Worker log     : $DATA_DIR/worker.log"
  echo ""
  echo -e "  To uninstall   : ${BOLD}nous-uninstall${NC}  (or delete $DATA_DIR and remove hooks from $SETTINGS)"
  echo ""
}

main
