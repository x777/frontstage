# MCP server

The desktop app ships a local MCP server: point Claude (or any MCP client) at
a running Frontstage project and it can inspect and edit the timeline
directly — same undo stack as the UI and the in-app agent. Desktop only; the
web app doesn't expose this.

## Enable it

**Settings → Agent → MCP Server.** Check the box. The panel then shows the
server's URL and bearer token, plus **Copy** and **Regenerate** buttons.

- **URL:** `http://127.0.0.1:19789/mcp` — bound to `127.0.0.1` only, never
  `0.0.0.0`. Port is fixed at `19789` unless you set the `MCP_PORT` environment
  variable before launching the app.
- **Token:** a 32-byte random hex string, generated once and persisted to a
  `mcp-token` file in the app's user-data directory (mode `0600`). **Regenerate**
  issues a new token and restarts the listener; the old token stops working
  immediately.

## Auth

Every request must pass three checks, in order:

1. `Host` header resolves to `127.0.0.1` / `localhost` / `[::1]` — else `403`.
2. `Origin` header, if the client sends one, must also be localhost — else `403`.
   (Non-browser clients that send no `Origin` skip this check; the token is
   the real gate for them.)
3. `Authorization: Bearer <token>` matches, compared with a timing-safe
   comparison — else `401`.

There's no way to expose this server beyond your own machine; it isn't meant
to be.

## `frontstage://` resources

| URI | Name | Contents |
|---|---|---|
| `frontstage://models` | Models | Available AI models (JSON) |
| `frontstage://timeline` | Timeline | The current project's timeline (JSON) |

## Tools

43 tools, generated at build time from `packages/ai/src/tools/catalog.ts`'s
`buildCatalog("mcp")` — the same 40 tools the in-app agent has, minus `read_skill`
(in-app-agent only), plus three project-navigation tools that only make sense
from outside the running window (`get_projects`, `open_project`, `new_project`).

### Read

| Tool | Description |
|---|---|
| `get_timeline` | Returns a JSON summary of the current timeline: fps, dimensions, tracks, and clips. |
| `get_media` | Returns the media manifest entries available in the project. |
| `inspect_media` | Returns full metadata for a single media entry by id. |
| `inspect_timeline` | See the composited timeline — what the user actually sees in the preview at a given frame: all video tracks stacked with their transforms, opacity, crop, and keyframes applied, plus text and caption overlays baked in. Use this to verify your edits landed (a PIP's position, a title's placement, layer order) — `inspect_media` shows the raw source asset, not the cut. Frames are project frames (from `get_timeline`). Pass a single `startFrame` for one composited frame; add `endFrame` to sample `maxFrames` evenly across `[startFrame, endFrame)` for a transition or sequence. Frames past content render black. Returns frames downscaled for token efficiency, with the frame numbers sampled. Rendering seeks the preview to render each frame — the visible playhead may move as a result. |
| `search_media` | Searches media manifest entries. `scope='visual'` matches by semantic similarity to the query over the indexed visual library (SigLIP embeddings of sampled frames), plus name matching (case-insensitive substring) which always runs over every entry regardless of visual-index status; if the visual model isn't downloaded yet, the first visual/both search asks for confirmation (`confirm: true`) before starting the one-time download. `scope='spoken'` matches cached transcript text (case/diacritic-insensitive, never transcribes); `scope='both'` (default) unions the two. |

### Clip mutation

