# Contributing to Frontstage

## Dev setup

    pnpm install
    pnpm turbo run test typecheck

The GPU harness (`@frontstage/engine-harness`) needs a real GPU and does not
run in CI: `pnpm -F @frontstage/engine-harness e2e` (headed).

## PR expectations

- `pnpm turbo run test typecheck` green before you open a PR.
- No hardcoded styling — use the design tokens (`@frontstage/ui` theme), never
  raw numeric spacing/color/font values.
- Keep comments minimal: only when the *why* is non-obvious, never narrating
  the diff.

## Provenance

Frontstage is a cross-platform TypeScript port of the upstream Swift
[Palmier Pro](https://github.com/palmier-io/palmier-pro). Porting work happens
in a separate tree and is synced into this repo — if you're fixing a bug that
also exists upstream, mention it in your PR so it can be ported back.
