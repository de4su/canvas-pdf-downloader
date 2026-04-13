function getCourseCodeFromPath() {
  const match = window.location.pathname.match(/\/courses\/(\d+)/);
  return match ? `Course_${match[1]}` : "UnknownCourse";
}

function hostMatchesRule(hostname, rule) {
  const h = String(hostname || "").toLowerCase();
  const r = String(rule || "").toLowerCase().trim();
  if (!h || !r) return false;
  if (r.startsWith("*.")) {
    const suffix = r.slice(1); // ".example.edu"
    return h.endsWith(suffix);
  }
  return h === r;
}

function isAllowedHost(hostname, allowedDomains) {
  const domains = Array.isArray(allowedDomains) ? allowedDomains : [];
  if (!domains.length) return false;
  return domains.some((rule) => hostMatchesRule(hostname, rule));
}

async function getSettings() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (!resp?.ok) {
    return { allowedDomains: ["opit.instructure.com"] };
  }
  return resp.settings || { allowedDomains: ["opit.instructure.com"] };
}

async function assertPageIsSupported() {
  const settings = await getSettings();
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();

  if (!isAllowedHost(host, settings.allowedDomains)) {
    throw new Error(`Domain not allowed: ${host}. Add it in extension settings.`);
  }
  if (!path.includes("/courses/")) {
    throw new Error("Open a Canvas course page first.");
  }
}

function toAbsoluteUrl(url) {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return null;
  }
}

function buildDirectDownloadUrl(fileUrl) {
  try {
    const url = new URL(fileUrl);
    const match = url.pathname.match(/^(\/courses\/\d+\/files\/\d+)(?:\/download)?$/);
    if (!match) return fileUrl;
    return `${url.origin}${match[1]}/download?download_frd=1`;
  } catch {
    return fileUrl;
  }
}

function cleanFilenameCandidate(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (lower === "true" || lower === "false" || lower === "download" || lower === "click here") {
    return "";
  }
  return v;
}

function inferFilename(anchor, href) {
  const text = cleanFilenameCandidate(anchor?.textContent || anchor?.title || "");
  if (text && text.length < 180) return text;

  try {
    const url = new URL(href);
    const tail = cleanFilenameCandidate(decodeURIComponent(url.pathname.split("/").pop() || ""));
    if (tail && tail.toLowerCase() !== "download") return tail;
  } catch {
    // ignore
  }

  return "resource.pdf";
}

function getNearestModuleTitle(anchor) {
  const moduleContainer = anchor.closest(".context_module") || anchor.closest(".item-group-container");
  if (!moduleContainer) return "";
  const titleEl = moduleContainer.querySelector(".ig-header-title, .name, .context_module_item_title");
  return (titleEl?.textContent || "").trim();
}

function looksLikePdfLink(href) {
  if (!href) return false;
  const lower = href.toLowerCase();
  return (
    lower.includes("/files/") &&
    (lower.includes("/download") ||
      lower.includes("module_item_id=") ||
      lower.endsWith(".pdf") ||
      lower.includes("content_type=application/pdf"))
  );
}

function looksLikeLiveSessionLink(anchor, absoluteHref) {
  const text = (anchor.textContent || "").toLowerCase();
  const title = (anchor.title || "").toLowerCase();
  const href = (absoluteHref || "").toLowerCase();
  return (
    text.includes("live session") ||
    title.includes("live session") ||
    text.includes("recording") ||
    title.includes("recording") ||
    href.includes("zoom.us/rec/") ||
    href.includes("recording")
  );
}

function looksLikeModuleItemAttachmentLink(anchor, absoluteHref) {
  const listItem = anchor.closest("li.context_module_item");
  return !!(listItem && listItem.classList.contains("attachment") && absoluteHref.includes("/modules/items/"));
}

