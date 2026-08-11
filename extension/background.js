import { getConfig, helperFetch, helperHealth } from './lib/helper.js';

const DOWNLOAD_MIME_OK = true;
/** Parallel Chrome downloads + Helper claims (was 1). */
const DOWNLOAD_CONCURRENCY = 6;
let activeJobCount = 0;
let pumpInProgress = false;
let pumpRequested = false;
const downloadWaiters = new Map();
let cancelRequested = false;
const activeChromeDownloadIds = new Set();
const activeQueueItemIds = new Set();
/** Items removed via Tasks — worker must not auto-retry or cancel-all on Chrome abort. */
const removedQueueItemIds = new Set();
/** Absolute partial paths currently held by Range recovery — orphan sweep must keep them. */
const protectedPartialPaths = new Set();
/** In-page Download/(a/b) session — lives in the SW so Tasks deletes survive pagination. */
const DL_SESSION_KEY = 'hxyruleDownloadSession';
let dlSession = { active: false, total: 0, baselineCompleted: 0 };
let dlSessionLoad = null;

async function loadDlSession() {
  if (!dlSessionLoad) {
    dlSessionLoad = (async () => {
      try {
        const stored = await chrome.storage.session.get(DL_SESSION_KEY);
        const raw = stored?.[DL_SESSION_KEY];
        if (raw && typeof raw === 'object') {
          dlSession = {
            active: !!raw.active,
            total: Math.max(0, Number(raw.total) || 0),
            baselineCompleted: Math.max(0, Number(raw.baselineCompleted) || 0),
          };
        }
      } catch (_) {
        /* session storage unavailable — memory only */
      }
      return dlSession;
    })();
  }
  return dlSessionLoad;
}

async function saveDlSession() {
  try {
    await chrome.storage.session.set({ [DL_SESSION_KEY]: { ...dlSession } });
  } catch (_) {
    /* ignore */
  }
}

function remainingQueueCount(status) {
  const counts = status?.counts || {};
  return (
    Number(counts.pending || 0) +
    Number(counts.waiting || 0) +
    Number(counts.downloading || 0) +
    Number(counts.paused || 0) +
    Number(counts.failed || 0)
  );
}

/** Attach Download button (a/b) — shrinks when Tasks cancels unfinished rows. */
async function withDownloadProgress(status) {
  await loadDlSession();
  const active = Math.max(
    0,
    Number(status?.activeCount || 0) || remainingQueueCount(status),
  );
  const completed = Math.max(0, Number(status?.completed || 0));
  const cancelled = Math.max(0, Number(status?.cancelled || 0));
  let downloadProgress = 'idle';
  let changed = false;

  if (dlSession.active) {
    const done = Math.max(0, completed - dlSession.baselineCompleted);
    if (active > 0) {
      const nextTotal = Math.max(done + active, 1);
      if (nextTotal !== dlSession.total) {
        dlSession.total = nextTotal;
        changed = true;
      }
      downloadProgress = `${Math.min(done, dlSession.total)}/${dlSession.total}`;
    } else {
      dlSession = { active: false, total: 0, baselineCompleted: 0 };
      changed = true;
      downloadProgress = 'idle';
    }
  } else if (active > 0) {
    // No session (SW restart / old tab): exclude cancelled rows from the fraction.
    const totalRows = Math.max(0, Number(status?.total || 0));
    const denom = Math.max(1, totalRows > 0 ? totalRows - cancelled : active + completed);
    const done = Math.max(0, Math.min(completed, denom));
    downloadProgress = `${done}/${denom}`;
  }

  if (changed) await saveDlSession();
  return {
    ...status,
    downloadProgress,
    downloadSession: { ...dlSession },
  };
}

async function noteEnqueueSession(beforeStatus, added) {
  await loadDlSession();
  const n = Math.max(0, Number(added) || 0);
  if (n <= 0) return;
  if (dlSession.active) {
    dlSession.total += n;
  } else {
    const remainingBefore = remainingQueueCount(beforeStatus);
    dlSession = {
      active: true,
      total: remainingBefore + n,
      baselineCompleted: Math.max(0, Number(beforeStatus?.completed || 0)),
    };
  }
  await saveDlSession();
}

async function clearDlSession() {
  dlSession = { active: false, total: 0, baselineCompleted: 0 };
  await saveDlSession();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'hxyrule-open-local',
      title: 'Open with local player',
      contexts: ['link', 'page'],
      documentUrlPatterns: ['https://rule34video.com/*', 'https://www.rule34video.com/*'],
    });
    chrome.contextMenus.create({
      id: 'hxyrule-open-web',
      title: 'Open web version',
      contexts: ['link', 'page'],
      documentUrlPatterns: ['https://rule34video.com/*', 'https://www.rule34video.com/*'],
    });
    chrome.contextMenus.create({
      id: 'hxyrule-reveal',
      title: 'Reveal in Finder',
      contexts: ['link', 'page'],
      documentUrlPatterns: ['https://rule34video.com/*', 'https://www.rule34video.com/*'],
    });
    chrome.contextMenus.create({
      id: 'hxyrule-copy-path',
      title: 'Copy local path',
      contexts: ['link', 'page'],
      documentUrlPatterns: ['https://rule34video.com/*', 'https://www.rule34video.com/*'],
    });
  });
});

function videoIdFromUrl(url) {
  const m = String(url || '').match(/\/videos?\/(\d+)\b/i);
  return m ? m[1] : '';
}

function videoUrlForId(videoId) {
  return `https://rule34video.com/video/${videoId}/`;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url || '';
  const videoId = videoIdFromUrl(url);
  if (!videoId) return;
  try {
    if (info.menuItemId === 'hxyrule-open-local') {
      await helperFetch('/open', { method: 'POST', body: { videoId } });
      return;
    }
    if (info.menuItemId === 'hxyrule-reveal') {
      await helperFetch('/reveal', { method: 'POST', body: { videoId } });
      return;
    }
    if (info.menuItemId === 'hxyrule-open-web') {
      const href = videoUrlForId(videoId);
      if (tab?.id != null) {
        try {
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: pageOpenNativePopup,
            args: [href, videoId],
          });
          if (result?.result?.ok) return;
        } catch (_) {
          /* fall through to tab open */
        }
      }
      await chrome.tabs.create({ url: href, active: true });
      return;
    }
    if (info.menuItemId === 'hxyrule-copy-path') {
      const lookup = await helperFetch('/lookup', {
        method: 'POST',
        body: { videoIds: [videoId] },
      });
      const row = lookup?.results?.[videoId] || lookup?.results?.[String(videoId)];
      if (!row?.exists) throw new Error('No local file for this video');
      const path = String(row.displayPath || row.relativePath || '').trim();
      if (!path) throw new Error('No local file for this video');
      if (tab?.id == null) throw new Error('No active tab for clipboard');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (text) => {
          await navigator.clipboard.writeText(text);
        },
        args: [path],
      });
    }
  } catch (err) {
    console.warn('HXYRULE context menu failed:', err?.message || err);
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  const waiter = downloadWaiters.get(delta.id);
  if (!waiter) {
    // MV3 may have discarded the service worker (and its waiter) while Chrome
    // kept downloading. A terminal event wakes us so the queue can reconcile
    // the persisted Helper row with Chrome's download history.
    if (delta.state && ['complete', 'interrupted'].includes(delta.state.current)) {
      runQueueWorker();
    }
    return;
  }
  if (delta.state && delta.state.current === 'complete') {
    downloadWaiters.delete(delta.id);
    waiter.resolve({ id: delta.id, state: 'complete' });
  } else if (delta.state && delta.state.current === 'interrupted') {
    downloadWaiters.delete(delta.id);
    if (cancelRequested) {
      waiter.resolve({ id: delta.id, state: 'cancelled' });
    } else {
      const reason = String(delta.error?.current || '').trim();
      waiter.reject(
        new Error(`Chrome download interrupted${reason ? `: ${reason}` : ''}`),
      );
    }
  }
});

async function cancelActiveChromeDownloads() {
  const ids = new Set(activeChromeDownloadIds);
  try {
    const inProgress = await chrome.downloads.search({ state: 'in_progress' });
    for (const d of inProgress || []) {
      const name = `${d.filename || ''} ${d.finalUrl || ''} ${d.url || ''}`;
      if (/HXYRULE|\.mp4/i.test(name) || ids.has(d.id)) ids.add(d.id);
    }
  } catch (_) {
    /* ignore */
  }
  for (const id of ids) {
    try {
      await chrome.downloads.cancel(id);
    } catch (_) {
      /* ignore */
    }
  }
  activeChromeDownloadIds.clear();
}

async function stopDownloads() {
  cancelRequested = true;
  await cancelActiveChromeDownloads();
  const snap = await helperFetch('/downloads/cancel', { method: 'POST', body: {} });
  // Also purge finished noise so Stop shows idle cleanly after cancel.
  try {
    await helperFetch('/downloads/clear-finished', { method: 'POST', body: {} });
  } catch (_) {
    /* ignore */
  }
  await clearDlSession();
  return withDownloadProgress(snap);
}

function waitForDownload(id, timeoutMs = 6 * 60 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      downloadWaiters.delete(id);
      reject(new Error('download timeout'));
    }, timeoutMs);
    downloadWaiters.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
}

async function chromeDownloadById(id) {
  const [info] = await chrome.downloads.search({ id: Number(id) });
  return info || null;
}

function chromeFailurePartialPaths(info) {
  const path = String(info?.filename || '').trim();
  if (!path) return [];
  const paths = new Set();
  paths.add(path);
  if (!path.endsWith('.crdownload')) paths.add(`${path}.crdownload`);
  return [...paths];
}

function isRule34ChromeFailure(info) {
  const identity = `${info?.url || ''} ${info?.finalUrl || ''} ${info?.filename || ''}`;
  if (/rule34video\.com|[\\/]HXYRULE(?:[\\/]|$)/i.test(identity)) return true;
  // Unconfirmed artifacts often keep the CDN URL even when the path has no video id.
  const base = String(info?.filename || '').split(/[\\/]/).pop() || '';
  return (
    /^unconfirmed\s+\d+\.crdownload$/i.test(base) &&
    /rule34|get_file|kalvin|trafficdeposit|cdn/i.test(identity)
  );
}

async function collectFailurePartialPaths(downloadId) {
  const id = Number(downloadId);
  if (!Number.isInteger(id) || id <= 0) return [];
  try {
    return chromeFailurePartialPaths(await chromeDownloadById(id));
  } catch (_) {
    return [];
  }
}

