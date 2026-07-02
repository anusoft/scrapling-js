#!/usr/bin/env bash
set -euo pipefail

project_dir="${SCRAPLING_JS_PROJECT_DIR:-$PWD}"
package_spec="${SCRAPLING_JS_PACKAGE:-github:anusoft/scrapling-js}"
mode="${SCRAPLING_JS_INSTALL_MODE:-auto}"
build_dev=1

usage() {
  cat <<'USAGE'
Usage: install.sh [--runtime|--dev] [--project-dir DIR] [--package SPEC] [--no-build]

Install scrapling-js for generated crawling scripts:
  curl -fsSL https://raw.githubusercontent.com/anusoft/scrapling-js/main/install.sh | bash

Modes:
  --runtime        Initialize DIR as a Bun project if needed, then bun add scrapling-js from GitHub.
  --dev            Install this repository's dependencies, then build dist/.
  auto             Default. Uses --dev inside the scrapling-js repo, otherwise --runtime.

Environment:
  SCRAPLING_JS_PROJECT_DIR=/path/to/script-dir
  SCRAPLING_JS_PACKAGE=github:anusoft/scrapling-js
  SCRAPLING_JS_INSTALL_MODE=runtime|dev|auto
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir)
      project_dir="$2"
      shift 2
      ;;
    --package)
      package_spec="$2"
      shift 2
      ;;
    --runtime)
      mode="runtime"
      shift
      ;;
    --dev)
      mode="dev"
      shift
      ;;
    --no-build)
      build_dev=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    return
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "install.sh needs Bun, or curl to install Bun from https://bun.sh/install." >&2
    exit 1
  fi
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    echo "Bun installation finished, but bun is not on PATH." >&2
    exit 1
  fi
}

is_scrapling_repo() {
  [[ -f "$project_dir/package.json" ]] && grep -q '"name"[[:space:]]*:[[:space:]]*"scrapling-js"' "$project_dir/package.json"
}

ensure_bun

if [[ "$mode" == "auto" ]]; then
  if is_scrapling_repo; then
    mode="dev"
  else
    mode="runtime"
  fi
fi

case "$mode" in
  dev)
    cd "$project_dir"
    bun install
    if [[ "$build_dev" == "1" ]]; then
      bun run build
    fi
    ;;
  runtime)
    mkdir -p "$project_dir"
    cd "$project_dir"
    if [[ ! -f package.json ]]; then
      bun init --yes >/dev/null
    fi
    bun add "$package_spec"
    ;;
  *)
    echo "unknown install mode: $mode" >&2
    exit 1
    ;;
esac

echo "scrapling-js install complete ($mode)."