function collectCourseResources() {
  const courseCode = getCourseCodeFromPath();
  const pdfItems = [];
  const liveSessionItems = [];
  const moduleAttachmentItems = [];

  const seenPdf = new Set();
  const seenLive = new Set();
  const seenAttachment = new Set();

  const anchors = document.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    const absolute = toAbsoluteUrl(href);
    if (!absolute) continue;

    const label = (anchor.textContent || "").trim();
    const moduleTitle = getNearestModuleTitle(anchor);

    if (looksLikePdfLink(href)) {
      const key = buildDirectDownloadUrl(absolute);
      if (!seenPdf.has(key)) {
        seenPdf.add(key);
        pdfItems.push({
          type: "pdf",
          url: absolute,
          downloadUrl: key,
          filename: inferFilename(anchor, absolute),
          title: document.title,
          moduleTitle,
          label,
          courseCode
        });
      }
      continue;
    }

    if (looksLikeLiveSessionLink(anchor, absolute)) {
      if (!seenLive.has(absolute)) {
        seenLive.add(absolute);
        liveSessionItems.push({
          type: "live_session",
          url: absolute,
          label,
          moduleTitle,
          courseCode
        });
      }
      continue;
    }

    if (looksLikeModuleItemAttachmentLink(anchor, absolute)) {
      if (!seenAttachment.has(absolute)) {
        seenAttachment.add(absolute);
        moduleAttachmentItems.push({
          type: "module_attachment_pending",
          url: absolute,
          filenameHint: inferFilename(anchor, absolute),
          title: document.title,
          moduleTitle,
          label,
          courseCode
        });
      }
    }
  }

  return {
    pdfItems,
    liveSessionItems,
    moduleAttachmentItems,
    totalLinksScanned: anchors.length
  };
}

async function resolveModuleAttachmentToPdf(item) {
  try {
    const response = await fetch(item.url, { credentials: "include" });
    if (!response.ok) return null;

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const directAnchor = doc.querySelector(
      'a[href*="/files/"][download], a[href*="/files/"][href*="/download"], a[href$=".pdf"], a[href*="content_type=application/pdf"]'
    );
    if (!directAnchor) return null;

    const href = directAnchor.getAttribute("href");
    if (!href) return null;

    const absoluteDownloadUrl = new URL(href, item.url).toString();
    const downloadAttr = cleanFilenameCandidate(directAnchor.getAttribute("download"));
    const linkText = cleanFilenameCandidate(directAnchor.textContent);
    const linkTitle = cleanFilenameCandidate(directAnchor.title);
    const fallbackName = cleanFilenameCandidate(
      decodeURIComponent(new URL(absoluteDownloadUrl).pathname.split("/").pop() || "")
    );
    const filename =
      downloadAttr ||
      item.filenameHint ||
      linkText ||
      linkTitle ||
      fallbackName ||
      "resource.pdf";

    return {
      type: "pdf",
      url: item.url,
      downloadUrl: buildDirectDownloadUrl(absoluteDownloadUrl),
      filename,
      title: item.title,
      moduleTitle: item.moduleTitle,
      label: item.label,
      courseCode: item.courseCode
    };
  } catch {
    return null;
  }
}

async function buildResolvedScanResults() {
  await assertPageIsSupported();
  const raw = collectCourseResources();
  const resolvedPdfs = [];
  for (const pendingItem of raw.moduleAttachmentItems) {
    const resolved = await resolveModuleAttachmentToPdf(pendingItem);
    if (resolved) resolvedPdfs.push(resolved);
  }

  const deduped = [];
  const seen = new Set();
  for (const item of [...raw.pdfItems, ...resolvedPdfs]) {
    const key = item.downloadUrl || item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return {
    ok: true,
    pdfItems: deduped,
    liveSessionItems: raw.liveSessionItems,
    totalLinksScanned: raw.totalLinksScanned,
    resolvedAttachmentCount: resolvedPdfs.length
  };
}

async function scanAndMaybeAutoDownload() {
  try {
    await assertPageIsSupported();
    const stateResp = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!stateResp?.ok || !stateResp.state.autoDownload) return;
    const scan = await buildResolvedScanResults();
    if (scan.pdfItems.length) {
      await chrome.runtime.sendMessage({ type: "DOWNLOAD_ITEMS", items: scan.pdfItems });
    }
  } catch {
    // keep page stable if messaging fails
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCAN_PAGE") {
    buildResolvedScanResults()
      .then((scan) => sendResponse(scan))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "DOWNLOAD_CURRENT_PAGE") {
    (async () => {
      const scan = await buildResolvedScanResults();
      const result = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_ITEMS",
        items: scan.pdfItems || []
      });
      sendResponse({
        ok: true,
        count: scan.pdfItems.length,
        result,
        resources: scan
      });
    })().catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  return false;
});

scanAndMaybeAutoDownload();
