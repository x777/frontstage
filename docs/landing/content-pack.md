# Landing page content pack

Everything to paste into the **Frontstage Design System** Claude Design
project to build frontstage.studio's landing page. Copy is final; layout and
visual treatment are the design session's job.

## Before you start

- **Design system:** use the synced **"Frontstage Design System"** Claude
  Design project — its tokens and components are mandatory. Don't invent new
  colors, spacing, or one-off components; if something's missing from that
  system, that's a design-system update, not a landing-page exception.
- **Dark-first.** Design for dark mode as the primary surface. If a light
  mode gets built later it's a secondary pass, not a parallel design.
- **Voice:** terse-technical. Short declarative sentences, lead with the verb
  or the noun that matters, no adjectives doing the work a fact should do.
  No "revolutionary," "seamless," "powerful," "unleash." If a sentence would
  read fine in a press release, cut it.
- **Platform note (don't add a third download button):** there is no macOS
  download. Downloads are Windows only, plus the web app. macOS users are the
  web editor's audience — don't add a "Download for Mac" CTA anywhere on this
  page.

## Assets

| Asset | Path | Size | Use |
|---|---|---|---|
| Logo banner | `docs/assets/banner.png` | 1200×300 | Source for the navbar logo mark. |
| Hero screenshot | `docs/assets/hero.png` | 1936×1048 | The packaged app mid-edit: project "Sunset Cut," an AI-generated clip selected on the timeline. Already captured — do not recapture or restage. |

## Section-by-section copy

### Navbar

Logo (from `banner.png`) on the left. Links: **Features** · **GitHub** · **Donate**.

- Features → scrolls to the feature-cards section on this page
- GitHub → `https://github.com/x777/frontstage`
- Donate → `https://ko-fi.com/frontstage`

### Hero

```
Title:     The AI-native video editor.
Subtitle:  Free. Open source. In your browser.

CTA 1 (primary):   Open Studio       -> https://frontstage.studio/studio
CTA 2 (secondary): Download for Windows -> https://github.com/x777/frontstage/releases/latest
```

### Product screenshot

Full-width (or near-full-width) placement of `docs/assets/hero.png` directly
under the hero. No caption required; if one is wanted, keep it factual:
"Editing 'Sunset Cut' — the palm tree clip was generated inside the editor."

### Feature cards (3, equal weight)

**AI generation**
Video, image, audio, and TTS via fal.ai — your key, your cost control.
Results land straight in the library.

**Real timeline editing**
Multi-track. Ripple and razor tools, linked audio, frame-accurate trims,
color grading built in.

**Agent**
A chat that edits your timeline — cuts, layout, color, captions — over the
same undo stack you use. Any model via OpenRouter, your key.

### On-device strip

A slim band under the feature cards, visually distinct from the BYO-key cards
above it (these don't need a key):

```
Transcription and visual search run free, on-device. No keys.
Point Claude at your project via MCP — 43 tools, edit it from outside.
```

### Trust block

```
Your keys, your data — keys live in your browser. Zero telemetry.
GPL-3.0, a port of Palmier Pro.
```

Link "Palmier Pro" → `https://github.com/palmier-io/palmier-pro`.
Link "GPL-3.0" → `LICENSE` (or the GitHub-rendered license file).

### Donate footer

Three links, no extra copy beyond labels:

- **Ko-fi** → `https://ko-fi.com/frontstage`
- **Crypto** → link to `DONATE.md` on GitHub (ETH/USDT/USDC, any EVM chain —
  address lives in that file)
- **GitHub** → `https://github.com/x777/frontstage`

## Link manifest (for the design session's reference)

| Label | Target |
|---|---|
| Open Studio | `https://frontstage.studio/studio` |
| Download for Windows | `https://github.com/x777/frontstage/releases/latest` |
| GitHub | `https://github.com/x777/frontstage` |
| Ko-fi | `https://ko-fi.com/frontstage` |
| Crypto | `https://github.com/x777/frontstage/blob/main/DONATE.md` |
| Palmier Pro | `https://github.com/palmier-io/palmier-pro` |
| License | `https://github.com/x777/frontstage/blob/main/LICENSE` |
