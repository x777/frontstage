# Frontstage

**The AI-native video editor. Free, open source, cross-platform.**

Edit on a real multi-track timeline (ripple, razor, linked audio), grade with
scopes and curves, generate video/image/audio with your own fal.ai key, and let
the agent edit for you with your own OpenRouter key. Transcription and visual
search run free, on-device. No account required for editing. No telemetry.

## Run it

- **Web**: https://frontstage.studio (editing works without any keys)
- **Windows**: installer coming with the first release — for now, build from source
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
