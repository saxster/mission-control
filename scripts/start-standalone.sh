#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STANDALONE_DIR="$PROJECT_ROOT/.next/standalone"
STANDALONE_NEXT_DIR="$STANDALONE_DIR/.next"
STANDALONE_STATIC_DIR="$STANDALONE_NEXT_DIR/static"
SOURCE_STATIC_DIR="$PROJECT_ROOT/.next/static"
SOURCE_PUBLIC_DIR="$PROJECT_ROOT/public"
STANDALONE_PUBLIC_DIR="$STANDALONE_DIR/public"
STANDALONE_SERVER="$STANDALONE_DIR/server.js"

if [[ ! -f "$STANDALONE_SERVER" ]]; then
  NESTED_STANDALONE_SERVER="$STANDALONE_DIR/${PROJECT_ROOT#/}/server.js"
  if [[ -f "$NESTED_STANDALONE_SERVER" ]]; then
    STANDALONE_SERVER="$NESTED_STANDALONE_SERVER"
    STANDALONE_DIR="$(dirname "$STANDALONE_SERVER")"
    STANDALONE_NEXT_DIR="$STANDALONE_DIR/.next"
    STANDALONE_STATIC_DIR="$STANDALONE_NEXT_DIR/static"
    STANDALONE_PUBLIC_DIR="$STANDALONE_DIR/public"
  fi
fi

if [[ ! -f "$STANDALONE_SERVER" ]]; then
  echo "error: standalone server missing at $PROJECT_ROOT/.next/standalone/server.js" >&2
  echo "run 'pnpm build' first" >&2
  exit 1
fi

mkdir -p "$STANDALONE_NEXT_DIR"

if [[ -d "$SOURCE_STATIC_DIR" ]]; then
  rm -rf "$STANDALONE_STATIC_DIR"
  cp -R "$SOURCE_STATIC_DIR" "$STANDALONE_STATIC_DIR"
fi

if [[ -d "$SOURCE_PUBLIC_DIR" ]]; then
  rm -rf "$STANDALONE_PUBLIC_DIR"
  cp -R "$SOURCE_PUBLIC_DIR" "$STANDALONE_PUBLIC_DIR"
fi

cd "$STANDALONE_DIR"
# Next.js standalone server reads HOSTNAME to decide bind address.
# Default to 0.0.0.0 so the server is accessible from outside the host.
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
exec node "$STANDALONE_SERVER"
