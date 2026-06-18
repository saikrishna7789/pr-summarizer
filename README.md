# PR Summarizer — Chrome Extension

AI-powered PR summaries, injected directly into GitHub and GitLab.

## What it does

Opens a panel on any GitHub PR or GitLab MR page showing:

- **Purpose** — what the PR accomplishes
- **Files changed** — count from the page
- **Risk** — Low / Medium / High with a reason
- **Summary** — 2–3 sentence technical overview
- **Review focus** — specific things to pay attention to

Powered by Gemini / Google Generative Language API. Your API key is stored locally in Chrome — nothing is sent anywhere except Google's API.

---

## Install (Developer Mode)

1. **Download / clone** this folder to your computer.

2. Open Chrome and go to `chrome://extensions`

3. Enable **Developer mode** (toggle, top right).

4. Click **Load unpacked** → select the `pr-summarizer` folder.

5. The extension icon (◆) appears in your toolbar.

6. Click the icon → enter your **Google API key** (enable the Generative Language API in your Google Cloud project)
  - Create an API key in the Google Cloud Console and enable the Generative Language API for your project.
  - If you have access to Google Gemini models, set `gemini-1.0` as the model in `src/content.js`.

7. Navigate to any GitHub PR (`/pull/N`) or GitLab MR (`/merge_requests/N`).

8. The **AI PR Summary** panel appears below the PR header. Click **Generate Summary**.

---

## File structure

```
pr-summarizer/
├── manifest.json          # Extension config (MV3)
├── icons/                 # Extension icons (add your own PNGs)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── content.js         # Injected into PR pages — extracts data, calls API, renders panel
    ├── panel.css          # Panel styles injected alongside content.js
    ├── popup.html         # Toolbar popup UI
    └── popup.js           # Popup logic (save/load API key)
```

---

## Icons

The `icons/` folder needs PNG files at 16×16, 48×48, and 128×128 px.

Quick option — generate placeholders with ImageMagick:
```bash
for size in 16 48 128; do
  convert -size ${size}x${size} xc:#6e40c9 icons/icon${size}.png
done
```

Or drop in any square PNG and rename it.

---

## Tips

- **Diff not loading?** Click the **Files changed** tab on the PR first so the diff renders in the DOM, then click Regenerate.
- The extension reads up to ~200 diff lines and 1 000 chars of description to keep API costs low.
-- Summaries are not cached — each Generate / Regenerate costs one API call.

---

## Extending

| Want to… | Where to look |
|---|---|
| Change the AI model | `content.js` → `generateSummary()` → `modelName` variable |
| Adjust diff depth | `content.js` → `extractGitHub/GitLabData()` → `.slice(0, 200)` |
| Restyle the panel | `src/panel.css` |
| Add more summary fields | Update the JSON prompt in `generateSummary()` and the `getPanelHTML("result")` template |
