#!/usr/bin/env bash
# Provision REA (Reverse Engineer Anything, github.com/morluto/rea) and its
# Linux analysis providers, then register REA as an MCP server for Claude Code.
#
# Intended as a Claude Code cloud-environment setup script (runs as root on
# Ubuntu 24.04 x64). Idempotent: completed steps are skipped on re-run.
#
# Usage: bash scripts/setup-rea.sh
set -euo pipefail

TOOLS_DIR="${REA_TOOLS_DIR:-/opt/rea-tools}"
REA_DIR="${REA_DIR:-$TOOLS_DIR/rea}"
REA_REF="${REA_REF:-main}"

NODE_VERSION=24.22.1
NPM_VERSION=11.16.0
GHIDRA_URL=https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip
GHIDRA_SHA256=ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db
GHIDRA_DIR="$TOOLS_DIR/ghidra_12.1.4_PUBLIC"
JADX_URL=https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar
JADX_SHA256=6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75
JADX_JAR="$TOOLS_DIR/jadx-headless-mcp-0.7.1-all.jar"
RIZIN_URL=https://github.com/rizinorg/rizin/releases/download/v0.7.4/rizin-v0.7.4-static-x86_64.tar.xz

log() { printf '\n==> %s\n' "$*"; }

mkdir -p "$TOOLS_DIR"
export PATH="/usr/local/bin:$TOOLS_DIR/rizin/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

# 1. System packages
log "apt packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  procps util-linux binutils gdb tshark sigrok-cli apktool \
  openjdk-21-jdk-headless unzip xz-utils curl git ca-certificates >/dev/null

# 2. Node.js + npm, pinned by REA's .nvmrc / packageManager
if [ "$(/usr/local/bin/node -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  log "Node.js $NODE_VERSION"
  tmp="$(mktemp -d)"
  tarball="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL --retry 3 -o "$tmp/$tarball" "https://nodejs.org/dist/v$NODE_VERSION/$tarball"
  (cd "$tmp" && curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep " $tarball\$" | sha256sum -c -)
  tar -xJf "$tmp/$tarball" -C "$tmp"
  cp -r "$tmp/node-v$NODE_VERSION-linux-x64/"{bin,include,lib,share} /usr/local/
  rm -rf "$tmp"
fi
if [ "$(/usr/local/bin/npm -v)" != "$NPM_VERSION" ]; then
  log "npm $NPM_VERSION"
  /usr/local/bin/npm install -g --prefix /usr/local "npm@$NPM_VERSION" >/dev/null
fi

# 3. REA source, dependencies and build
if [ ! -d "$REA_DIR/.git" ]; then
  log "clone morluto/rea"
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --branch "$REA_REF" https://github.com/morluto/rea "$REA_DIR"
else
  log "update morluto/rea to $REA_REF"
  git -C "$REA_DIR" fetch -q --depth 1 origin "$REA_REF"
  git -C "$REA_DIR" reset -q --hard FETCH_HEAD
fi
log "build REA"
(
  cd "$REA_DIR"
  git submodule update --init --depth 1
  npm ci --no-audit --no-fund
  npm run build:cached
)

# 4. Ghidra (bring-your-own provider; REA accepts 12.1.x with JDK 21+)
if [ ! -x "$GHIDRA_DIR/support/analyzeHeadless" ]; then
  log "Ghidra 12.1.4"
  curl -fsSL --retry 3 -o "$TOOLS_DIR/ghidra.zip" "$GHIDRA_URL"
  echo "$GHIDRA_SHA256  $TOOLS_DIR/ghidra.zip" | sha256sum -c -
  unzip -q "$TOOLS_DIR/ghidra.zip" -d "$TOOLS_DIR"
  rm "$TOOLS_DIR/ghidra.zip"
fi

# 5. Headless JADX (Android)
if ! echo "$JADX_SHA256  $JADX_JAR" | sha256sum -c - >/dev/null 2>&1; then
  log "JADX headless 0.7.1"
  curl -fsSL --retry 3 -o "$JADX_JAR" "$JADX_URL"
  echo "$JADX_SHA256  $JADX_JAR" | sha256sum -c -
fi

# 6. Rizin 0.7.4 (static build)
if [ ! -x "$TOOLS_DIR/rizin/bin/rizin" ]; then
  log "Rizin 0.7.4"
  mkdir -p "$TOOLS_DIR/rizin"
  curl -fsSL --retry 3 "$RIZIN_URL" | tar -xJ -C "$TOOLS_DIR/rizin"
fi

# 7. Binwalk 3.1.x (Rust; the apt package is the unsupported 2.x line)
if ! binwalk --version 2>/dev/null | grep -q '^binwalk 3\.1\.'; then
  log "Binwalk 3.1"
  command -v cargo >/dev/null || { curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal; }
  cargo install binwalk --version '~3.1' --locked
fi

# 8. Python tools: unblob, mitmproxy, pwntools
command -v uv >/dev/null || python3 -m pip install --user -q uv
uv tool list 2>/dev/null | grep -q '^unblob v26\.6\.4' || { log "unblob 26.6.4"; uv tool install --force unblob==26.6.4; }
uv tool list 2>/dev/null | grep -q '^mitmproxy v12\.2\.3' || { log "mitmproxy 12.2.3"; uv tool install --force mitmproxy==12.2.3; }
if ! "$TOOLS_DIR/pwn-venv/bin/python" -c 'import pwn' 2>/dev/null; then
  log "pwntools 4.15.0"
  uv venv -q --allow-existing "$TOOLS_DIR/pwn-venv"
  uv pip install -q --python "$TOOLS_DIR/pwn-venv/bin/python" pwntools==4.15.0
fi

# 9. Provider environment (setup reads it and stores it in the MCP registration)
cat > "$TOOLS_DIR/rea.env" <<EOF
# REA toolchain. Source before using the rea CLI: . $TOOLS_DIR/rea.env
export PATH="/usr/local/bin:$TOOLS_DIR/rizin/bin:$HOME/.cargo/bin:$HOME/.local/bin:\$PATH"
export GHIDRA_INSTALL_DIR=$GHIDRA_DIR
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export REA_JADX_MCP_JAR=$JADX_JAR
export REA_RIZIN_COMMAND=$TOOLS_DIR/rizin/bin/rizin
export REA_BINWALK_COMMAND=$HOME/.cargo/bin/binwalk
export REA_UNBLOB_COMMAND=$HOME/.local/bin/unblob
export REA_MITMDUMP_COMMAND=$HOME/.local/bin/mitmdump
export REA_PWNTOOLS_PYTHON=$TOOLS_DIR/pwn-venv/bin/python
export REA_APKTOOL_COMMAND=/usr/bin/apktool
EOF
# shellcheck source=/dev/null
. "$TOOLS_DIR/rea.env"

# 10. Register the REA MCP server and skill with Claude Code
log "register REA with Claude Code"
node "$REA_DIR/scripts/rea.mjs" setup --client claude_code --yes >/dev/null
node "$REA_DIR/scripts/rea.mjs" doctor | grep -E '^ *(healthy|environment_healthy):'

log "REA ready. MCP server 'rea' registered; CLI env: . $TOOLS_DIR/rea.env"