| Tool | Description |
|---|---|
| `add_clips` | Adds one or more clips to the timeline. Each clip references a media entry by id. All clips are added as a single undo step. |
| `remove_clips` | Removes one or more clips from the timeline by id. All removals are one undo step. |
| `remove_tracks` | Removes one or more tracks from the timeline by id. All removals are one undo step. |
| `move_clips` | Moves one or more clips to new track/frame positions. All moves are one undo step. |
| `split_clip` | Splits a clip at the given frame, producing two clips. This is one undo step. |
| `split_clips` | Splits one or more clips, each at a given frame. Each split keeps the left half's id and creates a new right-half clip. All splits are a single undo step. |
| `trim_clips` | Trims one or more clips by adjusting their left or right edge by `deltaFrames`. All trims are one undo step. |
| `ripple_delete_ranges` | Ripple-deletes frame ranges on a track: cuts the ranges and shifts later clips (and non-ignored sync-locked tracks) left to close the gaps. Refuses if a sync-locked track would collide. |
| `insert_clips` | Ripple-inserts clips at a frame on a track: opens a gap (pushing later clips and sync-locked + linked-audio tracks right), then drops the clips in. Each references a media entry by id. `durationFrames` and `trimStartFrame`/`trimEndFrame` are optional and mutually constrained; omit all three to use the full source. Untrimmed source stays as headroom for later extension. |
| `apply_layout` | Arranges multiple clips into a common multi-video layout (split screen, picture-in-picture, grid) in one undoable action. Pick a named layout and assign a clip to each of its slots; the tool computes every transform and crop so each clip fills its region edge-to-edge (cover-crop) or letterboxes (`fit='fit'`). Give each slot either a `mediaRef` (creates a new stacked track with linked audio) or `clipIds` (re-layouts existing clips into that slot) — don't mix modes across slots. Layouts: `full`; `side_by_side`; `top_bottom`; `pip_bottom_right`/`pip_bottom_left`/`pip_top_right`/`pip_top_left`; `grid_2x2`; `main_sidebar`; `three_up`. |

### Property / keyframe / text

| Tool | Description |
|---|---|
| `set_clip_properties` | Sets one or more properties on a clip (opacity, volume, speed, transform, crop, textStyle). All property updates are a single undo step. |
| `set_keyframes` | Sets or removes keyframes on a clip's animation track. All keyframe changes are a single undo step. |
| `add_texts` | Adds one or more text clips to the timeline. All additions are a single undo step. |

### AI generation

| Tool | Description |
|---|---|
| `generate_image` | Generates image(s) from a text prompt using AI and adds them to the media library. With a fal.ai key configured, runs as an async background generation (call `list_models kind='image'` first): returns a placeholder asset id immediately, `numImages` (1–4) generates a batch, costs real money, not undoable. Without a key, falls back to a synchronous single-image generation. |
| `generate_video` | Starts an async AI video generation. Returns a placeholder asset id immediately; the asset becomes usable once ready. Costs real money and is not undoable. Call `list_models` first. |
| `generate_audio` | Starts an async AI audio generation: text-to-speech, text-to-music, or video-scored audio (matching a soundtrack to a timeline span or an existing video asset). Returns a placeholder asset id immediately. A timeline-span source auto-places the result on the timeline as one undo step; a media-ref source stays library-only (place it with `add_clips`). Call `list_models (kind='audio')` first. Costs real money and is not undoable. |
| `upscale_media` | Upscales an existing video or image asset to higher resolution using an AI upscaler. Returns a placeholder asset id immediately. Use `list_models (kind='upscale')` to pick a compatible model. Costs real money and is not undoable. |
| `list_models` | Call this before any `generate_*`/`upscale` call to discover models, capabilities, and costs. |

### Color / effects

| Tool | Description |
|---|---|
| `apply_color` | Sets the color grade on clips (exposure/contrast/temperature/etc., color wheels, curves, LUT). Rebuilds the `color.*` effect stack; non-color effects untouched. One undo step. |
| `apply_effect` | Adds/updates or removes non-color effects (blur, chroma key, vignette, grain, glow, etc.) on clips. Rejects `color.*` — use `apply_color`. One undo step. |
| `inspect_color` | Renders a timeline frame and reports color scopes (luma/RGB levels, saturation, warm/cool + green/magenta bias, histograms). Optionally compares to a reference frame with actionable gap hints. |

### Transcript

| Tool | Description |
|---|---|
| `get_transcript` | Returns the timeline's spoken-word transcript as project-frame words grouped by clip. Paged at 10,000 words; continue with `startFrame = nextStartFrame`. Read-only. |
| `remove_words` | Word-precise ripple cut: removes the given transcript words (`get_transcript` index, an inclusive `[start, end]` span, or exact-text matches) from the timeline and closes the gap. One undo step. |
| `add_captions` | Generates timed captions from the timeline's spoken-word transcript and places them as text clips on a new video track. Targets explicit clipIds, or auto-detects the dominant speech track. One undo step. |

### Media library

