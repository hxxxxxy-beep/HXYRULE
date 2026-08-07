import { getConfig, setConfig, helperFetch, helperHealth } from './lib/helper.js';

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
/** Absolute partial paths currently held by Range recovery — orphan sweep must keep them. */
const protectedPartialPaths = new Set();

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
  return snap;
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
  // Save into configured root via absolute filename path unsupported by chrome.downloads
  // on all platforms; use relative under user downloads then ask helper... 
  // Better: set filename as basename and use downloads downloadPath via onDeterminingFilename
  // Chrome cannot set arbitrary absolute paths without prompting. Use helper video dir
  // by setting conflictAction and listening — actually MV3 can use filename relative to
  // default Downloads folder only.
  // Strategy: download to Downloads with our basename, then Helper moves? User root is
  // /Volumes/External/HXYRULE. chrome.downloads cannot write there directly without
  // asking user each time unless Download shelf path is set.
  // Practical approach used by HXYLIVE: open URL in Chrome with save path configured
  // to video dir. Here we set Chrome download filename to basename and instruct user
  // to set Chrome download location OR we use the downloads API with filename and
  // rely on chrome.downloads.search + moving via helper reading from Downloads.
  //
  // Better UX for personal tool: use chrome.downloads.download with `filename` as
  // just basename, and in Helper register — but file lands in ~/Downloads.
  // Then Helper can accept a move from Downloads if we pass the absolute path from
  // chrome.downloads.search.
  //
  // We'll download, get final absolute path from chrome.downloads.search, verify it's
  // a file, then ask Helper to import via a new endpoint that copies into root.
  // Actually Helper.register_download expects file already in root.
  // Add import-from-path that only accepts paths under Downloads or video root.

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
      if (cancelRequested || err.cancelled || /cancelled/i.test(String(err.message || ''))) {
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
  const parts = raw.split(':').map((p) => Number(p));
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
  const optsFor = (el) => ({
    topRatio: 0,
    openEffect: 'none',
    openSpeed: 0,
    closeEffect: 'none',
    closeSpeed: 0,
    prevEffect: 'none',
    prevSpeed: 0,
    nextEffect: 'none',
    nextSpeed: 0,
  });
  document.querySelectorAll('[data-fancybox="ajax"]').forEach((el) => {
    el.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ajaxHref = el.getAttribute('data-href') || el.getAttribute('href');
      if (!ajaxHref) return;
      $.fancybox([{ href: ajaxHref, type: 'ajax' }], optsFor(el));
    };
  });
  return { ok: true, count: document.querySelectorAll('[data-fancybox="ajax"]').length };
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
  const $ = window.jQuery || window.$;
  const id = String(videoId || '');
  const wantHref = String(href || '');
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
  const items = Array.from(document.querySelectorAll('.item.thumb'));
  const item = items.find((el) => {
    if (id && (el.classList.contains(`video_${id}`) || el.querySelector(`[href*="/video/${id}/"]`))) {
      return true;
    }
    const a = el.querySelector('a.th.js-open-popup, a.th');
    if (!a) return false;
    const h = a.getAttribute('href') || '';
    return (
      (wantHref && (h === wantHref || a.href === wantHref)) ||
      (id && (h.includes(`/video/${id}/`) || a.href.includes(`/video/${id}/`)))
    );
  });

  const clickEl =
    item?.querySelector('a.js-click[data-fancybox="ajax"], [data-fancybox="ajax"]') || null;
  const openEl = item?.querySelector('a.th.js-open-popup, a.th') || null;
  const pageHref = openEl?.getAttribute('href') || wantHref || '';
  const ajaxHref =
    clickEl?.getAttribute('data-href') ||
    clickEl?.getAttribute('href') ||
    (id ? `https://rule34video.com/popup-video/${id}/?popup_id=1` : '');

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

  if (openEl) {
    openEl.click();
    return { ok: true, method: 'open-popup-click' };
  }
  return { ok: false, reason: 'popup target missing' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'GET_CONFIG':
        return await getConfig();
      case 'SET_CONFIG':
        return await setConfig(message.partial || {});
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
      case 'HELPER_SCAN':
        return await helperFetch('/scan', { method: 'POST', body: {} });
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
      case 'HELPER_ORDINALS_REBUILD':
        return await helperFetch('/ordinals/rebuild', {
          method: 'POST',
          body: {
            videoIds: message.videoIds || [],
            titles: message.titles || {},
            renameFiles: message.renameFiles !== false,
          },
        });
      case 'HELPER_ORDINALS_RENAME_FILES':
        return await helperFetch('/ordinals/rename-files', {
          method: 'POST',
          body: {},
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
      case 'HELPER_DELETE_MEDIA':
        return await helperFetch('/media/delete', {
          method: 'POST',
          body: { videoIds: message.videoIds || [] },
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
        return status;
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
        const result = await helperFetch('/downloads/enqueue', {
          method: 'POST',
          body: { items: message.items || [] },
        });
        runQueueWorker();
        return result;
      }
      case 'QUEUE_PAUSE':
        return await helperFetch('/downloads/pause', { method: 'POST', body: {} });
      case 'QUEUE_RESUME': {
        cancelRequested = false;
        const r = await helperFetch('/downloads/resume', { method: 'POST', body: {} });
        runQueueWorker();
        return r;
      }
      case 'QUEUE_RETRY': {
        cancelRequested = false;
        const r = await helperFetch('/downloads/retry', {
          method: 'POST',
          body: { id: message.id },
        });
        runQueueWorker();
        return r;
      }
      case 'QUEUE_SKIP': {
        cancelRequested = false;
        const r = await helperFetch('/downloads/skip', {
          method: 'POST',
          body: { id: message.id },
        });
        runQueueWorker();
        return r;
      }
      case 'QUEUE_CANCEL':
        return await stopDownloads();
      case 'QUEUE_STOP':
        return await stopDownloads();
      case 'QUEUE_CLEAR_FINISHED':
        return await helperFetch('/downloads/clear-finished', { method: 'POST', body: {} });
      case 'QUEUE_PURGE':
        return await helperFetch('/downloads/purge', { method: 'POST', body: {} });
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

async function fetchPlaylistPage(
  playlistId,
  page,
  { blockId = '', fromKey = '', includeHtml = false } = {},
) {
  const pid = String(playlistId || '').trim();
  if (!/^[1-9]\d*$/.test(pid)) throw new Error('invalid playlist id');
  const pageNum = Number(page);
  if (!Number.isInteger(pageNum) || pageNum < 1) throw new Error('invalid page');
  const primaryBlock =
    String(blockId || '').trim() || 'list_videos_common_videos_list';
  const blocks = [
    primaryBlock,
    'list_videos_common_videos_list',
    'list_videos_my_favourite_videos',
  ].filter((b, i, arr) => b && arr.indexOf(b) === i);
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

  let html = '';
  let used = '';
  let lastLen = 0;
  for (const url of attempts) {
    const res = await fetch(url, {
      credentials: 'include',
      redirect: 'follow',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/html, */*;q=0.1',
      },
    });
    const text = await res.text();
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
        maxPage: parseMaxPage(text),
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
    maxPage: parseMaxPage(html),
    sourceUrl: used,
    ...(includeHtml ? { html } : {}),
  };
}

/* keep fetchFavoritesPage below — marker for splice safety */
async function fetchFavoritesPage(page, { includeHtml = false } = {}) {
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

  let html = '';
  let used = '';
  let lastLen = 0;
  for (const url of attempts) {
    const res = await fetch(url, {
      credentials: 'include',
      redirect: 'follow',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/html, */*;q=0.1',
      },
    });
    const text = await res.text();
    lastLen = text.length;
    if (!res.ok) continue;
    if (/login-required|\/login\/|\?login/i.test(res.url) && !/item\s+thumb/i.test(text)) {
      throw new Error('login expired');
    }
    if (/captcha|cf-browser-verification|just a moment/i.test(text) && !/item\s+thumb/i.test(text)) {
      throw new Error('captcha or bot check encountered');
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
    });
    index += 1;
  }
  if (items.length) {
    // Enrich titles/hrefs from nearby markup when possible.
    items.forEach((it) => {
      const around = html.match(
        new RegExp(
          `[\\s\\S]{0,800}/video/${it.videoId}/[\\s\\S]{0,800}`,
          'i',
        ),
      );
      if (!around) return;
      const chunk = around[0];
      const href = chunk.match(/href=["'](https?:\/\/rule34video\.com\/video\/\d+\/[^"']+)["']/i)
        || chunk.match(/href=["'](\/video\/\d+\/[^"']+)["']/i);
      const title = chunk.match(/title=["']([^"']+)["']/i);
      if (href) {
        it.detailUrl = href[1].startsWith('http')
          ? href[1]
          : `https://rule34video.com${href[1]}`;
      }
      if (title) it.title = title[1];
      if (it.durationSec == null) {
        const dur = extractDurationFromChunk(chunk);
        if (dur != null) it.durationSec = dur;
      }
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
    items.push({
      videoId,
      detailUrl,
      title: titleMatch ? titleMatch[1] : videoId,
      favoritePage: pageNum,
      cardIndex: items.length,
      durationSec: durationById[String(videoId)] ?? extractDurationFromChunk(block),
    });
  }
  return items;
}

function parseMaxPage(html) {
  let max = 0;
  for (const m of html.matchAll(/from_my_fav(?:ourite)?_videos:(\d+)/gi)) {
    max = Math.max(max, Number(m[1]));
  }
  for (const m of html.matchAll(/from_videos(?:_common(?:_videos_list)?)?:(\d+)/gi)) {
    max = Math.max(max, Number(m[1]));
  }
  for (const m of html.matchAll(/from_[a-z0-9_]+:(\d+)/gi)) {
    max = Math.max(max, Number(m[1]));
  }
  for (const m of html.matchAll(/data-parameters="[^"]*from[^"]*?:(\d+)/gi)) {
    max = Math.max(max, Number(m[1]));
  }
  const active = html.match(/pagination[\s\S]*?item active[^>]*>\s*(\d+)/i);
  if (active) max = Math.max(max, Number(active[1]));
  return max || null;
}

// Resume queue after SW wake
chrome.alarms?.create?.('hxyrule-queue', { periodInMinutes: 1 });
chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === 'hxyrule-queue') runQueueWorker();
});
runQueueWorker();
