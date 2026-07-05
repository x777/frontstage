# Frontstage

[![Release](https://img.shields.io/github/v/release/x777/frontstage)](https://github.com/x777/frontstage/releases/latest)
[![CI](https://github.com/x777/frontstage/actions/workflows/ci.yml/badge.svg)](https://github.com/x777/frontstage/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/ko--fi-support-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/frontstage)

**The AI-native video editor. Free, open source, cross-platform.**

Edit on a real multi-track timeline (ripple, razor, linked audio), grade with
scopes and curves, generate video/image/audio with your own fal.ai key, and let
the agent edit for you with your own OpenRouter key. Transcription and visual
search run free, on-device. No account required for editing. No telemetry.

## Run it

- **Web**: https://frontstage.studio (editing works without any keys)
- **Windows**: [Download the latest installer](https://github.com/x777/frontstage/releases/latest)
  (unsigned — SmartScreen will warn; choose "More info → Run anyway")
- **macOS**: experimental unsigned dmg on the [Releases page](https://github.com/x777/frontstage/releases/latest)
  (untested on hardware — reports welcome)
- **Build from source**:

    pnpm install
    pnpm -F @frontstage/desktop dev     # desktop app
    pnpm -F @frontstage/web dev         # web app

Requires Node 18+ and pnpm 10. macOS/Linux builds are untested (experimental).

## AI features — your keys

Generation uses [fal.ai](https://fal.ai) (bring your own key), the agent uses
[OpenRouter](https://openrouter.ai) (bring your own key). Keys stay on your
machine (desktop keychain / browser storage) — never on our servers.

## License & provenance

GPL-3.0. Frontstage is a cross-platform port of
[Palmier Pro](https://github.com/palmier-io/palmier-pro) (GPL-3.0) — see NOTICE.

## Support the project

See [DONATE.md](DONATE.md) — Ko-fi and crypto.
