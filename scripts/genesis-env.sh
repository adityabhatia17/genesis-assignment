#!/usr/bin/env bash
# Project-only toolchain for Genesis. Does not change nvm default, PATH, or ~/.zshrc.
# Usage from repo root:  source scripts/genesis-env.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || return 1

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use --silent
fi

# Prefer a JDK dropped into this repo; otherwise a side-by-side 21 install.
# Never export a global default.
if [ -d "$ROOT/.tools/jdk-21/Contents/Home" ]; then
  export JAVA_HOME="$ROOT/.tools/jdk-21/Contents/Home"
elif [ -d "$ROOT/.tools/jdk-21" ] && [ -x "$ROOT/.tools/jdk-21/bin/java" ]; then
  export JAVA_HOME="$ROOT/.tools/jdk-21"
elif command -v /usr/libexec/java_home >/dev/null 2>&1; then
  _jh="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
  if [ -n "$_jh" ]; then
    export JAVA_HOME="$_jh"
  fi
fi

if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# firebase-tools comes from this repo once package.json exists (npx / node_modules/.bin).
if [ -d "$ROOT/node_modules/.bin" ]; then
  export PATH="$ROOT/node_modules/.bin:$PATH"
fi

echo "genesis env: node $(node -v 2>/dev/null || echo missing) · java $(java -version 2>&1 | head -1) · firebase $(firebase --version 2>/dev/null || echo 'npx later')"
