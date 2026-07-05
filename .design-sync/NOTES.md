# design-sync notes — @palmier/ui (Frontstage Design System)

- No dist/build script: the package is source-exported (`main: ./src/index.ts`). Converter runs with `--entry packages/ui/src/primitives/index.ts` (the primitives barrel — the deliberate DS scope; the full package barrel exports app panels that need stores/engines).
- Discovery still scans the whole package's PascalCase exports (56) — the 44 non-primitive app surfaces are excluded via `componentSrcMap: null` entries in config. A new primitive needs no config change; a new app-panel export will appear in discovery and must be added to the null list.
- Run everything from `cross-platform/` with `--node-modules packages/ui/node_modules` (pnpm keeps react/react-dom resolvable there).
- Render check: playwright must be importable from `.ds-sync/` — `(cd .ds-sync && npm i playwright@<version matching the ms-playwright chromium cache>)`. Repo currently resolves playwright-core 1.61.0 ↔ cache chromium-1228.
- Dark-first DS: every authored preview wraps cells in `background: var(--bg-base)` — without it components render light-on-white and look broken. The conventions header teaches the design agent the same rule.
- `Select` shows its placeholder option only when `value === null` (NOT `undefined`) — cost one verify cycle.
- `Dialog`/`Toast` are fixed-position overlays → `cfg.overrides` pins them to `cardMode: single` viewports (520x360 / 460x160).
- System-font DS: no @font-face anywhere, `[FONT_MISSING]` never fires. Amber/blue tint on tiny glyph text in review sheets is subpixel-AA screenshot artifact, not a styling bug (live app verified).
- Known render warns: none recorded (12/12 clean, 0 bad/thin/identical on the final run).

## Re-sync risks

- The M18 rebrand (planned: `@palmier/ui` → `@frontstage/ui`, repo extraction to x777/frontstage) will change `pkg`, import specifiers in `previews/*.tsx`, and possibly paths — the next sync after the rebrand must update `cfg.pkg` + preview imports together, and this dir moves to the new repo root (paths in NOTES stay relative to the monorepo root = new repo root, minus the `cross-platform/` prefix; `--entry` becomes `packages/ui/src/primitives/index.ts` unchanged).
- Preview realism references app copy ("Veo 3.1 Fast", "Sunset Cut v3") — cosmetic only, nothing breaks if models change.
- `tokensGlob`/`cssEntry` point at `src/theme/tokens.css`; if the theme file is ever split, update both.
- Verification anchor lives in the uploaded `_ds_sync.json`; grades in gitignored `.cache/` — a fresh clone re-verifies only what the anchor can't vouch for.
