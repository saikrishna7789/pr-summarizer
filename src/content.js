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
  return `
You are a senior software engineer and expert code reviewer.

Analyze the following Pull Request carefully.

Return ONLY valid JSON.
Do not return markdown.
Do not use code fences.
Do not add explanations outside the JSON.

PR TITLE:
${prData.title}

PR DESCRIPTION:
${prData.description || "(none)"}

FILES CHANGED:
${prData.filesChanged}

CHANGED FILE PATHS:
${prData.changedFiles.slice(0, 30).join("\n") || "(not detected)"}

DIFF:
${prData.diffSample || "(diff not available)"}

Analyze:

1. Purpose of the change
2. Overall risk
3. Risk score from 0 to 100
4. Potential bugs
5. Missing tests
6. Security concerns
7. Performance concerns
8. Important review points
9. Technical summary

Risk score guidance:

0-20   = Very Low
21-40  = Low
41-60  = Medium
61-80  = High
81-100 = Critical

Return exactly this JSON structure:

{
  "purpose": "One sentence describing the purpose",

  "risk": "Low | Medium | High | Critical",

  "riskScore": 50,

  "riskReason": "Short explanation of the risk score",

  "potentialBugs": [
    {
      "severity": "Low | Medium | High",
      "file": "file name if known",
      "issue": "Potential problem",
      "suggestion": "Recommended fix"
    }
  ],

  "missingTests": [
    "Missing test scenario"
  ],

  "securityConcerns": [
    "Security concern"
  ],

  "performanceConcerns": [
    "Performance concern"
  ],

  "reviewFocus": [
    "Important review point"
  ],

  "summary": "2-3 sentence technical summary"
}

If no issue exists for an array field, return an empty array.
`;
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

    console.log("========== OLLAMA DEBUG ==========");
    console.log("URL:", ollamaUrl);
    console.log("Model:", modelName);
    console.log("Prompt length:", prompt.length);

    let data;

    try {

        data = await chrome.runtime.sendMessage({
            type: "OLLAMA",
            prompt: prompt,
            ollamaUrl: ollamaUrl || "http://127.0.0.1:11434",
            model: modelName || "qwen2.5-coder:7b"
        });

        console.log("Background Response:", data);

    } catch (error) {

        console.error("sendMessage failed:", error);

        throw new Error(
            "Background communication failed: " + error.message
        );
    }

    if (data === undefined) {
        throw new Error(
            "Background returned undefined. Check Service Worker console."
        );
    }

    if (data === null) {
        throw new Error(
            "Background returned null."
        );
    }

    if (data.success !== true) {

        console.error("Ollama failure response:", data);

        throw new Error(
            data.error
                ? String(data.error)
                : "Background request failed. Response: " +
                  JSON.stringify(data)
        );
    }

    if (!data.response) {
        throw new Error(
            "Ollama returned empty response: " +
            JSON.stringify(data)
        );
    }

    console.log("Raw Ollama Output:", data.response);

    const clean = data.response
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    const match = clean.match(/\{[\s\S]*\}/);

    if (!match) {
        throw new Error(
            "No JSON found in model output: " +
            clean.substring(0, 500)
        );
    }

    try {
        return JSON.parse(match[0]);
    } catch (error) {

        console.error("JSON parse failure:", match[0]);

        throw new Error(
            "Invalid JSON from model: " + error.message
        );
    }
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

  const {
    purpose,
    risk,
    riskScore,
    riskReason,
    potentialBugs,
    missingTests,
    securityConcerns,
    performanceConcerns,
    reviewFocus,
    summary,
    filesChanged
  } = data;


  const createList = (items = []) => {

    if (!items.length) {
      return `<div class="prs-empty">No issues detected</div>`;
    }

    return `
      <ul class="prs-focus-list">
        ${items
          .map(item => `<li>${escapeHTML(item)}</li>`)
          .join("")}
      </ul>
    `;
  };


  const bugHTML = (potentialBugs || [])
    .map(bug => `
      <div class="prs-bug">

        <div class="prs-bug-header">

          <span class="prs-severity prs-severity-${String(
            bug.severity || "medium"
          ).toLowerCase()}">

            ${escapeHTML(bug.severity || "Medium")}

          </span>

          <span class="prs-bug-file">
            ${escapeHTML(bug.file || "Unknown file")}
          </span>

        </div>

        <div class="prs-bug-issue">
          ${escapeHTML(bug.issue || "")}
        </div>

        ${
          bug.suggestion
            ? `
              <div class="prs-bug-suggestion">
                Suggestion: ${escapeHTML(bug.suggestion)}
              </div>
            `
            : ""
        }

      </div>
    `)
    .join("");


  return `

    <div class="prs-header">

      <span class="prs-logo">◆</span>

      <span class="prs-title">
        AI PR Review
      </span>

      <button
        class="prs-btn prs-btn-ghost prs-regen"
        id="prs-regenerate-btn">

        ↻ Regenerate

      </button>

    </div>


    <div class="prs-body">


      <!-- PURPOSE -->

      <div class="prs-row">

        <span class="prs-label">
          Purpose
        </span>

        <span class="prs-value">
          ${escapeHTML(purpose || "—")}
        </span>

      </div>


      <!-- FILES -->

      <div class="prs-row">

        <span class="prs-label">
          Files Changed
        </span>

        <span class="prs-value">
          ${escapeHTML(String(filesChanged || "?"))}
        </span>

      </div>


      <!-- RISK SCORE -->

      <div class="prs-row">

        <span class="prs-label">
          Risk Score
        </span>

        <div class="prs-value">

          <div class="prs-score-container">

            <div class="prs-score-number">
              ${escapeHTML(String(riskScore ?? "?"))}/100
            </div>

            <div class="prs-score-bar">

              <div
                class="prs-score-fill"
                style="width:${Math.min(
                  Math.max(Number(riskScore) || 0, 0),
                  100
                )}%">
              </div>

            </div>

          </div>

        </div>

      </div>


      <!-- RISK -->

      <div class="prs-row prs-row-risk">

        <span class="prs-label">
          Risk
        </span>

        <span class="prs-value">

          <span class="prs-risk-badge ${getRiskClass(risk)}">
            ${escapeHTML(risk || "?")}
          </span>

          <span class="prs-risk-reason">
            ${escapeHTML(riskReason || "")}
          </span>

        </span>

      </div>


      <!-- SUMMARY -->

      <div class="prs-section">

        <div class="prs-section-title">
          Technical Summary
        </div>

        <div class="prs-summary">
          ${escapeHTML(summary || "No summary available")}
        </div>

      </div>


      <!-- POTENTIAL BUGS -->

      <div class="prs-section">

        <div class="prs-section-title">
          🐞 Potential Bugs
        </div>

        ${
          bugHTML ||
          `<div class="prs-empty">
             No potential bugs detected
           </div>`
        }

      </div>


      <!-- MISSING TESTS -->

      <div class="prs-section">

        <div class="prs-section-title">
          🧪 Missing Tests
        </div>

        ${createList(missingTests)}

      </div>


      <!-- SECURITY -->

      <div class="prs-section">

        <div class="prs-section-title">
          🔐 Security Concerns
        </div>

        ${createList(securityConcerns)}

      </div>


      <!-- PERFORMANCE -->

      <div class="prs-section">

        <div class="prs-section-title">
          ⚡ Performance Concerns
        </div>

        ${createList(performanceConcerns)}

      </div>


      <!-- REVIEW CHECKLIST -->

      <div class="prs-section">

        <div class="prs-section-title">
          ✓ Review Checklist
        </div>

        ${createList(reviewFocus)}

      </div>


    </div>
  `;
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
