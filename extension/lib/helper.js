const DEFAULTS = {
  helperBase: 'http://127.0.0.1:17934',
  token: '',
  player: 'iina',
  videoDir: '/Volumes/External/HXYRULE',
  localPreferPlayback: true,
  showFullPath: true,
  qualityOrder: ['1080p', '720p', '480p', '360p'],
  expectedOrigin: '',
};

export async function getConfig() {
  const data = await chrome.storage.local.get(['hxyruleConfig']);
  return { ...DEFAULTS, ...(data.hxyruleConfig || {}) };
}

export async function setConfig(partial) {
  const current = await getConfig();
  const next = { ...current, ...partial };
  if (typeof next.token === 'string') next.token = next.token.trim();
  if (typeof next.helperBase === 'string') next.helperBase = next.helperBase.trim();
  await chrome.storage.local.set({ hxyruleConfig: next });
  return next;
}

export async function helperFetch(path, { method = 'GET', body } = {}) {
  const cfg = await getConfig();
  if (!cfg.token) {
    throw new Error('Helper token missing. Open Options and import pairing config.');
  }
  const headers = {
    'X-HXYRULE-Token': cfg.token.trim(),
  };
  // Only set JSON content-type when sending a body. Putting it on GET forces a
  // CORS preflight and has caused opaque Forbidden failures from options pages.
  const hasBody = body !== undefined && body !== null && method !== 'GET';
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(`${cfg.helperBase}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const detail = String(err && err.message ? err.message : err);
    if (/failed to fetch|networkerror|load failed/i.test(detail)) {
      throw new Error(
        `Cannot reach Helper at ${cfg.helperBase} (${detail}). ` +
          'Check Helper is running, then Reload the extension and re-import pairing if needed.',
      );
    }
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Helper HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function helperHealth() {
  return helperFetch('/health');
}

/** Prefer Service Worker bridge — more reliable Origin/PNA than options-page fetch. */
export function helperViaBackground(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp || !resp.ok) {
        reject(new Error((resp && resp.error) || `${type} failed`));
        return;
      }
      resolve(resp.result);
    });
  });
}

export function helperHealthViaBackground() {
  return helperViaBackground('HELPER_HEALTH');
}
