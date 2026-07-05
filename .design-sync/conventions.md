# Frontstage UI — conventions

**Dark-first system.** Every design paints its own page background with `var(--bg-base)` (near-black `rgb(10,10,10)`); all components assume a dark surround and render light text. A design on a white page will look broken — always start from:

```jsx
<div style={{ background: "var(--bg-base)", color: "var(--text-primary)", minHeight: "100vh" }}>
  …
</div>
```

**No CSS classes.** This system styles exclusively with inline `style` objects referencing CSS custom properties from `styles.css`. Never invent class names. The token vocabulary (all defined in `styles.css`):

- Backgrounds: `--bg-base` `--bg-surface` `--bg-raised` `--bg-prominent` (ascending elevation)
- Text: `--text-primary` `--text-secondary` `--text-tertiary` `--text-muted`
- Accents: `--accent-primary` (warm cream — the ONLY brand accent; text on it must be dark `rgb(10,10,10)` = `--color-text-on-accent`), `--accent-timecode` (amber, timecodes/monospace readouts only)
- Status: `--status-error` `--status-success`
- Borders: `--border-primary` `--border-subtle` `--border-divider`; widths `--border-width-hairline|thin|medium|thick`
- Radii: `--radius-xs|xs-sm|sm|md|md-lg|lg|xl` and `--radius-pill` (999px capsules)
- Spacing: `--spacing-xxs|xs|sm|sm-md|md|md-lg|lg|lg-xl|xl|xl-xxl|xxl` (2–28px)
- Fonts: sizes `--font-micro|xxs|xs|sm|sm-md|md|md-lg|lg|xl|title1|title2|display`; weights `--font-weight-light|regular|medium|semibold|bold`. System font stack only — no webfonts. Monospace (`ui-monospace`) for timecodes with `fontVariantNumeric: "tabular-nums"`.
- Section headers idiom: `--font-xxs` + semibold + `letterSpacing: var(--letter-spacing-wide)` + `--text-muted` + uppercase.

**Components need no provider** — import and use directly; they are self-contained. Gotchas:
- `Select`: pass `value={null}` (not `undefined`) to show the `placeholder` option.
- `Toast` positions itself `fixed` at the viewport bottom-center; `Dialog` overlays the whole viewport with its own scrim.
- `Button` is a CAPSULE by default; `shape="rect"` only for full-width CTAs. `variant="accent"` = cream with dark text; `gradient="ai"` only for AI-agent actions.
- `TextInput`/`SearchField`/`Checkbox` are controlled (`value`+`onChange`).

**Truth lives in** `styles.css` (every token above) and each `components/general/<Name>/<Name>.d.ts` + `.prompt.md` — read them before styling.

**Idiomatic composition:**

```jsx
import { Button, PanelHeader, SearchField, MenuList } from window.FrontstageUI;

<div style={{ background: "var(--bg-base)", padding: "var(--spacing-lg)" }}>
  <PanelHeader title="Media" />
  <div style={{ display: "flex", gap: "var(--spacing-sm)", padding: "var(--spacing-md) 0" }}>
    <SearchField value="" onChange={() => {}} placeholder="Search" />
    <Button variant="accent">Generate</Button>
  </div>
</div>
```

**Copy voice:** terse and technical, like a native pro tool — lead with the verb ("Export Video", "Add your fal.ai key"), never marketing fluff.
