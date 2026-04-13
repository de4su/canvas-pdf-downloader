const statusEl = document.getElementById("status");
const countsEl = document.getElementById("counts");
const autoDownloadEl = document.getElementById("autoDownload");
const scanBtn = document.getElementById("scanBtn");
const downloadBtn = document.getElementById("downloadBtn");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const aboutBtn = document.getElementById("aboutBtn");
const closeBtn = document.getElementById("closeBtn");

let lastScan = null;

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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  if (!tab.url || !tab.url.includes("opit.instructure.com/courses/")) {
    throw new Error("Open an OPIT course modules page first.");
  }
  return tab;
}

async function scanCurrentPage() {
  const tab = await getActiveTab();
  const result = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE" });
  return ensureValidScanResult(result);
}

async function init() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (resp?.ok) autoDownloadEl.checked = !!resp.state.autoDownload;
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

aboutBtn.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("about.html") });
});

closeBtn.addEventListener("click", () => {
  window.close();
});

init().catch((error) => setStatus(`Init error: ${String(error)}`));