| Tool | Description |
|---|---|
| `list_folders` | Lists every folder in the media panel as `{id, name, parentFolderId}`. Folders are nested. Use to find an existing folder by name before generating new media. |
| `create_folder` | Creates folders in the media panel. One folder (`name`/`parentFolderId`) or several (`entries`) — not both. |
| `move_to_folder` | Moves media assets to folders. One destination (`assetIds`/`folderId`) or several (`entries`) — not both. Omit `folderId` to move to root. |
| `rename_media` | Renames media assets in the library. One asset (`mediaRef`/`name`) or several (`entries`) — not both. |
| `rename_folder` | Renames folders in the media panel. One folder (`folderId`/`name`) or several (`entries`) — not both. |
| `delete_media` | Deletes media assets from the library. Any clips referencing them are removed from the timeline in the same undoable action. |
| `delete_folder` | Deletes folders and everything inside them (subfolders and assets). Clips referencing any deleted asset are removed from the timeline in the same undoable action. |
| `import_media` | Imports external media into the project's library — the bridge for assets from other MCP servers (stock libraries, music services, web search) or local files. `source` sets exactly one of `url` (HTTPS, background download, max 5 GB), `path` (absolute local file or directory, desktop only, copied in the background — a directory imports recursively as folders), or `bytes` (base64 inline, ~15 MB max). Supported types: video (mp4, mov), audio (mp3, wav, aac, m4a, aiff, aifc, flac), image (png, jpg, jpeg, tiff, heic). Returns a placeholder asset id immediately; poll `get_media`. |
| `create_matte` | Creates a solid-color PNG matte in the media library. |

### Export

| Tool | Description |
|---|---|
| `export_project` | Exports the current project's timeline. `xml` writes XMEML (Premiere Pro); `fcpxml` writes FCPXML (DaVinci Resolve or Final Cut Pro — also carries text, transforms, crop, opacity, keyframes); `srt`/`vtt` write a subtitle file from the timeline's caption clips, or from a media's cached transcript via `captionsSource.mediaRef` (cache-only, never transcribes). `mode='video'` isn't available from the agent yet — use the File menu's Export command. Omit `outputPath` for a save dialog/picker. |

### Project settings

| Tool | Description |
|---|---|
| `set_project_settings` | Changes the project's frame rate, resolution, or aspect ratio. `aspectRatio` and explicit `width`+`height` are mutually exclusive. Existing clips are re-fitted automatically (transforms recompute, frame positions/durations rescale on an fps change). Undoable. |

### Project navigation (MCP-only)

These three don't exist in the in-app agent's tool set — they're for driving
the app from the outside, e.g. "open my other project and add captions to it."

| Tool | Description |
|---|---|
| `get_projects` | Lists known projects, most recently opened first, plus which one is active. Call before `open_project`, or to find out what's currently open. Takes no arguments. |
| `open_project` | Opens a project and makes it active — every editing tool then acts on it. Identify by `id` (from `get_projects`) or `path`. No-op if already active. Saves the current project first if it has unsaved changes. |
| `new_project` | Creates a new empty project in the user's Frontstage folder and makes it active. Fails if the name is already taken. Saves the current project first if it has unsaved changes. |

## Client config

**Claude Desktop / Claude Code**, editing the `mcpServers` config directly:

```json
{
  "mcpServers": {
    "frontstage": {
      "type": "http",
      "url": "http://127.0.0.1:19789/mcp",
      "headers": { "Authorization": "Bearer <token from Settings>" }
    }
  }
}
```

**Claude Code** also supports adding it as a one-liner instead of hand-editing
the config file:

```sh
claude mcp add --transport http frontstage http://127.0.0.1:19789/mcp \
  --header "Authorization: Bearer <token from Settings>"
```

If your Claude Desktop version doesn't accept a direct HTTP transport with
custom headers, bridge it through a local stdio wrapper instead
([`mcp-remote`](https://www.npmjs.com/package/mcp-remote)):

```json
{
  "mcpServers": {
    "frontstage": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://127.0.0.1:19789/mcp",
        "--header",
        "Authorization: Bearer <token from Settings>"
      ]
    }
  }
}
```

Then: *"split the interview at every silence and add captions"* — and watch
the timeline change.
