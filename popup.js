const statusEl = document.getElementById("status");
const countsEl = document.getElementById("counts");
const autoDownloadEl = document.getElementById("autoDownload");
const scanBtn = document.getElementById("scanBtn");
const downloadBtn = document.getElementById("downloadBtn");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const aboutBtn = document.getElementById("aboutBtn");
const domainInputEl = document.getElementById("domainInput");
const addDomainBtn = document.getElementById("addDomainBtn");
const domainListEl = document.getElementById("domainList");

let lastScan = null;
let allowedDomains = ["opit.instructure.com"];

function setStatus(text) {
  statusEl.textContent = text;
}

function setCounts(scanData) {
  const pdfCount = scanData?.pdfItems?.length || 0;
  const liveCount = scanData?.liveSessionItems?.length || 0;
  countsEl.textContent = `PDFs: ${pdfCount} | Live sessions: ${liveCount}`;
}

function ensureValidScanResult(scanResult) {
  if (!scanResult?.ok) throw new Error(scanResult?.error || "Scan failed.");
  if (!Array.isArray(scanResult.pdfItems) || !Array.isArray(scanResult.liveSessionItems)) {
    throw new Error("Scan returned invalid data.");
  }
  return scanResult;
}

function normalizeDomainRule(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function hostMatchesRule(hostname, rule) {
  const host = String(hostname || "").toLowerCase();
  const r = normalizeDomainRule(rule);
  if (!host || !r) return false;
  if (r.startsWith("*.")) return host.endsWith(r.slice(1));
  return host === r;
}

function renderDomainList() {
  domainListEl.textContent = `Domains: ${allowedDomains.join(", ")}`;
}

async function loadSettings() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (resp?.ok && Array.isArray(resp.settings?.allowedDomains) && resp.settings.allowedDomains.length) {
    allowedDomains = resp.settings.allowedDomains.map(normalizeDomainRule).filter(Boolean);
  }
  if (!allowedDomains.length) allowedDomains = ["opit.instructure.com"];
  renderDomainList();
}

async function saveSettingsDomains() {
  const resp = await chrome.runtime.sendMessage({
    type: "SET_ALLOWED_DOMAINS",
    domains: allowedDomains
  });
  if (!resp?.ok) throw new Error(resp?.error || "Failed to save domains.");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  if (!tab.url) throw new Error("Active tab has no URL.");
  const url = new URL(tab.url);
  const isAllowed = allowedDomains.some((rule) => hostMatchesRule(url.hostname, rule));
  if (!isAllowed) {
    throw new Error(`Domain not allowed: ${url.hostname}. Add it in popup settings.`);
  }
  if (!url.pathname.toLowerCase().includes("/courses/")) {
    throw new Error("Open a Canvas course page first.");
  }
  return tab;
}

async function scanCurrentPage() {
  const tab = await getActiveTab();
  const result = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE" });
  return ensureValidScanResult(result);
}

async function init() {
  const [stateResp] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATE" }),
    loadSettings()
  ]);
  if (stateResp?.ok) autoDownloadEl.checked = !!stateResp.state.autoDownload;
}

autoDownloadEl.addEventListener("change", async () => {
  const resp = await chrome.runtime.sendMessage({
    type: "SET_AUTO_DOWNLOAD",
    enabled: autoDownloadEl.checked
  });
  if (!resp?.ok) {
    setStatus(`Failed to update setting: ${resp?.error || "unknown error"}`);
    return;
  }
  setStatus(`Auto-download: ${autoDownloadEl.checked ? "ON" : "OFF"}`);
});

scanBtn.addEventListener("click", async () => {
  try {
    setStatus("Scanning...");
    const scan = await scanCurrentPage();
    lastScan = scan;
    setCounts(scan);
    setStatus(
      `Scanned ${scan.totalLinksScanned || 0} links.\nPDFs: ${scan.pdfItems.length}\nLive sessions: ${scan.liveSessionItems.length}\nResolved attachments: ${scan.resolvedAttachmentCount || 0}`
    );
  } catch (error) {
    setStatus(`Scan failed: ${String(error)}`);
  }
});

downloadBtn.addEventListener("click", async () => {
  try {
    setStatus("Scanning and queueing downloads...");
    const scan = await scanCurrentPage();
    const downloadResp = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_ITEMS",
      items: scan.pdfItems
    });
    if (!downloadResp?.ok) throw new Error(downloadResp?.error || "Download queue failed.");

    lastScan = scan;
    setCounts(scan);
    setStatus(`Queued ${scan.pdfItems.length} PDF item(s) for download.`);
  } catch (error) {
    setStatus(`Download failed: ${String(error)}`);
  }
});

exportBtn.addEventListener("click", async () => {
  try {
    if (!lastScan) {
      setStatus("Scanning before export...");
      lastScan = await scanCurrentPage();
    }

    const blob = new Blob([JSON.stringify(lastScan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const now = new Date().toISOString().replace(/[:.]/g, "-");

    await chrome.downloads.download({
      url,
      filename: `OPIT/scan_results_${now}.json`,
      conflictAction: "uniquify",
      saveAs: false
    });

    setCounts(lastScan);
    setStatus("Exported scan JSON to Downloads/OPIT.");
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    setStatus(`Export failed: ${String(error)}`);
  }
});

clearBtn.addEventListener("click", async () => {
  const resp = await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
  setStatus(resp?.ok ? "History cleared." : `Failed to clear history: ${resp?.error || "unknown error"}`);
});

addDomainBtn.addEventListener("click", async () => {
  try {
    const next = normalizeDomainRule(domainInputEl.value);
    if (!next) {
      setStatus("Enter a valid domain.");
      return;
    }
    if (allowedDomains.includes(next)) {
      setStatus("Domain already exists.");
      return;
    }
    allowedDomains.push(next);
    allowedDomains = Array.from(new Set(allowedDomains));
    await saveSettingsDomains();
    renderDomainList();
    domainInputEl.value = "";
    setStatus(`Domain added: ${next}`);
  } catch (error) {
    setStatus(`Failed to add domain: ${String(error)}`);
  }
});

domainListEl.addEventListener("dblclick", async () => {
  try {
    const input = prompt("Remove which domain? Type exact domain rule:");
    const target = normalizeDomainRule(input);
    if (!target) return;
    const next = allowedDomains.filter((d) => d !== target);
    if (!next.length) {
      setStatus("At least one domain is required.");
      return;
    }
    allowedDomains = next;
    await saveSettingsDomains();
    renderDomainList();
    setStatus(`Domain removed: ${target}`);
  } catch (error) {
    setStatus(`Failed to remove domain: ${String(error)}`);
  }
});

aboutBtn.addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://github.com/de4su" });
});

init().catch((error) => setStatus(`Init error: ${String(error)}`));
