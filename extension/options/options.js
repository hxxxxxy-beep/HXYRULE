import { getConfig, setConfig, helperFetch, helperHealthViaBackground } from '../lib/helper.js';

const $ = (id) => document.getElementById(id);

async function refreshForm() {
  const cfg = await getConfig();
  $('helperBase').value = cfg.helperBase || '';
  $('token').value = cfg.token || '';
  $('videoDir').value = cfg.videoDir || '';
  $('player').value = cfg.player || 'iina';
  $('localPrefer').checked = cfg.localPreferPlayback !== false;
  $('showFullPath').checked = cfg.showFullPath !== false;
  const id = chrome.runtime.id;
  $('extId').textContent = id;
  $('installCmd').textContent =
    `./mac-helper/install.sh --extension-id ${id} --video-dir /Volumes/External/HXYRULE --player iina`;
  const expected = (cfg.expectedOrigin || '').replace('chrome-extension://', '');
  if (expected && expected !== id) {
    $('healthStatus').className = 'status bad';
    $('healthStatus').textContent =
      `Extension ID mismatch: current ${id}, Helper expects ${expected}. Re-run install.sh with the current ID.`;
  }
}

$('importPairing').addEventListener('click', async () => {
  const status = $('healthStatus');
  try {
    const data = JSON.parse($('pairingJson').value);
    const token = String(data.token || '').trim();
    if (!token) throw new Error('JSON is missing token');
    await setConfig({
      helperBase: data.helperBase || `http://127.0.0.1:${data.port || 17934}`,
      token,
      videoDir: data.videoDir,
      player: data.player || 'iina',
      expectedOrigin: data.origin || '',
    });
    await refreshForm();
    const h = await helperHealthViaBackground();
    status.className = 'status ok';
    status.textContent = `Paired · online · ${h.directory}`;
  } catch (err) {
    status.className = 'status bad';
    status.textContent = String(err.message || err);
  }
});

$('checkHealth').addEventListener('click', async () => {
  const status = $('healthStatus');
  try {
    await setConfig({
      helperBase: $('helperBase').value.trim(),
      token: $('token').value.trim(),
    });
    const h = await helperHealthViaBackground();
    status.className = 'status ok';
    status.textContent = `Online · ${h.directory} · exists=${h.directoryExists}`;
  } catch (err) {
    status.className = 'status bad';
    status.textContent = String(err.message || err);
  }
});

$('save').addEventListener('click', async () => {
  const status = $('saveStatus');
  try {
    await setConfig({
      helperBase: $('helperBase').value.trim(),
      token: $('token').value.trim(),
      videoDir: $('videoDir').value.trim(),
      player: $('player').value,
      localPreferPlayback: $('localPrefer').checked,
      showFullPath: $('showFullPath').checked,
    });
    await helperFetch('/settings', {
      method: 'POST',
      body: {
        player: $('player').value,
        localPreferPlayback: $('localPrefer').checked,
        showFullPath: $('showFullPath').checked,
        videoDir: $('videoDir').value.trim(),
      },
    });
    status.className = 'status ok';
    status.textContent = 'Saved';
  } catch (err) {
    status.className = 'status bad';
    status.textContent = String(err.message || err);
  }
});

$('scan').addEventListener('click', async () => {
  const status = $('saveStatus');
  try {
    const r = await helperFetch('/scan', { method: 'POST', body: {} });
    status.className = 'status ok';
    status.textContent = `Scan done: files ${r.fileCount}, matched ${r.matchedCount}`;
  } catch (err) {
    status.className = 'status bad';
    status.textContent = String(err.message || err);
  }
});

$('clearStale').addEventListener('click', async () => {
  const status = $('saveStatus');
  try {
    const r = await helperFetch('/maintenance/clear-stale', { method: 'POST', body: {} });
    status.className = 'status ok';
    status.textContent = `Removed ${r.removed} stale index rows`;
  } catch (err) {
    status.className = 'status bad';
    status.textContent = String(err.message || err);
  }
});

$('openLogs').addEventListener('click', async () => {
  const status = $('healthStatus');
  try {
    const r = await helperFetch('/maintenance/open-logs', { method: 'POST', body: {} });
    status.className = 'status ok';
    status.textContent = `Log: ${r.logPath}`;
  } catch (err) {
    status.className = 'status bad';
    status.textContent = String(err.message || err);
  }
});

refreshForm();
