// PR Summarizer - Content Script
// Runs on GitHub PR and GitLab MR pages

(function () {
  "use strict";

  // ─── Platform Detection ──────────────────────────────────────────────────
  const isGitHub = location.hostname === "github.com";
  const isGitLab = location.hostname === "gitlab.com";

  // ─── PR Data Extraction ──────────────────────────────────────────────────
  function extractPRData() {
    if (isGitHub) return extractGitHubData();
    if (isGitLab) return extractGitLabData();
    return null;
  }

  function extractGitHubData() {
    const title =
      document.querySelector(".js-issue-title, h1.gh-header-title .markdown-title")?.textContent?.trim() ||
      document.querySelector('[data-testid="issue-title"]')?.textContent?.trim() ||
      document.querySelector("h1 bdi")?.textContent?.trim() ||
      "Unknown PR";

    const description =
      document.querySelector(".markdown-body.comment-body")?.textContent?.trim() ||
      document.querySelector('[data-testid="pr-description"]')?.textContent?.trim() ||
      "";

    // File diffs — grab the first ~150 lines to keep token count sane
    const diffElements = document.querySelectorAll(
      ".file-header [data-path], .file-info .Link--primary"
    );
    const changedFiles = [...diffElements].map((el) => el.textContent?.trim()).filter(Boolean);

    // Grab diff text (truncated)
    const diffLines = [...document.querySelectorAll(".blob-code-inner")]
      .slice(0, 200)
      .map((el) => el.textContent)
      .join("\n");

    const filesChanged =
      document.querySelector("#files_tab_counter, [data-tab-item='files-tab'] .Counter")
        ?.textContent?.trim() || changedFiles.length || "?";

    const additions =
      document.querySelector(".diffstat .color-fg-success")?.textContent?.trim() || "";
    const deletions =
      document.querySelector(".diffstat .color-fg-danger")?.textContent?.trim() || "";

    return {
      platform: "GitHub",
      title,
      description: description.slice(0, 1000),
      changedFiles,
      filesChanged,
      additions,
      deletions,
      diffSample: diffLines.slice(0, 3000),
    };
  }

  function extractGitLabData() {
    const title =
      document.querySelector(".title.gl-font-weight-bold, h1.title")?.textContent?.trim() ||
      document.querySelector('[data-testid="mr-title"]')?.textContent?.trim() ||
      "Unknown MR";

    const description =
      document.querySelector(".description .md")?.textContent?.trim() ||
      "";

    const changedFiles = [...document.querySelectorAll(".diff-file-changes .file-title-name, .file-title strong")]
      .map((el) => el.textContent?.trim())
      .filter(Boolean);

    const filesChanged =
      document.querySelector(".js-file-count, [data-testid='file-count']")?.textContent?.trim() ||
      changedFiles.length ||
      "?";

    const diffLines = [...document.querySelectorAll(".line_content")]
      .slice(0, 200)
      .map((el) => el.textContent)
      .join("\n");

    return {
      platform: "GitLab",
      title,
      description: description.slice(0, 1000),
      changedFiles,
      filesChanged,
      additions: "",
      deletions: "",
      diffSample: diffLines.slice(0, 3000),
    };
  }

  // ─── AI Summary ──────────────────────────────────────────────────────────
  // Build the prompt shared by all providers
  function buildPrompt(prData) {
    return `You are a senior code reviewer. Analyze this pull request and respond ONLY with a JSON object — no markdown, no explanation.

PR Title: ${prData.title}

Description:
${prData.description || "(none)"}

Files changed: ${prData.filesChanged}
Changed file paths: ${prData.changedFiles.slice(0, 20).join(", ") || "(not detected)"}

Diff sample:
${prData.diffSample || "(diff not loaded yet — user may need to click 'Files changed' tab first)"}

Respond with ONLY this JSON structure:
{
  "purpose": "One sentence describing what this PR does",
  "risk": "Low | Medium | High",
  "riskReason": "One sentence explaining the risk level",
  "reviewFocus": ["item 1", "item 2", "item 3"],
  "summary": "2-3 sentence technical summary"
}`;
  }

  async function generateWithGemini(prData, googleKey, modelName = "gemini-1.0") {
    const prompt = buildPrompt(prData);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta2/models/${modelName}:generate?key=${encodeURIComponent(googleKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: { text: prompt }, temperature: 0.0, maxOutputTokens: 1024 }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini API error ${response.status}`);
    }
    const data = await response.json();
    const text = data?.candidates?.[0]?.content || data?.candidates?.[0]?.output || "";
    const clean = text.replace(/```json|```/gi, "").trim();
    return JSON.parse(clean);
  }

  async function generateWithAnthropic(prData, anthropicKey, modelName = "claude-sonnet-4-6") {
    const prompt = buildPrompt(prData);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2024-06-01",
      },
      body: JSON.stringify({ model: modelName, max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Anthropic API error ${response.status}`);
    }
    const data = await response.json();
    const text = data?.content?.[0]?.text || data?.message || "";
    const clean = String(text).replace(/```json|```/gi, "").trim();
    return JSON.parse(clean);
  }

  async function generateWithOllama(prData, ollamaUrl, modelName) {
    const prompt = buildPrompt(prData);
    const base = (ollamaUrl || "http://localhost:11434").replace(/\/$/, "");
    const url = `${base}/api/generate`;
    const body = { model: modelName || "qwen2.5-coder:7b", prompt, stream: false };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      throw new Error(err || `Ollama API error ${response.status}`);
    }
    const data = await response.json().catch(() => ({}));
    // Try common fields returned by Ollama / local wrappers
    const text = data?.choices?.[0]?.content || data?.choices?.[0]?.message?.content || data?.output || data?.text || "";
    const clean = String(text).replace(/```json|```/gi, "").trim();
    return JSON.parse(clean);
  }

  // Unified entrypoint: chooses provider based on stored settings
  async function generateSummary(prData, settings) {
    const provider = settings.provider || "ollama";
    if (provider === "gemini") {
      if (!settings.googleKey) throw new Error("No Google API key set. Open popup to add it.");
      return generateWithGemini(prData, settings.googleKey, settings.googleModel || "gemini-1.0");
    }
    if (provider === "claude") {
      if (!settings.anthropicKey) throw new Error("No Anthropic API key set. Open popup to add it.");
      return generateWithAnthropic(prData, settings.anthropicKey, settings.anthropicModel || "claude-sonnet-4-6");
    }
    // default: ollama
    if (!settings.ollamaUrl) settings.ollamaUrl = "http://localhost:11434";
    return generateWithOllama(prData, settings.ollamaUrl, settings.ollamaModel || "");
  }

  // ─── Panel UI ────────────────────────────────────────────────────────────
  const PANEL_ID = "pr-summarizer-panel";

  function getOrCreatePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = getPanelHTML("idle");

    // GitHub: inject after PR header
    const ghAnchor =
      document.querySelector(".gh-header-actions") ||
      document.querySelector(".pull-request-tab-content") ||
      document.querySelector("#partial-discussion-header");

    // GitLab: inject after MR header
    const glAnchor =
      document.querySelector(".merge-request-details") ||
      document.querySelector(".detail-page-header");

    const anchor = ghAnchor || glAnchor || document.body.firstElementChild;

    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    } else {
      document.body.prepend(panel);
    }

    return panel;
  }

  function getRiskClass(risk) {
    if (!risk) return "";
    const r = risk.toLowerCase();
    if (r === "low") return "risk-low";
    if (r === "high") return "risk-high";
    return "risk-medium";
  }

  function getPanelHTML(state, data = {}, error = "") {
    if (state === "idle") {
      return `
        <div class="prs-header">
          <span class="prs-logo">◆</span>
          <span class="prs-title">AI PR Summary</span>
        </div>
        <div class="prs-idle">
          <button class="prs-btn prs-btn-primary" id="prs-generate-btn">
            Generate Summary
          </button>
          <p class="prs-hint">Reads this PR's diff and description</p>
        </div>`;
    }

    if (state === "loading") {
      return `
        <div class="prs-header">
          <span class="prs-logo">◆</span>
          <span class="prs-title">AI PR Summary</span>
        </div>
        <div class="prs-loading">
          <div class="prs-spinner"></div>
          <span>Analyzing PR…</span>
        </div>`;
    }

    if (state === "error") {
      return `
        <div class="prs-header">
          <span class="prs-logo">◆</span>
          <span class="prs-title">AI PR Summary</span>
        </div>
        <div class="prs-error">
          <span class="prs-error-icon">⚠</span>
          <p>${escapeHTML(error)}</p>
          <button class="prs-btn prs-btn-secondary" id="prs-retry-btn">Try again</button>
          ${!error.includes("API key") ? "" : `<button class="prs-btn prs-btn-ghost" id="prs-settings-btn">Set API key</button>`}
        </div>`;
    }

    if (state === "result") {
      const { purpose, risk, riskReason, reviewFocus, summary, filesChanged } = data;
      const focusItems = (reviewFocus || [])
        .map((f) => `<li>${escapeHTML(f)}</li>`)
        .join("");
      return `
        <div class="prs-header">
          <span class="prs-logo">◆</span>
          <span class="prs-title">AI PR Summary</span>
          <button class="prs-btn prs-btn-ghost prs-regen" id="prs-regenerate-btn" title="Regenerate">↻ Regenerate</button>
        </div>
        <div class="prs-body">
          <div class="prs-row">
            <span class="prs-label">Purpose</span>
            <span class="prs-value">${escapeHTML(purpose || "—")}</span>
          </div>
          <div class="prs-row">
            <span class="prs-label">Files Changed</span>
            <span class="prs-value">${escapeHTML(String(filesChanged || "?"))}</span>
          </div>
          <div class="prs-row prs-row-risk">
            <span class="prs-label">Risk</span>
            <span class="prs-value">
              <span class="prs-risk-badge ${getRiskClass(risk)}">${escapeHTML(risk || "?")}</span>
              <span class="prs-risk-reason">${escapeHTML(riskReason || "")}</span>
            </span>
          </div>
          ${summary ? `
          <div class="prs-row">
            <span class="prs-label">Summary</span>
            <span class="prs-value prs-summary">${escapeHTML(summary)}</span>
          </div>` : ""}
          ${focusItems ? `
          <div class="prs-row prs-row-focus">
            <span class="prs-label">Review Focus</span>
            <ul class="prs-focus-list">${focusItems}</ul>
          </div>` : ""}
        </div>`;
    }

    return "";
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderPanel(state, data = {}, error = "") {
    const panel = getOrCreatePanel();
    panel.innerHTML = getPanelHTML(state, data, error);
    panel.className = `prs-panel prs-state-${state}`;
    attachListeners(panel, data);
  }

  function attachListeners(panel, lastData) {
    panel.querySelector("#prs-generate-btn")?.addEventListener("click", () => runSummary());
    panel.querySelector("#prs-retry-btn")?.addEventListener("click", () => runSummary());
    panel.querySelector("#prs-regenerate-btn")?.addEventListener("click", () => runSummary());
    panel.querySelector("#prs-settings-btn")?.addEventListener("click", () => {
      // Opens the popup — instruct user since content scripts can't open popups
      alert("Click the PR Summarizer extension icon in your browser toolbar to set your API key.");
    });
  }

  // ─── Main Flow ───────────────────────────────────────────────────────────
  async function runSummary() {
    renderPanel("loading");

    const settings = await chrome.storage.sync.get([
      "provider",
      "googleKey",
      "anthropicKey",
      "ollamaUrl",
      "ollamaModel",
      "googleModel",
      "anthropicModel",
    ]);

    const prData = extractPRData();
    if (!prData) {
      renderPanel("error", {}, "Could not detect a PR on this page.");
      return;
    }

    try {
      const result = await generateSummary(prData, settings);
      renderPanel("result", { ...result, filesChanged: prData.filesChanged });
    } catch (err) {
      console.error("[PR Summarizer]", err);
      renderPanel("error", {}, err.message || "Something went wrong. Please try again.");
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    // Small delay to let page fully render
    setTimeout(() => {
      renderPanel("idle");
    }, 800);
  }

  // Handle SPA navigation on GitHub
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (/\/pull\/\d+|\/merge_requests\/\d+/.test(location.pathname)) {
        document.getElementById(PANEL_ID)?.remove();
        setTimeout(init, 1200);
      }
    }
  }).observe(document.body, { subtree: true, childList: true });

  init();
})();
