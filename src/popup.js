// PR Summarizer - Popup Script

const providerSelect = document.getElementById("provider");
const ollamaUrlInput = document.getElementById("ollama-url");
const ollamaModelInput = document.getElementById("ollama-model");
const googleKeyInput = document.getElementById("google-key");
const anthropicKeyInput = document.getElementById("anthropic-key");
const saveBtn = document.getElementById("save-btn");
const clearBtn = document.getElementById("clear-btn");
const status = document.getElementById("status");

function showSettingsFor(provider) {
  document.getElementById("ollama-settings").style.display = provider === "ollama" ? "block" : "none";
  document.getElementById("gemini-settings").style.display = provider === "gemini" ? "block" : "none";
  document.getElementById("claude-settings").style.display = provider === "claude" ? "block" : "none";
}

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = `status ${type}`;
  setTimeout(() => {
    status.className = "status";
    status.textContent = "";
  }, 2500);
}

// Load existing key (masked)
// Load existing settings (provider + keys/URL)
chrome.storage.sync.get([
  "provider",
  "ollamaUrl",
  "ollamaModel",
  "googleKey",
  "anthropicKey",
], (items) => {
  const provider = items.provider || "ollama";
  providerSelect.value = provider;
  ollamaUrlInput.value = items.ollamaUrl || "http://localhost:11434";
  ollamaModelInput.value = items.ollamaModel || "";
  googleKeyInput.value = items.googleKey || "";
  anthropicKeyInput.value = items.anthropicKey || "";
  showSettingsFor(provider);
});

providerSelect.addEventListener("change", (e) => showSettingsFor(e.target.value));

saveBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const ollamaUrl = ollamaUrlInput.value.trim();
  const ollamaModel = ollamaModelInput.value.trim();
  const googleKey = googleKeyInput.value.trim();
  const anthropicKey = anthropicKeyInput.value.trim();

  const settings = { provider, ollamaUrl, ollamaModel, googleKey, anthropicKey };
  chrome.storage.sync.set(settings, () => {
    showStatus("Settings saved!", "success");
  });
});

clearBtn.addEventListener("click", () => {
  chrome.storage.sync.remove(["provider", "ollamaUrl", "ollamaModel", "googleKey", "anthropicKey"], () => {
    providerSelect.value = "ollama";
    ollamaUrlInput.value = "http://localhost:11434";
    ollamaModelInput.value = "";
    googleKeyInput.value = "";
    anthropicKeyInput.value = "";
    showSettingsFor("ollama");
    showStatus("Settings cleared.", "success");
  });
});

// Allow Enter to save
// Allow Enter to save from any input
[providerSelect, ollamaUrlInput, ollamaModelInput, googleKeyInput, anthropicKeyInput].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });
});
