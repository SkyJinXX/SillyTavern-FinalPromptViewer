# SillyTavern Final Prompt Viewer（最终提示词查看器）

A SillyTavern extension that intercepts the actual `fetch` request sent to the AI backend, capturing the **fully rendered final prompt** — including all worldbook injections, EJS template outputs, and any other pre-processing.

## Why this extension?

SillyTavern's built-in prompt viewer (and the one in [JS-Slash-Runner](https://github.com/N0VI028/JS-Slash-Runner) / 酒馆助手) shows the prompt **before** EJS rendering and worldbook injection are complete. If you use heavy frontend extensions like [Evolution World Assistant](https://github.com/Youzini-afk/tavern_helper_template) that dynamically write worldbook entries via `getwi()` right before generation, those entries will be **invisible** in the standard viewers.

This extension solves that by intercepting `window.fetch` at the very last moment — after all processing is done — and displaying the exact `messages` array that gets sent to the AI.

## Features

- **Intercepts the real fetch** — captures the final `messages[]` payload sent to `/api/backends/chat-completions/generate`
- **Per-message token estimation** — local CJK-aware estimator, no API calls needed
- **Search with in-message navigation** — ▲▼ buttons to jump between matches; scrollbar minimap shows match positions at a glance
- **Role-colored messages** — system (purple) / user (green) / assistant (blue)
- **Freeze while viewing** — panel open → new requests buffer as "pending" so your current view isn't disrupted; load new data on demand
- **Magic wand menu entry** — accessible from ST's wand (✨) toolbar menu
- **Draggable floating button** — position is saved across page reloads
- **Extension settings** — toggle the floating button on/off from the Extensions panel

## Installation

In SillyTavern, go to **Extensions → Install extension** and paste:

```
https://github.com/SkyJinXX/SillyTavern-FinalPromptViewer
```

Or clone manually into your `public/scripts/extensions/third-party/` folder:

```bash
cd public/scripts/extensions/third-party/
git clone https://github.com/SkyJinXX/SillyTavern-FinalPromptViewer final-prompt-viewer
```

Then reload SillyTavern.

## Usage

1. Send a message to trigger AI generation
2. Click the **📋** button (bottom-right) or use **✨ → 最终提示词查看器** from the wand menu
3. Click any message row to expand it; use the search box to find specific content
4. Use **▲ ▼** arrows or the right-side minimap ticks to jump between matches

## Compatibility

- Tested with SillyTavern `1.12+`
- Works alongside JS-Slash-Runner / 酒馆助手
- Works with EJS-based extensions (ST-Prompt-Template, Evolution World Assistant, etc.)

## License

MIT