async function removeChromeFailureFile(id) {
  const downloadId = Number(id);
  if (!Number.isInteger(downloadId) || downloadId <= 0) return false;
  if (activeChromeDownloadIds.has(downloadId)) return false;
  try {
    const info = await chromeDownloadById(downloadId);
    if (!info) return false;
    const name = String(info.filename || '');
    const base = name.split(/[\\/]/).pop() || '';
    const looksPartial =
      info.state === 'interrupted' ||
      /\.(crdownload|download|part)$/i.test(name) ||
      /^unconfirmed\s+\d+/i.test(base);
    const fileSize = Number(info.fileSize || info.bytesReceived || 0);
    // Chrome uniquify leaves `title——id (1).mp4` at 0 bytes after a failed
    // attempt; those are complete-state rows but still safe to erase.
    const looksEmptyNamedFailure =
      fileSize === 0 &&
      (/\u2014\u2014\d+(?: \(\d+\))?\.(mp4|mkv|webm|mov|m4v|ts)$/i.test(base) ||
        /[\\/]HXYRULE(?:[\\/]|$)/i.test(name));
    if (info.state === 'complete' && !looksPartial && !looksEmptyNamedFailure) return false;
    if (!looksPartial && !looksEmptyNamedFailure) return false;
    try {
      await chrome.downloads.removeFile(downloadId);
    } catch (_) {
      // Some Chrome builds keep the DownloadItem but refuse removeFile after
      // certain interrupt reasons; Helper exact-path cleanup is the fallback.
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function cleanupInterruptedRule34Files() {
  let interrupted = [];
  try {
    interrupted = await chrome.downloads.search({ state: 'interrupted' });
  } catch (_) {
    return 0;
  }
  let removed = 0;
  for (const info of interrupted || []) {
    if (activeChromeDownloadIds.has(Number(info.id))) continue;
    if (!isRule34ChromeFailure(info)) continue;
    if (await removeChromeFailureFile(info.id)) removed += 1;
    // Drop the shelf row so a failed removeFile is not the only handle we have
    // on a path that Helper orphan-sweep can still delete by basename.
    try {
      await chrome.downloads.erase({ id: Number(info.id) });
    } catch (_) {
      /* ignore */
    }
  }
  return removed;
}

/**
 * Unconfirmed <n>.crdownload / zero-byte named leftovers. ONLY safe when the
 * queue is idle: deleting a live Chrome partial out from under an in_progress
 * download surfaces as Chrome "Failed - Download error" (file error, not network).
 */
async function sweepOrphanUnconfirmedPartials() {
  // Hard gate — do not trust keepPaths matching. Chrome often writes
  // `Unconfirmed <n>.crdownload` while filename/metadata still lag.
  if (
    activeJobCount > 0 ||
    activeChromeDownloadIds.size > 0 ||
    activeQueueItemIds.size > 0 ||
    protectedPartialPaths.size > 0
  ) {
    return { helperRemoved: 0, chromeRemoved: 0, skipped: true, reason: 'active_jobs' };
  }
  try {
    const inProgress = await chrome.downloads.search({ state: 'in_progress' });
    if ((inProgress || []).length > 0) {
      return { helperRemoved: 0, chromeRemoved: 0, skipped: true, reason: 'in_progress' };
    }
  } catch (_) {
    return { helperRemoved: 0, chromeRemoved: 0, skipped: true, reason: 'search_failed' };
  }

  let helperRemoved = 0;
  try {
    const result = await helperFetch('/downloads/cleanup-orphan-unconfirmed', {
      method: 'POST',
      body: { keepPaths: [] },
    });
    helperRemoved = Number(result?.removedPartials || 0);
  } catch (_) {
    /* Chrome removeFile sweep below remains the fallback */
  }
  const chromeRemoved = await cleanupInterruptedRule34Files();
  return { helperRemoved, chromeRemoved, skipped: false };
}

async function cleanupFailedDownloadArtifacts(item, err) {
  const videoId = String(item?.videoId || '').trim();
  const downloadId = Number(err?.chromeDownloadId || item?.chromeDownloadId || 0);
  const partialPaths = new Set(
    [...(Array.isArray(err?.partialPaths) ? err.partialPaths : [])]
      .map((p) => String(p || '').trim())
      .filter(Boolean),
  );
  const suggested = String(item?.filename || '').trim();
  if (suggested) {
    partialPaths.add(suggested);
    if (!suggested.endsWith('.crdownload')) partialPaths.add(`${suggested}.crdownload`);
  }
  for (const path of await collectFailurePartialPaths(downloadId)) {
    partialPaths.add(path);
  }
  await removeChromeFailureFile(downloadId);

  // Sweep other interrupted Chrome rows for this same video id (conflict copies,
  // earlier attempts) before Helper basename matching runs.
  try {
    const interrupted = await chrome.downloads.search({ state: 'interrupted' });
    const idRe = videoId ? new RegExp(`(?<!\\d)${videoId}(?!\\d)`) : null;
    for (const info of interrupted || []) {
      if (activeChromeDownloadIds.has(Number(info.id))) continue;
      const name = String(info.filename || '');
      const related =
        Number(info.id) === downloadId ||
        (idRe && idRe.test(name)) ||
        isRule34ChromeFailure(info);
      if (!related) continue;
      for (const path of chromeFailurePartialPaths(info)) partialPaths.add(path);
      await removeChromeFailureFile(info.id);
    }
  } catch (_) {
    /* Helper cleanup below remains authoritative for on-disk partials */
  }

  if (videoId) {
    try {
      await helperFetch('/downloads/cleanup-partials', {
        method: 'POST',
        body: { videoId, partialPaths: [...partialPaths] },
      });
    } catch (_) {
      /* Chrome removeFile / later wake sweep remain the fallback */
    }
  }
  // Do NOT orphan-sweep here. A sibling in_progress download may still be
  // writing Unconfirmed*.crdownload; wiping it causes Chrome "Download error".
}

function settleDownloadWaiter(id, state) {
  const waiter = downloadWaiters.get(Number(id));
  if (!waiter) return;
  downloadWaiters.delete(Number(id));
  if (state === 'complete') {
    waiter.resolve({ id: Number(id), state: 'complete' });
  } else if (cancelRequested) {
    waiter.resolve({ id: Number(id), state: 'cancelled' });
  } else {
    waiter.reject(new Error('Chrome download interrupted'));
  }
}

async function waitForExistingDownload(id) {
  const downloadId = Number(id);
  let info = await chromeDownloadById(downloadId);
  if (!info) throw new Error('Chrome download record missing');
  if (info.state === 'complete') return info;
  if (info.state === 'interrupted') {
    const reason = String(info.error || '').trim();
    throw new Error(`Chrome download interrupted${reason ? `: ${reason}` : ''}`);
  }

  activeChromeDownloadIds.add(downloadId);
  const pending = waitForDownload(downloadId);
  // Close the search/listener race: the download may finish after the first
  // search but before waitForDownload installs its waiter.
  info = await chromeDownloadById(downloadId);
  if (!info) settleDownloadWaiter(downloadId, 'interrupted');
  else if (info.state === 'complete' || info.state === 'interrupted') {
    settleDownloadWaiter(downloadId, info.state);
  }
  const result = await pending;
  if (result.state === 'cancelled' || cancelRequested) {
    const err = new Error('cancelled');
    err.cancelled = true;
    throw err;
  }
  info = await chromeDownloadById(downloadId);
  if (!info || info.state !== 'complete' || !info.filename) {
    throw new Error('download finished without local file');
  }
  return info;
}

function pickQualityUrl(html, order) {
  const links = [...html.matchAll(/href=["']([^"']*get_file[^"']*download=true[^"']*)["']/gi)].map(
    (m) => m[1].replace(/&amp;/g, '&'),
  );
  const labeled = [];
  for (const href of links) {
    const lower = href.toLowerCase();
    let quality = 'unknown';
    if (lower.includes('_1080p') || lower.includes('1080p')) quality = '1080p';
    else if (lower.includes('_720p') || lower.includes('720p')) quality = '720p';
    else if (lower.includes('_480p') || lower.includes('480p')) quality = '480p';
    else if (lower.includes('_360') || lower.includes('360p')) quality = '360p';
    labeled.push({ href, quality });
  }
  for (const q of order) {
    const hit = labeled.find((x) => x.quality === q);
    if (hit) return hit;
  }
  return labeled[0] || null;
}

function parseTitle(html, fallback) {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (!m) return fallback || '';
  return m[1]
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s*[-|].*$/, '')
    .trim();
}

async function resolveDownloadSource(detailUrl) {
  const cfg = await getConfig();
  const res = await fetch(detailUrl, { credentials: 'include', redirect: 'follow' });
  if (res.status === 403 || res.status === 404) {
    throw new Error(`detail page HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`detail page HTTP ${res.status}`);
  const html = await res.text();
  if (/captcha|ddos|cf-browser-verification|just a moment/i.test(html) && html.length < 5000) {
    throw new Error('possible captcha or bot check on detail page');
  }
  if (/login-required|\/login\/|\?login/i.test(res.url) && !/flashvars/i.test(html)) {
    throw new Error('login required to fetch download URL');
  }
  const picked = pickQualityUrl(html, cfg.qualityOrder || DEFAULT_QUALITY);
  if (!picked) throw new Error('no downloadable get_file URL found');
  const title = parseTitle(html, '');
  return { url: picked.href, quality: picked.quality, title, htmlLength: html.length };
}

const DEFAULT_QUALITY = ['1080p', '720p', '480p', '360p'];

async function finalizeCompletedDownload(item, info, fallbackTitle = '') {
  if (!info || info.state !== 'complete' || !info.filename) {
    throw new Error('download finished without local file');
  }
  const fileSize = Number(info.fileSize || 0);
  if (fileSize <= 0) {
    const err = new Error('Chrome download completed empty');
    err.chromeDownloadId = Number(info.id) || 0;
    err.partialPaths = chromeFailurePartialPaths(info);
    throw err;
  }
  const filename = item.filename || String(info.filename).split(/[\\/]/).pop();
  let imported;
  try {
    imported = await helperFetch('/downloads/import', {
      method: 'POST',
      body: {
        videoId: item.videoId,
        title: item.title || fallbackTitle || '',
        sourcePath: info.filename,
        filename,
      },
    });
  } catch (err) {
    // The service worker can be discarded after Helper moved the file but
    // before /downloads/complete. In that narrow window the staging source is
    // gone, while Helper's media index already has the valid destination.
    const lookup = await helperFetch('/lookup', {
      method: 'POST',
      body: { videoIds: [String(item.videoId)] },
    });
    const local = lookup?.results?.[String(item.videoId)];
    if (!local?.exists || !local.relativePath) throw err;
    imported = { relativePath: local.relativePath, alreadyExisted: true };
  }
  await helperFetch('/downloads/complete', {
    method: 'POST',
    body: {
      id: item.id,
      videoId: item.videoId,
      title: fallbackTitle || item.title || '',
      filename: imported.relativePath || filename,
    },
  });
  return imported;
}

async function downloadOne(item) {
  const detailUrl =
    item.detailUrl || `https://rule34video.com/video/${item.videoId}/`;
  const source = await resolveDownloadSource(detailUrl);
  const suggest = await helperFetch('/downloads/suggest-filename', {
    method: 'POST',
    body: {
      videoId: item.videoId,
      // Prefer detail-page <title> (already fetched). Helper strips any ordinal
      // and rebuilds `{seq}——{title}——{videoId}.mp4` from the ordinals DB.
      title: source.title || item.title || item.videoId,
      ext: '.mp4',
    },
  });
  const filename = suggest.filename;
  const cfg = await getConfig();
  // chrome.downloads cannot write arbitrary absolute paths. Stage under
  // ~/Downloads/HXYRULE/, then Helper imports into the realpath-locked video root.

  await helperFetch('/downloads/progress', {
    method: 'POST',
    body: {
      id: item.id,
      status: 'downloading',
      filename,
      quality: source.quality,
    },
  });

  const downloadId = await chrome.downloads.download({
    url: source.url,
    // The user's Chrome download directory is already the video root. Prefixing
    // this with HXYRULE created /HXYRULE/HXYRULE and stranded partials there.
    filename,
    conflictAction: 'uniquify',
    saveAs: false,
  });
  activeChromeDownloadIds.add(downloadId);
  await helperFetch('/downloads/progress', {
    method: 'POST',
    body: { id: item.id, status: 'downloading', chromeDownloadId: downloadId, filename },
  });
  try {
    if (cancelRequested) {
      try {
        await chrome.downloads.cancel(downloadId);
      } catch (_) {
        /* ignore */
      }
      const err = new Error('cancelled');
      err.cancelled = true;
      throw err;
    }
    // Search before and after installing the waiter so very small downloads
    // cannot finish in the gap and leave this worker waiting forever.
    let imported;
    try {
      const info = await waitForExistingDownload(downloadId);
      imported = await finalizeCompletedDownload(
        { ...item, filename },
        info,
        source.title || item.title || '',
      );
    } catch (err) {
      err.chromeDownloadId = downloadId;
      // Tasks remove (or Stop) aborted this Chrome download — do not Range-recover.
      if (cancelRequested || removedQueueItemIds.has(Number(item.id))) {
        const cancelled = new Error('cancelled');
        cancelled.cancelled = true;
        cancelled.chromeDownloadId = downloadId;
        throw cancelled;
      }
      // Keep this queue item/video lock occupied while Helper tries the partial.
      // A fresh Chrome retry is scheduled only after this recovery returns false.
      if (!cancelRequested && isTransientDownloadError(err)) {
        let interrupted = null;
        try {
          interrupted = await chromeDownloadById(downloadId);
        } catch (_) {
          /* fall through to the existing fresh-download retry */
        }
        const received = Number(interrupted?.bytesReceived || 0);
        const total = Number(interrupted?.totalBytes || 0);
        const interruptedPath = String(interrupted?.filename || '').trim();
        const partialPath = interruptedPath
          ? (interruptedPath.endsWith('.crdownload') ? interruptedPath : `${interruptedPath}.crdownload`)
          : '';
        const targetBase = interruptedPath.split(/[\\/]/).pop();
        const partialName = targetBase
          ? (targetBase.endsWith('.crdownload') ? targetBase : `${targetBase}.crdownload`)
          : '';
        // Chrome can leave failures as `Unconfirmed <random>.crdownload`.
        // Such a name contains no video ID, so preserve its exact validated
        // absolute path for Helper cleanup instead of relying on name matching.
        if (partialPath) err.partialPaths = [partialPath];
        // Range-resume the same partial only when Chrome reported a positive
        // byte total. Otherwise skip straight to cleanup + bounded fresh retry.
        // Protect before any further await so orphan Unconfirmed sweep cannot
        // delete a partial Helper is about to Range-recover.
        const canRecoverPartial = received > 0 && total > 0 && !!partialName;
        if (canRecoverPartial && partialPath) protectedPartialPaths.add(partialPath);
        if (canRecoverPartial) {
          try {
            const recoveryBody = {
              videoId: item.videoId,
              filename,
              partialName,
              partialPath,
              sourceUrl: source.url,
              expectedSize: total,
            };
            let recovered = await helperFetch('/downloads/recover-partial', {
              method: 'POST',
              body: recoveryBody,
            });
            // Keep continuing the same partial on temporary Range/network
            // failures. The queue item and video-id lock remain occupied, so
            // these attempts cannot create a second Chrome download.
            for (const delaySec of [5, 15, 30]) {
              if (recovered?.recovered || !/^range request failed:/i.test(recovered?.reason || '')) break;
              await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
              recovered = await helperFetch('/downloads/recover-partial', {
                method: 'POST',
                body: recoveryBody,
              });
            }
            if (recovered?.recovered) {
              await helperFetch('/downloads/complete', {
                method: 'POST',
                body: {
                  id: item.id,
                  videoId: item.videoId,
                  title: source.title || item.title || '',
                  filename: recovered.filename || filename,
                },
              });
              imported = { relativePath: recovered.filename || filename, recovered: true };
            }
          } catch (_) {
            /* validated recovery is optional; preserve normal bounded retry */
          } finally {
            if (partialPath) protectedPartialPaths.delete(partialPath);
          }
        }
        // Recovery exhausted or ineligible: delete this attempt's partial before
        // startQueueJob schedules a fresh Chrome download for the same video id.
        if (!imported) {
          await cleanupFailedDownloadArtifacts(item, err);
          throw err;
        }
      } else {
        throw err;
      }
    }
    // Successful files have already been imported; keep their Chrome history.
    // removeFile is reserved for terminal interrupted attempts only, and erase
    // is never used, so completed download records remain intact.
    return imported;
  } finally {
    activeChromeDownloadIds.delete(downloadId);
  }
}

async function recoverDownload(item) {
  const downloadId = Number(item.chromeDownloadId);
  try {
    try {
      const info = await waitForExistingDownload(downloadId);
      return await finalizeCompletedDownload(item, info, item.title || '');
    } catch (err) {
      try {
        const info = await chromeDownloadById(downloadId);
        const path = String(info?.filename || '').trim();
        if (path) err.partialPaths = [path.endsWith('.crdownload') ? path : `${path}.crdownload`];
      } catch (_) {
        /* preserve the original reconciliation error */
      }
      err.chromeDownloadId = downloadId;
      throw err;
    }
  } finally {
    activeChromeDownloadIds.delete(downloadId);
  }
}

function startQueueJob(item, work) {
  const itemId = Number(item.id);
  if (!itemId || activeQueueItemIds.has(itemId)) return false;
  activeQueueItemIds.add(itemId);
  activeJobCount += 1;
  Promise.resolve()
    .then(work)
    .catch(async (err) => {
      // Chrome owns the authoritative mapping for random
      // `Unconfirmed <n>.crdownload` names. Recovery is already exhausted when
      // control reaches here, so remove this interrupted DownloadItem's file
      // (and Helper exact/video-id partials) before scheduling a fresh attempt.
      await cleanupFailedDownloadArtifacts(item, err);
      if (removedQueueItemIds.has(itemId)) {
        removedQueueItemIds.delete(itemId);
        // Tasks already marked this row cancelled; do not wipe the rest of the queue.
      } else if (cancelRequested || err.cancelled || /cancelled/i.test(String(err.message || ''))) {
        try {
          await helperFetch('/downloads/cancel', { method: 'POST', body: {} });
        } catch (_) {
          /* ignore */
        }
      } else if (isTransientDownloadError(err)) {
        // Cleanup failure must never prevent the bounded retry from being
        // persisted. A later terminal cleanup still gets the same exact path.
        try {
          const retry = await helperFetch('/downloads/auto-retry', {
            method: 'POST',
            body: { id: item.id, error: String(err.message || err).slice(0, 500) },
          });
          if (retry?.exhausted) {
            await cleanupFailedDownloadArtifacts(item, err);
          }
        } catch (_) {
          // Keep the queue state explicit if an older/unavailable Helper cannot
          // persist the bounded retry.
          try {
            await helperFetch('/downloads/fail', {
              method: 'POST',
              body: { id: item.id, error: String(err.message || err).slice(0, 500) },
            });
            await cleanupFailedDownloadArtifacts(item, err);
          } catch (_) {
            /* ignore */
          }
        }
      } else {
        try {
          await helperFetch('/downloads/fail', {
            method: 'POST',
            body: { id: item.id, error: String(err.message || err).slice(0, 500) },
          });
          await cleanupFailedDownloadArtifacts(item, err);
        } catch (_) {
          /* ignore */
        }
      }
    })
    .finally(() => {
      activeQueueItemIds.delete(itemId);
      activeJobCount = Math.max(0, activeJobCount - 1);
      runQueueWorker();
      // Only after the whole pool is idle — never beside live Chrome writers.
      if (activeJobCount === 0 && activeChromeDownloadIds.size === 0) {
        sweepOrphanUnconfirmedPartials().catch(() => {});
      }
    });
  return true;
}

function isTransientDownloadError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  if (/http (403|404)|login required|captcha|bot check|no downloadable/.test(message)) {
    return false;
  }
  return (
    /interrupted|completed empty|network|failed to fetch|fetch failed|timeout|timed out|connection|econn|enotfound/.test(
      message,
    ) || /http (408|425|429|5\d\d)/.test(message)
  );
}

async function recoverOrphanedDownloads() {
  const snapshot = await helperFetch('/downloads/status');
  const orphaned = (snapshot.items || []).filter(
    (item) => item.status === 'downloading' && !activeQueueItemIds.has(Number(item.id)),
  );
  let requeued = false;
  for (const item of orphaned) {
    const downloadId = Number(item.chromeDownloadId);
    let info = null;
    if (downloadId > 0) {
      try {
        info = await chromeDownloadById(downloadId);
      } catch (_) {
        /* Treat an unreadable record like a missing record and fetch a fresh URL. */
      }
    }
    if (info && (info.state === 'in_progress' || info.state === 'complete')) {
      startQueueJob(item, () => recoverDownload(item));
      continue;
    }
    // A claim can persist without a Chrome id if MV3 was stopped while resolving
    // the detail page. Missing/interrupted Chrome jobs also need a fresh short-lived URL.
    // Drop any stranded partial for this video before the fresh attempt.
    await cleanupFailedDownloadArtifacts(item, {
      chromeDownloadId: downloadId,
      partialPaths: chromeFailurePartialPaths(info),
    });
    await helperFetch('/downloads/auto-retry', {
      method: 'POST',
      body: { id: item.id, error: 'Chrome download interrupted or missing' },
    });
    requeued = true;
  }
  // /retry resumes the queue. Preserve an explicit/manual or failure pause while
  // still repairing stale rows so Retry/Skip remains the user's decision.
  if (requeued && snapshot.paused) {
    await helperFetch('/downloads/pause', { method: 'POST', body: {} });
  }
  // Idle-only orphan sweep (no-op while any Chrome/Helper job is still live).
  await sweepOrphanUnconfirmedPartials();
}

async function recoverFailedQueueItems() {
  const snapshot = await helperFetch('/downloads/status');
  const failed = (snapshot.items || []).filter((item) => item.status === 'failed');
  for (const item of failed) {
    await helperFetch('/downloads/retry', { method: 'POST', body: { id: item.id } });
  }
  const status = failed.length ? await helperFetch('/downloads/status') : snapshot;
  return { ...status, retriedFailed: failed.length };
}

async function runQueueWorker() {
  pumpRequested = true;
  if (cancelRequested) return;
  if (pumpInProgress) return;
  pumpInProgress = true;
  try {
    while (pumpRequested && !cancelRequested) {
      pumpRequested = false;
      try {
        await recoverOrphanedDownloads();
      } catch (err) {
        console.warn('queue recovery failed', err);
      }
      while (activeJobCount < DOWNLOAD_CONCURRENCY && !cancelRequested) {
        let claim;
        try {
          claim = await helperFetch('/downloads/claim', { method: 'POST', body: {} });
        } catch (err) {
          console.warn('claim failed', err);
          return;
        }
        const item = claim.item;
        if (!item) break;
        if (!startQueueJob(item, () => downloadOne(item))) {
          // A page-load retry can race the previous promise's final cleanup.
          // Put the duplicate claim back and let that cleanup pump us again.
          await helperFetch('/downloads/retry', { method: 'POST', body: { id: item.id } });
          break;
        }
      }
    }
  } finally {
    pumpInProgress = false;
    if (pumpRequested && !cancelRequested) {
      runQueueWorker();
    }
  }
}

async function getSelection() {
  const data = await chrome.storage.local.get(['hxyruleSelection']);
  return data.hxyruleSelection || { items: {}, updatedAt: 0 };
}

async function setSelection(sel) {
  await chrome.storage.local.set({ hxyruleSelection: sel });
  return sel;
}

async function getFavIndex(scope = 'favorites') {
  const key = scope && scope !== 'favorites' ? `hxyruleIndex:${scope}` : 'hxyruleFavIndex';
  const data = await chrome.storage.local.get([key]);
  return data[key] || { builtAt: 0, favTotal: 0, videos: [] };
}

async function setFavIndex(index, scope = 'favorites') {
  const key = scope && scope !== 'favorites' ? `hxyruleIndex:${scope}` : 'hxyruleFavIndex';
  const next = {
    builtAt: Number(index?.builtAt) || Date.now(),
    favTotal: Number(index?.favTotal) || (index?.videos || []).length,
    videos: Array.isArray(index?.videos) ? index.videos : [],
    scope: scope || 'favorites',
  };
  await chrome.storage.local.set({ [key]: next });
  return next;
}

/** Union of videoIds across all stored playlist indexes (hxyruleIndex:playlist:*). */
async function getPlaylistMembership() {
  const all = await chrome.storage.local.get(null);
  const videoIds = new Set();
  const scopes = [];
  Object.entries(all || {}).forEach(([key, val]) => {
    const m = String(key).match(/^hxyruleIndex:(playlist:[1-9]\d*)$/);
    if (!m) return;
    scopes.push(m[1]);
    (val?.videos || []).forEach((v) => {
      const id = String(v?.videoId || '').trim();
      if (id) videoIds.add(id);
    });
  });
  scopes.sort();
  return { videoIds: [...videoIds], scopes, count: videoIds.size };
}

function parseDurationSec(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  // Prefer an explicit clock token so icon / label noise in .time does not fail parse.
  const clock = raw.match(/(\d+:\d{1,2}(?::\d{1,2})?)/);
  const source = clock ? clock[1] : raw;
  const parts = source.split(':').map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  return null;
}

function extractDurationFromChunk(chunk) {
  const m =
    String(chunk || '').match(/class=["'][^"']*\btime\b[^"']*["'][^>]*>\s*([\d:]+)/i) ||
    String(chunk || '').match(/<div\s+class=["']time["'][^>]*>\s*([\d:]+)/i);
  return m ? parseDurationSec(m[1]) : null;
}

function parseDurationMap(html) {
  const map = {};
  const src = String(html || '');
  const openRe = /<div\b[^>]*class=["'][^"']*\bitem\b[^"']*\bthumb\b[^"']*["'][^>]*>/gi;
  const opens = [...src.matchAll(openRe)];
  for (let i = 0; i < opens.length; i += 1) {
    const start = opens[i].index;
    const end = i + 1 < opens.length ? opens[i + 1].index : Math.min(src.length, start + 8000);
    const block = src.slice(start, end);
    const id = parseDeleteValue(block) || (block.match(/\/video\/(\d+)\//i) || [])[1];
    if (!id) continue;
    const dur = extractDurationFromChunk(block);
    if (dur != null) map[String(id)] = dur;
  }
  return map;
}

function isValidPlaylistId(id) {
  return /^[1-9]\d*$/.test(String(id || '').trim());
}

function parsePlaylistsFromHtml(html) {
  const byId = new Map();
  const cleanTitle = (raw, pid) => {
    let t = String(raw || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/[-_/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    t = t
      .replace(/^my\s*playlists?\s*[:：\-–]?\s*/i, '')
      .replace(/^playlists?\s*[:：\-–]?\s*/i, '')
      .replace(/\b(public|private)\b/gi, ' ')
      .replace(/\b\d[\d\s,]*\s*videos?\b/gi, ' ')
      .replace(/\(\s*[\d,\s.]+\s*(videos?)?\s*\)/gi, ' ')
      .replace(/（\s*[\d,\s.]+\s*(videos?)?\s*）/gi, ' ')
      .replace(new RegExp(`^#?${pid}\\s*[·•\\-:]?\\s*`, 'i'), '')
      .replace(new RegExp(`\\s*[#(]?${pid}[)]?\\s*$`, 'i'), '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^(create|new|新建|edit|delete|remove|view)/i.test(t)) return '';
    if (t === pid || t === `Playlist ${pid}`) return '';
    return t;
  };
  const score = (title, pid) => {
    const t = String(title || '').trim();
    if (!t) return 0;
    if (t === pid || t === `Playlist ${pid}` || t === `#${pid}`) return 1;
    if (/^\d+$/.test(t)) return 1;
    if (/^playlist\s+\d+$/i.test(t)) return 2;
    return 10 + Math.min(t.length, 48);
  };
  const push = (id, title) => {
    const pid = String(id || '').trim();
    if (!isValidPlaylistId(pid)) return;
    const clean = cleanTitle(title, pid);
    const nextTitle = clean || `Playlist ${pid}`;
    const prev = byId.get(pid);
    if (!prev || score(nextTitle, pid) > score(prev.title, pid)) {
      byId.set(pid, { id: pid, title: nextTitle });
    }
  };

  const src = String(html || '');
  try {
    const doc = new DOMParser().parseFromString(src, 'text/html');
    doc.querySelectorAll('input[name="playlist_id"]').forEach((inp) => {
      const pid = inp.value || inp.getAttribute('value');
      let title =
        inp.getAttribute('data-playlist-title') ||
        inp.closest('[data-playlist-title]')?.getAttribute('data-playlist-title') ||
        '';
      const label = inp.closest('label') || (inp.id ? doc.querySelector(`label[for="${inp.id}"]`) : null);
      if (label) title = title || label.textContent || '';
      const item = inp.closest('.item, li, .playlist, tr');
      const titleEl =
        item && item.querySelector('.title a, a.title, strong.title, .title, .playlist-title, .name');
      if (titleEl) title = titleEl.textContent || title;
      push(pid, title);
    });
    doc.querySelectorAll('[data-playlist-id]').forEach((el) => {
      push(el.getAttribute('data-playlist-id'), el.getAttribute('data-playlist-title') || el.textContent);
    });
    doc.querySelectorAll('a[href*="/playlists/"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const m =
        href.match(/\/my\/playlists\/([1-9]\d*)(?:\/|$|\?|#)/i) ||
        href.match(/\/playlists\/([1-9]\d*)\/([A-Za-z0-9][^"'/]*)/i) ||
        href.match(/\/edit-playlist\/([1-9]\d*)/i);
      if (!m) return;
      const pid = m[1];
      const item = a.closest('.item, li, .playlist, tr');
      const titleEl =
        (item && item.querySelector('.title a, a.title, strong.title, .title, .playlist-title, .name')) || a;
      let title = (titleEl && titleEl.textContent) || '';
      if (!cleanTitle(title, pid) && m[2]) title = m[2];
      push(pid, title);
    });
  } catch (_) {
    /* regex fallback below */
  }

  for (const m of src.matchAll(
    /data-playlist-id=["']([1-9]\d*)["'][^>]*data-playlist-title=["']([^"']*)["']/gi,
  )) {
    push(m[1], m[2]);
  }
  for (const m of src.matchAll(
    /data-playlist-title=["']([^"']*)["'][^>]*data-playlist-id=["']([1-9]\d*)["']/gi,
  )) {
    push(m[2], m[1]);
  }
  for (const m of src.matchAll(
    /name=["']playlist_id["'][^>]*value=["']([1-9]\d*)["'][^>]*>/gi,
  )) {
    push(m[1], '');
  }
  for (const m of src.matchAll(
    /value=["']([1-9]\d*)["'][^>]*name=["']playlist_id["'][^>]*>/gi,
  )) {
    push(m[1], '');
  }
  for (const m of src.matchAll(
    /<label\b[^>]*>[\s\S]{0,400}?name=["']playlist_id["'][^>]*value=["']([1-9]\d*)["'][\s\S]{0,400}?<\/label>/gi,
  )) {
    push(m[1], m[0]);
  }
  for (const m of src.matchAll(
    /name=["']playlist_id["'][^>]*value=["']([1-9]\d*)["'][^>]*>[\s\S]{0,120}?<\/label>/gi,
  )) {
    push(m[1], m[0]);
  }
  for (const m of src.matchAll(
    /href=["'](?:https?:\/\/rule34video\.com)?\/my\/playlists\/([1-9]\d*)\/([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    push(m[1], m[3] || m[2] || '');
  }
  for (const m of src.matchAll(
    /href=["'](?:https?:\/\/rule34video\.com)?\/playlists\/([1-9]\d*)\/([A-Za-z0-9][^"'/]*)\/?["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    push(m[1], m[3] || m[2] || '');
  }
  for (const m of src.matchAll(
    /href=["'](?:https?:\/\/rule34video\.com)?\/edit-playlist\/([1-9]\d*)\/["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    push(m[1], m[2] || '');
  }
  return [...byId.values()];
}

async function siteFetch(url, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    redirect: 'follow',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'text/html, application/json, */*;q=0.1',
      ...headers,
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, url: res.url, text };
}

async function listSitePlaylists() {
  // Prefer native select-playlist picker (same as Move to playlist fancybox).
  const attempts = [
    'https://rule34video.com/select-playlist/',
    'https://rule34video.com/my/playlists/',
    'https://rule34video.com/?mode=async&function=get_block&block_id=list_playlists_my_created_playlists',
    'https://rule34video.com/?mode=async&function=get_block&block_id=list_playlists_my_created_playlists&global=true',
  ];
  let lastErr = '';
  for (const url of attempts) {
    try {
      const res = await siteFetch(url);
      if (!res.ok || !res.text) {
        lastErr = `HTTP ${res.status} for ${url}`;
        continue;
      }
      if (/login-required|\/login\/|sign\s*in/i.test(res.text) && res.text.length < 8000) {
        lastErr = 'not logged in';
        continue;
      }
      const list = parsePlaylistsFromHtml(res.text);
      if (list.length) return { playlists: list, sourceUrl: url };
      lastErr = `0 playlists parsed from ${url}`;
    } catch (err) {
      lastErr = String(err.message || err);
    }
  }
  throw new Error(lastErr || 'Could not load site playlists');
}

function buildAsyncQuery(params) {
  const q = new URLSearchParams();
  q.set('mode', 'async');
  q.set('format', 'json');
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((v) => q.append(`${key}[]`, String(v)));
    } else {
      q.set(key, String(value));
    }
  });
  return q.toString();
}

async function parseJsonStatus(res) {
  const raw = String(res.text || '').trim();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch (_) {
    return {
      ok: false,
      detail: `non-JSON HTTP ${res.status} (${raw.slice(0, 60).replace(/\s+/g, ' ')})`,
      json: null,
    };
  }
  const status = String(json?.status || '');
  if (status === 'success') return { ok: true, json };
  const code =
    json?.errors?.[0]?.code ||
    json?.errors?.[0]?.message ||
    json?.message ||
    status ||
    'unknown';
  return { ok: false, detail: String(code), json };
}

async function addVideosToSitePlaylist(playlistId, videoIds, mode = 'save') {
  const pid = String(playlistId || '').trim();
  if (!isValidPlaylistId(pid)) throw new Error('invalid playlist id');
  const ids = [...new Set((videoIds || []).map((v) => String(v).trim()).filter((v) => /^[1-9]\d*$/.test(v)))];
  if (!ids.length) throw new Error('no video ids');

  // save = add_to_favourites fav_type=10 (keeps My Favorites)
  // move is handled in the content script via move_to_playlist_id
  if (mode === 'move') {
    throw new Error('move mode must run in favorites page content script');
  }

  let ok = 0;
  let failed = 0;
  const errors = [];
  for (const id of ids) {
    const added = await addOneViaFavouritesAction(pid, id);
    if (added.ok) ok += 1;
    else {
      failed += 1;
      if (errors.length < 8) errors.push(`${id}: ${added.detail || 'failed'}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  if (ok === 0 && failed > 0) {
    throw new Error(
      `Playlist save failed for all ${failed} video(s)` +
        (errors.length ? `: ${errors.slice(0, 3).join('; ')}` : ''),
    );
  }
  return { playlistId: pid, total: ids.length, ok, failed, errors, method: 'add_to_favourites' };
}

async function addOneViaFavouritesAction(playlistId, videoId) {
  const pid = String(playlistId);
  const id = String(videoId);
  // Try param shapes seen in kvs.min.js btn-favourites handler.
  const variants = [
    { action: 'add_to_favourites', video_id: id, fav_type: '10', playlist_id: pid },
    { action: 'add_to_favourites', video_id: id, playlist_id: pid, fav_type: '10' },
    { action: 'add_to_favourites', video_id: id, video_ids: [id], fav_type: '10', playlist_id: pid },
    { action: 'add_to_favourites', video_id: id, playlist_id: pid },
  ];
  const bases = [
    `https://rule34video.com/video/${id}/`,
    'https://rule34video.com/',
    'https://rule34video.com/my/favourites/videos/',
  ];
  let lastDetail = '';
  for (const params of variants) {
    const qs = buildAsyncQuery(params);
    for (const base of bases) {
      const url = `${base}${base.includes('?') ? '&' : '?'}${qs}`;
      try {
        const res = await siteFetch(url, {
          headers: { Accept: 'application/json, text/javascript, */*;q=0.1' },
        });
        const parsed = await parseJsonStatus(res);
        if (parsed.ok) return { ok: true };
        lastDetail = parsed.detail;
        if (parsed.detail === 'invalid_params') continue;
        if (String(parsed.json?.status) === 'failure') {
          // definite API rejection for this variant
          break;
        }
      } catch (err) {
        lastDetail = String(err.message || err);
      }
    }
  }
  return { ok: false, detail: lastDetail || 'invalid_params' };
}

async function addOneToMyFavourites(videoId) {
  const id = String(videoId);
  const variants = [
    { action: 'add_to_favourites', video_id: id, video_ids: [id], fav_type: '0', playlist_id: '0' },
    { action: 'add_to_favourites', video_id: id, video_ids: [id], fav_type: '0' },
    { action: 'add_to_favourites', video_id: id, fav_type: '0', playlist_id: '0' },
    { action: 'add_to_favourites', video_id: id, video_ids: [id] },
  ];
  const bases = [
    `https://rule34video.com/video/${id}/`,
    'https://rule34video.com/',
    'https://rule34video.com/my/favourites/videos/',
  ];
  let lastDetail = '';
  for (const params of variants) {
    const qs = buildAsyncQuery(params);
    for (const base of bases) {
      const url = `${base}${base.includes('?') ? '&' : '?'}${qs}`;
      try {
        const res = await siteFetch(url, {
          headers: { Accept: 'application/json, text/javascript, */*;q=0.1' },
        });
        const parsed = await parseJsonStatus(res);
        if (parsed.ok) return { ok: true };
        lastDetail = parsed.detail;
        if (parsed.detail === 'invalid_params') continue;
        if (String(parsed.json?.status) === 'failure') break;
      } catch (err) {
        lastDetail = String(err.message || err);
      }
    }
  }
  return { ok: false, detail: lastDetail || 'invalid_params' };
}

async function addVideosToMyFavourites(videoIds) {
  const ids = [
    ...new Set((videoIds || []).map((v) => String(v).trim()).filter((v) => /^[1-9]\d*$/.test(v))),
  ];
  if (!ids.length) throw new Error('no video ids');
  let ok = 0;
  let failed = 0;
  const errors = [];
  for (const id of ids) {
    const added = await addOneToMyFavourites(id);
    if (added.ok) ok += 1;
    else {
      failed += 1;
      if (errors.length < 8) errors.push(`${id}: ${added.detail || 'failed'}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  if (ok === 0 && failed > 0) {
    throw new Error(
      `Add to Favorites failed for all ${failed}` +
        (errors.length ? `: ${errors.slice(0, 3).join('; ')}` : ''),
    );
  }
  return { total: ids.length, ok, failed, errors, method: 'add_to_favourites' };
}

/** Move selected Favorites videos into a playlist (leaves My Favorites). */
async function moveVideosToSitePlaylist(playlistId, videoIds) {
  const pid = String(playlistId || '').trim();
  if (!isValidPlaylistId(pid)) throw new Error('invalid playlist id');
  const ids = [
    ...new Set((videoIds || []).map((v) => String(v).trim()).filter((v) => /^[1-9]\d*$/.test(v))),
  ];
  if (!ids.length) throw new Error('no video ids');
  const bases = [
    'https://rule34video.com/my/favourites/videos/',
    'https://rule34video.com/my/favourites/videos',
  ];
  const encodings = ['brackets', 'plain'];
  let lastDetail = 'no attempt';
  for (const base of bases) {
    for (const enc of encodings) {
      const q = new URLSearchParams({ mode: 'async', format: 'json' });
      q.set('function', 'get_block');
      q.set('block_id', 'list_videos_my_favourite_videos');
      q.set('move_to_playlist_id', pid);
      ids.forEach((id) => {
        if (enc === 'brackets') q.append('delete[]', id);
        else q.append('delete', id);
      });
      const url = `${base}${base.includes('?') ? '&' : '?'}${q.toString()}`;
      try {
        const res = await siteFetch(url, {
          headers: { Accept: 'application/json, text/javascript, */*;q=0.1' },
        });
        const parsed = await parseJsonStatus(res);
        if (parsed.ok) return { ok: true, detail: 'success', deleteCount: ids.length };
        lastDetail = parsed.detail || `HTTP ${res.status}`;
      } catch (err) {
        lastDetail = String(err.message || err);
      }
    }
  }
  return { ok: false, detail: lastDetail, deleteCount: ids.length };
}

function normalizeJobItems(rawItems, videoIds) {
  const out = {};
  const src = rawItems && typeof rawItems === 'object' ? rawItems : {};
  (videoIds || []).forEach((id) => {
    const key = String(id);
    const hit = src[key] || src[Number(key)] || {};
    out[key] = {
      videoId: key,
      title: String(hit.title || key),
      detailUrl: String(hit.detailUrl || `https://rule34video.com/video/${key}/`),
      favoritePage: Number(hit.favoritePage) || 0,
      cardIndex: Number.isInteger(hit.cardIndex) ? hit.cardIndex : 0,
      durationSec:
        hit.durationSec == null || hit.durationSec === ''
          ? null
          : Number(hit.durationSec),
    };
  });
  return out;
}

const JOB_ORDINAL_PREFIX_RE = /^(\d+)\s*——\s*/;

function ordinalFromJobTitle(title) {
  const m = String(title || '').match(JOB_ORDINAL_PREFIX_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Sort by Helper Renumber seq ascending (1…N). Chunks lookup (max 500/call). */
async function sortVideoIdsByOrdinalAsc(ids, items = {}) {
  const list = [
    ...new Set((ids || []).map((v) => String(v).trim()).filter((v) => /^[1-9]\d*$/.test(v))),
  ];
  if (list.length <= 1) return list;
  const map = {};
  const CHUNK = 500;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    try {
      const looked = await helperFetch('/ordinals/lookup', {
        method: 'POST',
        body: { videoIds: chunk },
      });
      Object.assign(map, looked?.ordinals || {});
    } catch (_) {
      /* Helper optional; title prefix fallback below */
    }
  }
  const scored = list.map((id, i) => {
    let seq = map[id] != null ? Number(map[id]) : NaN;
    if (!Number.isFinite(seq) || seq < 1) {
      const hit = items[id] || items[Number(id)] || {};
      seq = ordinalFromJobTitle(hit.title) || Infinity;
    }
    return { id, seq, i };
  });
  scored.sort((a, b) => a.seq - b.seq || a.i - b.i);
  return scored.map((x) => x.id);
}

function playlistAddJobResult(job, { stopped = false } = {}) {
  return {
    mode: job.mode || 'save',
    playlistIds: Array.isArray(job.playlistIds) ? job.playlistIds.slice() : [],
    videoIds: Array.isArray(job.videoIds) ? job.videoIds.slice() : [],
    ok: Number(job.ok) || 0,
    failed: Number(job.failed) || 0,
    done: Number(job.done) || 0,
    total: Number(job.total) || 0,
    okIdsByPlaylist: { ...(job.okIdsByPlaylist || {}) },
    moveOkIds: Array.isArray(job.moveOkIds) ? job.moveOkIds.slice() : [],
    errors: Array.isArray(job.errors) ? job.errors.slice(0, 8) : [],
    items: job.items && typeof job.items === 'object' ? job.items : {},
    sourceScope: String(job.sourceScope || ''),
    stopped: !!stopped,
  };
}

/**
 * MAIN-world helpers must be self-contained: chrome.scripting.executeScript
 * serializes only the function body, not sibling helpers.
 *
 * Site flow: .js-open-popup → .js-click[data-fancybox=ajax] → $.fancybox ajax.
 * Our list innerHTML replaces wipe KVS per-node fancybox handlers.
 */
function pageRebindAjaxPopups() {
  const $ = window.jQuery || window.$;
  if (!$ || typeof $.fancybox !== 'function') return { ok: false, reason: 'fancybox missing' };
  const opts = {
    topRatio: 0,
    openEffect: 'none',
    openSpeed: 0,
    closeEffect: 'none',
    closeSpeed: 0,
    prevEffect: 'none',
    prevSpeed: 0,
    nextEffect: 'none',
    nextSpeed: 0,
  };
  const openAjax = (ajaxHref) => {
    if (!ajaxHref) return;
    $.fancybox([{ href: ajaxHref, type: 'ajax' }], opts);
  };
  document.querySelectorAll('[data-fancybox="ajax"]').forEach((el) => {
    el.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openAjax(el.getAttribute('data-href') || el.getAttribute('href'));
    };
  });
  // Compact clones lose KVS .js-open-popup handlers. Wire thumb links in the
  // compact host so a plain click opens Fancybox without a prior Ctrl/Cmd+click.
  let compactBound = 0;
  document
    .querySelectorAll(
      '.hxyrule-compact-thumbs .item.thumb[data-hxyrule-compact="1"] a.th, ' +
        '.hxyrule-compact-thumbs .item.thumb[data-hxyrule-compact="1"] a[href*="/video/"]',
    )
    .forEach((el) => {
      if (el.dataset.hxyrulePopupBound === '1') return;
      el.dataset.hxyrulePopupBound = '1';
      el.addEventListener(
        'click',
        (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (event.button != null && event.button !== 0) return;
          const item = el.closest('.item.thumb');
          if (!item) return;
          const id =
            (item.className.match(/\bvideo_(\d+)\b/) || [])[1] ||
            (el.getAttribute('href') || '').match(/\/video\/(\d+)\//)?.[1] ||
            '';
          const clickEl =
            item.querySelector('a.js-click[data-fancybox="ajax"], [data-fancybox="ajax"]') ||
            null;
          let ajaxHref =
            clickEl?.getAttribute('data-href') || clickEl?.getAttribute('href') || '';
          if (
            id &&
            ajaxHref &&
            !ajaxHref.includes(`/popup-video/${id}/`) &&
            !ajaxHref.includes(`/video/${id}/`)
          ) {
            ajaxHref = '';
          }
          if (!ajaxHref && id) {
            ajaxHref = `https://rule34video.com/popup-video/${id}/?popup_id=1`;
          }
          if (!ajaxHref) return;
          event.preventDefault();
          event.stopPropagation();
          try {
            const pageHref = el.getAttribute('href') || '';
            if (pageHref) window.history.pushState('page2', 'Title', pageHref);
          } catch (_) {
            /* ignore */
          }
          openAjax(ajaxHref);
        },
        true,
      );
      compactBound += 1;
    });
  return {
    ok: true,
    count: document.querySelectorAll('[data-fancybox="ajax"]').length,
    compactBound,
  };
}

/**
 * Re-bind KVS/jQuery lazyload after list innerHTML replace or boot unhide.
 * Must run in MAIN world — content-script <script> injects are blocked by CSP,
 * which left post-pagination thumbs stuck on grey.gif placeholders.
 */
function pageReinitThumbLazyload() {
  const root = document.querySelector(
    '#list_videos_my_favourite_videos_items, #list_videos_common_videos_list_items, [id^="list_videos"][id$="_items"], .thumbs',
  );
  if (!root) return { ok: false, reason: 'no root' };
  const $ = window.jQuery || window.$;
  let bound = 0;
  let usedPlugin = false;
  if ($ && typeof $.fn === 'object') {
    const imgs = $(root).find(
      'img.lazy-load, img.lazy, img.lazyload, img[data-original], img[data-src]',
    );
    bound = imgs.length;
    if (imgs.length && typeof imgs.lazyload === 'function') {
      try {
        imgs.lazyload({ failure_limit: 200, threshold: 400 });
        usedPlugin = true;
      } catch (_) {
        /* ignore */
      }
    }
    try {
      $(window).trigger('scroll').trigger('resize').trigger('lookup');
    } catch (_) {
      /* ignore */
    }
    try {
      $(document).trigger('kt_loaded').trigger('ajaxComplete');
    } catch (_) {
      /* ignore */
    }
  }
  ['init_lazy_load', 'initLazyLoad', 'initThumbs', 'lazyLoadImages'].forEach((name) => {
    try {
      if (typeof window[name] === 'function') window[name]();
    } catch (_) {
      /* ignore */
    }
  });
  // Last resort only when the site plugin is missing: copy data-original → src
  // the same way jquery.lazyload would for in-viewport thumbs.
  if (!usedPlugin) {
    root
      .querySelectorAll('img[data-original], img[data-src], img[data-lazy-src]')
      .forEach((img) => {
        const url =
          img.getAttribute('data-original') ||
          img.getAttribute('data-src') ||
          img.getAttribute('data-lazy-src');
        if (!url) return;
        const cur = img.getAttribute('src') || '';
        if (cur === url) return;
        if (
          !cur ||
          /grey\.gif|blank|spacer|placeholder|transparent|data:image\/gif/i.test(cur)
        ) {
          img.setAttribute('src', url);
        }
      });
  }
  const kick = () => {
    try {
      window.dispatchEvent(new Event('scroll'));
    } catch (_) {
      /* ignore */
    }
    try {
      document.dispatchEvent(new Event('scroll'));
    } catch (_) {
      /* ignore */
    }
    if ($) {
      try {
        $(window).trigger('scroll');
      } catch (_) {
        /* ignore */
      }
    }
  };
  kick();
  setTimeout(kick, 50);
  setTimeout(kick, 250);
  return { ok: true, bound, usedPlugin };
}

/** Open an arbitrary Fancybox ajax URL (e.g. create-playlist). */
function pageOpenAjaxHref(href) {
  const ajaxHref = String(href || '').trim();
  if (!ajaxHref) return { ok: false, reason: 'missing href' };
  const $ = window.jQuery || window.$;
  if (!$ || typeof $.fancybox !== 'function') {
    return { ok: false, reason: 'fancybox missing' };
  }
  const opts = {
    topRatio: 0,
    openEffect: 'none',
    openSpeed: 0,
    closeEffect: 'none',
    closeSpeed: 0,
    prevEffect: 'none',
    prevSpeed: 0,
    nextEffect: 'none',
    nextSpeed: 0,
  };
  $.fancybox([{ href: ajaxHref, type: 'ajax' }], opts);
  return { ok: true, method: 'fancybox-ajax' };
}

/** Stop media + close Fancybox so exit cannot leave a ghost audio stream. */
function pageCloseNativePopup() {
  const $ = window.jQuery || window.$;
  const roots = Array.from(
    document.querySelectorAll(
      '.fancybox-wrap, .fancybox-container, .fancybox-inner, .mfp-wrap, .mfp-content',
    ),
  );
  const videos = new Set();
  roots.forEach((root) => {
    root.querySelectorAll('video, audio').forEach((media) => videos.add(media));
  });
  videos.forEach((media) => {
    try {
      media.pause();
      media.muted = true;
      media.volume = 0;
    } catch (_) {
      /* ignore */
    }
  });
  try {
    if ($ && typeof $.fancybox?.close === 'function') $.fancybox.close(true);
    else if ($) $('.fancybox-close, .fancybox-close-small').trigger('click');
  } catch (_) {
    /* ignore */
  }
  try {
    if (typeof window.url_home === 'string' && window.url_home) {
      window.history.pushState('page2', 'Title', window.url_home);
    }
  } catch (_) {
    /* ignore */
  }
  return { ok: true, silenced: videos.size };
}

function pageOpenNativePopup(href, videoId) {
  const id = String(videoId || '');
  const wantHref = String(href || '');
  const popupFallback = id ? `https://rule34video.com/popup-video/${id}/?popup_id=1` : '';
  const opts = {
    topRatio: 0,
    openEffect: 'none',
    openSpeed: 0,
    closeEffect: 'none',
    closeSpeed: 0,
    prevEffect: 'none',
    prevSpeed: 0,
    nextEffect: 'none',
    nextSpeed: 0,
  };

  const resolve = () => {
    const $ = window.jQuery || window.$;
    // Prefer compact-match cards: native favorites stay in DOM (hidden) and would
    // otherwise win querySelectorAll / stale fancybox data-href from sample clones.
    const compactHost = document.querySelector('.hxyrule-compact-thumbs');
    const roots = compactHost ? [compactHost, document] : [document];
    let item = null;
    for (const root of roots) {
      const items = Array.from(root.querySelectorAll('.item.thumb'));
      item =
        items.find((el) => {
          if (
            id &&
            (el.classList.contains(`video_${id}`) || el.querySelector(`[href*="/video/${id}/"]`))
          ) {
            return true;
          }
          const a = el.querySelector('a.th.js-open-popup, a.th');
          if (!a) return false;
          const h = a.getAttribute('href') || '';
          return (
            (wantHref && (h === wantHref || a.href === wantHref)) ||
            (id && (h.includes(`/video/${id}/`) || a.href.includes(`/video/${id}/`)))
          );
        }) || null;
      if (item) break;
    }

    const clickEl =
      item?.querySelector('a.js-click[data-fancybox="ajax"], [data-fancybox="ajax"]') || null;
    const openEl = item?.querySelector('a.th.js-open-popup, a.th') || null;
    const pageHref = openEl?.getAttribute('href') || wantHref || '';
    let ajaxHref =
      clickEl?.getAttribute('data-href') || clickEl?.getAttribute('href') || '';
    // Compact sample clones often keep the donor card's popup URL — ignore mismatch.
    if (
      id &&
      ajaxHref &&
      !ajaxHref.includes(`/popup-video/${id}/`) &&
      !ajaxHref.includes(`/video/${id}/`)
    ) {
      ajaxHref = '';
    }
    if (!ajaxHref) ajaxHref = popupFallback;

    if (pageHref) {
      try {
        window.history.pushState('page2', 'Title', pageHref);
      } catch (_) {
        /* ignore */
      }
    }

    if (ajaxHref && $ && typeof $.fancybox === 'function') {
      // Rebind siblings so later plain clicks also work after our HTML replace.
      document.querySelectorAll('[data-fancybox="ajax"]').forEach((el) => {
        el.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const hrefAjax = el.getAttribute('data-href') || el.getAttribute('href');
          if (!hrefAjax) return;
          $.fancybox([{ href: hrefAjax, type: 'ajax' }], opts);
        };
      });
      $.fancybox([{ href: ajaxHref, type: 'ajax' }], opts);
      return { ok: true, method: 'fancybox-ajax' };
    }

    if (!$ || typeof $?.fancybox !== 'function') {
      return { ok: false, reason: 'fancybox missing', retry: true };
    }

    if (openEl) {
      openEl.click();
      return { ok: true, method: 'open-popup-click' };
    }
    return { ok: false, reason: 'popup target missing' };
  };

  const first = resolve();
  if (first.ok || !first.retry) return first;

  // Compact can finish before site jQuery/Fancybox boots after a hard refresh.
  return new Promise((resolveDone) => {
    let tries = 0;
    const tick = () => {
      tries += 1;
      const next = resolve();
      if (next.ok || !next.retry || tries >= 20) {
        resolveDone(next.ok ? next : { ok: false, reason: next.reason || 'fancybox missing' });
        return;
      }
      setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'GET_CONFIG':
        return await getConfig();
      case 'PAGE_REBIND_POPUPS': {
        const tabId = sender.tab?.id;
        if (!tabId) return { ok: false, reason: 'no tab' };
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: pageRebindAjaxPopups,
        });
        return result?.result || { ok: false };
      }
      case 'PAGE_REINIT_LAZYLOAD': {
        const tabId = sender.tab?.id;
        if (!tabId) return { ok: false, reason: 'no tab' };
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: pageReinitThumbLazyload,
        });
        return result?.result || { ok: false };
      }
      case 'PAGE_OPEN_POPUP': {
        const tabId = sender.tab?.id;
        if (!tabId) return { ok: false, reason: 'no tab' };
        const href = String(message.href || '');
        const videoId = String(message.videoId || '');
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: pageOpenNativePopup,
          args: [href, videoId],
        });
        return result?.result || { ok: false };
      }
      case 'PAGE_OPEN_AJAX': {
        const tabId = sender.tab?.id;
        if (!tabId) return { ok: false, reason: 'no tab' };
        const href = String(message.href || '').trim();
        if (!href) return { ok: false, reason: 'missing href' };
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: pageOpenAjaxHref,
          args: [href],
        });
        return result?.result || { ok: false };
      }
      case 'PAGE_CLOSE_POPUP': {
        const tabId = sender.tab?.id;
        if (!tabId) return { ok: false, reason: 'no tab' };
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: pageCloseNativePopup,
        });
        return result?.result || { ok: false };
      }
      case 'HELPER_HEALTH':
        return await helperHealth();
      case 'HELPER_SCAN': {
        const result = await helperFetch('/scan', { method: 'POST', body: {} });
        // Drop absolutePath before extension messaging — same info is in
        // displayPath/relativePath and keeps the ~N×path payload smaller.
        const matches = result && result.matches;
        if (matches && typeof matches === 'object') {
          for (const row of Object.values(matches)) {
            if (row && typeof row === 'object' && 'absolutePath' in row) {
              delete row.absolutePath;
            }
          }
        }
        return result;
      }
      case 'HELPER_SETTINGS_SET':
        return await helperFetch('/settings', {
          method: 'POST',
          body: {
            player: message.player,
            localPreferPlayback: message.localPreferPlayback,
            showFullPath: message.showFullPath,
            videoDir: message.videoDir,
          },
        });
      case 'HELPER_CLEAR_STALE':
        return await helperFetch('/maintenance/clear-stale', { method: 'POST', body: {} });
      case 'HELPER_OPEN_LOGS':
        return await helperFetch('/maintenance/open-logs', { method: 'POST', body: {} });
      case 'HELPER_LOOKUP':
        return await helperFetch('/lookup', {
          method: 'POST',
          body: { videoIds: message.videoIds || [] },
        });
      case 'HELPER_ORDINALS_ENSURE':
        return await helperFetch('/ordinals/ensure', {
          method: 'POST',
          body: { items: message.items || [] },
        });
      case 'HELPER_ORDINALS_LOOKUP':
        return await helperFetch('/ordinals/lookup', {
          method: 'POST',
          body: { videoIds: message.videoIds || [] },
        });
      case 'HELPER_ORDINALS_BY_SEQ':
        return await helperFetch('/ordinals/by-seq', {
          method: 'POST',
          body: { seq: message.seq },
        });
      case 'HELPER_OPEN':
        return await helperFetch('/open', {
          method: 'POST',
          body: { videoId: message.videoId },
        });
      case 'HELPER_REVEAL':
        return await helperFetch('/reveal', {
          method: 'POST',
          body: { videoId: message.videoId },
        });
      case 'HELPER_REVEAL_PATH':
        return await helperFetch('/reveal-path', {
          method: 'POST',
          body: { relativePath: message.relativePath || '' },
        });
      case 'HELPER_LIST_ORPHANS':
        return await helperFetch('/media/list-orphans', {
          method: 'POST',
          body: { keepVideoIds: message.keepVideoIds || [] },
        });
      case 'HELPER_DELETE_PATHS':
        return await helperFetch('/media/delete-paths', {
          method: 'POST',
          body: { relativePaths: message.relativePaths || [] },
        });
      case 'QUEUE_STATUS': {
        const status = await helperFetch('/downloads/status');
        if (Number(status.activeCount || 0) > 0) runQueueWorker();
        return withDownloadProgress(status);
      }
      case 'QUEUE_RECOVER_FAILED': {
        cancelRequested = false;
        const status = await recoverFailedQueueItems();
        runQueueWorker();
        return status;
      }
      case 'QUEUE_WAKE': {
        cancelRequested = false;
        // Manual equivalent of a page reload: repair orphaned Chrome/Helper
        // state, retry failed rows with fresh URLs, unpause, then refill slots.
        await recoverOrphanedDownloads();
        const status = await recoverFailedQueueItems();
        if (status.paused && !(status.counts?.failed > 0)) {
          await helperFetch('/downloads/resume', { method: 'POST', body: {} });
        }
        runQueueWorker();
        return { ...status, woken: true };
      }
      case 'QUEUE_ENQUEUE': {
        cancelRequested = false;
        const before = await helperFetch('/downloads/status');
        const result = await helperFetch('/downloads/enqueue', {
          method: 'POST',
          body: { items: message.items || [] },
        });
        await noteEnqueueSession(before, result?.added);
        runQueueWorker();
        const status = await withDownloadProgress(await helperFetch('/downloads/status'));
        return { ...result, ...status };
      }
      case 'QUEUE_PAUSE': {
        // Tasks: pause selected (or all) in-flight downloads; next pending rows claim freed slots.
        const ids = Array.isArray(message.ids)
          ? message.ids.map((x) => Number(x)).filter((id) => id > 0)
          : null;
        const r = await helperFetch('/downloads/queue/pause', {
          method: 'POST',
          body: ids ? { ids } : {},
        });
        const pausedItems = Array.isArray(r?.pausedItems) ? r.pausedItems : [];
        for (const item of pausedItems) {
          const itemId = Number(item?.id || 0);
          if (itemId > 0) removedQueueItemIds.add(itemId);
        }
        const chromeIds = [
          ...(Array.isArray(r?.chromeDownloadIds) ? r.chromeDownloadIds : []),
          ...pausedItems.map((item) => Number(item?.chromeDownloadId || 0)),
        ].filter((id) => id > 0);
        for (const downloadId of new Set(chromeIds)) {
          try {
            await chrome.downloads.cancel(downloadId);
          } catch (_) {
            /* ignore */
          }
          activeChromeDownloadIds.delete(downloadId);
        }
        runQueueWorker();
        return r;
      }
      case 'QUEUE_RESUME': {
        cancelRequested = false;
        // Tasks: return selected (or all) paused rows to pending (not queue-wide pause meta).
        const ids = Array.isArray(message.ids)
          ? message.ids.map((x) => Number(x)).filter((id) => id > 0)
          : null;
        const r = await helperFetch('/downloads/queue/resume', {
          method: 'POST',
          body: ids ? { ids } : {},
        });
        runQueueWorker();
        return r;
      }
      case 'QUEUE_LIST':
        return await helperFetch('/downloads/queue/list', { method: 'POST', body: {} });
      case 'QUEUE_REMOVE': {
        const itemId = Number(message.id || 0);
        if (itemId > 0) removedQueueItemIds.add(itemId);
        let chromeDownloadId = Number(message.chromeDownloadId || 0);
        let r;
        try {
          r = await helperFetch('/downloads/queue/remove', {
            method: 'POST',
            body: { id: itemId },
          });
          chromeDownloadId = Number(r?.chromeDownloadId || chromeDownloadId || 0);
        } catch (err) {
          removedQueueItemIds.delete(itemId);
          throw err;
        }
        if (chromeDownloadId > 0) {
          try {
            await chrome.downloads.cancel(chromeDownloadId);
          } catch (_) {
            /* ignore */
          }
          activeChromeDownloadIds.delete(chromeDownloadId);
        }
        runQueueWorker();
        return withDownloadProgress(r);
      }
      case 'QUEUE_REORDER': {
        const r = await helperFetch('/downloads/queue/reorder', {
          method: 'POST',
          body: { ids: message.ids || [] },
        });
        runQueueWorker();
        return r;
      }
      case 'QUEUE_STOP':
        return await stopDownloads();
      case 'SELECTION_GET':
        return await getSelection();
      case 'SELECTION_SET':
        return await setSelection(message.selection);
      case 'SELECTION_CLEAR':
        return await setSelection({ items: {}, updatedAt: Date.now() });
      case 'FAV_INDEX_GET':
        return await getFavIndex(message.scope || 'favorites');
      case 'FAV_INDEX_SET':
        return await setFavIndex(message.index || {}, message.scope || message.index?.scope || 'favorites');
      case 'INDEX_JOB_STATUS':
        return await getIndexJobStatus();
      case 'INDEX_JOB_START':
        return await startIndexJob(message || {});
      case 'INDEX_JOB_STOP':
        return await stopIndexJob();
      case 'SEX_CLASSIFY_PAGE1':
        return await classifySexGroupsPage1(message || {});
      case 'RENUMBER_JOB_STATUS':
        return await getRenumberJobStatus();
      case 'RENUMBER_JOB_START':
        return await startRenumberJob(message || {});
      case 'RENUMBER_JOB_STOP':
        return await stopRenumberJob();
      case 'PLAYLIST_ADD_JOB_STATUS':
        return await getPlaylistAddJobStatus();
      case 'PLAYLIST_ADD_JOB_START':
        return await startPlaylistAddJob(message || {});
      case 'PLAYLIST_ADD_JOB_STOP':
        return await stopPlaylistAddJob();
      case 'FAV_ADD_JOB_STATUS':
        return await getFavAddJobStatus();
      case 'FAV_ADD_JOB_START':
        return await startFavAddJob(message || {});
      case 'FAV_ADD_JOB_STOP':
        return await stopFavAddJob();
      case 'PLAYLIST_MEMBERSHIP_GET':
        return await getPlaylistMembership();
      case 'SITE_PLAYLIST_LIST':
        return await listSitePlaylists();
      case 'SITE_PLAYLIST_ADD':
        return await addVideosToSitePlaylist(
          message.playlistId,
          message.videoIds || [],
          message.mode || 'save',
        );
      case 'SITE_FAVOURITES_ADD':
        return await addVideosToMyFavourites(message.videoIds || []);
      case 'FETCH_FAVORITES_PAGE':
        return await fetchFavoritesPage(message.page, {
          includeHtml: !!message.includeHtml,
        });
      case 'FETCH_PLAYLIST_PAGE':
        return await fetchPlaylistPage(message.playlistId, message.page, {
          blockId: message.blockId,
          fromKey: message.fromKey,
          includeHtml: !!message.includeHtml,
        });
      case 'UPLOAD_META_LOOKUP':
        return await fetchUploadMetaForIds(message.videoIds || []);
      case 'START_QUEUE_WORKER':
        runQueueWorker();
        return { ok: true };
      default:
        throw new Error(`Unknown message ${message.type}`);
    }
  })()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
  return true;
});

/** KVS from_* keys commonly used for playlist / common video list blocks. */
function playlistFromKeys(blockId, preferredKey = '') {
  const block = String(blockId || '').trim();
  const keys = [];
  const add = (k) => {
    const key = String(k || '').trim();
    if (key && !keys.includes(key)) keys.push(key);
  };
  add(preferredKey);
  if (block) {
    // list_videos_common_videos_list → from_videos_common_videos_list
    add(`from_${block.replace(/^list_/i, '')}`);
  }
  add('from_videos');
  add('from_videos_common');
  add('from_videos_common_videos_list');
  add('from');
  return keys;
}

function isRateLimitedResponse(status, text) {
  if (Number(status) === 429) return true;
  const body = String(text || '');
  if (/item[\s_-]+thumb|name=["']delete\[]["']/i.test(body)) return false;
  return /ddos-guard|too many requests|error code:\s*429/i.test(body);
}

/**
 * Site fetch with DDoS-Guard 429 backoff. Index crawl + sex enrich otherwise
 * die on ~1690-byte empty pages after tens of favorites pages.
 *
 * preferSameOrigin: for sex-filter crawls, fetch from an open rule34video tab so
 * the Lax category_group_id cookie is actually sent (SW cross-site fetch often
 * drops it; favorites then return the unfiltered list and Tag sex dual-labels
 * everything as futa,straight).
 */
async function fetchSiteText(url, { retries = 6, preferSameOrigin = false } = {}) {
  let lastLen = 0;
  let lastStatus = 0;
  const maxRetries = Math.max(0, Number(retries) || 0);
  let sameOriginTabId = null;
  if (preferSameOrigin) {
    const tab = await findRule34VideoTab();
    sameOriginTabId = tab?.id ?? null;
  }
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let status = 0;
    let text = '';
    let finalUrl = url;
    if (sameOriginTabId != null) {
      try {
        const page = await fetchSiteTextInTab(sameOriginTabId, url);
        status = Number(page.status) || 0;
        text = page.text || '';
        finalUrl = page.url || url;
      } catch (err) {
        // Tab closed / restricted — fall back to SW fetch for this attempt.
        sameOriginTabId = null;
        const res = await fetch(url, {
          credentials: 'include',
          redirect: 'follow',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'text/html, */*;q=0.1',
          },
        });
        text = await res.text();
        status = res.status;
        finalUrl = res.url || url;
      }
    } else {
      const res = await fetch(url, {
        credentials: 'include',
        redirect: 'follow',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html, */*;q=0.1',
        },
      });
      text = await res.text();
      status = res.status;
      finalUrl = res.url || url;
    }
    lastLen = text.length;
    lastStatus = status;
    if (isRateLimitedResponse(status, text)) {
      if (attempt >= maxRetries) {
        const err = new Error(
          `rate limited by site (HTTP ${status || 429}, ${lastLen} bytes) — wait ~30s and Rebuild index again`,
        );
        err.code = 'RATE_LIMITED';
        throw err;
      }
      const waitMs = Math.min(20_000, 2000 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    // Synthesize a Response-like object for callers that only read .ok / .status / .url.
    const res = {
      ok: status >= 200 && status < 300,
      status,
      url: finalUrl,
    };
    return { res, text, url: finalUrl };
  }
  throw new Error(`fetch failed (HTTP ${lastStatus}, ${lastLen} bytes)`);
}

async function fetchPlaylistPage(
  playlistId,
  page,
  {
    blockId = '',
    fromKey = '',
    includeHtml = false,
    sexGroupId = '',
    rateLimitRetries = 6,
  } = {},
) {
  const pid = String(playlistId || '').trim();
  if (!/^[1-9]\d*$/.test(pid)) throw new Error('invalid playlist id');
  const pageNum = Number(page);
  if (!Number.isInteger(pageNum) || pageNum < 1) throw new Error('invalid page');
  const primaryBlock =
    String(blockId || '').trim() || 'list_videos_common_videos_list';
  // Never fall back to Favorites block — that fed Favorites pager HTML into
  // playlist indexes (1/10 → a/a+1 on a 12-video list).
  const blocks = [primaryBlock, 'list_videos_common_videos_list'].filter(
    (b, i, arr) => b && !/favourites?|favorite/i.test(b) && arr.indexOf(b) === i,
  );
  const fromVals = [pageNum];
  if (pageNum > 1) fromVals.push(pageNum - 1);
  const attempts = [];
  const pushUnique = (url) => {
    if (url && !attempts.includes(url)) attempts.push(url);
  };

  // Prefer full-document + primary block/fromKey (page 1 already proved full URL works).
  if (pageNum === 1) {
    pushUnique(`https://rule34video.com/my/playlists/${pid}/`);
  }
  const primaryKeys = playlistFromKeys(primaryBlock, fromKey);
  for (const key of primaryKeys) {
    for (const from of [...new Set(fromVals)]) {
      pushUnique(`https://rule34video.com/my/playlists/${pid}/?${key}=${from}`);
      pushUnique(
        `https://rule34video.com/my/playlists/${pid}/?mode=async&function=get_block&block_id=${encodeURIComponent(primaryBlock)}&${key}=${from}`,
      );
    }
  }
  // Secondary block / key variants only if primary guesses fail later in the loop.
  for (const block of blocks.slice(1)) {
    for (const key of playlistFromKeys(block, fromKey).slice(0, 3)) {
      for (const from of [...new Set(fromVals)]) {
        pushUnique(
          `https://rule34video.com/my/playlists/${pid}/?mode=async&function=get_block&block_id=${encodeURIComponent(block)}&${key}=${from}`,
        );
      }
    }
  }
  pushUnique(`https://rule34video.com/my/playlists/${pid}/${pageNum}/`);

  const sexId = String(sexGroupId || '').trim();
  const urls = sexId
    ? attempts.map((u) => appendSexGroupParams(u, sexId))
    : attempts;

  let html = '';
  let used = '';
  let lastLen = 0;
  for (const url of urls) {
    let res;
    let text;
    try {
      ({ res, text } = await fetchSiteText(url, {
        retries: rateLimitRetries,
        preferSameOrigin: !!sexId,
      }));
    } catch (err) {
      if (err?.code === 'RATE_LIMITED') throw err;
      lastLen = 0;
      continue;
    }
    lastLen = text.length;
    if (!res.ok) continue;
    if (
      /login-required|\/login\/|\?login/i.test(res.url) &&
      !/item[\s_-]+thumb|name=["']delete\[]["']/i.test(text)
    ) {
      throw new Error('login expired');
    }
    const parsed = parseFavoriteCards(text, pageNum);
    if (parsed.length) {
      return {
        page: pageNum,
        items: parsed,
        maxPage: parseMaxPage(text, {
          fromKey,
          scope: `playlist:${pid}`,
        }),
        sourceUrl: url,
        ...(includeHtml ? { html: text } : {}),
      };
    }
    if (/item[\s_-]+thumb|name=["']delete\[]["']/i.test(text) && !html) {
      html = text;
      used = url;
    }
  }
  if (!html) {
    throw new Error(`failed to load playlist ${pid} page ${pageNum} (last response ${lastLen} bytes)`);
  }
  const items = parseFavoriteCards(html, pageNum);
  if (!items.length) {
    throw new Error(`playlist page ${pageNum} parsed 0 videos`);
  }
  return {
    page: pageNum,
    items,
    maxPage: parseMaxPage(html, {
      fromKey,
      scope: `playlist:${pid}`,
    }),
    sourceUrl: used,
    ...(includeHtml ? { html } : {}),
  };
}

/* keep fetchFavoritesPage below — marker for splice safety */
async function fetchFavoritesPage(
  page,
  { includeHtml = false, sexGroupId = '', rateLimitRetries = 6 } = {},
) {
  const pageNum = Number(page);
  if (!Number.isInteger(pageNum) || pageNum < 1) {
    throw new Error('invalid page');
  }
  // KVS async block. Page N uses from_my_fav_videos:N (verified on site pagination).
  // Also try 0-based (N-1), favourite spelling, and a plain path fallback.
  const params = [pageNum];
  if (pageNum > 1) params.push(pageNum - 1);
  if (pageNum === 1) params.push(1, 0);
  const uniqueParams = [...new Set(params)];
  const attempts = [];
  for (const from of uniqueParams) {
    attempts.push(
      `https://rule34video.com/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&from_my_fav_videos=${from}`,
    );
    attempts.push(
      `https://rule34video.com/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&from_my_favourite_videos=${from}`,
    );
  }
  attempts.push(
    `https://rule34video.com/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&from=${pageNum}`,
    `https://rule34video.com/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&from_my_fav_videos=${pageNum}`,
    `https://rule34video.com/my/favourites/videos/${pageNum}/`,
  );
  if (pageNum === 1) {
    attempts.unshift('https://rule34video.com/my/favourites/videos/');
    attempts.unshift(
      'https://rule34video.com/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos',
    );
  }
  const sexId = String(sexGroupId || '').trim();
  // Sex enrich: one proven async URL shape — do not fan out every fallback
  // (that multiplies traffic right after the full-list crawl and trips 429).
  let urls = attempts;
  if (sexId) {
    const primary = [
      pageNum === 1
        ? 'https://rule34video.com/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos'
        : null,
      `https://rule34video.com/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&from_my_fav_videos=${pageNum}`,
      `https://rule34video.com/my/favourites/videos/`,
    ].filter(Boolean);
    urls = primary.map((u) => appendSexGroupParams(u, sexId));
  }

  let html = '';
  let used = '';
  let lastLen = 0;
  for (const url of urls) {
    let res;
    let text;
    try {
      ({ res, text } = await fetchSiteText(url, {
        retries: rateLimitRetries,
        preferSameOrigin: !!sexId,
      }));
    } catch (err) {
      if (err?.code === 'RATE_LIMITED') throw err;
      lastLen = 0;
      continue;
    }
    lastLen = text.length;
    if (!res.ok) continue;
    if (/login-required|\/login\/|\?login/i.test(res.url) && !/item\s+thumb/i.test(text)) {
      throw new Error('login expired');
    }
    if (/captcha|cf-browser-verification|just a moment/i.test(text) && !/item\s+thumb/i.test(text)) {
      throw new Error('captcha or bot check encountered');
    }
    if (isRateLimitedResponse(res.status, text)) {
      throw new Error(
        `rate limited by site (${lastLen} bytes) — wait ~30s and Rebuild index again`,
      );
    }
    const parsed = parseFavoriteCards(text, pageNum);
    if (parsed.length) {
      html = text;
      used = url;
      const maxPage = parseMaxPage(html);
      return {
        page: pageNum,
        items: parsed,
        maxPage,
        sourceUrl: used.replace(/([?&]v-acctoken=)[^&]+/gi, '$1***'),
        ...(includeHtml ? { html } : {}),
      };
    }
    if (/item\s+thumb|name=["']delete\[]["']/i.test(text) && !html) {
      html = text;
      used = url;
    }
  }
  if (!html) {
    throw new Error(`failed to load favorites page ${pageNum} (last response ${lastLen} bytes)`);
  }
  const items = parseFavoriteCards(html, pageNum);
  if (!items.length) {
    throw new Error(
      `page ${pageNum} loaded but parsed 0 videos (html ${html.length}B). Site markup may have changed.`,
    );
  }
  const maxPage = parseMaxPage(html);
  return {
    page: pageNum,
    items,
    maxPage,
    sourceUrl: used.replace(/([?&]v-acctoken=)[^&]+/gi, '$1***'),
    ...(includeHtml ? { html } : {}),
  };
}

function parseDeleteValue(block) {
  const a = block.match(/name=["']delete\[]["'][^>]*value=["'](\d+)["']/i);
  if (a) return a[1];
  const b = block.match(/value=["'](\d+)["'][^>]*name=["']delete\[]["']/i);
  if (b) return b[1];
  return null;
}

/** Absolute preview URL from card HTML; skip lazy placeholders. */
function normalizeThumbUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (/^(?:data:|about:blank)/i.test(u)) return '';
  if (/(?:grey|gray|spacer|blank|lazy)\.(?:gif|png|jpg|svg)|\/empty\./i.test(u)) return '';
  if (u.startsWith('//')) u = `https:${u}`;
  else if (u.startsWith('/')) u = `https://rule34video.com${u}`;
  else if (!/^https?:\/\//i.test(u)) return '';
  return u;
}

function extractThumbUrlFromChunk(chunk) {
  if (!chunk) return '';
  const attrs = ['data-original', 'data-src', 'data-lazy-src', 'data-thumb', 'src'];
  for (const attr of attrs) {
    const re = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
    const m = chunk.match(re);
    const u = normalizeThumbUrl(m?.[1]);
    if (u) return u;
  }
  return '';
}

/** Hover-preview mp4/webm URL from a favorites card HTML chunk. */
function extractPreviewUrlFromChunk(chunk) {
  if (!chunk) return '';
  const attrs = [
    'data-preview',
    'data-trailer',
    'data-video',
    'data-mp4',
    'data-webm',
    'data-mid',
  ];
  for (const attr of attrs) {
    const re = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
    const m = chunk.match(re);
    const raw = String(m?.[1] || '').trim();
    if (!raw || /grey\.gif|spacer|blank|lazy|placeholder/i.test(raw)) continue;
    if (/\.(?:mp4|webm)(?:$|\?)/i.test(raw) || /preview|trailer/i.test(raw)) {
      return normalizeThumbUrl(raw) || (raw.startsWith('//') ? `https:${raw}` : raw);
    }
  }
  return '';
}

function stripHtmlText(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Views / like-rate / added time from a favorites card HTML chunk. */
function extractCardMetaFromChunk(chunk) {
  if (!chunk) return { viewsText: '', ratingText: '', addedText: '' };
  const pick = (cls) => {
    const re = new RegExp(
      `class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)</(?:div|span|a|li|p)`,
      'i',
    );
    const m = chunk.match(re);
    return stripHtmlText(m?.[1]);
  };
  return {
    viewsText: pick('views'),
    ratingText: pick('rating'),
    addedText: pick('added'),
  };
}

/**
 * Sex label from a list card badge. Favorites/playlists ignore the top
 * category_group_id / flag1 filter, so Tag sex uses these overlays instead:
 *   <div class="futa">Futa</div> | Gay | (none → straight).
 */
function parseSexGroupFromCardChunk(chunk) {
  if (!chunk) return '';
  const labels = [];
  const re = /<div\s+class=["'][^"']*\bfuta\b[^"']*["']\s*>\s*([^<]*?)\s*<\/div>/gi;
  let m;
  while ((m = re.exec(chunk))) {
    const t = stripHtmlText(m[1]).toLowerCase();
    if (t) labels.push(t);
  }
  if (labels.some((t) => t === 'futa' || t === 'trans')) return 'futa';
  if (labels.some((t) => t === 'gay')) return 'gay';
  return 'straight';
}

/**
 * Site upload relative age from popup-video / detail HTML.
 * Favorites list `.added` is import time; popup calendar is post_date.
 */
function extractUploadedTextFromHtml(html) {
  if (!html) return '';
  const cal = html.match(
    /custom-calendar[\s\S]{0,160}?<span\b[^>]*>\s*([^<]+?)\s*<\/span>/i,
  );
  if (cal) {
    const text = stripHtmlText(cal[1]);
    if (text) return text;
  }
  const added = html.match(
    /class=["'][^"']*\badded\b[^"']*["'][^>]*>[\s\S]*?(?:<\/svg>|>)\s*([^<]+)/i,
  );
  if (added) {
    const text = stripHtmlText(added[1]);
    if (text && /\bago\b|today|yesterday|just\s+now/i.test(text)) return text;
  }
  const iso = html.match(/uploadDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"/i);
  if (iso) return relativeAgeFromIsoDate(iso[1]);
  return '';
}

function relativeAgeFromIsoDate(isoDay) {
  const m = String(isoDay || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(then)) return '';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86400000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.max(1, Math.floor(days / 7));
    return w === 1 ? '1 week ago' : `${w} weeks ago`;
  }
  if (days < 365) {
    const mo = Math.max(1, Math.floor(days / 30));
    return mo === 1 ? '1 month ago' : `${mo} months ago`;
  }
  const y = Math.max(1, Math.floor(days / 365));
  return y === 1 ? '1 year ago' : `${y} years ago`;
}

async function fetchUploadMetaForIds(videoIds, { concurrency = 6, shouldCancel = null } = {}) {
  const ids = [
    ...new Set(
      (videoIds || [])
        .map((id) => String(id || '').trim())
        .filter((id) => /^[1-9]\d*$/.test(id)),
    ),
  ];
  const results = {};
  let cursor = 0;
  let rateLimited = false;
  let cancelled = false;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, ids.length || 1)) }, async () => {
    while (cursor < ids.length) {
      if (rateLimited || cancelled) return;
      if (typeof shouldCancel === 'function' && (await shouldCancel())) {
        cancelled = true;
        return;
      }
      const i = cursor;
      cursor += 1;
      const id = ids[i];
      try {
        const res = await fetch(`https://rule34video.com/popup-video/${id}/`, {
          credentials: 'include',
          redirect: 'follow',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'text/html, */*;q=0.1',
          },
        });
        const text = await res.text();
        if (isRateLimitedResponse(res.status, text)) {
          rateLimited = true;
          return;
        }
        if (!res.ok) continue;
        const uploaded = extractUploadedTextFromHtml(text);
        if (uploaded) results[id] = { uploadedText: uploaded };
      } catch (_) {
        /* ignore one id */
      }
    }
  });
  if (ids.length) await Promise.all(workers);
  if (cancelled) {
    const err = new Error('index cancelled');
    err.code = 'INDEX_CANCELLED';
    throw err;
  }
  return { results, count: Object.keys(results).length, rateLimited };
}

/**
 * Full `.item.thumb` block for a video. Meta (views/rating/added) sits ~2KB after
 * the /video/{id}/ href — a short window around the URL misses it.
 */
function findThumbBlockForVideo(html, videoId) {
  const id = String(videoId || '').trim();
  if (!html || !id) return '';
  const openRe = /<div\b[^>]*class=["'][^"']*\bitem\b[^"']*\bthumb\b[^"']*["'][^>]*>/gi;
  const opens = [...html.matchAll(openRe)];
  for (let i = 0; i < opens.length; i += 1) {
    const start = opens[i].index;
    const end =
      i + 1 < opens.length ? opens[i + 1].index : Math.min(html.length, start + 10000);
    const block = html.slice(start, end);
    if (
      block.includes(`/video/${id}/`) ||
      block.includes(`value="${id}"`) ||
      block.includes(`value='${id}'`) ||
      block.includes(`video_${id}`)
    ) {
      return block;
    }
  }
  const around = html.match(
    new RegExp(`[\\s\\S]{0,800}/video/${id}/[\\s\\S]{0,4000}`, 'i'),
  );
  return around ? around[0] : '';
}

function parseFavoriteCards(html, pageNum) {
  const items = [];
  const seen = new Set();
  const durationById = parseDurationMap(html);

  // 1) Prefer delete[] inputs — unique to manage/favorites lists.
  const inputRe =
    /<input\b[^>]*?(?:name=["']delete\[]["'][^>]*?value=["'](\d+)["']|value=["'](\d+)["'][^>]*?name=["']delete\[]["'])[^>]*?>/gi;
  let im;
  let index = 0;
  while ((im = inputRe.exec(html))) {
    const id = im[1] || im[2];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({
      videoId: id,
      detailUrl: `https://rule34video.com/video/${id}/`,
      title: id,
      favoritePage: pageNum,
      cardIndex: index,
      durationSec: durationById[String(id)] ?? null,
      thumbUrl: '',
      previewUrl: '',
      viewsText: '',
      ratingText: '',
      addedText: '',
      sexGroup: '',
    });
    index += 1;
  }
  if (items.length) {
    // Enrich titles/hrefs/meta from the full card block (not a short URL window).
    items.forEach((it) => {
      const chunk = findThumbBlockForVideo(html, it.videoId);
      if (!chunk) return;
      const href = chunk.match(/href=["'](https?:\/\/rule34video\.com\/video\/\d+\/[^"']+)["']/i)
        || chunk.match(/href=["'](\/video\/\d+\/[^"']+)["']/i);
      const title =
        chunk.match(/class=["'][^"']*\bthumb_title\b[^"']*["'][^>]*>([\s\S]*?)<\//i) ||
        chunk.match(/title=["']([^"']+)["']/i);
      if (href) {
        it.detailUrl = href[1].startsWith('http')
          ? href[1]
          : `https://rule34video.com${href[1]}`;
      }
      if (title) it.title = stripHtmlText(title[1]) || it.title;
      if (it.durationSec == null) {
        const dur = extractDurationFromChunk(chunk);
        if (dur != null) it.durationSec = dur;
      }
      if (!it.thumbUrl) it.thumbUrl = extractThumbUrlFromChunk(chunk);
      if (!it.previewUrl) it.previewUrl = extractPreviewUrlFromChunk(chunk);
      const meta = extractCardMetaFromChunk(chunk);
      it.viewsText = meta.viewsText;
      it.ratingText = meta.ratingText;
      it.addedText = meta.addedText;
      if (!it.sexGroup) it.sexGroup = parseSexGroupFromCardChunk(chunk);
    });
    return items;
  }

  // 2) Fallback: item.thumb cards with /video/{id}/ links (no delete[] in some skins).
  const openRe = /<div\b[^>]*class=["'][^"']*\bitem\b[^"']*\bthumb\b[^"']*["'][^>]*>/gi;
  const opens = [...html.matchAll(openRe)];
  for (let i = 0; i < opens.length; i += 1) {
    const start = opens[i].index;
    const end = i + 1 < opens.length ? opens[i + 1].index : Math.min(html.length, start + 8000);
    const block = html.slice(start, end);
    const idFromDelete = parseDeleteValue(block);
    const idFromHref = (block.match(/\/video\/(\d+)\//i) || [])[1];
    const videoId = idFromDelete || idFromHref;
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    const hrefMatch = block.match(/href=["'](https?:\/\/rule34video\.com\/video\/\d+\/[^"']+)["']/i)
      || block.match(/href=["'](\/video\/\d+\/[^"']+)["']/i);
    const titleMatch = block.match(/title=["']([^"']+)["']/i);
    let detailUrl = `https://rule34video.com/video/${videoId}/`;
    if (hrefMatch) {
      detailUrl = hrefMatch[1].startsWith('http')
        ? hrefMatch[1]
        : `https://rule34video.com${hrefMatch[1]}`;
    }
    const meta = extractCardMetaFromChunk(block);
    items.push({
      videoId,
      detailUrl,
      title: titleMatch ? titleMatch[1] : videoId,
      favoritePage: pageNum,
      cardIndex: items.length,
      durationSec: durationById[String(videoId)] ?? extractDurationFromChunk(block),
      thumbUrl: extractThumbUrlFromChunk(block),
      previewUrl: extractPreviewUrlFromChunk(block),
      viewsText: meta.viewsText,
      ratingText: meta.ratingText,
      addedText: meta.addedText,
      sexGroup: parseSexGroupFromCardChunk(block),
    });
  }
  return items;
}

function parseMaxPage(html, { fromKey = '', scope = 'favorites' } = {}) {
  let max = 0;
  const scopeKey = String(scope || 'favorites');
  const isPlaylist = scopeKey.startsWith('playlist:') || scopeKey === 'playlist';

  if (isPlaylist) {
    // Only trust this playlist's from_* keys — never from_my_fav_* or a bare
    // "(2450)" in page chrome (that inflated small playlists to 1/10→a/a+1).
    const keyHints = [];
    const fk = String(fromKey || '').trim();
    if (fk) keyHints.push(fk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    keyHints.push('from_videos(?:_common(?:_videos_list)?)?');
    for (const key of keyHints) {
      try {
        const re = new RegExp(`${key}:(\\d+)`, 'gi');
        for (const m of html.matchAll(re)) {
          const n = Number(m[1]);
          if (Number.isInteger(n) && n > 0) max = Math.max(max, n);
        }
      } catch (_) {
        /* ignore bad key */
      }
    }
    for (const m of html.matchAll(/data-parameters="[^"]*(from_videos[a-z0-9_]*):(\d+)/gi)) {
      const n = Number(m[2]);
      if (Number.isInteger(n) && n > 0) max = Math.max(max, n);
    }
    return max || null;
  }

  for (const m of html.matchAll(/from_my_fav(?:ourite)?_videos:(\d+)/gi)) {
    max = Math.max(max, Number(m[1]));
  }
  // Do NOT scan generic from_videos / from_* here — Favorites HTML includes other
  // blocks (sidebars, recommendations) whose from_* keys inflate crawls
  // (e.g. ~44 real pages → 222 pages / 2000+ phantom ids).
  const active = html.match(/pagination[\s\S]*?item active[^>]*>\s*(\d+)/i);
  if (active) max = Math.max(max, Number(active[1]));
  // Headline "(N)" may raise the pager slightly, but never jump far above fav keys.
  const totalHit = html.match(/\(\s*([\d,]+)\s*(?:videos?)?\s*\)/i);
  if (totalHit) {
    const total = Number(String(totalHit[1]).replace(/,/g, ''));
    if (Number.isInteger(total) && total >= 20) {
      const byTotal = Math.ceil(total / 12);
      if (max > 0) {
        if (byTotal > max && byTotal <= max + 2) max = byTotal;
      } else if (byTotal > 0) {
        max = byTotal;
      }
    }
  }
  return max || null;
}

const INDEX_JOB_KEY = 'hxyruleIndexJob';
let indexJobRunning = false;

function idleIndexJob() {
  return {
    status: 'idle',
    scope: '',
    playlistId: '',
    blockId: '',
    fromKey: '',
    page: 0,
    maxPage: 0,
    startMaxPage: 0,
    libraryTotal: 0,
    pageSize: 0,
    probedPastEnd: false,
    videos: [],
    error: '',
    phase: '', // '' | 'sex' (align Futa/Straight with site category_group_id)
    /** List crawl page count; kept while phase=sex overwrites page/maxPage for UI. */
    listMaxPage: 0,
    /** Within sex step: list page while reading card badges. */
    sexFilterPage: 0,
    sexFilterMaxPage: 0,
    /** 'cards' while reading badges; legacy 'futa' | 'straight' */
    sexFilterLabel: '',
    /** When true, skip list crawl and only run sex enrich on job.videos. */
    sexOnly: false,
    /** 'incremental' (page-range merge) | 'full' (all pages) | 'sex' | 'sex-delta'. */
    mode: '',
    /** Sex-delta: only classify these videoIds (empty = all untagged). */
    targetIds: [],
    /** Inclusive page window for incremental Refresh (absolute list pages). */
    fromPage: 0,
    toPage: 0,
    startedAt: 0,
    updatedAt: 0,
    cancelRequested: false,
  };
}

function mergeIndexRowFields(prev, row, pageNum, idx) {
  const id = String(row?.videoId || prev?.videoId || '').trim();
  const durationSec = coerceIndexDurationSec(row?.durationSec);
  return {
    ...(prev || {}),
    videoId: id,
    title: row?.title || prev?.title || id,
    detailUrl:
      row?.detailUrl || prev?.detailUrl || `https://rule34video.com/video/${id}/`,
    favoritePage:
      Number(row?.favoritePage) || pageNum || Number(prev?.favoritePage) || 0,
    cardIndex: Number.isInteger(row?.cardIndex) ? row.cardIndex : idx,
    durationSec:
      durationSec != null ? durationSec : coerceIndexDurationSec(prev?.durationSec),
    thumbUrl: normalizeThumbUrl(row?.thumbUrl) || normalizeThumbUrl(prev?.thumbUrl) || '',
    previewUrl:
      normalizeThumbUrl(row?.previewUrl) || normalizeThumbUrl(prev?.previewUrl) || '',
    viewsText: String(row?.viewsText || prev?.viewsText || '')
      .replace(/\s+/g, ' ')
      .trim(),
    ratingText: String(row?.ratingText || prev?.ratingText || '')
      .replace(/\s+/g, ' ')
      .trim(),
    addedText: String(row?.addedText || prev?.addedText || '')
      .replace(/\s+/g, ' ')
      .trim(),
    uploadedText: String(row?.uploadedText || prev?.uploadedText || '')
      .replace(/\s+/g, ' ')
      .trim(),
    sexGroup: String(prev?.sexGroup || row?.sexGroup || '').trim(),
  };
}

/**
 * Merge one list page into an existing index.
 * Page 1: promote that page to the front (newest-first).
 * Other pages: upsert in place; append truly new ids (keeps mid-list order).
 */
function mergeIndexPageVideos(existing, pageRows, pageNum) {
  const prevById = new Map();
  const priorOrder = [];
  (Array.isArray(existing) ? existing : []).forEach((v) => {
    const id = String(v?.videoId || '').trim();
    if (!id || prevById.has(id)) return;
    prevById.set(id, v);
    priorOrder.push(id);
  });
  const pageIds = [];
  const seenPage = new Set();
  const pageMerged = new Map();
  (Array.isArray(pageRows) ? pageRows : []).forEach((row, idx) => {
    const id = String(row?.videoId || '').trim();
    if (!id || seenPage.has(id)) return;
    seenPage.add(id);
    pageIds.push(id);
    pageMerged.set(id, mergeIndexRowFields(prevById.get(id) || {}, row, pageNum, idx));
  });
  const promote = Number(pageNum) === 1;
  if (promote) {
    const merged = pageIds.map((id) => pageMerged.get(id));
    priorOrder.forEach((id) => {
      if (seenPage.has(id)) return;
      merged.push(prevById.get(id));
    });
    return merged;
  }
  const merged = [];
  const emitted = new Set();
  priorOrder.forEach((id) => {
    if (seenPage.has(id)) {
      merged.push(pageMerged.get(id));
    } else {
      merged.push(prevById.get(id));
    }
    emitted.add(id);
  });
  pageIds.forEach((id) => {
    if (emitted.has(id)) return;
    merged.push(pageMerged.get(id));
  });
  return merged;
}

function publicIndexJobStatus(job) {
  const j = job || idleIndexJob();
  const phase = j.phase || '';
  const listMax = Math.max(0, Number(j.listMaxPage) || 0);
  const mode = String(j.mode || '') || (j.sexOnly ? 'sex' : '');
  const fromPage = Math.max(0, Number(j.fromPage) || 0);
  const toPage = Math.max(0, Number(j.toPage) || 0);
  const absPage = Math.max(0, Number(j.page) || 0);
  let page = absPage;
  let maxPage = Math.max(1, listMax || Number(j.maxPage) || 1);
  if (phase === 'sex') {
    page = absPage;
    maxPage = Math.max(1, Number(j.maxPage) || 1);
  } else if (mode === 'incremental' && fromPage > 0) {
    // Progress is relative to the from–to window (3–3 → 0/1…1/1), not absolute
    // site page numbers (which looked like a 1…3 full crawl).
    const fromP = fromPage;
    const toP = Math.max(fromP, toPage || fromP);
    const total = Math.max(1, toP - fromP + 1);
    page = absPage < fromP ? 0 : Math.min(total, absPage - fromP + 1);
    maxPage = total;
  }
  return {
    status: j.status || 'idle',
    scope: j.scope || '',
    playlistId: j.playlistId || '',
    page,
    maxPage,
    listMaxPage: listMax,
    sexFilterPage: Math.max(0, Number(j.sexFilterPage) || 0),
    sexFilterMaxPage: Math.max(0, Number(j.sexFilterMaxPage) || 0),
    sexFilterLabel: String(j.sexFilterLabel || ''),
    videoCount: Array.isArray(j.videos) ? j.videos.length : 0,
    error: j.error || '',
    phase,
    mode,
    sexOnly: !!j.sexOnly,
    fromPage,
    toPage,
    targetIds: Array.isArray(j.targetIds) ? j.targetIds.map(String) : [],
    /** Absolute list page last completed (incremental Refresh). */
    absPage,
    startedAt: Number(j.startedAt) || 0,
    updatedAt: Number(j.updatedAt) || 0,
    cancelRequested: !!j.cancelRequested,
  };
}

/** Site top filter cookie (cleared during list index so a stuck sex chip cannot shrink crawls). */
const SEX_GROUP_COOKIE = 'category_group_id';

/** Site UI also pushes flag1 via #js-ajax_sort data-parameters (flag1:15;). */
function appendSexGroupParams(url, sexGroupId) {
  const id = String(sexGroupId || '').trim();
  if (!id || !url) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('flag1', id);
    return u.toString();
  } catch (_) {
    const join = String(url).includes('?') ? '&' : '?';
    return `${url}${join}flag1=${encodeURIComponent(id)}`;
  }
}

async function readCategoryGroupIdCookie() {
  try {
    const c = await chrome.cookies.get({
      url: 'https://rule34video.com/',
      name: SEX_GROUP_COOKIE,
    });
    return c && c.value != null ? String(c.value) : '';
  } catch (_) {
    return '';
  }
}

async function findRule34VideoTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://rule34video.com/*', 'https://www.rule34video.com/*'],
    });
    if (!tabs?.length) return null;
    return tabs.find((t) => t.active && t.id != null) || tabs.find((t) => t.id != null) || null;
  } catch (_) {
    return null;
  }
}

async function fetchSiteTextInTab(tabId, url) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: async (fetchUrl) => {
      const res = await fetch(fetchUrl, {
        credentials: 'include',
        redirect: 'follow',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html, */*;q=0.1',
        },
      });
      const text = await res.text();
      return {
        ok: !!res.ok,
        status: Number(res.status) || 0,
        url: String(res.url || fetchUrl),
        text: String(text || ''),
      };
    },
    args: [url],
  });
  const payload = result?.result;
  if (!payload || typeof payload.text !== 'string') {
    throw new Error('same-origin sex fetch returned no body');
  }
  return payload;
}

async function writeCategoryGroupIdCookie(value) {
  const url = 'https://rule34video.com/';
  const v = value == null ? '' : String(value);
  try {
    if (v === '') {
      await chrome.cookies.remove({ url, name: SEX_GROUP_COOKIE });
      try {
        await chrome.cookies.remove({
          url: 'https://www.rule34video.com/',
          name: SEX_GROUP_COOKIE,
        });
      } catch (_) {
        /* optional */
      }
      return;
    }
    const base = {
      url,
      name: SEX_GROUP_COOKIE,
      value: v,
      domain: '.rule34video.com',
      path: '/',
      expirationDate: Math.floor(Date.now() / 1000) + 31536000,
    };
    // Prefer SameSite=None so SW fetches can still send it when needed.
    let saved = await chrome.cookies.set({
      ...base,
      secure: true,
      sameSite: 'no_restriction',
    });
    if (!saved) saved = await chrome.cookies.set(base);
    if (!saved) throw new Error('chrome.cookies.set returned null');
    const got = await readCategoryGroupIdCookie();
    if (String(got) !== v) {
      throw new Error(`write mismatch (want ${v}, got ${got || 'empty'})`);
    }
  } catch (err) {
    throw new Error(`category_group_id cookie: ${err?.message || err}`);
  }
}

async function assertIndexJobNotCancelled() {
  if (indexJobCancelFlag) {
    const err = new Error('index cancelled');
    err.code = 'INDEX_CANCELLED';
    throw err;
  }
  const job = await readIndexJob();
  if (job.cancelRequested || job.status === 'stopping') {
    indexJobCancelFlag = true;
    const err = new Error('index cancelled');
    err.code = 'INDEX_CANCELLED';
    throw err;
  }
}

/** Sleep that aborts within ~150ms when Stop is pressed. */
async function sleepIndexJob(ms) {
  const end = Date.now() + Math.max(0, Number(ms) || 0);
  while (Date.now() < end) {
    await assertIndexJobNotCancelled();
    const left = end - Date.now();
    if (left <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(150, left)));
  }
  await assertIndexJobNotCancelled();
}

function isTerminalJobStatus(status) {
  return ['stopped', 'done', 'error', 'idle'].includes(String(status || ''));
}

function countSexGroupTagged(videos) {
  return (Array.isArray(videos) ? videos : []).reduce(
    (n, v) => n + (String(v?.sexGroup || '').trim() ? 1 : 0),
    0,
  );
}

function sexWantIdsForEnrich(rows, { delta = false, targetIds = [] } = {}) {
  const targetSet = new Set(
    (Array.isArray(targetIds) ? targetIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  const want = new Set();
  (Array.isArray(rows) ? rows : []).forEach((v) => {
    const id = String(v?.videoId || '').trim();
    if (!id) return;
    if (targetSet.size) {
      if (targetSet.has(id)) want.add(id);
      return;
    }
    if (delta) {
      if (!String(v?.sexGroup || '').trim()) want.add(id);
      return;
    }
    want.add(id);
  });
  return want;
}

/**
 * Align index sexGroup with list-card badges (Futa / Gay / unlabeled→straight).
 * Favorites & playlists ignore the site top category_group_id / flag1 filter, so
 * native chip clicks cannot produce distinct sets — badge crawl is the source of truth.
 *
 * delta=false: wipe and retag every row (full Tag sex / Retag sex).
 * delta=true: keep existing labels; only fill want-ids (targetIds or untagged).
 */
async function enrichVideosWithSexGroups(job, videos, { delta = false } = {}) {
  const rows = (Array.isArray(videos) ? videos : []).map((v) => ({
    ...v,
    sexGroup: delta ? String(v?.sexGroup || '').trim() : '',
  }));
  if (!rows.length) return rows;
  const byId = new Map(rows.map((v) => [String(v.videoId || ''), v]));
  const wantIds = sexWantIdsForEnrich(rows, {
    delta,
    targetIds: job?.targetIds,
  });
  if (delta && !wantIds.size) return rows;

  const listMaxPage = Math.max(
    Number(job.listMaxPage) || 0,
    Number(job.maxPage) || 0,
    Number(job.page) || 0,
    Math.ceil(rows.length / 12),
    1,
  );

  let seenWant = 0;
  let futaBadges = 0;
  let pagesWithCards = 0;

  for (let page = 1; page <= listMaxPage; page += 1) {
    await assertIndexJobNotCancelled();
    await writeIndexJob({
      ...(await readIndexJob()),
      status: 'running',
      phase: 'sex',
      page: 1,
      maxPage: 1,
      listMaxPage,
      sexFilterPage: page,
      sexFilterMaxPage: listMaxPage,
      sexFilterLabel: 'cards',
      error: '',
    });

    let data;
    try {
      data = await fetchIndexPage(job, page, { rateLimitRetries: 6 });
    } catch (err) {
      if (err?.code === 'RATE_LIMITED' || /rate limited/i.test(String(err?.message || err))) {
        await sleepIndexJob(10_000);
        data = await fetchIndexPage(job, page, { rateLimitRetries: 6 });
      } else {
        throw err;
      }
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) {
      if (page === 1) {
        throw new Error('Tag sex page 1 parsed 0 videos — check login / list pages');
      }
      break;
    }
    pagesWithCards += 1;

    items.forEach((it) => {
      const id = String(it?.videoId || '').trim();
      if (!id) return;
      const row = byId.get(id);
      if (!row) return;
      if (delta && !wantIds.has(id)) return;
      const sex = String(it?.sexGroup || '').trim() || 'straight';
      row.sexGroup = sex;
      if (sex === 'futa') futaBadges += 1;
      if (delta && wantIds.has(id)) seenWant += 1;
    });

    if (delta && seenWant >= wantIds.size) break;
    await sleepIndexJob(120);
  }

  const tagged = countSexGroupTagged(rows);
  if (!delta && !tagged) {
    throw new Error('Tag sex labeled 0 videos — check login / list pages');
  }
  if (!delta && rows.length >= 24 && pagesWithCards > 0 && futaBadges === 0) {
    throw new Error(
      'Tag sex found no Futa badges on list cards — cannot separate Futa/Straight',
    );
  }
  return rows;
}

/**
 * Cheap sex classify for a small set of new ids: parse badges on list page 1.
 * Merges labels into the stored list index.
 */
let sexClassifyPage1Chain = Promise.resolve();

async function classifySexGroupsPage1(opts = {}) {
  const run = () => classifySexGroupsPage1Unlocked(opts);
  const p = sexClassifyPage1Chain.then(run, run);
  sexClassifyPage1Chain = p.then(
    () => {},
    () => {},
  );
  return p;
}

async function classifySexGroupsPage1Unlocked({
  scope = 'favorites',
  videoIds = [],
  playlistId = '',
  blockId = '',
  fromKey = '',
} = {}) {
  const scopeKey = String(scope || 'favorites').trim() || 'favorites';
  const want = new Set(
    (Array.isArray(videoIds) ? videoIds : [])
      .map((id) => String(id || '').trim())
      .filter((id) => /^\d+$/.test(id)),
  );
  if (!want.size) {
    return { tagged: 0, remaining: [], remainingCount: 0, byId: {} };
  }
  const current = await readIndexJob();
  if (jobIsActive(current)) {
    throw new Error(
      `Index already running for ${current.scope} — stop it before sex auto-tag`,
    );
  }
  let pid = String(playlistId || '').trim();
  if (scopeKey.startsWith('playlist:')) {
    pid = pid || scopeKey.slice('playlist:'.length);
    if (!/^[1-9]\d*$/.test(pid)) throw new Error('invalid playlist id');
  } else if (scopeKey !== 'favorites') {
    throw new Error('unsupported index scope');
  }
  const existing = await getFavIndex(scopeKey);
  const videos = Array.isArray(existing?.videos) ? existing.videos.slice() : [];
  if (!videos.length) {
    throw new Error('No list index to enrich — click Build index first');
  }
  const job = {
    scope: scopeKey,
    playlistId: scopeKey === 'favorites' ? '' : pid,
    blockId: String(blockId || '').trim(),
    fromKey: String(fromKey || '').trim(),
    listMaxPage: 1,
    startMaxPage: 1,
  };
  const data = await fetchIndexPage(job, 1, { rateLimitRetries: 4 });
  const found = Object.create(null);
  (Array.isArray(data?.items) ? data.items : []).forEach((it) => {
    const id = String(it?.videoId || '').trim();
    if (!id || !want.has(id)) return;
    found[id] = String(it?.sexGroup || '').trim() || 'straight';
  });
  let tagged = 0;
  const nextVideos = videos.map((v) => {
    const id = String(v?.videoId || '').trim();
    const label = found[id];
    if (!label) return v;
    tagged += 1;
    return { ...v, sexGroup: label };
  });
  if (tagged) {
    await setFavIndex(
      {
        builtAt: Number(existing?.builtAt) || Date.now(),
        favTotal: nextVideos.length,
        videos: nextVideos,
        scope: scopeKey,
      },
      scopeKey,
    );
  }
  const remaining = [...want].filter((id) => !found[id]);
  return {
    tagged,
    remaining,
    remainingCount: remaining.length,
    byId: found,
  };
}

async function readIndexJob() {
  const data = await chrome.storage.local.get([INDEX_JOB_KEY]);
  return { ...idleIndexJob(), ...(data[INDEX_JOB_KEY] || {}) };
}

/** Serialize index-job writes so Stop cannot be clobbered by a stale progress write. */
let indexJobWriteChain = Promise.resolve();
let indexJobCancelFlag = false;

async function writeIndexJob(job) {
  const run = async () => {
    const cur = await readIndexJob();
    const next = { ...idleIndexJob(), ...job, updatedAt: Date.now() };
    // Progress patches often spread a pre-fetch snapshot (cancelRequested:false,
    // status:'running'). Never let those undo an in-flight Stop.
    if (!isTerminalJobStatus(next.status) && (cur.cancelRequested || cur.status === 'stopping' || indexJobCancelFlag)) {
      next.cancelRequested = true;
      next.status = 'stopping';
      indexJobCancelFlag = true;
    }
    if (isTerminalJobStatus(next.status)) {
      indexJobCancelFlag = false;
    }
    await chrome.storage.local.set({ [INDEX_JOB_KEY]: next });
    return next;
  };
  const p = indexJobWriteChain.then(run, run);
  indexJobWriteChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

async function getIndexJobStatus() {
  const job = await readIndexJob();
  if ((job.status === 'running' || job.status === 'stopping') && !indexJobRunning) {
    runIndexJob();
  }
  return publicIndexJobStatus(job);
}

async function stopIndexJob() {
  const job = await readIndexJob();
  if (job.status !== 'running' && job.status !== 'stopping') {
    return publicIndexJobStatus(job);
  }
  indexJobCancelFlag = true;
  const next = await writeIndexJob({
    ...job,
    status: 'stopping',
    cancelRequested: true,
  });
  runIndexJob();
  return publicIndexJobStatus(next);
}

function jobIsActive(job) {
  const status = job?.status || '';
  return status === 'running' || status === 'stopping';
}

async function startIndexJob({
  scope = 'favorites',
  maxPage = 0,
  playlistId = '',
  blockId = '',
  fromKey = '',
  libraryTotal = 0,
  sexOnly = false,
  mode = '',
  fromPage = 0,
  toPage = 0,
  targetIds = [],
} = {}) {
  const scopeKey = String(scope || 'favorites').trim() || 'favorites';
  const current = await readIndexJob();
  if (jobIsActive(current)) {
    if (current.scope === scopeKey) {
      runIndexJob();
      return publicIndexJobStatus(current);
    }
    throw new Error(
      `Index already running for ${current.scope} (${current.page}/${current.maxPage}). Stop it first.`,
    );
  }
  // Soft mutex: index and renumber both crawl site lists; renumber also renames files.
  const renumber = await readRenumberJob();
  if (jobIsActive(renumber)) {
    throw new Error(
      'Build/Rebuild index cannot run while Renumber is active — finish or Stop Renumber first (shared Favorites crawl; Renumber also renames library files)',
    );
  }
  let pid = String(playlistId || '').trim();
  if (scopeKey.startsWith('playlist:')) {
    pid = pid || scopeKey.slice('playlist:'.length);
    if (!/^[1-9]\d*$/.test(pid)) throw new Error('invalid playlist id');
  } else if (scopeKey !== 'favorites') {
    throw new Error('unsupported index scope');
  }
  const hintMax = Math.max(1, Number(maxPage) || 1);
  const totalHint = Math.max(0, Number(libraryTotal) || 0);
  let crawlMode = String(mode || '')
    .trim()
    .toLowerCase();
  if (crawlMode === 'sex-delta') {
    /* keep */
  } else if (sexOnly || crawlMode === 'sex') {
    crawlMode = 'sex';
  } else if (crawlMode !== 'incremental' && crawlMode !== 'full') {
    crawlMode = 'full';
  }
  const wantSex = crawlMode === 'sex' || crawlMode === 'sex-delta';
  const sexTargets = (Array.isArray(targetIds) ? targetIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => /^\d+$/.test(id));
  let seedVideos = [];
  let listMaxPage = 0;
  let crawlMaxPage = hintMax;
  let rangeFrom = 0;
  let rangeTo = 0;
  let startPage = 0;
  if (wantSex) {
    const existing = await getFavIndex(scopeKey);
    seedVideos = Array.isArray(existing?.videos) ? existing.videos.slice() : [];
    if (!seedVideos.length) {
      throw new Error('No list index to enrich — click Build index first');
    }
    if (crawlMode === 'sex-delta') {
      const want = sexWantIdsForEnrich(seedVideos, {
        delta: true,
        targetIds: sexTargets,
      });
      if (!want.size) {
        const idle = await writeIndexJob({
          ...idleIndexJob(),
          status: 'done',
          scope: scopeKey,
          playlistId: scopeKey === 'favorites' ? '' : pid,
          mode: 'sex-delta',
          sexOnly: true,
          targetIds: sexTargets,
          page: 2,
          maxPage: 2,
          listMaxPage: 1,
          startedAt: Date.now(),
        });
        return publicIndexJobStatus(idle);
      }
    }
    listMaxPage = Math.max(
      hintMax,
      Math.ceil(seedVideos.length / 12),
      Number(existing?.favTotal) ? Math.ceil(Number(existing.favTotal) / 12) : 0,
      1,
    );
  } else if (crawlMode === 'incremental') {
    // Refresh: merge an inclusive page window into the existing list (no sex).
    const existing = await getFavIndex(scopeKey);
    seedVideos = Array.isArray(existing?.videos) ? existing.videos.slice() : [];
    const rawFrom = Math.max(1, Number(fromPage) || 1);
    const rawTo = Math.max(1, Number(toPage) || rawFrom);
    rangeFrom = Math.min(rawFrom, rawTo);
    rangeTo = Math.max(rawFrom, rawTo);
    crawlMaxPage = rangeTo;
    listMaxPage = rangeTo;
    // nextPage = page + 1, so start just before the window.
    startPage = rangeFrom - 1;
  }
  indexJobCancelFlag = false;
  const job = await writeIndexJob({
    status: 'running',
    scope: scopeKey,
    playlistId: scopeKey === 'favorites' ? '' : pid,
    blockId: String(blockId || '').trim(),
    fromKey: String(fromKey || '').trim(),
    page: wantSex ? 1 : startPage,
    maxPage: wantSex ? 2 : crawlMaxPage,
    startMaxPage: crawlMaxPage,
    libraryTotal: totalHint || (wantSex ? seedVideos.length : 0),
    pageSize: 0,
    probedPastEnd: false,
    videos: seedVideos,
    error: '',
    phase: wantSex ? 'sex' : '',
    listMaxPage,
    sexFilterPage: 0,
    sexFilterMaxPage: 0,
    sexOnly: wantSex,
    mode: crawlMode,
    targetIds: sexTargets,
    fromPage: rangeFrom,
    toPage: rangeTo,
    startedAt: Date.now(),
    cancelRequested: false,
  });
  try {
    await chrome.alarms?.create?.('hxyrule-index', { periodInMinutes: 1 });
  } catch (_) {
    /* optional */
  }
  runIndexJob();
  return publicIndexJobStatus(job);
}

function coerceIndexDurationSec(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchIndexPage(job, page, { sexGroupId = '', rateLimitRetries = 6 } = {}) {
  if (job.scope === 'favorites') {
    return await fetchFavoritesPage(page, { sexGroupId, rateLimitRetries });
  }
  return await fetchPlaylistPage(job.playlistId, page, {
    blockId: job.blockId,
    fromKey: job.fromKey,
    sexGroupId,
    rateLimitRetries,
  });
}

function runIndexJob() {
  if (indexJobRunning) return;
  indexJobRunning = true;
  (async () => {
    const prevCategoryGroupCookie = await readCategoryGroupIdCookie();
    try {
      // Favorites/playlist index must crawl the unfiltered list. The site top
      // sex filter (and a stuck cookie from a prior sex-enrich) would shrink it.
      try {
        await writeCategoryGroupIdCookie('');
        await new Promise((r) => setTimeout(r, 50));
      } catch (_) {
        /* continue; fetches still use whatever cookie is present */
      }
      while (true) {
        let job = await readIndexJob();
        if (job.status !== 'running' && job.status !== 'stopping') break;
        if (job.cancelRequested || job.status === 'stopping' || indexJobCancelFlag) {
          await writeIndexJob({
            ...job,
            status: 'stopped',
            cancelRequested: false,
            phase: '',
            // Drop partial crawl; keep previous FAV_INDEX_* untouched.
            videos: [],
            error: '',
          });
          break;
        }

        // SW resume mid sex-enrich: do not treat sex page/maxPage as list crawl.
        if (String(job.phase || '') === 'sex') {
          let videos = Array.isArray(job.videos) ? job.videos : [];
          if (!videos.length) {
            await writeIndexJob({
              ...job,
              status: 'error',
              cancelRequested: false,
              phase: '',
              videos: [],
              error: 'indexed 0 videos — check login / page parse',
            });
            break;
          }
          try {
            const delta = String(job.mode || '') === 'sex-delta';
            videos = await enrichVideosWithSexGroups(job, videos, { delta });
          } catch (err) {
            if (
              err?.code === 'INDEX_CANCELLED' ||
              /index cancelled/i.test(String(err?.message || err))
            ) {
              await writeIndexJob({
                ...(await readIndexJob()),
                status: 'stopped',
                cancelRequested: false,
                phase: '',
                videos: [],
                error: '',
              });
              break;
            }
            throw err;
          }
          job = await readIndexJob();
          if (job.cancelRequested || job.status === 'stopping' || indexJobCancelFlag) {
            await writeIndexJob({
              ...job,
              status: 'stopped',
              cancelRequested: false,
              phase: '',
              videos: [],
              error: '',
            });
            break;
          }
          const listMaxPage = Math.max(
            Number(job.listMaxPage) || 0,
            Number(job.startMaxPage) || 0,
            1,
          );
          await setFavIndex(
            {
              builtAt: Date.now(),
              favTotal: videos.length,
              videos,
              scope: job.scope,
            },
            job.scope,
          );
          await writeIndexJob({
            ...job,
            status: 'done',
            cancelRequested: false,
            phase: '',
            videos: [],
            error: '',
            page: listMaxPage,
            maxPage: listMaxPage,
            listMaxPage,
          });
          break;
        }

        const nextPage = (Number(job.page) || 0) + 1;
        let maxPage = Math.max(1, Number(job.maxPage) || 1);
        if (nextPage > maxPage) {
          // Finished.
        } else {
          let data;
          try {
            data = await fetchIndexPage(job, nextPage);
            await assertIndexJobNotCancelled();
          } catch (err) {
            if (
              err?.code === 'INDEX_CANCELLED' ||
              /index cancelled/i.test(String(err?.message || err))
            ) {
              throw err;
            }
            const msg = String(err?.message || err);
            const pastEnd =
              nextPage > 1 &&
              (/failed to load favorites page|parsed 0 videos|failed to load playlist page/i.test(
                msg,
              ) ||
                !!job.probedPastEnd);
            // One-shot probe past a truncated pager, or a mid-list empty under
            // a sticky sex filter: finish with pages already collected.
            if (pastEnd && (job.probedPastEnd || (Array.isArray(job.videos) && job.videos.length))) {
              maxPage = nextPage - 1;
              job = await writeIndexJob({
                ...job,
                status: 'running',
                maxPage,
                error: '',
              });
              data = null;
            } else {
              throw err;
            }
          }
          if (data) {
            const batch = Array.isArray(data?.items) ? data.items : [];
            const isIncremental = String(job.mode || '') === 'incremental';
            const libraryTotal = Math.max(0, Number(job.libraryTotal) || 0);
            let pageSize = Math.max(0, Number(job.pageSize) || 0);
            if (batch.length > pageSize) pageSize = batch.length;
            const byTotal =
              libraryTotal > 0 && pageSize > 0
                ? Math.ceil(libraryTotal / pageSize)
                : 0;
            const parsedMax = Number(data?.maxPage) || 0;
            const isPlaylistScope = String(job.scope || '').startsWith('playlist:');
            const startMax = Math.max(1, Number(job.startMaxPage) || 1);

            if (isIncremental) {
              // Incremental merge: stay inside from–to (never expand via pager chrome).
              const to = Math.max(1, Number(job.toPage) || startMax);
              maxPage = to;
            } else {
              if (parsedMax > maxPage) maxPage = parsedMax;
              if (byTotal > maxPage) maxPage = byTotal;
              // Never shrink below the start hint (playlist pager said 2 pages).
              if (startMax > maxPage) maxPage = startMax;
              // Cap Favorites-chrome inflation above a solid native total / hint.
              const solid = Math.max(byTotal, startMax);
              if (solid > 0 && maxPage > solid + 2) maxPage = solid;
            }

            const priorVideos = Array.isArray(job.videos) ? job.videos.slice() : [];
            const seen = new Set(
              isIncremental ? [] : priorVideos.map((v) => String(v.videoId || '')),
            );
            // Skip per-card popup-video fetches during list crawl (~12×pages).
            // Compact already lazy-loads uploadedText and patches the index.
            // Incremental merge still keeps any prior uploadedText on known ids.
            const pageRows = [];
            batch.forEach((it, idx) => {
              const id = String(it.videoId || '');
              if (!id) return;
              if (!isIncremental && seen.has(id)) return;
              if (!isIncremental) seen.add(id);
              pageRows.push({
                videoId: id,
                title: it.title || id,
                detailUrl: it.detailUrl || `https://rule34video.com/video/${id}/`,
                favoritePage: Number(it.favoritePage) || nextPage,
                cardIndex: Number.isInteger(it.cardIndex) ? it.cardIndex : idx,
                durationSec: coerceIndexDurationSec(it.durationSec),
                thumbUrl: normalizeThumbUrl(it.thumbUrl),
                previewUrl: normalizeThumbUrl(it.previewUrl),
                viewsText: String(it.viewsText || '').replace(/\s+/g, ' ').trim(),
                ratingText: String(it.ratingText || '').replace(/\s+/g, ' ').trim(),
                addedText: String(it.addedText || '').replace(/\s+/g, ' ').trim(),
                uploadedText: '',
              });
            });
            const videos = isIncremental
              ? mergeIndexPageVideos(priorVideos, pageRows, nextPage)
              : priorVideos.concat(pageRows);

            if (isIncremental) {
              maxPage = Math.max(1, Number(job.toPage) || startMax);
            } else if (
              libraryTotal > 0 &&
              videos.length >= libraryTotal &&
              nextPage >= startMax
            ) {
              // Only stop early when we have also reached the pager hint.
              // libraryTotal=12 (page-1 cards) used to force (0/2)→(1/1).
              maxPage = nextPage;
            } else if (isPlaylistScope && nextPage > 1 && batch.length === 0) {
              maxPage = nextPage - 1;
            } else if (
              isPlaylistScope &&
              nextPage > 1 &&
              pageSize > 0 &&
              batch.length > 0 &&
              batch.length < Math.max(pageSize, 8) &&
              nextPage >= startMax
            ) {
              // Short last page ends the playlist crawl (after meeting pager hint).
              maxPage = nextPage;
            } else if (isPlaylistScope && startMax > maxPage) {
              maxPage = startMax;
            }

            let probedPastEnd = !!job.probedPastEnd;
            // Unknown total + full final page: probe exactly one extra page.
            if (
              !isIncremental &&
              !libraryTotal &&
              !isPlaylistScope &&
              nextPage >= maxPage &&
              batch.length >= 8 &&
              !probedPastEnd
            ) {
              maxPage = nextPage + 1;
              probedPastEnd = true;
            }
            job = await writeIndexJob({
              ...job,
              status: 'running',
              page: nextPage,
              maxPage,
              startMaxPage: Number(job.startMaxPage) || startMax,
              pageSize,
              libraryTotal,
              probedPastEnd,
              videos,
              error: '',
            });
            if (nextPage < maxPage) {
              // List-only crawl: short gap; sex enrich uses its own step cooldowns.
              // ~200 pages × 250ms ≈ 50s sleep.
              await sleepIndexJob(250);
              continue;
            }
          }
        }
        // Persist list index (Futa/Straight is a separate sex-only job).
        job = await readIndexJob();
        if (job.cancelRequested || job.status === 'stopping' || indexJobCancelFlag) {
          await writeIndexJob({
            ...job,
            status: 'stopped',
            cancelRequested: false,
            videos: [],
            error: '',
          });
          break;
        }
        const videos = Array.isArray(job.videos) ? job.videos : [];
        if (!videos.length) {
          await writeIndexJob({
            ...job,
            status: 'error',
            cancelRequested: false,
            videos: [],
            error: 'indexed 0 videos — check login / page parse',
          });
          break;
        }
        const listMaxPage = Math.max(
          Number(job.listMaxPage) || 0,
          Number(job.page) || 0,
          Number(job.maxPage) || 0,
          Number(job.startMaxPage) || 0,
          1,
        );
        const doneMax = listMaxPage;
        await setFavIndex(
          {
            builtAt: Date.now(),
            favTotal: videos.length,
            videos,
            scope: job.scope,
          },
          job.scope,
        );
        await writeIndexJob({
          ...job,
          status: 'done',
          cancelRequested: false,
          phase: '',
          videos: [],
          error: '',
          page: doneMax,
          maxPage: doneMax,
          listMaxPage: doneMax,
        });
        break;
      }
    } catch (err) {
      if (
        err?.code === 'INDEX_CANCELLED' ||
        /index cancelled/i.test(String(err?.message || err))
      ) {
        const job = await readIndexJob();
        await writeIndexJob({
          ...job,
          status: 'stopped',
          cancelRequested: false,
          phase: '',
          videos: [],
          error: '',
        });
      } else {
        const job = await readIndexJob();
        await writeIndexJob({
          ...job,
          status: 'error',
          cancelRequested: false,
          phase: '',
          videos: [],
          error: String(err?.message || err),
        });
      }
    } finally {
      try {
        await writeCategoryGroupIdCookie(prevCategoryGroupCookie);
      } catch (_) {
        /* best-effort restore of the user's top sex filter */
      }
      indexJobRunning = false;
      const job = await readIndexJob();
      if (job.status === 'running' || job.status === 'stopping') {
        // SW may have been interrupted mid-page; resume.
        runIndexJob();
      } else {
        try {
          await chrome.alarms?.clear?.('hxyrule-index');
        } catch (_) {
          /* optional */
        }
      }
    }
  })();
}

const RENUMBER_JOB_KEY = 'hxyruleRenumberJob';
let renumberJobRunning = false;
const ORDINAL_PREFIX_RE = /^(\d+)\s*——\s*/;

function bareTitleForRenumber(title) {
  return String(title || '').replace(ORDINAL_PREFIX_RE, '').trim();
}

function idleRenumberJob() {
  return {
    status: 'idle',
    phase: '', // crawl | renaming
    page: 0,
    maxPage: 0,
    videoIds: [],
    titles: {},
    result: null,
    error: '',
    startedAt: 0,
    updatedAt: 0,
    cancelRequested: false,
  };
}

function publicRenumberJobStatus(job) {
  const j = job || idleRenumberJob();
  return {
    status: j.status || 'idle',
    phase: j.phase || '',
    page: Number(j.page) || 0,
    maxPage: Number(j.maxPage) || 0,
    videoCount: Array.isArray(j.videoIds) ? j.videoIds.length : 0,
    result: j.result || null,
    error: j.error || '',
    startedAt: Number(j.startedAt) || 0,
    updatedAt: Number(j.updatedAt) || 0,
    cancelRequested: !!j.cancelRequested,
  };
}

async function readRenumberJob() {
  const data = await chrome.storage.local.get([RENUMBER_JOB_KEY]);
  return { ...idleRenumberJob(), ...(data[RENUMBER_JOB_KEY] || {}) };
}

/** Serialize renumber-job writes so Stop cannot be clobbered by a stale progress write. */
let renumberJobWriteChain = Promise.resolve();
let renumberJobCancelFlag = false;

async function writeRenumberJob(job) {
  const run = async () => {
    const cur = await readRenumberJob();
    const next = { ...idleRenumberJob(), ...job, updatedAt: Date.now() };
    if (!isTerminalJobStatus(next.status) && (cur.cancelRequested || cur.status === 'stopping' || renumberJobCancelFlag)) {
      next.cancelRequested = true;
      next.status = 'stopping';
      renumberJobCancelFlag = true;
    }
    if (isTerminalJobStatus(next.status)) {
      renumberJobCancelFlag = false;
    }
    await chrome.storage.local.set({ [RENUMBER_JOB_KEY]: next });
    return next;
  };
  const p = renumberJobWriteChain.then(run, run);
  renumberJobWriteChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

async function getRenumberJobStatus() {
  const job = await readRenumberJob();
  if ((job.status === 'running' || job.status === 'stopping') && !renumberJobRunning) {
    runRenumberJob();
  }
  return publicRenumberJobStatus(job);
}

async function stopRenumberJob() {
  const job = await readRenumberJob();
  if (job.status !== 'running' && job.status !== 'stopping') {
    return publicRenumberJobStatus(job);
  }
  renumberJobCancelFlag = true;
  const next = await writeRenumberJob({
    ...job,
    status: 'stopping',
    cancelRequested: true,
  });
  runRenumberJob();
  return publicRenumberJobStatus(next);
}

async function startRenumberJob({ maxPage = 1 } = {}) {
  const current = await readRenumberJob();
  if (jobIsActive(current)) {
    runRenumberJob();
    return publicRenumberJobStatus(current);
  }
  // Soft mutex: renumber and index both crawl; do not stack Favorites crawls / rename.
  const index = await readIndexJob();
  if (jobIsActive(index)) {
    throw new Error(
      'Renumber cannot run while Build/Rebuild index is active — finish or Stop index first (shared Favorites crawl; Renumber also renames library files)',
    );
  }
  renumberJobCancelFlag = false;
  const job = await writeRenumberJob({
    status: 'running',
    phase: 'crawl',
    page: 0,
    maxPage: Math.max(1, Number(maxPage) || 1),
    videoIds: [],
    titles: {},
    result: null,
    error: '',
    startedAt: Date.now(),
    cancelRequested: false,
  });
  try {
    await chrome.alarms?.create?.('hxyrule-renumber', { periodInMinutes: 1 });
  } catch (_) {
    /* optional */
  }
  runRenumberJob();
  return publicRenumberJobStatus(job);
}

function runRenumberJob() {
  if (renumberJobRunning) return;
  renumberJobRunning = true;
  (async () => {
    try {
      while (true) {
        let job = await readRenumberJob();
        if (job.status !== 'running' && job.status !== 'stopping') break;
        if (job.cancelRequested || job.status === 'stopping' || renumberJobCancelFlag) {
          await writeRenumberJob({
            ...job,
            status: 'stopped',
            phase: '',
            cancelRequested: false,
            videoIds: [],
            titles: {},
            result: null,
            error: '',
          });
          break;
        }

        const phase = job.phase || 'crawl';
        if (phase === 'crawl') {
          const nextPage = (Number(job.page) || 0) + 1;
          let maxPage = Math.max(1, Number(job.maxPage) || 1);
          if (nextPage <= maxPage) {
            const data = await fetchFavoritesPage(nextPage);
            if (renumberJobCancelFlag) {
              const cur = await readRenumberJob();
              if (cur.cancelRequested || cur.status === 'stopping' || renumberJobCancelFlag) {
                await writeRenumberJob({
                  ...cur,
                  status: 'stopped',
                  phase: '',
                  cancelRequested: false,
                  videoIds: [],
                  titles: {},
                  result: null,
                  error: '',
                });
                break;
              }
            }
            const batch = Array.isArray(data?.items) ? data.items : [];
            if (data?.maxPage && Number(data.maxPage) > maxPage) {
              maxPage = Number(data.maxPage);
            }
            const videoIds = Array.isArray(job.videoIds) ? job.videoIds.slice() : [];
            const titles = { ...(job.titles || {}) };
            const seen = new Set(videoIds.map(String));
            batch.forEach((it) => {
              const id = String(it.videoId || '');
              if (!id || seen.has(id)) return;
              seen.add(id);
              videoIds.push(id);
              const bare = bareTitleForRenumber(it.title || '');
              if (bare && bare !== id) titles[id] = bare;
            });
            job = await writeRenumberJob({
              ...job,
              status: 'running',
              phase: 'crawl',
              page: nextPage,
              maxPage,
              videoIds,
              titles,
              error: '',
            });
            if (nextPage < maxPage) {
              await new Promise((r) => setTimeout(r, 700));
              continue;
            }
          }

          job = await readRenumberJob();
          if (job.cancelRequested || job.status === 'stopping' || renumberJobCancelFlag) {
            await writeRenumberJob({
              ...job,
              status: 'stopped',
              phase: '',
              cancelRequested: false,
              videoIds: [],
              titles: {},
              result: null,
              error: '',
            });
            break;
          }
          const videoIds = Array.isArray(job.videoIds) ? job.videoIds : [];
          if (!videoIds.length) {
            await writeRenumberJob({
              ...job,
              status: 'error',
              phase: '',
              cancelRequested: false,
              videoIds: [],
              titles: {},
              error: 'crawled 0 videos — check login / page parse',
            });
            break;
          }
          await writeRenumberJob({
            ...job,
            status: 'running',
            phase: 'renaming',
            page: Number(job.maxPage) || job.page,
            error: '',
          });
          continue;
        }

        if (phase === 'renaming') {
          const videoIds = Array.isArray(job.videoIds) ? job.videoIds : [];
          const titles = job.titles || {};
          const result = await helperFetch('/ordinals/rebuild', {
            method: 'POST',
            body: {
              videoIds,
              titles,
              renameFiles: true,
            },
          });
          job = await readRenumberJob();
          if (job.cancelRequested || job.status === 'stopping' || renumberJobCancelFlag) {
            // Rebuild already applied; still mark stopped so UI does not claim success toast path.
            await writeRenumberJob({
              ...job,
              status: 'stopped',
              phase: '',
              cancelRequested: false,
              videoIds: [],
              titles: {},
              result: null,
              error: '',
            });
            break;
          }
          try {
            await helperFetch('/scan', { method: 'POST', body: {} });
          } catch (_) {
            /* rename already applied; scan optional */
          }
          await writeRenumberJob({
            ...job,
            status: 'done',
            phase: '',
            cancelRequested: false,
            videoIds: [],
            titles: {},
            result: {
              count: Number(result?.count) || videoIds.length,
              renamed: Number(result?.rename?.renamed) || 0,
              errorCount: Number(result?.rename?.errorCount) || 0,
            },
            error: '',
            page: Number(job.maxPage) || job.page,
          });
          break;
        }

        await writeRenumberJob({
          ...job,
          status: 'error',
          phase: '',
          cancelRequested: false,
          videoIds: [],
          titles: {},
          error: `unknown renumber phase: ${phase}`,
        });
        break;
      }
    } catch (err) {
      const job = await readRenumberJob();
      if (
        renumberJobCancelFlag ||
        job.cancelRequested ||
        job.status === 'stopping' ||
        /renumber cancelled|index cancelled|cancelled/i.test(String(err?.message || err))
      ) {
        await writeRenumberJob({
          ...job,
          status: 'stopped',
          phase: '',
          cancelRequested: false,
          videoIds: [],
          titles: {},
          result: null,
          error: '',
        });
      } else {
        await writeRenumberJob({
          ...job,
          status: 'error',
          phase: '',
          cancelRequested: false,
          videoIds: [],
          titles: {},
          error: String(err?.message || err),
        });
      }
    } finally {
      renumberJobRunning = false;
      const job = await readRenumberJob();
      if (job.status === 'running' || job.status === 'stopping') {
        runRenumberJob();
      } else {
        try {
          await chrome.alarms?.clear?.('hxyrule-renumber');
        } catch (_) {
          /* optional */
        }
      }
    }
  })();
}

const PLAYLIST_ADD_JOB_KEY = 'hxyrulePlaylistAddJob';
let playlistAddJobRunning = false;
let playlistAddJobWriteChain = Promise.resolve();
let playlistAddJobCancelFlag = false;

function idlePlaylistAddJob() {
  return {
    status: 'idle',
    mode: 'save',
    phase: '',
    playlistIds: [],
    videoIds: [],
    items: {},
    playlistIdx: 0,
    videoIdx: 0,
    done: 0,
    total: 0,
    ok: 0,
    failed: 0,
    okIdsByPlaylist: {},
    moveOkIds: [],
    errors: [],
    result: null,
    error: '',
    sourceScope: '',
    startedAt: 0,
    updatedAt: 0,
    cancelRequested: false,
  };
}

function publicPlaylistAddJobStatus(job) {
  const j = job || idlePlaylistAddJob();
  return {
    status: j.status || 'idle',
    mode: j.mode || 'save',
    phase: j.phase || '',
    playlistIds: Array.isArray(j.playlistIds) ? j.playlistIds.slice() : [],
    videoCount: Array.isArray(j.videoIds) ? j.videoIds.length : 0,
    playlistIdx: Number(j.playlistIdx) || 0,
    videoIdx: Number(j.videoIdx) || 0,
    done: Number(j.done) || 0,
    total: Number(j.total) || 0,
    ok: Number(j.ok) || 0,
    failed: Number(j.failed) || 0,
    error: j.error || '',
    result: j.result || null,
    sourceScope: String(j.sourceScope || ''),
    startedAt: Number(j.startedAt) || 0,
    updatedAt: Number(j.updatedAt) || 0,
    cancelRequested: !!j.cancelRequested,
  };
}

async function readPlaylistAddJob() {
  const data = await chrome.storage.local.get([PLAYLIST_ADD_JOB_KEY]);
  return { ...idlePlaylistAddJob(), ...(data[PLAYLIST_ADD_JOB_KEY] || {}) };
}

async function writePlaylistAddJob(job) {
  const run = async () => {
    const cur = await readPlaylistAddJob();
    const next = { ...idlePlaylistAddJob(), ...job, updatedAt: Date.now() };
    if (
      !isTerminalJobStatus(next.status) &&
      (cur.cancelRequested || cur.status === 'stopping' || playlistAddJobCancelFlag)
    ) {
      next.cancelRequested = true;
      next.status = 'stopping';
      playlistAddJobCancelFlag = true;
    }
    if (isTerminalJobStatus(next.status)) {
      playlistAddJobCancelFlag = false;
    }
    await chrome.storage.local.set({ [PLAYLIST_ADD_JOB_KEY]: next });
    return next;
  };
  const p = playlistAddJobWriteChain.then(run, run);
  playlistAddJobWriteChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

async function getPlaylistAddJobStatus() {
  const job = await readPlaylistAddJob();
  if ((job.status === 'running' || job.status === 'stopping') && !playlistAddJobRunning) {
    runPlaylistAddJob();
  }
  return publicPlaylistAddJobStatus(job);
}

async function stopPlaylistAddJob() {
  const job = await readPlaylistAddJob();
  if (job.status !== 'running' && job.status !== 'stopping') {
    return publicPlaylistAddJobStatus(job);
  }
  playlistAddJobCancelFlag = true;
  const next = await writePlaylistAddJob({
    ...job,
    status: 'stopping',
    cancelRequested: true,
  });
  runPlaylistAddJob();
  return publicPlaylistAddJobStatus(next);
}

async function startPlaylistAddJob({
  playlistIds = [],
  videoIds = [],
  mode = 'save',
  items = {},
  sourceScope = '',
} = {}) {
  const current = await readPlaylistAddJob();
  if (jobIsActive(current)) {
    runPlaylistAddJob();
    return publicPlaylistAddJobStatus(current);
  }
  const pids = [
    ...new Set(
      (playlistIds || [])
        .map((x) => String(x || '').trim())
        .filter((id) => isValidPlaylistId(id)),
    ),
  ];
  const rawIds = [
    ...new Set((videoIds || []).map((v) => String(v).trim()).filter((v) => /^[1-9]\d*$/.test(v))),
  ];
  if (!pids.length) throw new Error('invalid playlist id');
  if (!rawIds.length) throw new Error('no video ids');
  const normalizedItems = normalizeJobItems(items, rawIds);
  const ids = await sortVideoIdsByOrdinalAsc(rawIds, normalizedItems);
  const jobMode = mode === 'move' ? 'move' : 'save';
  const saveList = jobMode === 'move' ? pids.slice(0, -1) : pids;
  // Move is one-by-one (same as save) so playlist order follows ascending seq.
  const total =
    jobMode === 'move'
      ? saveList.length * ids.length + ids.length
      : saveList.length * ids.length;
  const phase = jobMode === 'move' && !saveList.length ? 'move' : 'save';
  playlistAddJobCancelFlag = false;
  const job = await writePlaylistAddJob({
    status: 'running',
    mode: jobMode,
    phase,
    playlistIds: pids,
    videoIds: ids,
    items: normalizeJobItems(normalizedItems, ids),
    playlistIdx: 0,
    videoIdx: 0,
    done: 0,
    total: Math.max(1, total),
    ok: 0,
    failed: 0,
    okIdsByPlaylist: {},
    moveOkIds: [],
    errors: [],
    result: null,
    error: '',
    sourceScope: String(sourceScope || ''),
    startedAt: Date.now(),
    cancelRequested: false,
  });
  try {
    await chrome.alarms?.create?.('hxyrule-playlist-add', { periodInMinutes: 1 });
  } catch (_) {
    /* optional */
  }
  runPlaylistAddJob();
  return publicPlaylistAddJobStatus(job);
}

function runPlaylistAddJob() {
  if (playlistAddJobRunning) return;
  playlistAddJobRunning = true;
  (async () => {
    try {
      while (true) {
        let job = await readPlaylistAddJob();
        if (job.status !== 'running' && job.status !== 'stopping') break;
        if (job.cancelRequested || job.status === 'stopping' || playlistAddJobCancelFlag) {
          await writePlaylistAddJob({
            ...job,
            status: 'stopped',
            phase: '',
            cancelRequested: false,
            result: playlistAddJobResult(job, { stopped: true }),
            error: '',
          });
          break;
        }

        const videoIds = Array.isArray(job.videoIds) ? job.videoIds : [];
        const playlistIds = Array.isArray(job.playlistIds) ? job.playlistIds : [];
        const mode = job.mode === 'move' ? 'move' : 'save';
        const phase = job.phase || 'save';

        if (phase === 'save') {
          const saveList = mode === 'move' ? playlistIds.slice(0, -1) : playlistIds;
          const pIdx = Number(job.playlistIdx) || 0;
          const vIdx = Number(job.videoIdx) || 0;
          if (!saveList.length || pIdx >= saveList.length) {
            if (mode === 'move') {
              job = await writePlaylistAddJob({
                ...job,
                status: 'running',
                phase: 'move',
                videoIdx: 0,
                error: '',
              });
              continue;
            }
            if ((Number(job.ok) || 0) === 0 && (Number(job.failed) || 0) > 0) {
              await writePlaylistAddJob({
                ...job,
                status: 'error',
                phase: '',
                cancelRequested: false,
                result: playlistAddJobResult(job),
                error:
                  `Save failed for all targets` +
                  (job.errors?.[0] ? `: ${job.errors[0]}` : ''),
              });
              break;
            }
            await writePlaylistAddJob({
              ...job,
              status: 'done',
              phase: '',
              cancelRequested: false,
              result: playlistAddJobResult(job),
              error: '',
            });
            break;
          }

          const pid = String(saveList[pIdx]);
          const vid = String(videoIds[vIdx] || '');
          if (!vid) {
            await writePlaylistAddJob({
              ...job,
              status: 'error',
              phase: '',
              cancelRequested: false,
              error: 'missing video id in playlist-add job',
            });
            break;
          }

          let added = await addOneViaFavouritesAction(pid, vid);
          if (!added.ok) {
            // Keep parity with content fallback path.
            try {
              const batch = await addVideosToSitePlaylist(pid, [vid], 'save');
              if (batch?.ok > 0) added = { ok: true };
              else if (batch?.errors?.[0]) added = { ok: false, detail: batch.errors[0] };
            } catch (err) {
              added = { ok: false, detail: String(err.message || err) };
            }
          }

          const okIdsByPlaylist = { ...(job.okIdsByPlaylist || {}) };
          const errors = Array.isArray(job.errors) ? job.errors.slice() : [];
          let ok = Number(job.ok) || 0;
          let failed = Number(job.failed) || 0;
          if (added.ok) {
            ok += 1;
            const list = Array.isArray(okIdsByPlaylist[pid]) ? okIdsByPlaylist[pid].slice() : [];
            if (!list.includes(vid)) list.push(vid);
            okIdsByPlaylist[pid] = list;
          } else {
            failed += 1;
            if (errors.length < 8) errors.push(`${vid}: ${added.detail || 'failed'}`);
          }

          let nextV = vIdx + 1;
          let nextP = pIdx;
          if (nextV >= videoIds.length) {
            nextV = 0;
            nextP = pIdx + 1;
          }
          job = await writePlaylistAddJob({
            ...job,
            status: 'running',
            phase: 'save',
            playlistIdx: nextP,
            videoIdx: nextV,
            done: (Number(job.done) || 0) + 1,
            ok,
            failed,
            okIdsByPlaylist,
            errors,
            error: '',
          });
          await new Promise((r) => setTimeout(r, 140));
          continue;
        }

        if (phase === 'move') {
          const moveTarget = String(playlistIds[playlistIds.length - 1] || '');
          if (!isValidPlaylistId(moveTarget)) {
            await writePlaylistAddJob({
              ...job,
              status: 'error',
              phase: '',
              cancelRequested: false,
              error: 'invalid move playlist id',
            });
            break;
          }
          const vIdx = Number(job.videoIdx) || 0;
          if (vIdx >= videoIds.length) {
            const moveOkIds = Array.isArray(job.moveOkIds) ? job.moveOkIds : [];
            if (!moveOkIds.length && (Number(job.failed) || 0) > 0) {
              await writePlaylistAddJob({
                ...job,
                status: 'error',
                phase: '',
                cancelRequested: false,
                result: playlistAddJobResult(job),
                error:
                  `Move failed for all targets` +
                  (job.errors?.[0] ? `: ${job.errors[0]}` : ''),
              });
              break;
            }
            const okIdsByPlaylist = { ...(job.okIdsByPlaylist || {}) };
            okIdsByPlaylist[moveTarget] = moveOkIds.slice();
            await writePlaylistAddJob({
              ...job,
              status: 'done',
              phase: '',
              cancelRequested: false,
              okIdsByPlaylist,
              result: playlistAddJobResult({
                ...job,
                okIdsByPlaylist,
                moveOkIds,
              }),
              error: '',
            });
            break;
          }
          const vid = String(videoIds[vIdx] || '');
          if (!vid) {
            await writePlaylistAddJob({
              ...job,
              status: 'error',
              phase: '',
              cancelRequested: false,
              error: 'missing video id in playlist-move job',
            });
            break;
          }
          const moved = await moveVideosToSitePlaylist(moveTarget, [vid]);
          job = await readPlaylistAddJob();
          if (job.cancelRequested || job.status === 'stopping' || playlistAddJobCancelFlag) {
            const moveOkIds = Array.isArray(job.moveOkIds) ? job.moveOkIds.slice() : [];
            if (moved.ok && !moveOkIds.includes(vid)) moveOkIds.push(vid);
            await writePlaylistAddJob({
              ...job,
              status: 'stopped',
              phase: '',
              cancelRequested: false,
              moveOkIds,
              ok: moved.ok ? (Number(job.ok) || 0) + 1 : Number(job.ok) || 0,
              done: (Number(job.done) || 0) + 1,
              result: playlistAddJobResult(
                {
                  ...job,
                  moveOkIds,
                  ok: moved.ok ? (Number(job.ok) || 0) + 1 : Number(job.ok) || 0,
                  done: (Number(job.done) || 0) + 1,
                },
                { stopped: true },
              ),
              error: '',
            });
            break;
          }
          const moveOkIds = Array.isArray(job.moveOkIds) ? job.moveOkIds.slice() : [];
          const errors = Array.isArray(job.errors) ? job.errors.slice() : [];
          let ok = Number(job.ok) || 0;
          let failed = Number(job.failed) || 0;
          if (moved.ok) {
            ok += 1;
            if (!moveOkIds.includes(vid)) moveOkIds.push(vid);
          } else {
            failed += 1;
            if (errors.length < 8) errors.push(`${vid}: ${moved.detail || 'failed'}`);
          }
          job = await writePlaylistAddJob({
            ...job,
            status: 'running',
            phase: 'move',
            videoIdx: vIdx + 1,
            done: (Number(job.done) || 0) + 1,
            ok,
            failed,
            moveOkIds,
            errors,
            error: '',
          });
          await new Promise((r) => setTimeout(r, 140));
          continue;
        }

        await writePlaylistAddJob({
          ...job,
          status: 'error',
          phase: '',
          cancelRequested: false,
          error: `unknown playlist-add phase: ${phase}`,
        });
        break;
      }
    } catch (err) {
      const job = await readPlaylistAddJob();
      if (
        playlistAddJobCancelFlag ||
        job.cancelRequested ||
        job.status === 'stopping' ||
        /cancelled|stopped/i.test(String(err?.message || err))
      ) {
        await writePlaylistAddJob({
          ...job,
          status: 'stopped',
          phase: '',
          cancelRequested: false,
          result: playlistAddJobResult(job, { stopped: true }),
          error: '',
        });
      } else {
        await writePlaylistAddJob({
          ...job,
          status: 'error',
          phase: '',
          cancelRequested: false,
          result: playlistAddJobResult(job),
          error: String(err?.message || err),
        });
      }
    } finally {
      playlistAddJobRunning = false;
      const job = await readPlaylistAddJob();
      if (job.status === 'running' || job.status === 'stopping') {
        runPlaylistAddJob();
      } else {
        try {
          await chrome.alarms?.clear?.('hxyrule-playlist-add');
        } catch (_) {
          /* optional */
        }
      }
    }
  })();
}

const FAV_ADD_JOB_KEY = 'hxyruleFavAddJob';
let favAddJobRunning = false;
let favAddJobWriteChain = Promise.resolve();
let favAddJobCancelFlag = false;

function idleFavAddJob() {
  return {
    status: 'idle',
    videoIds: [],
    items: {},
    cursor: 0,
    done: 0,
    total: 0,
    ok: 0,
    failed: 0,
    okIds: [],
    errors: [],
    result: null,
    error: '',
    sourceScope: '',
    startedAt: 0,
    updatedAt: 0,
    cancelRequested: false,
  };
}

function favAddJobResult(job, { stopped = false } = {}) {
  return {
    ok: Number(job.ok) || 0,
    failed: Number(job.failed) || 0,
    done: Number(job.done) || 0,
    total: Number(job.total) || 0,
    okIds: Array.isArray(job.okIds) ? job.okIds.slice() : [],
    errors: Array.isArray(job.errors) ? job.errors.slice(0, 8) : [],
    items: job.items && typeof job.items === 'object' ? job.items : {},
    sourceScope: String(job.sourceScope || ''),
    stopped: !!stopped,
  };
}

function publicFavAddJobStatus(job) {
  const j = job || idleFavAddJob();
  return {
    status: j.status || 'idle',
    done: Number(j.done) || 0,
    total: Number(j.total) || 0,
    ok: Number(j.ok) || 0,
    failed: Number(j.failed) || 0,
    error: j.error || '',
    result: j.result || null,
    sourceScope: String(j.sourceScope || ''),
    startedAt: Number(j.startedAt) || 0,
    updatedAt: Number(j.updatedAt) || 0,
    cancelRequested: !!j.cancelRequested,
  };
}

async function readFavAddJob() {
  const data = await chrome.storage.local.get([FAV_ADD_JOB_KEY]);
  return { ...idleFavAddJob(), ...(data[FAV_ADD_JOB_KEY] || {}) };
}

async function writeFavAddJob(job) {
  const run = async () => {
    const cur = await readFavAddJob();
    const next = { ...idleFavAddJob(), ...job, updatedAt: Date.now() };
    if (
      !isTerminalJobStatus(next.status) &&
      (cur.cancelRequested || cur.status === 'stopping' || favAddJobCancelFlag)
    ) {
      next.cancelRequested = true;
      next.status = 'stopping';
      favAddJobCancelFlag = true;
    }
    if (isTerminalJobStatus(next.status)) {
      favAddJobCancelFlag = false;
    }
    await chrome.storage.local.set({ [FAV_ADD_JOB_KEY]: next });
    return next;
  };
  const p = favAddJobWriteChain.then(run, run);
  favAddJobWriteChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

async function getFavAddJobStatus() {
  const job = await readFavAddJob();
  if ((job.status === 'running' || job.status === 'stopping') && !favAddJobRunning) {
    runFavAddJob();
  }
  return publicFavAddJobStatus(job);
}

async function stopFavAddJob() {
  const job = await readFavAddJob();
  if (job.status !== 'running' && job.status !== 'stopping') {
    return publicFavAddJobStatus(job);
  }
  favAddJobCancelFlag = true;
  const next = await writeFavAddJob({
    ...job,
    status: 'stopping',
    cancelRequested: true,
  });
  runFavAddJob();
  return publicFavAddJobStatus(next);
}

async function startFavAddJob({ videoIds = [], items = {}, sourceScope = '' } = {}) {
  const current = await readFavAddJob();
  if (jobIsActive(current)) {
    runFavAddJob();
    return publicFavAddJobStatus(current);
  }
  const rawIds = [
    ...new Set((videoIds || []).map((v) => String(v).trim()).filter((v) => /^[1-9]\d*$/.test(v))),
  ];
  if (!rawIds.length) throw new Error('no video ids');
  const normalizedItems = normalizeJobItems(items, rawIds);
  const ids = await sortVideoIdsByOrdinalAsc(rawIds, normalizedItems);
  favAddJobCancelFlag = false;
  const job = await writeFavAddJob({
    status: 'running',
    videoIds: ids,
    items: normalizeJobItems(normalizedItems, ids),
    cursor: 0,
    done: 0,
    total: ids.length,
    ok: 0,
    failed: 0,
    okIds: [],
    errors: [],
    result: null,
    error: '',
    sourceScope: String(sourceScope || ''),
    startedAt: Date.now(),
    cancelRequested: false,
  });
  try {
    await chrome.alarms?.create?.('hxyrule-fav-add', { periodInMinutes: 1 });
  } catch (_) {
    /* optional */
  }
  runFavAddJob();
  return publicFavAddJobStatus(job);
}

function runFavAddJob() {
  if (favAddJobRunning) return;
  favAddJobRunning = true;
  (async () => {
    try {
      while (true) {
        let job = await readFavAddJob();
        if (job.status !== 'running' && job.status !== 'stopping') break;
        if (job.cancelRequested || job.status === 'stopping' || favAddJobCancelFlag) {
          await writeFavAddJob({
            ...job,
            status: 'stopped',
            cancelRequested: false,
            result: favAddJobResult(job, { stopped: true }),
            error: '',
          });
          break;
        }

        const videoIds = Array.isArray(job.videoIds) ? job.videoIds : [];
        const cursor = Number(job.cursor) || 0;
        if (cursor >= videoIds.length) {
          if ((Number(job.ok) || 0) === 0 && (Number(job.failed) || 0) > 0) {
            await writeFavAddJob({
              ...job,
              status: 'error',
              cancelRequested: false,
              result: favAddJobResult(job),
              error:
                `Add to Favorites failed for all ${job.failed}` +
                (job.errors?.[0] ? `: ${job.errors[0]}` : ''),
            });
            break;
          }
          await writeFavAddJob({
            ...job,
            status: 'done',
            cancelRequested: false,
            result: favAddJobResult(job),
            error: '',
          });
          break;
        }

        const vid = String(videoIds[cursor]);
        const added = await addOneToMyFavourites(vid);
        const okIds = Array.isArray(job.okIds) ? job.okIds.slice() : [];
        const errors = Array.isArray(job.errors) ? job.errors.slice() : [];
        let ok = Number(job.ok) || 0;
        let failed = Number(job.failed) || 0;
        if (added.ok) {
          ok += 1;
          if (!okIds.includes(vid)) okIds.push(vid);
        } else {
          failed += 1;
          if (errors.length < 8) errors.push(`${vid}: ${added.detail || 'failed'}`);
        }
        await writeFavAddJob({
          ...job,
          status: 'running',
          cursor: cursor + 1,
          done: cursor + 1,
          ok,
          failed,
          okIds,
          errors,
          error: '',
        });
        await new Promise((r) => setTimeout(r, 140));
      }
    } catch (err) {
      const job = await readFavAddJob();
      if (
        favAddJobCancelFlag ||
        job.cancelRequested ||
        job.status === 'stopping' ||
        /cancelled|stopped/i.test(String(err?.message || err))
      ) {
        await writeFavAddJob({
          ...job,
          status: 'stopped',
          cancelRequested: false,
          result: favAddJobResult(job, { stopped: true }),
          error: '',
        });
      } else {
        await writeFavAddJob({
          ...job,
          status: 'error',
          cancelRequested: false,
          result: favAddJobResult(job),
          error: String(err?.message || err),
        });
      }
    } finally {
      favAddJobRunning = false;
      const job = await readFavAddJob();
      if (job.status === 'running' || job.status === 'stopping') {
        runFavAddJob();
      } else {
        try {
          await chrome.alarms?.clear?.('hxyrule-fav-add');
        } catch (_) {
          /* optional */
        }
      }
    }
  })();
}

// Resume queue after SW wake
chrome.alarms?.create?.('hxyrule-queue', { periodInMinutes: 1 });
chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === 'hxyrule-queue') runQueueWorker();
  if (alarm.name === 'hxyrule-index') runIndexJob();
  if (alarm.name === 'hxyrule-renumber') runRenumberJob();
  if (alarm.name === 'hxyrule-playlist-add') runPlaylistAddJob();
  if (alarm.name === 'hxyrule-fav-add') runFavAddJob();
});
runQueueWorker();
readIndexJob().then((job) => {
  if (job.status === 'running' || job.status === 'stopping') runIndexJob();
}).catch(() => {});
readRenumberJob().then((job) => {
  if (job.status === 'running' || job.status === 'stopping') runRenumberJob();
}).catch(() => {});
readPlaylistAddJob().then((job) => {
  if (job.status === 'running' || job.status === 'stopping') runPlaylistAddJob();
}).catch(() => {});
readFavAddJob().then((job) => {
  if (job.status === 'running' || job.status === 'stopping') runFavAddJob();
}).catch(() => {});
