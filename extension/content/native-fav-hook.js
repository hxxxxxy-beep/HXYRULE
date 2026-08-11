/**
 * MAIN-world hook: watch native KVS favourite AJAX and notify the isolated
 * content script so HXYRULE can patch list indexes without Refresh.
 * Runs at document_start on rule34video.com (see manifest world: MAIN).
 */
(function () {
  if (window.__hxyruleNativeFavHookInstalled) return;
  window.__hxyruleNativeFavHookInstalled = true;

  const MSG_TYPE = 'hxyrule-native-fav';

  function pick(params, key) {
    if (!params) return '';
    const v = params.get(key);
    if (v != null && String(v).trim() !== '') return String(v).trim();
    const alt = params.get(`${key}[]`);
    return alt != null ? String(alt).trim() : '';
  }

  function paramsFromUrl(url) {
    try {
      const u = new URL(String(url || ''), location.href);
      return u.searchParams;
    } catch (_) {
      return null;
    }
  }

  function paramsFromBody(body) {
    if (body == null || body === '') return null;
    try {
      if (typeof body === 'string') {
        return new URLSearchParams(body);
      }
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return body;
      }
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const q = new URLSearchParams();
        body.forEach((v, k) => {
          if (typeof v === 'string') q.append(k, v);
        });
        return q;
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function mergeParams(url, body) {
    const a = paramsFromUrl(url);
    const b = paramsFromBody(body);
    if (!a && !b) return null;
    const out = new URLSearchParams();
    if (a) a.forEach((v, k) => out.set(k, v));
    if (b) b.forEach((v, k) => out.set(k, v));
    return out;
  }

  function parseFavRequest(url, body) {
    const params = mergeParams(url, body);
    if (!params) return null;
    const action = pick(params, 'action').toLowerCase();
    let op = '';
    if (action === 'add_to_favourites') op = 'add';
    else if (action === 'delete_from_favourites') op = 'remove';
    else return null;
    let videoId = pick(params, 'video_id');
    if (!videoId) {
      const ids = params.getAll('video_ids[]').concat(params.getAll('video_ids'));
      videoId = String(ids[0] || '').trim();
    }
    if (!/^\d+$/.test(videoId)) return null;
    return {
      op,
      videoId,
      favType: pick(params, 'fav_type') || '0',
      playlistId: pick(params, 'playlist_id') || '0',
    };
  }

  function responseOk(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    try {
      const json = JSON.parse(raw);
      return String(json?.status || '').toLowerCase() === 'success';
    } catch (_) {
      return false;
    }
  }

  function report(info) {
    if (!info) return;
    try {
      window.postMessage(
        {
          type: MSG_TYPE,
          op: info.op,
          videoId: info.videoId,
          favType: info.favType,
          playlistId: info.playlistId,
        },
        '*',
      );
    } catch (_) {
      /* ignore */
    }
  }

  function afterNetwork(url, body, responseText) {
    const info = parseFavRequest(url, body);
    if (!info) return;
    if (!responseOk(responseText)) return;
    report(info);
  }

  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function hxyruleFavFetch(input, init) {
        const url =
          typeof input === 'string'
            ? input
            : input && typeof input.url === 'string'
              ? input.url
              : String(input || '');
        const body = init && init.body != null ? init.body : null;
        return origFetch.apply(this, arguments).then((res) => {
          try {
            const clone = res.clone();
            clone
              .text()
              .then((text) => afterNetwork(url, body, text))
              .catch(() => {});
          } catch (_) {
            /* ignore */
          }
          return res;
        });
      };
    }
  } catch (_) {
    /* ignore */
  }

  try {
    const XO = XMLHttpRequest.prototype.open;
    const XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__hxyruleFavUrl = url;
      this.__hxyruleFavMethod = method;
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      this.__hxyruleFavBody = body;
      this.addEventListener(
        'load',
        function () {
          try {
            afterNetwork(this.__hxyruleFavUrl, this.__hxyruleFavBody, this.responseText);
          } catch (_) {
            /* ignore */
          }
        },
        { once: true },
      );
      return XS.apply(this, arguments);
    };
  } catch (_) {
    /* ignore */
  }
})();
