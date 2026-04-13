const DEFAULT_STATE = {
  autoDownload: false,
  downloadedUrls: {}
};

const DEFAULT_SETTINGS = {
  allowedDomains: ["opit.instructure.com"]
};

async function getState() {
  const data = await chrome.storage.local.get(["opitState"]);
  return { ...DEFAULT_STATE, ...(data.opitState || {}) };
}

async function setState(nextState) {
  await chrome.storage.local.set({ opitState: nextState });
}

async function getSettings() {
  const data = await chrome.storage.local.get(["opitSettings"]);
  const settings = { ...DEFAULT_SETTINGS, ...(data.opitSettings || {}) };
  const allowedDomains = Array.isArray(settings.allowedDomains)
    ? settings.allowedDomains.map((d) => String(d || "").trim().toLowerCase()).filter(Boolean)
    : DEFAULT_SETTINGS.allowedDomains;
  return { ...settings, allowedDomains };
}

async function setSettings(nextSettings) {
  await chrome.storage.local.set({ opitSettings: nextSettings });
}

function sanitizeFilename(name) {
  return (name || "file")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFilename(name) {
  const text = String(name || "").trim();
  if (!text) return "resource.pdf";
  const lower = text.toLowerCase();
  if (lower === "true" || lower === "false" || lower === "download" || lower === "click here") {
    return "resource.pdf";
  }
  return text;
}

function makeFilename(item) {
  const folder = item.courseCode ? `OPIT/${item.courseCode}` : "OPIT/UnknownCourse";
  const base = sanitizeFilename(normalizeFilename(item.filename));
  return `${folder}/${base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`}`;
}

function canonicalUrlForHistory(item) {
  return item.downloadUrl || item.url;
}

async function downloadItem(item) {
  const state = await getState();
  const key = canonicalUrlForHistory(item);
  if (state.downloadedUrls[key]) {
    return { ok: true, skipped: true, reason: "already_downloaded" };
  }

  await chrome.downloads.download({
    url: item.downloadUrl || item.url,
    filename: makeFilename(item),
    conflictAction: "uniquify",
    saveAs: false
  });

  state.downloadedUrls[key] = Date.now();
  await setState(state);
  return { ok: true, skipped: false };
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await getState();
  await setState(current);
  const currentSettings = await getSettings();
  await setSettings(currentSettings);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_STATE") {
    getState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "SET_AUTO_DOWNLOAD") {
    getState()
      .then((state) => setState({ ...state, autoDownload: !!message.enabled }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "SET_ALLOWED_DOMAINS") {
    getSettings()
      .then((settings) => {
        const domains = Array.isArray(message.domains) ? message.domains : [];
        const allowedDomains = domains
          .map((d) => String(d || "").trim().toLowerCase())
          .filter(Boolean);
        return setSettings({ ...settings, allowedDomains: allowedDomains.length ? allowedDomains : ["opit.instructure.com"] });
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "DOWNLOAD_ITEMS") {
    (async () => {
      const items = Array.isArray(message.items) ? message.items : [];
      const results = [];
      for (const item of items) {
        try {
          const result = await downloadItem(item);
          results.push({ item, ...result });
        } catch (error) {
          results.push({ item, ok: false, error: String(error) });
        }
      }
      sendResponse({ ok: true, results });
    })();
    return true;
  }

  if (message?.type === "CLEAR_HISTORY") {
    getState()
      .then((state) => setState({ ...state, downloadedUrls: {} }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});
