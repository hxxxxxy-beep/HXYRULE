(() => {
  const NS = 'hxyrule';
  const FAV_PATH_RE = /\/my\/favourites\/videos\/?/i;
  const PLAYLIST_PATH_RE = /\/my\/playlists\/([1-9]\d*)\/?/i;
  const SOURCE_HAN_SERIF_STACK =
    "'HXY Source Han Serif', 'Source Han Serif CN', 'Source Han Serif SC', " +
    "'Noto Serif CJK SC', 'Noto Serif SC', 'Songti SC', serif";

  function isPlayerIcon(el) {
    if (
      el?.closest?.(
        `.${NS}-online-player, .video-js, .flowplayer, .fp-player, .jwplayer, .plyr, ` +
          '.kt-player, .kt_player, .video-player, .video_player, .player-holder, ' +
          '.player_holder, .player-container, .player_container',
      )
    ) return true;
    return !!el?.matches?.(
      '[class*="icon" i], .vjs-control, .vjs-big-play-button, .jw-icon, ' +
        '.fp-ui, .fp-controls, .plyr__control, [data-plyr], [class*="quality-icon" i]',
    );
  }

  function forceSourceHanSerif(root) {
    if (!(root instanceof Element)) return;
    if (!isPlayerIcon(root)) {
      root.style.setProperty('font-family', SOURCE_HAN_SERIF_STACK, 'important');
    }
    root.querySelectorAll('*').forEach((el) => {
      if (!isPlayerIcon(el)) {
        el.style.setProperty('font-family', SOURCE_HAN_SERIF_STACK, 'important');
      }
    });
  }

  function releasePlayerFont(root) {
    if (!(root instanceof Element)) return;
    root.style.removeProperty('font-family');
    root.querySelectorAll('*').forEach((el) => el.style.removeProperty('font-family'));
  }

  if (document.documentElement) {
    forceSourceHanSerif(document.documentElement);
    const sourceHanFontObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => forceSourceHanSerif(node));
      });
    });
    sourceHanFontObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Prevent the native page from being painted before its nodes are moved
  // into the HXYRULE layout. This runs at document_start, before any Helper or
  // storage awaits. The watchdog guarantees that an unexpected boot failure
  // can never leave the page hidden.
  const initialTargetPage =
    FAV_PATH_RE.test(location.pathname) || PLAYLIST_PATH_RE.test(location.pathname);
  let firstLayoutRevealed = !initialTargetPage;
  if (initialTargetPage && document.documentElement) {
    document.documentElement.dataset.hxyruleBooting = '1';
    // Persist for CSS: hide native Artists/Tags/Categories search chrome on library pages.
    document.documentElement.dataset.hxyruleLibrary = '1';
  }
  // Earliest native count hint (tab title) before headlines are rewritten.
  try {
    if (initialTargetPage && document.title) {
      /* filled after parse helpers exist — see captureDocumentTitleCount() */
      document.documentElement.dataset.hxyruleBootTitle = String(document.title);
    }
  } catch (_) {
    /* ignore */
  }
  const firstLayoutWatchdog = initialTargetPage
    ? setTimeout(() => {
        document.documentElement?.removeAttribute('data-hxyrule-booting');
        firstLayoutRevealed = true;
      }, 2500)
    : null;

  function revealFirstLayout() {
    if (firstLayoutRevealed) return;
    firstLayoutRevealed = true;
    if (firstLayoutWatchdog) clearTimeout(firstLayoutWatchdog);
    document.documentElement?.removeAttribute('data-hxyrule-booting');
    // Boot hide used visibility:hidden — ask the site's own lazyload to run again.
    try {
      if (typeof reinitPageThumbLazyload === 'function') reinitPageThumbLazyload();
    } catch (_) {
      /* defined later in this IIFE; function decls are hoisted */
    }
  }

  /**
   * Online play pushStates to /video/{id}/. Keep Favorites/playlist scope so
   * pageWatch does not treat that as a library switch (which reset Compact).
   */
  let lastListPathname =
    FAV_PATH_RE.test(location.pathname) || PLAYLIST_PATH_RE.test(location.pathname)
      ? location.pathname
      : '';

  function activeLibraryPathname() {
    const p = String(location.pathname || '');
    if (FAV_PATH_RE.test(p) || PLAYLIST_PATH_RE.test(p)) {
      lastListPathname = p;
      return p;
    }
    return lastListPathname || p;
  }

  function isFavoritesPage() {
    return FAV_PATH_RE.test(activeLibraryPathname());
  }

  function isPlaylistDetailPage() {
    return PLAYLIST_PATH_RE.test(activeLibraryPathname());
  }

  function currentPlaylistIdFromPath() {
    const m = String(activeLibraryPathname() || '').match(PLAYLIST_PATH_RE);
    return m && /^[1-9]\d*$/.test(m[1]) ? m[1] : null;
  }

  /**
   * Independent early playlist-header relocation.
   *
   * Keep this ahead of all async toolbar/Helper initialization: the native
   * black header must move even if an unrelated later feature fails to boot.
   */
  function forcePlaylistHeaderToBottom() {
    if (!isPlaylistDetailPage() || !document.body) return false;
    const headers = [...document.querySelectorAll('div.header')].filter((node) => {
      const children = [...node.children];
      return (
        children.some((child) => child.matches('button.burger')) &&
        children.some(
          (child) => child.matches('div.container') && child.querySelector('div.columns'),
        ) &&
        children.some((child) => child.matches('div.filters_wrap'))
      );
    });
    if (!headers.length) return false;

    headers.forEach((header) => {
      header.dataset.hxyruleDarkPanelMoved = '1';
      header.dataset.hxyruleDarkPanelPage = 'playlist';
      header.style.setProperty('position', 'relative', 'important');
      header.style.setProperty('inset', 'auto', 'important');
      header.style.setProperty('top', 'auto', 'important');
      header.style.setProperty('right', 'auto', 'important');
      header.style.setProperty('bottom', 'auto', 'important');
      header.style.setProperty('left', 'auto', 'important');
      header.style.setProperty('float', 'none', 'important');
      header.style.setProperty('clear', 'both', 'important');
      header.style.setProperty('order', '2147483000', 'important');
      header.style.setProperty('width', '100%', 'important');
      header.style.setProperty('transform', 'none', 'important');
    });
    const tail = [...document.body.children].slice(-headers.length);
    const alreadyLast = headers.every(
      (header, index) => header.parentElement === document.body && tail[index] === header,
    );
    if (!alreadyLast) headers.forEach((header) => document.body.appendChild(header));
    return true;
  }

  if (isPlaylistDetailPage()) {
    let playlistHeaderMoveQueued = false;
    const queuePlaylistHeaderMove = () => {
      if (playlistHeaderMoveQueued) return;
      playlistHeaderMoveQueued = true;
      requestAnimationFrame(() => {
        playlistHeaderMoveQueued = false;
        forcePlaylistHeaderToBottom();
      });
    };
    const playlistHeaderObserver = new MutationObserver(queuePlaylistHeaderMove);
    if (document.documentElement) {
      playlistHeaderObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    document.addEventListener('DOMContentLoaded', queuePlaylistHeaderMove, { once: true });
    queuePlaylistHeaderMove();
    setInterval(forcePlaylistHeaderToBottom, 1000);
  }

  function send(type, payload = {}, timeoutMs = 0) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              reject(new Error(`${type} timeout`));
            }, timeoutMs)
          : null;
      chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok) {
          reject(new Error((resp && resp.error) || 'extension message failed'));
          return;
        }
        resolve(resp.result);
      });
    });
  }

  function qs(root, sel) {
    return root.querySelector(sel);
  }

  function qsa(root, sel) {
    return [...root.querySelectorAll(sel)];
  }

  /** Display name for the title-row site pill (Favorites / playlist only). */
  function siteBrandName() {
    const og = String(
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '',
    ).trim();
    if (og) return og;
    const host = String(location.hostname || '')
      .replace(/^www\./i, '')
      .trim();
    if (/^rule34video\.com$/i.test(host)) return 'Rule34Video';
    return host || 'Home';
  }

  /** Prefer the native logo <a href>; fall back to site origin. Does not mutate the SVG. */
  function resolveSiteHomeHref() {
    const svg = qs(document, 'svg.custom-logo, svg.custom-svg.custom-logo');
    const a = svg?.closest?.('a[href]');
    if (a) {
      const raw = String(a.getAttribute('href') || '').trim();
      if (raw && raw !== '#' && !/^javascript:/i.test(raw)) {
        try {
          return a.href || raw;
        } catch (_) {
          return raw;
        }
      }
    }
    return `${location.origin}/`;
  }

  /**
   * Site-name pill on the first chrome row, immediately left of Libraries.
   * Favorites + playlist pages only; does not restyle the native header SVG.
   */
  function ensureSiteLogoButton(host) {
    if (!isFavoritesPage() && !isPlaylistDetailPage()) {
      qsa(document, `a.${NS}-site-logo, button.${NS}-site-logo`).forEach((el) => el.remove());
      qsa(document, `.${NS}-title-end`).forEach((el) => el.remove());
      return null;
    }
    if (!host) return null;
    const name = siteBrandName();
    const href = resolveSiteHomeHref();
    let logo =
      qs(host, `a.${NS}-site-logo`) ||
      qs(host.parentElement || document, `a.${NS}-site-logo`);
    if (!logo) {
      logo = document.createElement('a');
      logo.className = `${NS}-brand ${NS}-site-logo`;
      logo.dataset.hxyrule = '1';
    } else {
      logo.classList.add(`${NS}-brand`, `${NS}-site-logo`);
      logo.dataset.hxyrule = '1';
    }
    logo.href = href;
    logo.textContent = name;
    logo.setAttribute('title', `${name} — Home`);
    logo.setAttribute('aria-label', `${name} home`);
    if (logo.parentElement !== host) host.appendChild(logo);
    return logo;
  }

  /**
   * Put a previously adopted My Favorites anchor back beside Tags in `.panel_header`
   * so it keeps the native `.button_fav` shape (same family as Tags).
   */
  function restoreNativeMyFavoritesToPanelHeader(btn) {
    if (!btn || !(btn instanceof Element)) return;
    // Drop Libraries click listeners stamped by older builds.
    let node = btn;
    if (node.dataset?.hxyruleLibClickBound === '1' || node.dataset?.hxyruleLibBtn === '1') {
      const clean = node.cloneNode(true);
      node.replaceWith(clean);
      node = clean;
    }
    // Strip HXYRULE title-row markers — this is a site control again.
    node.classList.remove(`${NS}-native-fav-nav`, `${NS}-playlist-lib-btn`, `${NS}-hide-native-fav-nav`, `${NS}-brand`);
    delete node.dataset.hxyrule;
    delete node.dataset.hxyruleNativeFav;
    delete node.dataset.hxyruleLibBtn;
    delete node.dataset.hxyruleLibClickBound;
    node.removeAttribute('hidden');
    node.removeAttribute('aria-hidden');
    ['display', 'visibility', 'pointer-events', 'height', 'max-height', 'opacity'].forEach((p) => {
      node.style.removeProperty(p);
    });
    const href = String(node.getAttribute('href') || node.getAttribute('data-href') || '').trim();
    if (!/\/my\/favourites\/videos\/?/i.test(href)) {
      node.setAttribute('href', 'https://rule34video.com/my/favourites/videos/');
    }
    node.classList.add('button_fav', 'fav');
    if (isFavoritesPage()) node.classList.add('active');
    else node.classList.remove('active');

    const tags = qs(document, 'a.button_fav.tags');
    const panel = tags?.closest?.('.panel_header') || qs(document, '.panel_header');
    if (panel) {
      if (tags && tags.parentElement === panel) {
        if (tags.nextSibling !== node) tags.after(node);
      } else if (node.parentElement !== panel) {
        panel.appendChild(node);
      }
    }
  }

  /** Undo title-row adoption from older builds; keep site My Favorites next to Tags. */
  function releaseTitleRowMyFavorites() {
    qsa(document, `a.${NS}-native-fav-nav, a.${NS}-playlist-lib-btn.button_fav`).forEach((a) => {
      restoreNativeMyFavoritesToPanelHeader(a);
    });
    // Un-hide any leftover site fav links we previously stamped.
    qsa(document, `a.button_fav.fav.${NS}-hide-native-fav-nav, a.button_fav.${NS}-hide-native-fav-nav`).forEach(
      (a) => {
        if (!/\/my\/favourites\/videos\/?/i.test(String(a.getAttribute('href') || a.getAttribute('data-href') || ''))) {
          return;
        }
        a.classList.remove(`${NS}-hide-native-fav-nav`);
        a.removeAttribute('hidden');
        a.removeAttribute('aria-hidden');
        ['display', 'visibility', 'pointer-events'].forEach((p) => a.style.removeProperty(p));
      },
    );
  }

  /**
   * Right-end cluster: [site name] [Libraries switcher].
   * Native My Favorites stays in `.panel_header` next to Tags (site shape).
   */
  function ensureTitleRowEnd(row) {
    if (!row || (!isFavoritesPage() && !isPlaylistDetailPage())) return null;
    releaseTitleRowMyFavorites();
    let end = qs(row, `.${NS}-title-end`);
    if (!end) {
      end = document.createElement('div');
      end.className = `${NS}-title-end`;
      end.dataset.hxyrule = '1';
    }
    if (end.parentElement !== row) row.appendChild(end);

    // Pull orphan controls that older layout left as direct row children.
    [...row.children].forEach((child) => {
      if (child === end) return;
      if (
        child.classList?.contains(`${NS}-playlist-lib-btn`) ||
        child.classList?.contains(`${NS}-site-logo`)
      ) {
        end.appendChild(child);
      }
    });
    // Drop any fav control still stuck on the title row.
    qsa(end, `a.${NS}-native-fav-nav, a.button_fav.fav`).forEach((a) => {
      restoreNativeMyFavoritesToPanelHeader(a);
    });

    const logo = ensureSiteLogoButton(end);
    const lib = ensurePlaylistLibraryButton(end, logo);
    const ordered = [logo, lib].filter(Boolean);
    ordered.forEach((el, i) => {
      if (el.parentElement !== end) end.appendChild(el);
      if (i === 0) {
        if (end.firstElementChild !== el) end.insertBefore(el, end.firstChild);
      } else {
        const prev = ordered[i - 1];
        if (prev.nextSibling !== el) prev.after(el);
      }
    });
    return end;
  }

  function parsePageFromParams(raw) {
    if (!raw) return null;
    const s = String(raw);
    const m =
      s.match(/from_my_fav(?:ourite)?_videos:(\d+)/i) ||
      s.match(/from_videos(?:_common)?:(\d+)/i) ||
      s.match(/from[_a-z0-9]*:(\d+)/i) ||
      s.match(/[?&]from=(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  function currentPageNumber() {
    const pag = listPaginationEl();
    const active = qs(
      pag || document,
      '.pagination .item.active, .item.active',
    );
    if (active) {
      // Prefer our painted page marker — textContent may be "12(3)" after marks.
      const painted = pageNumberFromPagItem(active);
      if (painted) return painted;
      const fromLink =
        active.getAttribute('data-parameters') ||
        (active.querySelector('[data-parameters]') || {}).getAttribute?.('data-parameters');
      const parsed = parsePageFromParams(fromLink);
      if (parsed) return parsed;
    }
    const params = new URLSearchParams(location.search);
    for (const key of ['from_my_fav_videos', 'from_my_favourite_videos', 'from_videos', 'from']) {
      if (params.get(key)) {
        const n = Number(params.get(key));
        if (Number.isInteger(n) && n > 0) return n;
      }
    }
    return 1;
  }

  /** Next/prev arrows often carry from:lastPage+1 — exclude them from max. */
  function isNextPrevControl(el) {
    const node = el?.closest?.('.item') || el;
    if (!node || !node.getAttribute) return false;
    if (node.classList?.contains('jump_to')) return true;
    const btn = resolvePageButton(node);
    const cls = `${node.className || ''} ${btn?.className || ''}`;
    if (/\bnext\b/i.test(cls) || /\bprev(?:ious)?\b/i.test(cls)) return true;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    // Keep "last"/"first" and numeric labels (incl. our "218(3)" marks).
    if (pageNumberFromPagItem(node)) return false;
    if (/^(«|‹|←|prev|previous)$/i.test(text)) return true;
    if (/^(»|›|→|next)$/i.test(text)) return true;
    return false;
  }

  /** Explicit "N videos" in native playlist / list headlines. */
  function parseVideoCountFromText(text) {
    const m = String(text || '').match(/(\d[\d\s,]*)\s*videos?/i);
    if (!m) return null;
    const n = Number(String(m[1]).replace(/[\s,]/g, ''));
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  /** Playlist titles are usually "My Playlist NAME (23)" without the word "videos". */
  function parseParenCountFromText(text) {
    const m = String(text || '').match(/\(\s*(\d[\d\s,]*)\s*(?:videos?)?\s*\)/i);
    if (!m) return null;
    const n = Number(String(m[1]).replace(/[\s,]/g, ''));
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  function parsePlaylistTotalFromText(text) {
    return parseVideoCountFromText(text) ?? parseParenCountFromText(text);
  }

  /** Max page from this list's pager only (playlists: never document-wide). */
  function playlistPaginationMax() {
    const pag = listPaginationEl();
    if (!pag) return Math.max(1, currentPageNumber() || 1);
    let max = Math.max(1, currentPageNumber() || 1);
    qsa(pag, '[data-parameters]').forEach((el) => {
      if (isNextPrevControl(el)) return;
      const n = parsePageFromParams(el.getAttribute('data-parameters'));
      if (n) max = Math.max(max, n);
    });
    paginationItemEls(pag).forEach((el) => {
      const n = pageNumberFromPagItem(el);
      if (n) max = Math.max(max, n);
    });
    return max;
  }

  function detectLibraryTotalFromDom() {
    // Playlist pages: only read this playlist's title / pager — never Favorites chrome.
    if (isPlaylistDetailPage()) {
      const native = qs(document, `.${NS}-playlist-native-title`);
      const stored = Number(native?.dataset?.hxyrulePlaylistVideoCount || '');
      if (Number.isInteger(stored) && stored > 0) return stored;

      const texts = [];
      for (const el of [
        native,
        qs(document, `.${NS}-playlist-page-title`),
        qs(document, `.${NS}-hide-native-headline`),
        findFavoritesHeadline(),
      ].filter(Boolean)) {
        if (el.closest?.(`.${NS}-favcount`)) continue;
        texts.push(el.dataset?.hxyruleOrigTitleText);
        // After we rewrite the pill, textContent may be name-only — prefer orig.
        if (!el.dataset?.hxyruleOrigTitleText) texts.push(el.textContent);
      }
      for (const t of texts) {
        const n = parsePlaylistTotalFromText(t);
        if (n != null && n > 0) {
          if (native) native.dataset.hxyrulePlaylistVideoCount = String(n);
          return n;
        }
      }

      const cards = nativeListCardCount();
      const maxP = playlistPaginationMax();
      // One pager page → visible cards are the whole list.
      if (maxP <= 1 && cards > 0) return cards;
      // Multi-page without a title count: only exact when we are on the last page
      // (short tail). A full non-last page must NOT invent maxP*per (e.g. page1
      // has 12 and page2 exists → 24 for a 16-video list), which then poisoned
      // Scan local / AAAAAA labels via Math.max and refused to come back down.
      if (maxP > 1 && stablePerPage > 0) {
        const curPage = currentPageNumber();
        if (Number.isInteger(curPage) && curPage >= maxP && cards > 0) {
          return (maxP - 1) * stablePerPage + cards;
        }
        return null;
      }
      return null;
    }

    const candidates = [
      qs(document, `.${NS}-hide-native-headline`),
      qs(document, `.${NS}-hide-native-headline .title`),
      findFavoritesHeadline(),
      qs(document, '.headline .title'),
      qs(document, '.headline h1'),
      qs(document, '.headline h2'),
      qs(document, '#list_videos_my_favourite_videos .headline'),
    ].filter(Boolean);
    let best = 0;
    for (const el of candidates) {
      if (el.closest?.(`.${NS}-favcount`)) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ');
      const fromVideos = parseVideoCountFromText(text);
      if (fromVideos != null && fromVideos > best) best = fromVideos;
      const nums = [
        ...text.matchAll(/\(\s*(\d[\d\s,]*)\s*(?:videos?)?\s*\)/gi),
        ...text.matchAll(/(\d[\d\s,]{2,})/g),
      ].map((m) => Number(String(m[1]).replace(/[\s,]/g, '')));
      for (const n of nums) {
        if (!Number.isInteger(n) || n < 1) continue;
        if (n < 20 && !/\(\s*\d/.test(text) && !/\bvideos?\b/i.test(text)) continue;
        if (n > best) best = n;
      }
    }
    return best > 0 ? best : null;
  }

  function maxPageNumber() {
    if (isPlaylistDetailPage()) {
      let max = playlistPaginationMax();
      const per =
        (stablePerPage && stablePerPage > 0 ? stablePerPage : 0) ||
        Math.max(parseCards().length, 1);
      const native = qs(document, `.${NS}-playlist-native-title`);
      const stored = Number(native?.dataset?.hxyrulePlaylistVideoCount || '');
      const domTotal =
        (Number.isInteger(stored) && stored > 0 ? stored : 0) ||
        parsePlaylistTotalFromText(native?.dataset?.hxyruleOrigTitleText) ||
        0;
      // Only RAISE from a real native "N videos" count — never lower below pager
      // (card-count totals like 12 were wiping page 2 → Refresh index (1/1)).
      if (domTotal > per) {
        const byTotal = Math.ceil(domTotal / per);
        if (byTotal > max) max = byTotal;
      }
      return Math.max(1, max);
    }

    let max = currentPageNumber();
    const pag =
      listPaginationEl() ||
      qs(document, '#list_videos_my_favourite_videos_pagination') ||
      document;
    qsa(pag, '[data-parameters]').forEach((el) => {
      if (isNextPrevControl(el)) return;
      const n = parsePageFromParams(el.getAttribute('data-parameters'));
      if (n) max = Math.max(max, n);
    });
    paginationItemEls(pag).forEach((el) => {
      const n = pageNumberFromPagItem(el);
      if (n) max = Math.max(max, n);
    });
    const per =
      (stablePerPage && stablePerPage > 0 ? stablePerPage : 0) ||
      Math.max(parseCards().length, 1);
    const domTotal = detectLibraryTotalFromDom();
    const indexed = Number(favIndexCache?.videos?.length) || 0;
    let total = domTotal || 0;
    if (!total && scanFavTotal > per) total = scanFavTotal;
    if (!total && indexed > per) total = indexed;
    if (total > 0) {
      const byTotal = Math.ceil(total / per);
      if (byTotal >= 1) {
        if (max < byTotal) max = byTotal;
        if (max > byTotal) max = byTotal;
      }
    }
    return max;
  }

  /** Only numeric page links — skip next/prev/ellipsis. */
  function pageNumberFromPagItem(el) {
    const stored = Number(el.dataset.hxyrulePage || '');
    if (Number.isInteger(stored) && stored > 0) return stored;
    const numEl = qs(el, `.${NS}-page-num`);
    if (numEl) {
      const n = Number((numEl.textContent || '').trim());
      if (Number.isInteger(n) && n > 0) return n;
    }
    const text = (el.textContent || '').trim();
    // After we inject "(n)", text may be "201(3)" — still accept leading digits only.
    if (!/^\d/.test(text)) return null;
    const m = text.match(/^(\d+)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function resolvePageButton(el) {
    // Site: .item > a (rounded #424c55 button). Prefer inner <a>.
    if (el.matches('a')) return el;
    return qs(el, 'a') || el;
  }

  function paginationItemEls(root) {
    let items = qsa(root, '.pagination .item');
    if (!items.length) items = qsa(root, '.item');
    // Prefer shells that wrap a numeric page control; skip prev/next/first/last.
    return items.filter((el) => pageNumberFromPagItem(el));
  }

  function ensurePageLabel(el, pageNum, missing) {
    const btn = resolvePageButton(el);
    const shell = el;
    if (btn !== shell) shell.classList.add(`${NS}-page-shell`);
    shell.dataset.hxyrulePage = String(pageNum);
    btn.dataset.hxyrulePage = String(pageNum);
    btn.classList.add(`${NS}-page-chrome`);

    let num = qs(btn, `.${NS}-page-num`);
    let miss = qs(btn, `.${NS}-page-miss`);
    if (!num || !miss) {
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      num = document.createElement('span');
      num.className = `${NS}-page-num`;
      miss = document.createElement('span');
      miss.className = `${NS}-page-miss`;
      btn.appendChild(num);
      btn.appendChild(miss);
    }
    const legacyFace = qs(btn, `.${NS}-page-face`);
    if (legacyFace) {
      legacyFace.remove();
      num = qs(btn, `.${NS}-page-num`);
      miss = qs(btn, `.${NS}-page-miss`);
    }
    num.textContent = String(pageNum);
    if (missing != null && missing > 0) {
      miss.textContent = `(${missing})`;
      miss.hidden = false;
    } else {
      miss.textContent = '';
      miss.hidden = true;
    }
    return { shell, btn, num, miss };
  }

  /**
   * Apply marks with inline !important styles (site CSS beats our stylesheet selectors).
   * - Inner <a> fill = fully-local green / current-incomplete gray / else native
   * - Number color = current red / local-non-current white
   * - Missing count stacked under number, centered
   */
  function paintPageButton(btn, num, miss, { allLocal, isCurrent, missing }) {
    btn.dataset.hxyrulePaint = '1';
    btn.classList.toggle(`${NS}-page-local`, allLocal);
    btn.classList.toggle(`${NS}-page-current`, isCurrent);

    btn.style.setProperty('display', 'flex', 'important');
    btn.style.setProperty('flex-direction', 'column', 'important');
    btn.style.setProperty('align-items', 'center', 'important');
    btn.style.setProperty('justify-content', 'center', 'important');
    btn.style.setProperty('text-align', 'center', 'important');
    btn.style.setProperty('gap', '2px', 'important');

    if (allLocal) {
      btn.style.setProperty('background', '#3f9a6f', 'important');
      btn.style.setProperty('background-color', '#3f9a6f', 'important');
    } else {
      // Match toolbar control gray (including current — kill site active red fill).
      btn.style.setProperty('background', '#2f3b46', 'important');
      btn.style.setProperty('background-color', '#2f3b46', 'important');
    }

    if (num) {
      num.style.setProperty('display', 'block', 'important');
      num.style.setProperty('width', '100%', 'important');
      num.style.setProperty('text-align', 'center', 'important');
      num.style.setProperty('line-height', '1.15', 'important');
      if (isCurrent) num.style.setProperty('color', '#ce5f5d', 'important');
      else if (allLocal) num.style.setProperty('color', '#fff', 'important');
      else num.style.removeProperty('color');
    }
    if (miss) {
      const show = missing != null && missing > 0;
      miss.style.setProperty('display', show ? 'block' : 'none', 'important');
      miss.style.setProperty('width', '100%', 'important');
      miss.style.setProperty('text-align', 'center', 'important');
      miss.style.setProperty('font-size', '11px', 'important');
      miss.style.setProperty('line-height', '1.1', 'important');
      miss.style.setProperty('margin', '0', 'important');
      if (show) {
        if (allLocal || isCurrent) miss.style.setProperty('color', '#fff', 'important');
        else miss.style.removeProperty('color');
      }
    }
  }

  function paintPaginationLocalMarks() {
    const root = currentListPaginationEl();
    if (!root) return;
    const TITLE_FULL = 'All videos on this page are local';
    const cur = currentPageNumber();
    paginationItemEls(root).forEach((el) => {
      const n = pageNumberFromPagItem(el);
      if (!n) return;
      const missing = pageMissingCounts.has(n) ? pageMissingCounts.get(n) : null;
      const allLocal = fullLocalPages.has(n);
      const isCurrent = n === cur || el.classList.contains('active');
      const { shell, btn, num, miss } = ensurePageLabel(el, n, missing);
      // Never tint the outer .item shell
      shell.style.removeProperty('background');
      shell.style.removeProperty('background-color');
      shell.classList.toggle(`${NS}-page-local`, allLocal);
      shell.classList.toggle(`${NS}-page-current`, isCurrent);
      paintPageButton(btn, num, miss, { allLocal, isCurrent, missing });
      if (allLocal) {
        btn.setAttribute('title', TITLE_FULL);
        shell.setAttribute('title', TITLE_FULL);
      } else {
        if (btn.getAttribute('title') === TITLE_FULL) btn.removeAttribute('title');
        if (shell.getAttribute('title') === TITLE_FULL) shell.removeAttribute('title');
      }
    });
  }

  function isCardLocal(videoId, results) {
    const id = String(videoId);
    if (results && results[id]) return !!results[id].exists;
    if (localIdSet.has(id)) return true;
    const info = lastMatches[id];
    if (!info) return false;
    return !!(info.exists || info.absolutePath || info.relativePath);
  }

  function syncCurrentPageLocalMark(cards, results) {
    if (scanned && cards.length) {
      const page = currentPageNumber();
      let missing = 0;
      cards.forEach((c) => {
        if (!isCardLocal(c.videoId, results)) missing += 1;
      });
      pageMissingCounts.set(page, missing);
      if (missing === 0) fullLocalPages.add(page);
      else fullLocalPages.delete(page);
    }
    paintPaginationLocalMarks();
  }

  /** Numeric page links currently shown in the bar (not collapsed into “…”). */
  function visiblePageNumbers() {
    const root = currentListPaginationEl();
    const set = new Set();
    if (root) {
      qsa(root, '.pagination .item, .item').forEach((el) => {
        const n = pageNumberFromPagItem(el);
        if (n) set.add(n);
      });
    }
    const cur = currentPageNumber();
    if (Number.isInteger(cur) && cur > 0) set.add(cur);
    return [...set].sort((a, b) => a - b);
  }

  let nearbyEvalGen = 0;

  /**
   * Only check pages whose numbers are visible in the pagination bar.
   * Local disk scan is fast; each page check is an HTTP fetch — keep the set small.
   */
  async function evaluateVisibleLocalPages(localIds) {
    const ids = localIds instanceof Set ? localIds : localIdSet;
    if (!scanned && !(ids && ids.size)) return;
    const gen = ++nearbyEvalGen;
    const pages = visiblePageNumbers();
    if (!pages.length) return;

    const cur = currentPageNumber();
    const cards = parseCards();

    for (const page of pages) {
      if (gen !== nearbyEvalGen) return;
      try {
        let missing = 0;
        let total = 0;
        if (page === cur && cards.length) {
          total = cards.length;
          cards.forEach((c) => {
            if (!(ids.has(c.videoId) || isCardLocal(c.videoId, lastMatches))) missing += 1;
          });
          } else {
            const data = await fetchListPage(page);
            if (gen !== nearbyEvalGen) return;
            const batch = data.items || [];
            total = batch.length;
            if (!batch.length) {
              missing = 0;
            } else if (ids.size && scanMatched != null && ids.size >= scanMatched) {
              batch.forEach((it) => {
                if (!ids.has(String(it.videoId))) missing += 1;
              });
            } else {
              const lookup = await send('HELPER_LOOKUP', {
                videoIds: batch.map((it) => String(it.videoId)),
              });
              if (gen !== nearbyEvalGen) return;
              const results = lookup.results || {};
              batch.forEach((it) => {
                const id = String(it.videoId);
                if (!(results[id] && results[id].exists)) missing += 1;
              });
            }
            // Assign stable ordinals for nearby pages as we discover them.
            if (batch.length) {
              if (page === 1 || (page < maxPageNumber() && batch.length >= 5)) {
                // Lock full-page size; never learn from a short last page.
                if (!stablePerPage || batch.length >= (stablePerPage || 0)) {
                  stablePerPage = batch.length;
                }
              }
              const totalFav = scanFavTotal || detectFavoritesTotal() || batch.length;
              const perPage = cardsPerPageEstimate();
              send('HELPER_ORDINALS_ENSURE', {
                items: batch.map((it, i) => ({
                  videoId: String(it.videoId),
                  preferredSeq: preferredSeqForCard(
                    {
                      favoritePage: page,
                      cardIndex: Number.isInteger(it.cardIndex) ? it.cardIndex : i,
                    },
                    totalFav,
                    perPage,
                  ),
                })),
              }).catch(() => {});
            }
          }
        pageMissingCounts.set(page, missing);
        if (total > 0 && missing === 0) fullLocalPages.add(page);
        else fullLocalPages.delete(page);
      } catch (_) {
        /* skip unreachable page */
      }
    }
    if (gen !== nearbyEvalGen) return;
    paintPaginationLocalMarks();
  }

  function scheduleEvaluateVisiblePages() {
    clearTimeout(scheduleEvaluateVisiblePages._t);
    scheduleEvaluateVisiblePages._t = setTimeout(() => {
      evaluateVisibleLocalPages(localIdSet).catch(() => {});
    }, 200);
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

  /** Coerce indexed/API duration. Do not use Number(null) — that is 0 in JS. */
  function coerceDurationSec(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function cardDurationSec(el) {
    const timeEl = qs(el, '.time') || qs(el, '[class*="duration"]');
    if (!timeEl) return null;
    return parseDurationSec(timeEl.textContent);
  }

  /** Duration on a video detail page (info rows / player), when no list card .time. */
  function detailPageDurationSec() {
    const prefer = [
      qs(document, '.video-info'),
      qs(document, '.info-holder'),
      qs(document, '.block-video'),
      qs(document, '.player'),
    ].filter(Boolean);
    const roots = prefer.length ? prefer : [document.body].filter(Boolean);
    for (const root of roots) {
      const nodes = qsa(root, '.time, [class*="duration"]');
      for (const el of nodes) {
        const d = parseDurationSec(el.textContent);
        if (d != null && d > 0) return d;
      }
      const labeled = String(root.textContent || '').match(
        /duration\s*[:]?\s*(\d+:\d{1,2}(?::\d{1,2})?)/i,
      );
      if (labeled) {
        const d = parseDurationSec(labeled[1]);
        if (d != null && d > 0) return d;
      }
    }
    const video = qs(document, 'video');
    const vd = video && Number(video.duration);
    if (Number.isFinite(vd) && vd > 0) return Math.round(vd);
    return null;
  }

  /** Absolute preview URL; skip lazy placeholders. */
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

  function cardThumbUrl(el) {
    const img = qs(el, 'img');
    if (!img) return '';
    const attrs = ['data-original', 'data-src', 'data-lazy-src', 'data-thumb', 'src'];
    for (const attr of attrs) {
      const u = normalizeThumbUrl(img.getAttribute(attr));
      if (u) return u;
    }
    return '';
  }

  /** Hover-preview media URL from a native (or compact) card. */
  function cardPreviewUrl(el) {
    if (!el) return '';
    const nodes = [el, ...qsa(el, 'a.th, a, img, video, source')];
    const attrs = [
      'data-preview',
      'data-trailer',
      'data-video',
      'data-mp4',
      'data-webm',
      'data-mid',
      'data-src',
    ];
    for (const node of nodes) {
      if (!node?.getAttribute) continue;
      for (const attr of attrs) {
        const raw = String(node.getAttribute(attr) || '').trim();
        if (!raw || /grey\.gif|spacer|blank|lazy|placeholder/i.test(raw)) continue;
        if (/\.(?:mp4|webm)(?:$|\?)/i.test(raw) || /preview|trailer/i.test(raw)) {
          return normalizeThumbUrl(raw) || (raw.startsWith('//') ? `https:${raw}` : raw);
        }
      }
    }
    return '';
  }

  /** Views / like-rate / added time from a native favorites card. */
  function cardMetaFromEl(el) {
    const info = el ? qs(el, '.thumb_info') : null;
    const textOf = (sel) =>
      String(info ? qs(info, sel)?.textContent || '' : '')
        .replace(/\s+/g, ' ')
        .trim();
    return {
      viewsText: textOf('.views'),
      ratingText: textOf('.rating'),
      addedText: textOf('.added'),
    };
  }

  function normalizeMetaText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatClockDuration(sec) {
    const n = coerceDurationSec(sec);
    if (n == null) return '';
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Page URL for a video id. Ignore candidates that point at a different id.
   * Site 404s on bare `/video/{id}/` — keep slug paths; otherwise use `/v/`. */
  function detailUrlForVideoId(videoId, candidate = '') {
    const id = String(videoId || '').trim();
    if (!/^\d+$/.test(id)) return '';
    const raw = String(candidate || '').trim();
    // Must be /video/{id}/… — never trust /popup-video/… or another id's page.
    if (
      raw &&
      /(?:^|https?:\/\/[^/]+)\/video\/\d+\//i.test(raw) &&
      !/\/popup-video\//i.test(raw) &&
      raw.includes(`/video/${id}/`)
    ) {
      const abs = raw.startsWith('http') ? raw : `https://rule34video.com${raw}`;
      // Bare `/video/{id}/` → `/video/{id}/v/` (site requirement).
      try {
        const path = new URL(abs).pathname;
        if (/^\/videos?\/\d+\/?$/i.test(path)) {
          return `https://rule34video.com/video/${id}/v/`;
        }
      } catch (_) {
        /* keep abs */
      }
      return abs;
    }
    return `https://rule34video.com/video/${id}/v/`;
  }

  function popupUrlForVideoId(videoId) {
    const id = String(videoId || '').trim();
    if (!/^\d+$/.test(id)) return '';
    return `https://rule34video.com/popup-video/${id}/?popup_id=1`;
  }

  /** True when href is a watch/popup URL whose id differs from wantId. */
  function hrefVideoIdMismatch(href, wantId) {
    const id = String(wantId || '').trim();
    if (!id || !href) return false;
    const popup = String(href).match(/\/popup-video\/(\d+)\//i);
    if (popup) return popup[1] !== id;
    // Do not treat /popup-video/N/ as /video/N/ via substring.
    const page = String(href).match(/(?:^|https?:\/\/[^/]+)\/video\/(\d+)\//i);
    if (page) return page[1] !== id;
    return false;
  }

  function parseCards() {
    const page = currentPageNumber();
    const compactRoot = qs(document, `.${NS}-compact-thumbs`);
    const cards = compactViewActive
      ? qsa(compactRoot || document, `.item.thumb[data-hxyrule-compact="1"]`)
      : qsa(document, '.item.thumb').filter(
          (el) =>
            el.dataset?.hxyruleCompact !== '1' &&
            !el.closest(`.${NS}-compact-thumbs`),
        );
    return cards.map((el, index) => {
      const checkbox =
        qs(el, 'input.checkbox[name="delete[]"]') ||
        qs(el, 'input[name="delete[]"]') ||
        qs(el, 'input[type="checkbox"]');
      const link =
        qs(el, 'a.th.js-open-popup, a.th') || qs(el, 'a[href*="/video/"]');
      const videoId =
        checkbox?.value ||
        (link?.href.match(/\/video\/(\d+)\//) ||
          (link?.getAttribute('href') || '').match(/\/video\/(\d+)\//) ||
          [])[1];
      if (!videoId) return null;
      const titleEl = qs(el, '.thumb_title') || (link && qs(link, '.thumb_title'));
      // Prefer live textContent / link title (may include "N——" ordinal). Do NOT
      // prefer dataset.hxyruleOrigTitle here — that is the bare title and would
      // strip ordinals from Download queue filenames.
      const rawTitle =
        (titleEl && titleEl.textContent) ||
        link?.getAttribute('title') ||
        titleEl?.dataset?.hxyruleOrigTitle ||
        link?.dataset?.hxyruleOrigTitle ||
        link?.textContent?.trim() ||
        videoId;
      const favPage = Number(el.dataset?.hxyruleFavoritePage);
      const cardIdx = Number(el.dataset?.hxyruleCardIndex);
      return {
        el,
        videoId: String(videoId),
        detailUrl: link?.href || `https://rule34video.com/video/${videoId}/v/`,
        title: String(rawTitle).trim(),
        favoritePage: Number.isInteger(favPage) && favPage > 0 ? favPage : page,
        cardIndex: Number.isInteger(cardIdx) && cardIdx >= 0 ? cardIdx : index,
        durationSec: cardDurationSec(el),
        checkbox,
        link,
      };
    }).filter(Boolean);
  }

  const ORDINAL_PREFIX_RE = /^(\d+)\s*——\s*/;

  function bareTitle(title) {
    return String(title || '').replace(ORDINAL_PREFIX_RE, '').trim();
  }

  function titledWithOrdinal(seq, title) {
    return `${seq}——${bareTitle(title)}`;
  }

  /** Native list cards only — never related/suggested thumbs elsewhere on the page. */
  function nativeListCardCount() {
    const list = favoritesListEl();
    const scope = list || listBoxEl();
    if (!scope) return 0;
    return qsa(scope, '.item.thumb').filter(
      (el) =>
        el.dataset?.hxyruleCompact !== '1' &&
        !el.closest(`.${NS}-compact-thumbs`) &&
        !el.classList.contains(`${NS}-compact-native-hidden`),
    ).length;
  }

  function cardsPerPageEstimate() {
    const maxP = maxPageNumber();
    const total =
      Number(favIndexCache?.videos?.length) ||
      scanFavTotal ||
      detectLibraryTotalFromDom() ||
      0;
    const cur = nativeListCardCount();
    const curPage = currentPageNumber();
    const inferred =
      total > 0 && maxP > 1 ? Math.max(1, Math.ceil(total / maxP)) : 0;
    // A non-last page is normally full — lock that as the page size.
    // After Unfavorite we surgically remove cards mid-page; never shrink an
    // existing lock (or inferred size) to that short count — Compact / List
    // would then paint fewer cards and leave empty slots until a full refresh.
    if (Number.isInteger(curPage) && maxP > 1 && curPage < maxP && cur > 0) {
      const floor = Math.max(stablePerPage || 0, inferred || 0);
      if (!floor || cur >= floor) {
        stablePerPage = cur;
        return cur;
      }
      return floor;
    }
    if (stablePerPage && stablePerPage > 0) return stablePerPage;
    // Infer from total/maxPage so last-page short counts never poison preferredSeq
    // or Compact paging (refresh on page 2 used to lock 11 → infer 6).
    if (inferred > 0) {
      stablePerPage = inferred;
      return inferred;
    }
    if (maxP <= 1 && cur > 0) {
      stablePerPage = cur;
      return cur;
    }
    // Last-page short count — use for this call only; do not lock stablePerPage.
    return cur > 0 ? cur : 12;
  }

  function preferredSeqForCard(card, total, perPage) {
    const t = Math.max(Number(total) || 0, 1);
    const p = Math.max(Number(perPage) || 10, 1);
    const page = Math.max(Number(card.favoritePage) || 1, 1);
    const idx = Math.max(Number(card.cardIndex) || 0, 0);
    // Favorites list is newest-first on page 1; earliest favorite => seq 1.
    const fromNewest = (page - 1) * p + idx;
    return Math.max(1, t - fromNewest);
  }

  function applyOrdinalDisplay(card, seq) {
    // Update every .thumb_title on the card — some skins leave a duplicate under
    // a.th after the pick rail moves the primary title.
    const titleEls = [
      ...qsa(card.el, '.thumb_title'),
      ...(card.link ? qsa(card.link, '.thumb_title') : []),
    ].filter((el, i, arr) => arr.indexOf(el) === i);
    let bare = bareTitle(card.title);
    titleEls.forEach((titleEl) => {
      const nextBare =
        titleEl.dataset.hxyruleOrigTitle || bareTitle(titleEl.textContent) || bare;
      titleEl.dataset.hxyruleOrigTitle = nextBare;
      if (nextBare) bare = bare || nextBare;
      titleEl.textContent = titledWithOrdinal(seq, nextBare);
    });
    if (card.link) {
      const linkBare =
        card.link.dataset.hxyruleOrigTitle ||
        bareTitle(card.link.getAttribute('title') || '') ||
        bare;
      card.link.dataset.hxyruleOrigTitle = linkBare;
      bare = bare || linkBare;
      card.link.setAttribute('title', titledWithOrdinal(seq, linkBare));
    }
    card.title = titledWithOrdinal(seq, bare);
    card.ordinal = seq;
  }

  /**
   * Newest-first pages must show descending seq. An ascending run at the front
   * (e.g. 2563, 2564, 2562…) means refavorites kept mid-range ordinals — claim
   * fresh max+1… for that prefix (DOM order = newest first).
   */
  function ascendingOrdinalPrefixLen(cards, map) {
    if (cards.length < 2) return 0;
    let end = 0;
    while (
      end + 1 < cards.length &&
      Number(map[cards[end].videoId]) > 0 &&
      Number(map[cards[end + 1].videoId]) > 0 &&
      Number(map[cards[end].videoId]) < Number(map[cards[end + 1].videoId])
    ) {
      end += 1;
    }
    return end > 0 ? end + 1 : 0;
  }

  async function claimNewestOrdinals(videoIds) {
    const ids = [...new Set((videoIds || []).map(String).filter((id) => /^\d+$/.test(id)))];
    if (!ids.length) return {};
    try {
      const data = await send('HELPER_ORDINALS_CLAIM_NEWEST', { videoIds: ids });
      return data?.ordinals || {};
    } catch (_) {
      return {};
    }
  }

  async function applyOrdinalsToCards(cards) {
    if (!cards.length) return;
    const total = scanFavTotal || detectFavoritesTotal() || cards.length;
    const perPage = cardsPerPageEstimate();
    const items = cards.map((c) => ({
      videoId: c.videoId,
      preferredSeq: preferredSeqForCard(c, total, perPage),
    }));
    try {
      let data = await send('HELPER_ORDINALS_ENSURE', { items });
      let map = { ...(data.ordinals || {}) };
      const prefix = ascendingOrdinalPrefixLen(cards, map);
      if (prefix > 0) {
        const claimed = await claimNewestOrdinals(
          cards.slice(0, prefix).map((c) => c.videoId),
        );
        Object.assign(map, claimed);
      }
      cards.forEach((card) => {
        const seq = map[card.videoId];
        if (seq == null) return;
        applyOrdinalDisplay(card, Number(seq));
      });
    } catch (_) {
      /* Helper optional for titles */
    }
  }

  /** Re-paint seq prefixes after site HTML replace / Compact → Show all. */
  let ordinalRepaintTimer = null;
  function scheduleOrdinalRepaint(delays = [0, 400, 1200]) {
    if (ordinalRepaintTimer) {
      clearTimeout(ordinalRepaintTimer);
      ordinalRepaintTimer = null;
    }
    const run = (i) => {
      applyOrdinalsToCards(parseCards()).catch(() => {});
      if (i + 1 < delays.length) {
        ordinalRepaintTimer = setTimeout(() => run(i + 1), Math.max(0, delays[i + 1] - delays[i]));
      } else {
        ordinalRepaintTimer = null;
      }
    };
    const first = Math.max(0, Number(delays[0]) || 0);
    if (first === 0) run(0);
    else ordinalRepaintTimer = setTimeout(() => run(0), first);
  }

  function shortPathLabel(info) {
    const rel = String(info.relativePath || '').trim();
    if (rel) {
      const parts = rel.split(/[/\\]/);
      return parts[parts.length - 1] || rel;
    }
    const full = String(info.displayPath || '').trim();
    if (!full) return '';
    const parts = full.split(/[/\\]/);
    return parts[parts.length - 1] || full;
  }

  function findNativeControlsHost() {
    const selectAll = qs(document, 'input[data-action="select_all"]');
    const start = selectAll
      || qs(
        document,
        'input[data-action="delete"], input[data-action="delete_multi"], button[data-action="delete"], input[value="Delete selected"], input[value="Delete Selected"]',
      );
    if (!start) return null;
    const candidates = [
      start.closest('.bottom, .holder-bottom, .generic-button, .buttons, .btn-holder, .headline'),
      start.parentElement,
      start.closest('.row, .box'),
    ].filter(Boolean);
    for (const c of candidates) {
      // Never treat the big favorites form (which also holds thumbs) as the host.
      if (c.querySelector?.('.item.thumb, #list_videos_my_favourite_videos_items')) continue;
      return c;
    }
    return start.parentElement;
  }

  /** Native Artists / Tags / Categories / Temp Blacklist / Search row — unused on library pages. */
  function hideNativeAdvancedSearchFilters() {
    if (!isFavoritesPage() && !isPlaylistDetailPage()) return;
    if (document.documentElement) document.documentElement.dataset.hxyruleLibrary = '1';
    const mark = (el) => {
      if (!el || el.querySelector?.('.item.thumb, .thumbs, [id$="_items"]')) return;
      el.classList.add('hxyrule-hide-native');
    };
    qsa(
      document,
      '#model_filter, #tags_filter, #categories_filter, #temp_blacklist_filter, #search_button_large_container',
    ).forEach((el) => {
      mark(el);
      const row = el.closest('.columns');
      mark(row);
      const headerContainer = row?.closest('.header')?.querySelector(':scope > .container') || null;
      if (headerContainer && headerContainer.contains(row)) mark(headerContainer);
    });
  }

  function hideNativeControls() {
    hideNativeAdvancedSearchFilters();
    const scope = listBoxEl() || qs(document, '#list_videos_my_favourite_videos') || document;
    qsa(
      scope,
      'input[data-action="select_all"], [data-action="delete"], [data-action="delete_multi"], [data-action="delete_selected"], [data-action="move_to_playlist"], [data-action="add_to_playlist"], [data-action="move_multi"], input[value="Delete selected"], input[value="Delete Selected"], input[value="Move to playlist"], input[value="Move to Playlist"]',
    ).forEach((el) => {
      el.classList.add('hxyrule-hide-native');
      if (el.labels) [...el.labels].forEach((lab) => lab.classList.add('hxyrule-hide-native'));
      const wrap = el.closest('label, .checkbox-container');
      if (wrap && !wrap.querySelector?.('.item.thumb')) wrap.classList.add('hxyrule-hide-native');
    });
    // Per-card Order number + Delete strip under thumbs — CSS also hides these;
    // mark so AJAX replacements and partial matches stay collapsed.
    qsa(
      scope,
      '.item-control.headline_panel, .playlist_manage_controls, .playlist_order_field, .item.thumb .item-control',
    ).forEach((el) => {
      el.classList.add('hxyrule-hide-native');
    });
    const host = findNativeControlsHost();
    if (host && !host.querySelector?.('.item.thumb')) host.classList.add('hxyrule-hide-native');
  }

  /** Undo older title+Jump horizontal row if still present. */
  function unwrapTitleRow() {
    const row = qs(document, `.${NS}-title-row`);
    if (!row) return;
    const parent = row.parentElement;
    if (!parent) {
      row.remove();
      return;
    }
    while (row.firstChild) parent.insertBefore(row.firstChild, row);
    row.remove();
  }

  function findFavoritesHeadline() {
    // Playlist native title often sits ABOVE the list_videos box — search document-wide.
    const box = listBoxEl() || qs(document, '#list_videos_my_favourite_videos');
    const scopes = [box, box?.parentElement, qs(document, '.main, .page__main, .content'), document].filter(
      Boolean,
    );
    const seen = new Set();
    for (const scope of scopes) {
      const nodes = qsa(scope, '.headline, .headline .title, .headline h1, .headline h2, h1, h2');
      for (const el of nodes) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (
          el.closest?.(
            `.${NS}-favcount, .${NS}-jumpbar, .${NS}-toolbar, .${NS}-controls, .${NS}-playlist-page-title`,
          )
        ) {
          continue;
        }
        const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/my\s+playlist\b/i.test(t) || /my\s*favou?rites/i.test(t)) {
          return el.classList?.contains('headline') ? el : el.closest('.headline') || el;
        }
      }
    }
    for (const scope of scopes) {
      const nodes = qsa(scope, '.headline');
      for (const el of nodes) {
        const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/playlist/i.test(t) && /\([\d,]+\)/.test(t)) {
          return el;
        }
      }
    }
    return (box && qs(box, '.headline')) || qs(document, '.headline') || null;
  }

  function isPlaylistHeadlineEl(el) {
    const t = String(el?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    return /my\s+playlist\b/i.test(t) || (/playlist/i.test(t) && /\([\d,]+\s*\)/.test(t));
  }

  function restoreHeadlineStyles(hl) {
    if (!hl) return;
    hl.classList.remove(`${NS}-hide-native-headline`);
    hl.removeAttribute('hidden');
    hl.removeAttribute('aria-hidden');
    [
      'display',
      'height',
      'max-height',
      'margin',
      'padding',
      'overflow',
      'line-height',
      'font-size',
      'border',
      'visibility',
    ].forEach((p) => hl.style.removeProperty(p));
  }

  /** Keep the native playlist title in the fixed toolbar; hide every leftover copy. */
  function placePlaylistNativeTitle() {
    // Drop plain-text clone from earlier builds — it broke click-to-navigate.
    qs(document, `.${NS}-playlist-page-title`)?.remove();
    qs(document, `.${NS}-favorites-lib-row`)?.remove();
    if (!isPlaylistDetailPage()) return null;
    const stack = ensureControlStack();
    let hl =
      qs(stack, `.headline.${NS}-playlist-native-title`) ||
      qs(document, `.headline.${NS}-playlist-native-title`) ||
      [...qsa(stack, '.headline')].find((el) => isPlaylistHeadlineEl(el)) ||
      findFavoritesHeadline();
    if (!hl) {
      hideOrphanPlaylistHeadlines(null);
      return null;
    }
    restoreHeadlineStyles(hl);
    hl.classList.add(`${NS}-playlist-native-title`);
    hl.classList.remove(`${NS}-hide-native-headline`);
    hl.removeAttribute('hidden');
    hl.style.removeProperty('display');
    // Capture native href before compact hides sibling anchors.
    const href = resolvePlaylistTitleHref(hl);
    let label = ensurePlaylistTitleLabel(hl);
    label = ensurePlaylistTitleLink(hl, label, href);
    syncPlaylistTitleDisplay(hl, label);
    ensureTitleRowEnd(hl);
    compactPlaylistHeadline(hl, label);
    // Keep title inside the fixed stack so it stays above Match/Select.
    if (hl.parentElement !== stack || stack.firstElementChild !== hl) {
      stack.insertBefore(hl, stack.firstChild);
    }
    hideOrphanPlaylistHeadlines(hl);
    return hl;
  }

  /** Hide My Playlist chrome left in the document flow — never touch card grids. */
  function hideOrphanPlaylistHeadlines(keep) {
    qsa(document, '.headline').forEach((el) => {
      if (keep && (el === keep || keep.contains(el) || el.closest?.(`.${NS}-playlist-native-title`) === keep)) {
        return;
      }
      if (el.closest(`.${NS}-topstack`)) return;
      // Critical: some skins nest thumbs under a broad wrapper — never hide those.
      if (el.querySelector?.('.item.thumb, .thumbs, [id$="_items"], .hxyrule-compact-thumbs')) return;
      if (el.closest(`.${NS}-pick, .item.thumb, .${NS}-controls`)) return;
      const t = String(el.dataset?.hxyruleOrigTitleText || el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!t) return;
      const isPl =
        /my\s+playlist\b/i.test(t) || (/playlist/i.test(t) && /\([\d,]+\)/.test(t));
      if (!isPl) return;
      el.classList.add(`${NS}-hide-native-headline`);
      el.setAttribute('hidden', 'true');
      el.style.setProperty('display', 'none', 'important');
    });
  }

  function forceShowGridNode(el) {
    if (!el) return;
    el.classList.remove(
      'hxyrule-hide-native',
      `${NS}-hide-native-headline`,
      `${NS}-native-thumbs-hidden`,
      `${NS}-compact-native-hidden`,
    );
    if (!el.classList.contains(`${NS}-playlist-native-title`)) {
      el.removeAttribute('hidden');
    }
    if (el.style.getPropertyValue('display') === 'none') el.style.removeProperty('display');
    if (el.style.getPropertyValue('visibility') === 'hidden') {
      el.style.removeProperty('visibility');
    }
    if (el.style.getPropertyValue('opacity') === '0') el.style.removeProperty('opacity');
  }

  /**
   * Recover a wiped card grid when hide-native was stamped on a page branch
   * but Compact never mounted. Zero-match Compact (empty host + compact pager)
   * is valid — do not reveal the native grid in that state.
   */
  function ensureCardGridVisible() {
    const compactHost = qs(document, `.${NS}-compact-thumbs`);
    const compactCards = compactHost
      ? qsa(compactHost, `.item.thumb[data-hxyrule-compact="1"]`).length
      : 0;
    // Healthy Compact (including 0 matches) — leave native hide alone.
    if (compactViewActive || compactCards > 0) return;
    // Mid Compact boot: keep pending card hide (class only; no blank shell).
    if (
      (viewRestorePending || filterRunning) &&
      (normalizeViewMode(viewMode) === 'compact' ||
        normalizeViewMode(viewMode) === 'selected')
    ) {
      return;
    }

    compactViewActive = false;
    document.documentElement.classList.remove(`${NS}-compact-active`);
    clearPendingNativeListHide();
    if (compactHost && !compactHost.querySelector?.('.item.thumb')) {
      try {
        compactHost.remove();
      } catch (_) {
        /* ignore */
      }
    }

    const list = favoritesListEl();
    const box = listBoxEl();
    [
      list,
      box,
      qs(document, '.page__wrapper'),
      qs(document, '.page-wrapper'),
      qs(document, '.page__main'),
      qs(document, '.main'),
    ].forEach(forceShowGridNode);

    // Undo hide-native on any ancestor that still wraps the card grid.
    qsa(document, '.hxyrule-hide-native, .hxyrule-hide-native-headline').forEach((el) => {
      if (
        el.querySelector?.(
          '.item.thumb, .thumbs, [id$="_items"], .hxyrule-compact-thumbs, [id^="list_videos"]',
        )
      ) {
        forceShowGridNode(el);
      }
    });

    const gridSel = '.item.thumb, .thumbs, [id$="_items"], .hxyrule-compact-thumbs';
    qsa(document, gridSel).forEach((node) => {
      let el = node;
      for (let depth = 0; el && el !== document.body && depth < 14; depth += 1) {
        if (el.matches?.(gridSel) || el.querySelector?.(gridSel)) forceShowGridNode(el);
        el = el.parentElement;
      }
    });
  }

  /** Absolute URL the site used for the playlist-name click (fallback: playlist index). */
  function resolvePlaylistTitleHref(hl) {
    const stored = String(hl?.dataset?.hxyruleTitleHref || '').trim();
    if (stored) return stored;
    const anchors = [
      ...(hl ? qsa(hl, 'a[href]') : []),
      hl?.tagName === 'A' && hl.getAttribute('href') ? hl : null,
    ].filter(Boolean);
    let href = '';
    for (const a of anchors) {
      const raw = String(a.getAttribute('href') || '').trim();
      if (!raw || raw === '#' || /^javascript:/i.test(raw)) continue;
      href = raw;
      break;
    }
    if (!href) href = '/my/playlists/';
    if (href.startsWith('/')) href = `https://rule34video.com${href}`;
    if (hl) hl.dataset.hxyruleTitleHref = href;
    return href;
  }

  /**
   * Ensure one stable label node for the playlist title pill. Site markup varies
   * (.title / a / bare text); without this the CSS chip cannot attach reliably.
   */
  function ensurePlaylistTitleLabel(hl) {
    if (!hl) return null;
    let label = qs(hl, `.${NS}-playlist-title-label`);
    if (label) return label;
    const existing = [...hl.children].find((el) => el.matches?.('.title, h1, h2, a, strong'));
    if (existing) {
      existing.classList.add(`${NS}-playlist-title-label`);
      return existing;
    }
    // Keep the rail host and the pill as separate nodes so padding + chip do not fight.
    label = document.createElement('span');
    label.className = `${NS}-playlist-title-label`;
    label.dataset.hxyrule = '1';
    while (hl.firstChild) {
      const child = hl.firstChild;
      // Never swallow the card grid if a skin nested it under .headline.
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        (child.matches?.('.thumbs, [id$="_items"], .item.thumb') ||
          child.querySelector?.('.item.thumb, .thumbs, [id$="_items"]'))
      ) {
        hl.parentElement?.insertBefore(child, hl.nextSibling);
        continue;
      }
      label.appendChild(child);
    }
    hl.appendChild(label);
    return label;
  }

  /** Promote the pill to a real <a> so the whole chip navigates like the native name link. */
  function ensurePlaylistTitleLink(hl, label, href) {
    if (!hl || !label) return label;
    const url = String(href || resolvePlaylistTitleHref(hl) || 'https://rule34video.com/my/playlists/');
    let link = label;
    if (label.tagName !== 'A') {
      const inner = qs(label, 'a[href]');
      link = document.createElement('a');
      link.className = `${NS}-playlist-title-label`;
      link.dataset.hxyrule = '1';
      if (inner && String(inner.textContent || '').trim()) {
        link.textContent = String(inner.textContent || '').replace(/\s+/g, ' ').trim();
      } else {
        link.textContent = String(label.textContent || '').replace(/\s+/g, ' ').trim();
      }
      label.replaceWith(link);
    }
    link.classList.add(`${NS}-playlist-title-label`);
    link.setAttribute('href', url);
    link.setAttribute('title', 'Open playlists');
    if (hl) hl.dataset.hxyruleTitleHref = url;
    return link;
  }

  // Captured at first opportunity — document.title often has "… (N)" / "N videos"
  // before we rewrite the on-page headline.
  let siteNativeTitleSnapshot = '';
  let siteNativeTitleCount = null;

  function rememberSiteNativeTitleText(text) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    if (!siteNativeTitleSnapshot) siteNativeTitleSnapshot = raw;
    if (siteNativeTitleCount == null) {
      const n = parsePlaylistTotalFromText(raw) ?? parseVideoCountFromText(raw);
      // Never lock 0 from a title parse — that flashes "0 videos" before the
      // real headline count is available. Empty lists are confirmed via cards.
      if (n != null && n > 0) siteNativeTitleCount = n;
    }
    return siteNativeTitleCount;
  }

  function captureDocumentTitleCount() {
    try {
      const boot = document.documentElement?.dataset?.hxyruleBootTitle || '';
      if (boot) rememberSiteNativeTitleText(boot);
      return rememberSiteNativeTitleText(document.title || '');
    } catch (_) {
      return null;
    }
  }

  /**
   * Lock the site's own title-count once (before we rewrite the pill / applyKnown
   * patches). Favcount chip must always show this — never index or delete math.
   * Never read live el.textContent after our chip is mounted (it re-reads our label).
   */
  function lockSiteNativeVideoTotal(el, rawText) {
    if (siteNativeTitleCount != null) return siteNativeTitleCount;
    if (!el && rawText == null) return captureDocumentTitleCount();
    // Number('') === 0 — only accept an explicitly stored count.
    const locked = optionalNonNegInt(el?.dataset?.hxyruleSiteNativeVideoCount);
    if (locked != null && locked > 0) {
      siteNativeTitleCount = locked;
      return locked;
    }
    let raw = String(
      rawText ||
        el?.dataset?.hxyruleSiteNativeTitleText ||
        // Orig may be patched by applyKnownLibraryTotal — only use if we have no
        // immutable site snapshot yet and it still looks like a site title.
        (!siteNativeTitleSnapshot && el?.dataset?.hxyruleOrigTitleText
          ? el.dataset.hxyruleOrigTitleText
          : '') ||
        '',
    )
      .replace(/\s+/g, ' ')
      .trim();
    // Headline textContent is the usual "My Favourites (2658)" source. Skip once
    // our brand chip is inside the node (would re-parse our own label).
    if (!raw && el && !qs(el, `.${NS}-favcount`)) {
      raw = String(el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (!raw) return captureDocumentTitleCount();
    if (el && !el.dataset.hxyruleSiteNativeTitleText) {
      el.dataset.hxyruleSiteNativeTitleText = raw;
    }
    const count = rememberSiteNativeTitleText(raw);
    if (count != null && el) el.dataset.hxyruleSiteNativeVideoCount = String(count);
    return count;
  }

  /** Website-native list total only — no index, knownLibraryTotal, or pager math. */
  function siteNativeVideoTotal() {
    if (siteNativeTitleCount != null) return siteNativeTitleCount;
    captureDocumentTitleCount();
    if (siteNativeTitleCount != null) return siteNativeTitleCount;
    if (isPlaylistDetailPage()) {
      for (const el of [
        qs(document, `.${NS}-playlist-native-title`),
        qs(document, `.${NS}-hide-native-headline`),
        findFavoritesHeadline(),
      ].filter(Boolean)) {
        const snap =
          el.dataset?.hxyruleSiteNativeTitleText ||
          el.dataset?.hxyruleOrigTitleText ||
          '';
        const n = lockSiteNativeVideoTotal(el, snap);
        if (n != null) return n;
      }
      return siteNativeTitleCount;
    }
    const headline =
      qs(document, `.${NS}-hide-native-headline`) || findFavoritesHeadline();
    const snap =
      headline?.dataset?.hxyruleSiteNativeTitleText ||
      headline?.dataset?.hxyruleOrigTitleText ||
      '';
    return lockSiteNativeVideoTotal(headline, snap);
  }

  /**
   * Brand / Libraries "From:" count. Prefer locked site title, then live DOM
   * headline parse — never index/knownLibraryTotal (those flash stale lows).
   */
  function brandChipVideoTotal() {
    const locked = optionalNonNegInt(siteNativeTitleCount);
    if (locked != null && locked > 0) return locked;
    const native = optionalNonNegInt(siteNativeVideoTotal());
    if (native != null && native > 0) return native;
    const dom = detectLibraryTotalFromDom();
    if (dom != null && dom > 0) {
      if (siteNativeTitleCount == null) siteNativeTitleCount = dom;
      return dom;
    }
    return null;
  }

  /** Display playlist name only — drop the site's "My Playlist" prefix and video count. */
  function syncPlaylistTitleDisplay(hl, label) {
    if (!hl || !label) return;
    // Capture website title text once before name-only rewrite / known-total patches.
    if (!hl.dataset.hxyruleSiteNativeTitleText) {
      const first = String(
        hl.dataset.hxyruleOrigTitleText || label.textContent || hl.textContent || '',
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (first) hl.dataset.hxyruleSiteNativeTitleText = first;
    }
    if (!hl.dataset.hxyruleOrigTitleText && hl.dataset.hxyruleSiteNativeTitleText) {
      hl.dataset.hxyruleOrigTitleText = hl.dataset.hxyruleSiteNativeTitleText;
    }
    lockSiteNativeVideoTotal(hl, hl.dataset.hxyruleSiteNativeTitleText);
    const raw = hl.dataset.hxyruleOrigTitleText || hl.dataset.hxyruleSiteNativeTitleText || '';
    if (!hl.dataset.hxyrulePlaylistVideoCount) {
      const count = parsePlaylistTotalFromText(raw);
      if (count != null && count > 0) {
        hl.dataset.hxyrulePlaylistVideoCount = String(count);
      }
    }
    const pid = currentPlaylistIdFromPath() || '';
    let name =
      hl.dataset.hxyrulePlaylistName ||
      extractPlaylistNameFromText(raw, pid) ||
      'Playlist';
    // Avoid calling detectPlaylistTitle() here — it may read this same node mid-rewrite.
    if (!name || name === 'Playlist') {
      const fallback = extractPlaylistNameFromText(
        String(qs(document, `.${NS}-hide-native-headline`)?.dataset?.hxyruleOrigTitleText ||
          qs(document, `.${NS}-hide-native-headline`)?.textContent ||
          ''),
        pid,
      );
      if (fallback) name = fallback;
    }
    name = String(name || '').trim() || 'Playlist';
    hl.dataset.hxyrulePlaylistName = name;
    if (label.textContent !== name) label.textContent = name;
  }

  /**
   * Title-row Libraries pill. Opens the library switcher.
   * Native My Favorites stays in `.panel_header` next to Tags — do not reuse it here.
   * @param {Element} hl row host
   * @param {Element|null} anchor optional sibling to place after (site logo)
   */
  function ensurePlaylistLibraryButton(hl, anchor = null) {
    if (!hl) return null;
    // Prefer a dedicated Libraries control — never reuse the native fav <a>.
    let btn =
      qs(hl, `button.${NS}-playlist-lib-btn`) ||
      [...qsa(hl, `a.${NS}-playlist-lib-btn`)].find(
        (el) => !el.classList.contains('button_fav') && el.dataset?.hxyruleNativeFav !== '1',
      ) ||
      null;
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${NS}-playlist-lib-btn`;
      btn.dataset.hxyrule = '1';
      btn.dataset.hxyruleLibBtn = '1';
      btn.textContent = 'Libraries';
      btn.setAttribute('title', 'Open Favorites and playlists');
      btn.setAttribute('aria-label', 'Libraries');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLibrarySwitcher().catch(() => {});
      });
    } else {
      // Promote a relocated <a> (older builds) to a stable button control.
      if (btn.tagName === 'A') {
        const next = document.createElement('button');
        next.type = 'button';
        next.className = `${NS}-playlist-lib-btn`;
        next.dataset.hxyrule = '1';
        next.dataset.hxyruleLibBtn = '1';
        next.textContent = 'Libraries';
        next.setAttribute('title', 'Open Favorites and playlists');
        next.setAttribute('aria-label', 'Libraries');
        next.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openLibrarySwitcher().catch(() => {});
        });
        btn.replaceWith(next);
        btn = next;
      } else {
        btn.classList.add(`${NS}-playlist-lib-btn`);
        btn.dataset.hxyrule = '1';
        btn.dataset.hxyruleLibBtn = '1';
        btn.removeAttribute('hidden');
        btn.style.removeProperty('display');
        btn.style.removeProperty('visibility');
        btn.textContent = 'Libraries';
        btn.setAttribute('title', 'Open Favorites and playlists');
        btn.setAttribute('aria-label', 'Libraries');
        if (btn.dataset.hxyruleLibClickBound !== '1') {
          btn.dataset.hxyruleLibClickBound = '1';
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openLibrarySwitcher().catch(() => {});
          });
        }
      }
    }
    if (anchor && hl.contains(anchor)) {
      if (btn.parentElement !== hl || anchor.nextSibling !== btn) anchor.after(btn);
    } else if (btn.parentElement !== hl) {
      hl.appendChild(btn);
    }
    return btn;
  }

  /**
   * Keep site My Favorites in `.panel_header` (logo / Tags row) visible and
   * native-shaped. Older builds hid or relocated it into the title chrome.
   */
  function hideNativeMyFavoritesNavLinks(_keep = null) {
    releaseTitleRowMyFavorites();
  }

  /**
   * Favorites page: same chrome row as playlist (Libraries on the right),
   * without a centered NAME pill. Native My Favorites stays beside Tags.
   */
  function placeFavoritesLibraryTitleRow() {
    qs(document, `.${NS}-playlist-page-title`)?.remove();
    if (!isFavoritesPage()) {
      qs(document, `.${NS}-favorites-lib-row`)?.remove();
      return null;
    }
    const stack = ensureControlStack();
    let row =
      qs(stack, `.${NS}-favorites-lib-row`) || qs(document, `.${NS}-favorites-lib-row`);
    if (!row) {
      row = document.createElement('div');
      row.className = `${NS}-favorites-lib-row`;
      row.dataset.hxyrule = '1';
      row.setAttribute('aria-label', 'My libraries');
    }
    ensureTitleRowEnd(row);
    hideNativeMyFavoritesNavLinks();
    row.style.setProperty('border', 'none', 'important');
    row.style.setProperty('border-bottom', '1px solid #4a5563', 'important');
    row.style.setProperty('box-shadow', '0 1px 0 rgb(0 0 0 / 35%)', 'important');
    if (row.parentElement !== stack || stack.firstElementChild !== row) {
      stack.insertBefore(row, stack.firstChild);
    }
    return row;
  }

  /**
   * Site `.headline` often keeps clearfix / spacer siblings (and whitespace
   * text nodes) that inflate the hit-box with a blank row under the title.
   * Keep only the title pill + right-end cluster (site + Libraries) + brand.
   */
  function compactPlaylistHeadline(hl, label, libBtn = null) {
    if (!hl || !label) return;
    const keepEnd = qs(hl, `.${NS}-title-end`) || null;
    const keepLib = keepEnd
      ? qs(keepEnd, `.${NS}-playlist-lib-btn`)
      : libBtn || qs(hl, `.${NS}-playlist-lib-btn`);
    const keepLogo = keepEnd ? qs(keepEnd, `.${NS}-site-logo`) : qs(hl, `.${NS}-site-logo`);
    const keepFav = qs(hl, `.${NS}-favcount`);
    [...hl.childNodes].forEach((node) => {
      if (
        node === label ||
        node === keepEnd ||
        node === keepLib ||
        node === keepLogo ||
        node === keepFav
      ) {
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (
          node.contains?.(label) ||
          (keepEnd && node.contains?.(keepEnd)) ||
          (keepLib && node.contains?.(keepLib)) ||
          (keepLogo && node.contains?.(keepLogo)) ||
          (keepFav && node.contains?.(keepFav))
        ) {
          return;
        }
        node.setAttribute('hidden', 'true');
        node.style.setProperty('display', 'none', 'important');
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent = '';
      }
    });
    // Strip trailing <br> / empty blocks inside the title node itself.
    qsa(label, 'br, hr, .clear, .clearfix').forEach((el) => el.remove());
    [...label.childNodes].forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && !String(node.textContent || '').trim()) {
        node.textContent = '';
      }
    });
    // DOM order: brand (left) → NAME → [site | Libraries] (right).
    if (keepFav && hl.firstElementChild !== keepFav) {
      hl.insertBefore(keepFav, hl.firstChild);
    }
    const right = keepEnd || keepLib;
    if (right && label.nextSibling !== right) {
      label.after(right);
    }
    // Inline overrides beat site rules that set a tall min-height on .headline.
    hl.style.setProperty('min-height', '0', 'important');
    hl.style.setProperty('height', 'fit-content', 'important');
    hl.style.setProperty('padding-top', '8px', 'important');
    hl.style.setProperty('padding-bottom', '8px', 'important');
    hl.style.setProperty('line-height', '0', 'important');
    hl.style.setProperty('overflow', 'hidden', 'important');
    hl.style.setProperty('justify-content', 'center', 'important');
    hl.style.setProperty('position', 'relative', 'important');
    hl.style.setProperty('border', 'none', 'important');
    hl.style.setProperty('border-bottom', '1px solid #4a5563', 'important');
    hl.style.setProperty('box-shadow', '0 1px 0 rgb(0 0 0 / 35%)', 'important');
    hl.style.removeProperty('gap');
  }

  function hideNativeHeadline() {
    unwrapTitleRow();
    const rail = qs(document, `.${NS}-side-title`);
    if (rail) {
      const host = listBoxEl() || qs(document, '#list_videos_my_favourite_videos') || document.body;
      while (rail.firstChild) host.insertBefore(rail.firstChild, host.firstChild);
      rail.remove();
    }
    if (isPlaylistDetailPage()) {
      placePlaylistNativeTitle();
      return;
    }
    qs(document, `.${NS}-playlist-page-title`)?.remove();
    const headline = findFavoritesHeadline();
    if (!headline) return;
    // Snapshot headline text BEFORE the brand chip is inserted (textContent would
    // then include "My Favorites : N videos" and poison re-parses).
    if (!headline.dataset.hxyruleSiteNativeTitleText) {
      const t = String(headline.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (t) headline.dataset.hxyruleSiteNativeTitleText = t;
    }
    lockSiteNativeVideoTotal(headline, headline.dataset.hxyruleSiteNativeTitleText);
    headline.classList.remove(`${NS}-playlist-native-title`);
    headline.classList.add(`${NS}-hide-native-headline`);
    headline.style.removeProperty('display');
  }

  function favoritesListEl() {
    const playlist = isPlaylistDetailPage();
    const box = listBoxEl() || (playlist ? null : document);
    // Never return the compact host — it also has class "thumbs" and sits
    // before the native list, which broke findNativeCardEl / stack anchoring.
    // Note: data-hxyrule-compact-host marks the *native* list while Compact is
    // active (anchor for the host). Do not filter it out or Compact re-entry
    // and removeCompactDom cannot find the container on playlist pages.
    const isFavItems = (el) =>
      el && /favourites?|favorite/i.test(String(el.id || ''));
    const isCompact = (el) => el?.classList?.contains(`${NS}-compact-thumbs`);

    if (playlist) {
      const scope = box || document;
      const byId =
        qs(scope, '[id^="list_videos"][id$="_items"]') ||
        qs(scope, '[id$="_items"]');
      if (byId && !isCompact(byId) && !isFavItems(byId)) return byId;
      const thumbs =
        qsa(scope, '.thumbs').find((el) => !isCompact(el)) ||
        (box
          ? null
          : qsa(document, '.thumbs').find(
              (el) => !isCompact(el) && !el.closest('#list_videos_my_favourite_videos'),
            ));
      return thumbs || null;
    }

    const scope = box || document;
    const byId =
      qs(scope, '#list_videos_my_favourite_videos_items') ||
      qs(scope, '[id^="list_videos"][id$="_items"]') ||
      qs(scope, '[id$="_items"]');
    if (byId && !isCompact(byId)) return byId;
    return qsa(scope, '.thumbs').find((el) => !isCompact(el)) || null;
  }

  function formatFavCount(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) return '';
    return Math.round(num).toLocaleString('en-US');
  }

  function formatPlaylistCountPart(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) return '? videos';
    return `${Math.round(num)} videos`;
  }

  /** Jump / collection chip: SHORT A : 2402 videos (no playlist id). */
  function formatPlaylistJumpLabel(name, _pid, total) {
    const n = String(name || '').trim() || 'Playlist';
    const num = Number(total);
    const count =
      Number.isFinite(num) && num >= 0 ? `${Math.round(num)} videos` : '? videos';
    return `${n} : ${count}`;
  }

  function isJunkPlaylistTitle(title) {
    const t = String(title || '').trim();
    if (!t) return true;
    return (
      /trending\s*search/i.test(t) ||
      /^(trending|search|searches|tags?|related|popular|recommended|suggested|hot|categories?)$/i.test(t)
    );
  }

  function extractPlaylistNameFromText(raw, pid) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const myPl = s.match(/my\s+playlist\s+(.+?)\s*\(/i);
    if (myPl) {
      const direct = cleanPlaylistTitleText(myPl[1], pid);
      if (direct && !isJunkPlaylistTitle(direct)) return direct;
    }
    const stripped = s
      .replace(/\bpage\s*\d+\b/gi, ' ')
      .replace(/\(\s*[\d,\s.]+\s*(videos?)?\s*\)/gi, ' ')
      .replace(/^my\s+playlist\s+/i, ' ')
      .replace(/\|\s*Rule34.*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanPlaylistTitleText(stripped, pid) || cleanPlaylistTitleText(s, pid) || '';
  }

  function detectPlaylistTitle() {
    const pid = currentPlaylistIdFromPath() || '';
    const native = qs(document, `.${NS}-playlist-native-title`);
    if (native?.dataset?.hxyrulePlaylistName) {
      const stored = String(native.dataset.hxyrulePlaylistName || '').trim();
      if (stored && !isJunkPlaylistTitle(stored)) return stored;
    }
    if (native?.dataset?.hxyruleOrigTitleText) {
      const fromOrig = extractPlaylistNameFromText(native.dataset.hxyruleOrigTitleText, pid);
      if (fromOrig && !isJunkPlaylistTitle(fromOrig) && fromOrig !== 'Playlist') return fromOrig;
    }
    const box = listBoxEl();
    const candidates = [];
    const push = (el) => {
      if (el && !candidates.includes(el)) candidates.push(el);
    };
    push(native);
    push(qs(document, `.${NS}-playlist-page-title`));
    if (box) {
      push(qs(box, `.${NS}-hide-native-headline`));
      push(qs(box, '.headline .title'));
      push(qs(box, '.headline'));
    }
    push(findFavoritesHeadline());
    // Native title may sit outside the list box.
    qsa(document, '.headline .title, .headline').forEach((el) => {
      const t = String(el.dataset?.hxyruleOrigTitleText || el.textContent || '');
      if (/my\s+playlist\b/i.test(t)) push(el);
    });
    let best = '';
    let bestScore = 0;
    for (const el of candidates) {
      if (!el) continue;
      const raw = String(el.dataset?.hxyruleOrigTitleText || el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw) continue;
      // Don't parse our own jump chip format as a title source.
      if (el.classList?.contains(`${NS}-favcount`)) continue;
      if (/^\s*.+\(\d+\)\s*[:]/.test(raw) && !/my\s+playlist/i.test(raw)) {
        const m = raw.match(/^(.+?)\s*\(\d+\)\s*[:]/);
        if (m) {
          const n = cleanPlaylistTitleText(m[1], pid);
          if (n && !isJunkPlaylistTitle(n) && n !== 'Playlist') {
            const score = 80 + Math.min(n.length, 48);
            if (score > bestScore) {
              bestScore = score;
              best = n;
            }
          }
        }
        continue;
      }
      const title = extractPlaylistNameFromText(raw, pid);
      if (isJunkPlaylistTitle(title) || title === 'Playlist') continue;
      const score = /my\s+playlist/i.test(raw)
        ? 100 + Math.min(title.length, 48)
        : playlistTitleScore(title, pid);
      if (score > bestScore) {
        bestScore = score;
        best = title;
      }
    }
    return bestScore >= 10 ? best : '';
  }

  /** Parse a stored non-negative int; never treat null/'' as 0 via Number(null). */
  function optionalNonNegInt(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  /** Native playlist title count only (stored / orig text) — never index or pager math. */
  function nativePlaylistTitleCount() {
    if (!isPlaylistDetailPage()) return null;
    const native = qs(document, `.${NS}-playlist-native-title`);
    const stored = optionalNonNegInt(native?.dataset?.hxyrulePlaylistVideoCount);
    if (stored != null) return stored;
    const fromOrig = parsePlaylistTotalFromText(native?.dataset?.hxyruleOrigTitleText);
    return fromOrig != null ? fromOrig : null;
  }

  /**
   * Push an authoritative list total into scanFavTotal / knownLibraryTotal
   * (+ playlist title datasets) so deletes / index refresh can lower labels
   * even when the site headline is still stale-high.
   */
  function applyKnownLibraryTotal(count) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) return;
    scanFavTotal = n;
    knownLibraryTotal = n;
    if (!isPlaylistDetailPage()) return;
    const native = qs(document, `.${NS}-playlist-native-title`);
    if (!native) return;
    // Lock website-native count before patching title datasets for Scan/index.
    lockSiteNativeVideoTotal(native);
    native.dataset.hxyrulePlaylistVideoCount = String(n);
    const raw = native.dataset.hxyruleOrigTitleText;
    if (!raw) return;
    let next = String(raw);
    if (/\d[\d\s,]*\s*videos?/i.test(next)) {
      next = next.replace(/(\d[\d\s,]*)\s*videos?/i, `${n} videos`);
    } else if (/\(\s*\d[\d\s,]*\s*(?:videos?)?\s*\)/i.test(next)) {
      next = next.replace(/\(\s*\d[\d\s,]*\s*(?:videos?)?\s*\)/i, `(${n})`);
    }
    native.dataset.hxyruleOrigTitleText = next;
  }

  /** Parse "… : N videos" from the on-page brand chip (what the user sees). */
  function parseDisplayedLibraryFromCount() {
    const el = qs(document, `.${NS}-favcount`);
    if (!el) return null;
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    const m =
      text.match(/:\s*([\d,]+)\s*videos?\b/i) ||
      text.match(/\b([\d,]+)\s*videos?\b/i);
    if (!m) return null;
    const n = Number(String(m[1]).replace(/,/g, ''));
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  /**
   * After confirmed Remove from list / Unfavorite: lower Scan totals and the
   * locked brand / Libraries "From:" count (siteNativeTitleCount is otherwise
   * never decreased by index math).
   * Never raise — a bloated list index must not push 134 → 139 on delete.
   */
  function lowerDisplayedLibraryTotal(count) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) return;
    const prev =
      optionalNonNegInt(siteNativeTitleCount) ??
      optionalNonNegInt(parseDisplayedLibraryFromCount()) ??
      optionalNonNegInt(brandChipVideoTotal());
    const capped = prev != null ? Math.min(n, prev) : n;
    siteNativeTitleCount = capped;
    const headline =
      qs(document, `.${NS}-playlist-native-title`) ||
      findFavoritesHeadline() ||
      qs(document, `.${NS}-hide-native-headline`);
    if (headline) headline.dataset.hxyruleSiteNativeVideoCount = String(capped);
    applyKnownLibraryTotal(capped);
  }

  /**
   * After confirmed Add to Favorites / Add to playlist: raise Scan totals and
   * the locked brand / Libraries "From:" count (siteNativeTitleCount is
   * otherwise sticky at the pre-add value).
   */
  function raiseDisplayedLibraryTotal(count) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0) return;
    const prev = optionalNonNegInt(siteNativeTitleCount);
    if (prev == null || n >= prev) {
      siteNativeTitleCount = n;
      const headline =
        qs(document, `.${NS}-playlist-native-title`) ||
        findFavoritesHeadline() ||
        qs(document, `.${NS}-hide-native-headline`);
      if (headline) headline.dataset.hxyruleSiteNativeVideoCount = String(n);
    }
    applyKnownLibraryTotal(n);
  }

  function currentDisplayedLibraryTotal() {
    return (
      optionalNonNegInt(siteNativeTitleCount) ??
      optionalNonNegInt(knownLibraryTotal) ??
      optionalNonNegInt(scanFavTotal) ??
      optionalNonNegInt(nativePlaylistTitleCount()) ??
      optionalNonNegInt(detectFavoritesTotal()) ??
      optionalNonNegInt(detectLibraryTotalFromDom())
    );
  }

  /** Keep an open Libraries modal "From:" line in sync with the brand chip. */
  function refreshOpenLibrarySwitcherFromLabel() {
    const modal = qs(document, `.${NS}-library-switcher`);
    if (!modal) return;
    const h3 = qs(modal, 'h3');
    if (!h3) return;
    const fromLabel = currentLibrarySwitcherFromLabel(librarySwitcherCache || []);
    h3.textContent = fromLabel ? `From: ${fromLabel}` : 'My libraries';
  }

  /**
   * After fav-add / playlist-add: bump or lower the current library total,
   * force-refresh cards + pagination when this view changed, and refresh
   * brand / Libraries "From:" counts.
   */
  async function refreshUiAfterLibraryMutateJob({
    addedToCurrent = 0,
    removedFromCurrent = 0,
    reloadList = false,
  } = {}) {
    const added = Math.max(0, Number(addedToCurrent) || 0);
    const removed = Math.max(0, Number(removedFromCurrent) || 0);
    // Prefer the on-page brand / From: number over index/known (can be stale-high).
    const before =
      optionalNonNegInt(parseDisplayedLibraryFromCount()) ??
      optionalNonNegInt(brandChipVideoTotal()) ??
      optionalNonNegInt(currentDisplayedLibraryTotal());
    if (before != null && (added > 0 || removed > 0)) {
      const next = Math.max(0, before + added - removed);
      if (next > before) raiseDisplayedLibraryTotal(next);
      else if (next < before) lowerDisplayedLibraryTotal(next);
      else {
        applyKnownLibraryTotal(next);
        updateFavCountBar();
      }
    }
    librarySwitcherCache = null;
    librarySwitcherCacheAt = 0;
    libraryCountPrefetchP = null;
    if (reloadList) {
      try {
        await reloadCurrentListPageForced();
      } catch (_) {
        /* ignore — counts / From: still update below */
      }
    }
    refreshScanLabelCounts();
    updateToolbarLabels();
    updateFavCountBar();
    refreshOpenLibrarySwitcherFromLabel();
    loadPlaylistsForLibrarySwitcher({ force: true })
      .then(() => {
        updateFavCountBar();
        refreshOpenLibrarySwitcherFromLabel();
      })
      .catch(() => {
        updateFavCountBar();
        refreshOpenLibrarySwitcherFromLabel();
      });
  }

  function listLooksLikePage1OnlyIndex(indexed) {
    const n = Number(indexed) || 0;
    if (n <= 0) return false;
    const per =
      (stablePerPage && stablePerPage > 0 ? stablePerPage : 0) ||
      Math.max(nativeListCardCount(), parseCards().length, 0);
    const maxP = playlistPaginationMax();
    return per > 0 && n <= per && maxP > 1;
  }

  /**
   * Full list index we trust for display totals. Reject only when the index
   * looks like a truncated page-1 crawl against a higher native/known total.
   * Do not compare against pager lower bounds — after deletes the site pager
   * often stays stale high while the patched index is correct.
   */
  function trustedIndexedTotal() {
    if (listIndexDirty) return null;
    const indexed = Number(favIndexCache?.videos?.length) || 0;
    if (indexed <= 0) return null;
    const ceiling = isPlaylistDetailPage()
      ? Number(nativePlaylistTitleCount()) ||
        Number(siteNativeTitleCount) ||
        0
      : Math.max(
          Number(siteNativeTitleCount) || 0,
          Number(knownLibraryTotal) || 0,
          Number(detectLibraryTotalFromDom()) || 0,
        );
    // Bloated/stale index above site truth — do not trust for display totals
    // (was able to flash 134 → 139 after a single delete).
    if (ceiling > 0 && indexed > ceiling) return null;
    if (
      ceiling > 0 &&
      indexed + Math.max(isPlaylistDetailPage() ? 3 : 12, Math.floor(ceiling * 0.02)) < ceiling &&
      listLooksLikePage1OnlyIndex(indexed)
    ) {
      return null;
    }
    return indexed;
  }

  /** DOM/title/pager signals for index drift — must not read back the index itself. */
  function liveLibraryTotalForDrift() {
    if (isPlaylistDetailPage()) {
      const title = Number(nativePlaylistTitleCount()) || 0;
      const maxP = playlistPaginationMax();
      const per =
        (stablePerPage && stablePerPage > 0 ? stablePerPage : 0) ||
        Math.max(nativeListCardCount(), parseCards().length, 1);
      const lower =
        maxP > 1 && per > 0 ? (maxP - 1) * per + 1 : Math.max(nativeListCardCount(), 0);
      return Math.max(title, lower) || 0;
    }
    // Favorites: headline only for drift (pager math is a poor thousands-scale signal).
    return (
      Number(detectLibraryTotalFromDom()) ||
      Number(knownLibraryTotal) ||
      0
    );
  }

  function updateFavCountBar() {
    const el = qs(document, `.${NS}-favcount`);
    if (!el) return;
    // Scan / index math may still track detectFavoritesTotal — brand chip must not.
    const scanTotal = detectFavoritesTotal();
    if (scanTotal != null && Number(scanTotal) >= 0) scanFavTotal = Number(scanTotal);
    // Same string as Libraries modal "From: …" (without the prefix).
    const fromLabel = currentLibrarySwitcherFromLabel(librarySwitcherCache || []);
    el.dataset.hxyruleCountSource = 'library-from';
    el.textContent =
      fromLabel || (isPlaylistDetailPage() ? 'Playlist' : 'My Favorites');
    if (isPlaylistDetailPage()) {
      const hl = qs(document, `.${NS}-playlist-native-title`);
      const label = hl && qs(hl, `.${NS}-playlist-title-label`);
      if (hl && label) syncPlaylistTitleDisplay(hl, label);
    }
    syncToolbarMiddleCollapsed();
  }

  function indexScopeKey() {
    if (isPlaylistDetailPage()) {
      const pid = currentPlaylistIdFromPath();
      return pid ? `playlist:${pid}` : 'playlist';
    }
    return 'favorites';
  }

  // Selection bag is per library entry: Favorites, or one playlist id.
  // Survives pagination and page refresh inside that entry; cleared when
  // switching Favorites ↔ playlist or playlist ↔ playlist.
  let selectionLibraryKey = null;

  function selectionRecord(items, updatedAt = Date.now()) {
    return {
      items: items || {},
      updatedAt,
      libraryKey: indexScopeKey(),
    };
  }

  /**
   * On boot / full reload: keep the persisted selection when it belongs to this
   * library entry. Clear only when the bag was saved under a different list.
   */
  async function adoptSelectionForCurrentLibrary() {
    selectionLibraryKey = indexScopeKey();
    selCollectCancel = false;
    selProgress = null;
    let sel = { items: {}, updatedAt: 0 };
    try {
      sel = await send('SELECTION_GET');
    } catch (_) {
      /* ignore */
    }
    const items = sel?.items && typeof sel.items === 'object' ? sel.items : {};
    const count = Object.keys(items).length;
    const storedKey =
      sel?.libraryKey != null && String(sel.libraryKey).trim()
        ? String(sel.libraryKey)
        : null;
    if (count > 0 && storedKey != null && storedKey !== selectionLibraryKey) {
      try {
        await send('SELECTION_CLEAR');
      } catch (_) {
        /* ignore */
      }
      try {
        clearAllNativeSelectionOnPage();
      } catch (_) {
        /* ignore */
      }
      return;
    }
    // Legacy bags (no libraryKey) or same-list bags: keep and stamp scope.
    if (count > 0 && storedKey == null) {
      try {
        await send('SELECTION_SET', {
          selection: selectionRecord(items, Number(sel.updatedAt) || Date.now()),
        });
      } catch (_) {
        /* ignore */
      }
    }
  }

  async function clearSelectionIfLibraryChanged() {
    const key = indexScopeKey();
    if (selectionLibraryKey != null && selectionLibraryKey !== key) {
      selectionLibraryKey = key;
      selCollectCancel = true;
      selProgress = null;
      try {
        await send('SELECTION_CLEAR');
      } catch (_) {
        /* ignore */
      }
      try {
        clearAllNativeSelectionOnPage();
      } catch (_) {
        /* ignore */
      }
      // Collection chip labels flip meaning across Favorites ↔ playlist; load
      // that library entry's own remembered Match / View / Select state.
      myFavIdSet = null;
      listIndexDirty = false; // dirty flag is per current list scope
      lastIndexStats = null; // page (a/b) is per list — do not leak Favorites 10/10 onto a playlist
      knownLibraryTotal = null;
      scanFavTotal = null;
      scanMatched = null;
      siteNativeTitleSnapshot = '';
      siteNativeTitleCount = null;
      try {
        const t = String(document.title || '').trim();
        if (t) document.documentElement.dataset.hxyruleBootTitle = t;
      } catch (_) {
        /* ignore */
      }
      invalidatePlaylistMembershipCache();
      await loadFavIndexCache();
      const seeded = Number(favIndexCache?.videos?.length) || 0;
      if (seeded > 0) applyKnownLibraryTotal(seeded);
      // Re-bind brand count from Libraries list source / DOM for the new entry.
      if (librarySwitcherCache?.length) applySitePlaylistCountToBrand(librarySwitcherCache);
      else {
        libraryCountPrefetchP = null;
        ensureLibraryCountPrefetch({ force: false });
      }
      scheduleBrandChipCountRefresh();
      updateFavCountBar();
      refreshScanLabelCounts();
      await loadToolbarFilters();
      await restoreToolbarView();
      await refreshSelectionCount({});
      return true;
    }
    if (selectionLibraryKey == null) selectionLibraryKey = key;
    return false;
  }

  async function loadFavIndexCache() {
    try {
      favIndexCache = await send('FAV_INDEX_GET', { scope: indexScopeKey() });
    } catch (_) {
      favIndexCache = { builtAt: 0, favTotal: 0, videos: [] };
    }
    // Older builds stored Number(null)===0 for missing durations; treat 0 as unknown.
    if (Array.isArray(favIndexCache?.videos)) {
      favIndexCache = {
        ...favIndexCache,
        videos: favIndexCache.videos.map((v) => {
          const d = coerceDurationSec(v?.durationSec);
          return { ...v, durationSec: d === 0 ? null : d };
        }),
      };
    }
    updateFilterBarLabels();
    return favIndexCache;
  }

  async function fetchListPage(page) {
    if (isPlaylistDetailPage()) {
      const pid = currentPlaylistIdFromPath();
      if (!pid) throw new Error('playlist id missing');
      const blockId = playlistBlockId();
      const fromKey = playlistFromKey();
      try {
        return await fetchPlaylistPageInContent(page);
      } catch (contentErr) {
        try {
          return await send('FETCH_PLAYLIST_PAGE', {
            playlistId: pid,
            page,
            blockId,
            fromKey,
          });
        } catch (bgErr) {
          throw new Error(contentErr.message || bgErr.message || String(contentErr));
        }
      }
    }
    return await send('FETCH_FAVORITES_PAGE', { page });
  }

  /** Nav rail: Pages · Jump (same chrome as Match / View / Select). */
  function ensureJumpRow() {
    let row = qs(document, `.${NS}-jumprow`);
    if (!row) {
      row = document.createElement('div');
      row.className = `${NS}-rail ${NS}-rail-nav ${NS}-jumprow`;
      row.dataset.hxyrule = '1';
      row.setAttribute('aria-label', 'Jump pages');
    } else {
      row.classList.add(`${NS}-rail`, `${NS}-rail-nav`, `${NS}-jumprow`);
      row.setAttribute('aria-label', 'Jump pages');
    }
    const stack = ensureControlStack();
    if (row.parentElement !== stack) stack.appendChild(row);
    return row;
  }

  let statusFlash = '';
  let statusFlashIsError = false;
  let statusFlashTimer = null;
  let statusLive = 'Ready';
  let offpageStatusTimer = null;
  const STATUS_LOG_LIMIT = 200;
  const statusLog = [];
  let taskQueueState = { items: [], paused: false };
  let taskQueuePollTimer = null;
  let taskQueueDrag = null;

  function formatStatusTime(date = new Date()) {
    return date.toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function pushStatusLog(text, isError = false) {
    const last = statusLog[statusLog.length - 1];
    if (last && last.text === text) {
      last.repeats = (last.repeats || 1) + 1;
      last.at = formatStatusTime();
      last.isError = isError;
      renderStatusLog();
      return;
    }
    statusLog.push({ at: formatStatusTime(), text, isError, repeats: 1 });
    if (statusLog.length > STATUS_LOG_LIMIT) {
      statusLog.splice(0, statusLog.length - STATUS_LOG_LIMIT);
    }
    renderStatusLog();
  }

  function renderStatusLog() {
    const logEl = qs(document, `[data-role="status-log"]`);
    if (!logEl) return;
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    logEl.replaceChildren();
    if (!statusLog.length) {
      logEl.textContent = 'No status messages yet.';
      return;
    }
    statusLog.forEach((entry) => {
      const line = document.createElement('div');
      line.className = entry.isError ? `${NS}-status-line is-error` : `${NS}-status-line`;
      const stamp = document.createElement('span');
      stamp.className = `${NS}-status-time`;
      stamp.textContent = entry.at;
      const body = document.createElement('span');
      body.className = `${NS}-status-body`;
      body.textContent = entry.repeats > 1 ? `${entry.text}  ×${entry.repeats}` : entry.text;
      line.append(stamp, body);
      logEl.append(line);
    });
    if (nearBottom) logEl.scrollTop = logEl.scrollHeight;
  }

  function formatStatusLogText() {
    if (!statusLog.length) return 'No status messages yet.';
    return statusLog
      .map((entry) => {
        const body = entry.repeats > 1 ? `${entry.text}  ×${entry.repeats}` : entry.text;
        return `${entry.at}  ${body}`;
      })
      .join('\n');
  }

  async function copyStatusLog(btn) {
    const text = formatStatusLogText();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (_) {
        ok = false;
      }
    }
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      // Do not disable — that drops focus out of the dialog and breaks Esc.
      const dialog = btn.closest('dialog');
      const closeBtn = dialog && qs(dialog, 'button[value="close"], button[value="cancel"]');
      requestAnimationFrame(() => {
        (closeBtn || dialog)?.focus?.();
      });
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    }
  }

  function ensureStatusLogDialog() {
    let dialog = qs(document, `.${NS}-status-dialog`);
    if (dialog && (!qs(dialog, '[data-act="copy-status-log"]') || !qs(dialog, 'button[value="cancel"]'))) {
      dialog.remove();
      dialog = null;
    }
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = `${NS}-status-dialog`;
    dialog.dataset.hxyrule = '1';
    dialog.innerHTML = `
      <form method="dialog">
        <div class="${NS}-dialog-title">Status log</div>
        <pre class="${NS}-status-log" data-role="status-log"></pre>
        <div class="${NS}-dialog-actions">
          <button type="button" class="${NS}-btn" data-act="copy-status-log">Copy</button>
          <button type="button" class="${NS}-btn" data-act="clear-status-log">Clear</button>
          <button type="submit" class="${NS}-btn" value="cancel">Close</button>
        </div>
      </form>
    `;
    dialog.addEventListener('click', (e) => {
      // Modal <dialog>: clicks on ::backdrop retarget to the dialog itself.
      if (e.target === dialog) {
        dialog.close();
        return;
      }
      const clearBtn = e.target.closest('[data-act="clear-status-log"]');
      if (clearBtn && dialog.contains(clearBtn)) {
        e.preventDefault();
        statusLog.length = 0;
        renderStatusLog();
        return;
      }
      const copyBtn = e.target.closest('[data-act="copy-status-log"]');
      if (copyBtn && dialog.contains(copyBtn)) {
        e.preventDefault();
        copyStatusLog(copyBtn);
      }
    });
    bindStatusLogEsc(dialog);
    document.body.appendChild(dialog);
    return dialog;
  }

  function bindStatusLogEsc(dialog) {
    if (!dialog || dialog.dataset.escBound === '1') return;
    dialog.dataset.escBound = '1';
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    // Document capture: Esc still works if focus left the dialog (e.g. after Copy).
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !dialog.open) return;
        e.preventDefault();
        e.stopPropagation();
        dialog.close();
      },
      true,
    );
  }

  function openStatusLog() {
    const dialog = ensureStatusLogDialog();
    bindStatusLogEsc(dialog);
    renderStatusLog();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    const logEl = qs(dialog, '[data-role="status-log"]');
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
    requestAnimationFrame(() => {
      const closeBtn = qs(dialog, 'button[value="close"], button[value="cancel"]');
      (closeBtn || dialog).focus?.();
    });
  }

  /**
   * Compact top-right status chip for video / other non-library pages.
   * Does not mount the Favorites toolbar; click opens the full status log.
   */
  function ensureOffpageStatusToast() {
    let el = qs(document, `.${NS}-offpage-status`);
    if (el) return el;
    el = document.createElement('div');
    el.className = `${NS}-msgbar ${NS}-error ${NS}-offpage-status`;
    el.dataset.role = 'offpage-status';
    el.dataset.hxyrule = '1';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Status');
    el.hidden = true;
    const inner = document.createElement('span');
    inner.className = `${NS}-message-text`;
    el.appendChild(inner);
    bindStatusLogUi(el);
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function hideOffpageStatusToast() {
    if (offpageStatusTimer) {
      clearTimeout(offpageStatusTimer);
      offpageStatusTimer = null;
    }
    const el = qs(document, `.${NS}-offpage-status`);
    if (el) el.hidden = true;
  }

  function showOffpageStatusToast(text, isError = false) {
    const msg = String(text || '').trim();
    if (!msg || msg === 'Ready') {
      hideOffpageStatusToast();
      return;
    }
    const el = ensureOffpageStatusToast();
    if (!document.body?.contains(el)) {
      (document.body || document.documentElement).appendChild(el);
    }
    let inner = qs(el, `.${NS}-message-text`);
    if (!inner) {
      inner = document.createElement('span');
      inner.className = `${NS}-message-text`;
      el.replaceChildren(inner);
    }
    inner.textContent = msg;
    el.classList.toggle('is-error', !!isError);
    el.hidden = false;
    el.removeAttribute('hidden');
    if (offpageStatusTimer) clearTimeout(offpageStatusTimer);
    offpageStatusTimer = setTimeout(() => {
      offpageStatusTimer = null;
      el.hidden = true;
    }, 3200);
  }

  function taskQueueItemFullTitle(item) {
    const title = String(item?.title || item?.videoId || 'Untitled').trim() || 'Untitled';
    return title;
  }

  function taskQueueItemLabel(item) {
    return [...taskQueueItemFullTitle(item)].slice(0, 15).join('');
  }

  function taskQueueStatusLabel(item) {
    const st = String(item?.status || '');
    if (st === 'downloading') return 'Downloading';
    if (st === 'paused') return 'Paused';
    if (st === 'waiting') {
      const n = Number(item?.retryCount || 0);
      return n > 0 ? `Retry ${n}` : 'Waiting';
    }
    if (st === 'failed') return 'Failed';
    if (st === 'pending') return 'Queued';
    return st || 'Queued';
  }

  function selectedTaskQueueIds(dialog) {
    const ids = new Set();
    dialog?.querySelectorAll?.(`.${NS}-tasks-item-select.is-selected`).forEach((el) => {
      const id = el.dataset.id || '';
      if (id) ids.add(id);
    });
    return ids;
  }

  function setTaskQueueItemsSelected(dialog, on) {
    if (!dialog) return;
    dialog.querySelectorAll(`.${NS}-tasks-item-select`).forEach((select) => {
      select.classList.toggle('is-selected', on);
      select.setAttribute('aria-pressed', on ? 'true' : 'false');
      select.closest(`.${NS}-tasks-item`)?.classList.toggle('is-selected', on);
    });
    updateTaskQueueActionButtons(dialog);
  }

  function updateTaskQueueActionButtons(dialog = qs(document, `.${NS}-tasks-dialog`)) {
    if (!dialog) return;
    const selectedIds = selectedTaskQueueIds(dialog);
    const selectedCount = selectedIds.size;
    const deleteBtn = qs(dialog, '[data-act="tasks-delete"]');
    if (deleteBtn) deleteBtn.disabled = selectedCount === 0;
    const selectAllBtn = qs(dialog, '[data-act="tasks-select-all"]');
    if (selectAllBtn) selectAllBtn.disabled = !(taskQueueState.items?.length);
    const clearBtn = qs(dialog, '[data-act="tasks-clear-selection"]');
    if (clearBtn) clearBtn.disabled = selectedCount === 0;
    const byId = new Map((taskQueueState.items || []).map((item) => [String(item.id), item]));
    let selectedDownloading = 0;
    let selectedPaused = 0;
    selectedIds.forEach((id) => {
      const st = String(byId.get(id)?.status || '');
      if (st === 'downloading') selectedDownloading += 1;
      if (st === 'paused') selectedPaused += 1;
    });
    const pauseBtn = qs(dialog, '[data-act="tasks-pause"]');
    const resumeBtn = qs(dialog, '[data-act="tasks-resume"]');
    // Pause/Resume only apply to the selection; queued rows keep Pause disabled.
    if (pauseBtn) pauseBtn.disabled = selectedDownloading === 0;
    if (resumeBtn) resumeBtn.disabled = selectedPaused === 0;
  }

  function renderTaskQueueList(selectedIds = null) {
    const dialog = qs(document, `.${NS}-tasks-dialog`);
    if (!dialog) return;
    const list = qs(dialog, '[data-role="download-queue-list"]');
    const countEl = qs(dialog, '[data-role="download-queue-count"]');
    if (!list) return;
    const keep = selectedIds || selectedTaskQueueIds(dialog);
    const items = taskQueueState.items || [];
    if (countEl) countEl.textContent = String(items.length);
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = `${NS}-tasks-empty`;
      empty.textContent = 'Queue empty';
      list.appendChild(empty);
      return;
    }
    const liveCount = items.filter((item) => {
      const st = String(item.status || '');
      return st === 'downloading' || st === 'paused';
    }).length;
    items.forEach((item) => {
      const li = document.createElement('li');
      const st = String(item.status || '');
      const isLive = st === 'downloading' || st === 'paused';
      const id = String(item.id);
      const fullTitle = taskQueueItemFullTitle(item);
      const selected = keep.has(id);
      li.className = `${NS}-tasks-item${isLive ? ' is-live' : ''}${selected ? ' is-selected' : ''}`;
      li.dataset.id = id;
      // Pending/waiting/failed reorder; downloading + paused stay pinned at the top.
      li.draggable = !isLive && items.length > 1 && items.length > liveCount;
      const select = document.createElement('div');
      select.className = `${NS}-tasks-item-select${selected ? ' is-selected' : ''}`;
      select.dataset.id = id;
      select.setAttribute('role', 'button');
      select.tabIndex = 0;
      select.setAttribute('aria-pressed', selected ? 'true' : 'false');
      select.setAttribute('aria-label', `Select ${fullTitle}`);
      const meta = document.createElement('span');
      meta.className = `${NS}-tasks-item-meta`;
      if (st === 'downloading') meta.classList.add('is-live-status');
      if (st === 'paused') meta.classList.add('is-paused-status');
      if (st === 'failed') meta.classList.add('is-failed-status');
      meta.textContent = taskQueueStatusLabel(item);
      const title = document.createElement('span');
      title.className = `${NS}-tasks-item-title`;
      title.textContent = taskQueueItemLabel(item);
      title.title = fullTitle;
      select.append(meta, title);
      li.append(select);
      list.appendChild(li);
    });
  }

  function renderTaskQueues() {
    const dialog = qs(document, `.${NS}-tasks-dialog`);
    const keep = selectedTaskQueueIds(dialog);
    renderTaskQueueList(keep);
    updateTaskQueueActionButtons(dialog);
  }

  async function refreshTaskQueues() {
    const dialog = qs(document, `.${NS}-tasks-dialog`);
    if (!dialog?.open) return;
    // Replacing the list mid-drag aborts HTML5 DnD.
    if (taskQueueDrag) return;
    try {
      const listed = await send('QUEUE_LIST');
      if (taskQueueDrag || !dialog.open) return;
      taskQueueState = {
        items: Array.isArray(listed?.items) ? listed.items : [],
        paused: !!listed?.paused,
        hasPausedItems: !!listed?.hasPausedItems,
        hasDownloading: !!listed?.hasDownloading,
      };
      renderTaskQueues();
    } catch (error) {
      setError(error?.message || String(error));
    }
  }

  function setTaskQueuePolling(on) {
    if (taskQueuePollTimer) {
      clearInterval(taskQueuePollTimer);
      taskQueuePollTimer = null;
    }
    if (!on) return;
    taskQueuePollTimer = setInterval(() => {
      refreshTaskQueues().catch(() => {});
    }, 1200);
  }

  async function removeSelectedTaskQueueItems() {
    const dialog = qs(document, `.${NS}-tasks-dialog`);
    const selected = [...(dialog?.querySelectorAll?.(`.${NS}-tasks-item-select.is-selected`) || [])]
      .map((el) => el.dataset.id)
      .filter(Boolean);
    if (!selected.length) return;
    const byId = new Map((taskQueueState.items || []).map((i) => [String(i.id), i]));
    let lastStatus = null;
    try {
      for (const id of selected) {
        const snap = byId.get(String(id));
        lastStatus = await send('QUEUE_REMOVE', {
          id: Number(id),
          chromeDownloadId: Number(snap?.chromeDownloadId || 0),
        });
        const title = snap ? taskQueueItemFullTitle(snap) : id;
        // Log cancel, then immediately show shrunk Download (a/b) on chip + button.
        setFlash(`Cancelled · ${title}`);
        if (statusFlashTimer) {
          clearTimeout(statusFlashTimer);
          statusFlashTimer = null;
        }
        statusFlash = '';
        applyDownloadProgress(lastStatus);
      }
    } finally {
      await refreshTaskQueues().catch(() => {});
      await refreshQueue().catch(() => {});
    }
  }

  async function pauseTaskQueue() {
    const dialog = qs(document, `.${NS}-tasks-dialog`);
    const byId = new Map((taskQueueState.items || []).map((item) => [String(item.id), item]));
    const ids = [...selectedTaskQueueIds(dialog)]
      .filter((id) => String(byId.get(id)?.status || '') === 'downloading')
      .map((id) => Number(id))
      .filter((id) => id > 0);
    if (!ids.length) return;
    await send('QUEUE_PAUSE', { ids });
    if (ids.length === 1) {
      const snap = byId.get(String(ids[0]));
      setFlash(snap ? `Paused · ${taskQueueItemFullTitle(snap)}` : 'Download paused');
    } else {
      setFlash(`Paused ${ids.length} downloads`);
    }
    await refreshTaskQueues();
    await refreshQueue();
  }

  async function resumeTaskQueue() {
    const dialog = qs(document, `.${NS}-tasks-dialog`);
    const byId = new Map((taskQueueState.items || []).map((item) => [String(item.id), item]));
    const ids = [...selectedTaskQueueIds(dialog)]
      .filter((id) => String(byId.get(id)?.status || '') === 'paused')
      .map((id) => Number(id))
      .filter((id) => id > 0);
    if (!ids.length) return;
    await send('QUEUE_RESUME', { ids });
    if (ids.length === 1) {
      const snap = byId.get(String(ids[0]));
      setFlash(snap ? `Resumed · ${taskQueueItemFullTitle(snap)}` : 'Download resumed');
    } else {
      setFlash(`Resumed ${ids.length} downloads`);
    }
    await refreshTaskQueues();
    await refreshQueue();
  }

  async function commitTaskQueueOrder(ids) {
    await send('QUEUE_REORDER', { ids: ids.map((x) => Number(x)) });
    await refreshTaskQueues();
  }

  function clearTaskQueueDropMarks(list) {
    list?.querySelectorAll?.('.is-drop-before, .is-drop-after, .is-dragging').forEach((el) => {
      el.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging');
    });
    list?.classList?.remove('is-drop-end');
  }

  function taskQueueInsertIndex(list, clientY, dragRow) {
    const rows = [...list.querySelectorAll(`.${NS}-tasks-item`)];
    if (!rows.length) return 0;
    let insertAt = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) {
        insertAt = i;
        break;
      }
    }
    const liveCount = rows.filter((r) => r.classList.contains('is-live')).length;
    if (liveCount && dragRow && !dragRow.classList.contains('is-live') && insertAt < liveCount) {
      insertAt = liveCount;
    }
    return insertAt;
  }

  function paintTaskQueueDropMarks(list, insertAt, dragRow) {
    const rows = [...list.querySelectorAll(`.${NS}-tasks-item`)];
    rows.forEach((row) => row.classList.remove('is-drop-before', 'is-drop-after'));
    list.classList.remove('is-drop-end');
    if (!rows.length) return;
    const from = rows.indexOf(dragRow);
    if (from >= 0 && (insertAt === from || insertAt === from + 1)) return;
    if (insertAt >= rows.length) {
      rows[rows.length - 1].classList.add('is-drop-after');
      list.classList.add('is-drop-end');
      return;
    }
    rows[insertAt].classList.add('is-drop-before');
  }

  function bindTaskQueueDrag(list) {
    if (!list || list.dataset.hxyDragBound) return;
    list.dataset.hxyDragBound = '1';
    list.addEventListener('dragstart', (event) => {
      const row = event.target.closest?.(`.${NS}-tasks-item`);
      if (!row || !list.contains(row) || !row.draggable) {
        event.preventDefault();
        return;
      }
      taskQueueDrag = {
        id: row.dataset.id,
        row,
        insertAt: -1,
        moved: false,
      };
      row.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData('text/plain', row.dataset.id || '');
      } catch {
        /* ignore */
      }
      try {
        event.dataTransfer.setDragImage(row, 24, 16);
      } catch {
        /* ignore */
      }
    });
    list.addEventListener('dragend', () => {
      const moved = !!taskQueueDrag?.moved;
      clearTaskQueueDropMarks(list);
      taskQueueDrag = null;
      if (moved) {
        list.dataset.hxySkipSelectClick = '1';
        setTimeout(() => {
          delete list.dataset.hxySkipSelectClick;
        }, 0);
      }
      refreshTaskQueues().catch(() => {});
    });
    list.addEventListener('dragover', (event) => {
      if (!taskQueueDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      taskQueueDrag.moved = true;
      const insertAt = taskQueueInsertIndex(list, event.clientY, taskQueueDrag.row);
      taskQueueDrag.insertAt = insertAt;
      paintTaskQueueDropMarks(list, insertAt, taskQueueDrag.row);
    });
    list.addEventListener('dragleave', (event) => {
      if (!taskQueueDrag) return;
      if (list.contains(event.relatedTarget)) return;
      list.querySelectorAll('.is-drop-before, .is-drop-after').forEach((el) => {
        el.classList.remove('is-drop-before', 'is-drop-after');
      });
      list.classList.remove('is-drop-end');
    });
    list.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!taskQueueDrag) return;
      const rows = [...list.querySelectorAll(`.${NS}-tasks-item`)];
      const from = rows.indexOf(taskQueueDrag.row);
      let insertAt =
        taskQueueDrag.insertAt >= 0
          ? taskQueueDrag.insertAt
          : taskQueueInsertIndex(list, event.clientY, taskQueueDrag.row);
      clearTaskQueueDropMarks(list);
      list.dataset.hxySkipSelectClick = '1';
      setTimeout(() => {
        delete list.dataset.hxySkipSelectClick;
      }, 0);
      if (from < 0 || taskQueueDrag.row.classList.contains('is-live')) {
        taskQueueDrag = null;
        return;
      }
      const liveCount = rows.filter((r) => r.classList.contains('is-live')).length;
      if (insertAt < liveCount) insertAt = liveCount;
      if (insertAt === from || insertAt === from + 1) {
        taskQueueDrag = null;
        return;
      }
      const ids = rows.map((r) => r.dataset.id);
      const [moved] = ids.splice(from, 1);
      if (insertAt > from) insertAt -= 1;
      ids.splice(insertAt, 0, moved);
      const liveIds = rows.filter((r) => r.classList.contains('is-live')).map((r) => r.dataset.id);
      if (liveIds.length) {
        const rest = ids.filter((id) => !liveIds.includes(id));
        ids.splice(0, ids.length, ...liveIds, ...rest);
      }
      taskQueueDrag = null;
      commitTaskQueueOrder(ids).catch((err) => setError(err?.message || String(err)));
    });
  }

  function ensureTaskQueueDialog() {
    let dialog = qs(document, `.${NS}-tasks-dialog`);
    if (
      dialog &&
      (!qs(dialog, '[data-act="tasks-delete"]') ||
        !qs(dialog, '[data-act="tasks-clear-selection"]') ||
        !qs(dialog, 'button[value="cancel"]'))
    ) {
      dialog.remove();
      dialog = null;
    }
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = `${NS}-tasks-dialog`;
    dialog.dataset.hxyrule = '1';
    dialog.innerHTML = `
      <form method="dialog" class="${NS}-tasks-form">
        <div class="${NS}-dialog-title">Task queue</div>
        <section class="${NS}-tasks-pane" aria-label="Download queue">
          <header class="${NS}-tasks-pane-head">
            <strong>Download</strong>
            <div class="${NS}-tasks-pane-tools">
              <button type="button" class="${NS}-btn ${NS}-tasks-select-all" data-act="tasks-select-all" disabled>Select all</button>
              <button type="button" class="${NS}-btn ${NS}-tasks-select-all" data-act="tasks-clear-selection" disabled>Clear</button>
              <span class="${NS}-tasks-count" data-role="download-queue-count">0</span>
            </div>
          </header>
          <ul class="${NS}-tasks-list" data-role="download-queue-list"></ul>
        </section>
        <div class="${NS}-dialog-actions">
          <button type="button" class="${NS}-btn" data-act="tasks-pause" disabled>Pause</button>
          <button type="button" class="${NS}-btn" data-act="tasks-resume" disabled>Resume</button>
          <button type="button" class="${NS}-btn ${NS}-btn--danger" data-act="tasks-delete" disabled>Delete</button>
          <button type="submit" class="${NS}-btn" value="cancel">Close</button>
        </div>
      </form>
    `;
    bindTaskQueueDialog(dialog);
    bindStatusLogEsc(dialog);
    document.body.appendChild(dialog);
    return dialog;
  }

  function bindTaskQueueDialog(dialog) {
    if (!dialog || dialog.dataset.hxyTasksBound) return;
    dialog.dataset.hxyTasksBound = '1';
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        dialog.close();
        return;
      }
      const select = event.target.closest?.(`.${NS}-tasks-item-select`);
      if (select && dialog.contains(select)) {
        event.preventDefault();
        const list = select.closest?.(`.${NS}-tasks-list`);
        if (list?.dataset?.hxySkipSelectClick) return;
        const on = !select.classList.contains('is-selected');
        select.classList.toggle('is-selected', on);
        select.setAttribute('aria-pressed', on ? 'true' : 'false');
        select.closest(`.${NS}-tasks-item`)?.classList.toggle('is-selected', on);
        updateTaskQueueActionButtons(dialog);
        return;
      }
      const actionBtn = event.target.closest?.('[data-act]');
      if (!actionBtn || !dialog.contains(actionBtn)) return;
      const act = actionBtn.dataset.act;
      if (act === 'tasks-delete') {
        event.preventDefault();
        removeSelectedTaskQueueItems().catch((err) => setError(err?.message || String(err)));
      } else if (act === 'tasks-select-all') {
        event.preventDefault();
        setTaskQueueItemsSelected(dialog, true);
      } else if (act === 'tasks-clear-selection') {
        event.preventDefault();
        setTaskQueueItemsSelected(dialog, false);
      } else if (act === 'tasks-pause') {
        event.preventDefault();
        pauseTaskQueue().catch((err) => setError(err?.message || String(err)));
      } else if (act === 'tasks-resume') {
        event.preventDefault();
        resumeTaskQueue().catch((err) => setError(err?.message || String(err)));
      }
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const select = event.target.closest?.(`.${NS}-tasks-item-select`);
      if (!select || !dialog.contains(select)) return;
      event.preventDefault();
      const on = !select.classList.contains('is-selected');
      select.classList.toggle('is-selected', on);
      select.setAttribute('aria-pressed', on ? 'true' : 'false');
      select.closest(`.${NS}-tasks-item`)?.classList.toggle('is-selected', on);
      updateTaskQueueActionButtons(dialog);
    });
    dialog.addEventListener('close', () => {
      taskQueueDrag = null;
      setTaskQueuePolling(false);
    });
    bindTaskQueueDrag(qs(dialog, '[data-role="download-queue-list"]'));
  }

  function openTaskQueueDialog() {
    const dialog = ensureTaskQueueDialog();
    bindTaskQueueDialog(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    setTaskQueuePolling(true);
    refreshTaskQueues().catch((err) => setError(err?.message || String(err)));
    requestAnimationFrame(() => {
      const closeBtn = qs(dialog, 'button[value="close"], button[value="cancel"]');
      (closeBtn || dialog).focus?.();
    });
  }

  function bindStatusLogUi(el) {
    if (!el || el.dataset.logBound === '1') return;
    el.dataset.logBound = '1';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = 'Click to open status log';
    el.setAttribute('aria-label', 'Status log');
    const openLog = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openStatusLog();
    };
    el.addEventListener('click', openLog);
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      openLog(event);
    });
    el.addEventListener(
      'wheel',
      (event) => {
        if (el.scrollWidth <= el.clientWidth + 1) return;
        const delta =
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!delta) return;
        const max = el.scrollWidth - el.clientWidth;
        if ((delta < 0 && el.scrollLeft <= 0) || (delta > 0 && el.scrollLeft >= max)) return;
        event.preventDefault();
        el.scrollLeft = Math.min(max, Math.max(0, el.scrollLeft + delta));
      },
      { passive: false },
    );
  }

  function paintStatus() {
    const text = (statusFlash || statusLive || 'Ready').trim() || 'Ready';
    const isError = !!statusFlash && statusFlashIsError;
    // Video / other pages: never mount the Favorites toolbar just to show
    // status (e.g. sex auto-tag after heart). Top-right chip only.
    if (!isFavoritesPage() && !isPlaylistDetailPage()) {
      if (text === 'Ready') {
        hideOffpageStatusToast();
        return;
      }
      pushStatusLog(text, isError);
      showOffpageStatusToast(text, isError);
      return;
    }
    hideOffpageStatusToast();
    const el = ensureStatusBar();
    el.hidden = false;
    el.removeAttribute('hidden');
    el.classList.remove('is-scroll-test');
    let inner = qs(el, `.${NS}-message-text`);
    if (!inner) {
      inner = document.createElement('span');
      inner.className = `${NS}-message-text`;
      el.replaceChildren(inner);
    }
    bindStatusLogUi(el);
    // Same status text (e.g. queue polling): skip DOM rewrite so a manual
    // left-scroll is not yanked back to the end on every tick.
    if (inner.textContent === text) {
      el.classList.toggle('is-error', isError);
      return;
    }
    pushStatusLog(text, isError);
    const prevMax = Math.max(0, el.scrollWidth - el.clientWidth);
    const stickToEnd = prevMax <= 0 || el.scrollLeft >= prevMax - 2;
    const prevScrollLeft = el.scrollLeft;
    inner.textContent = text;
    el.classList.toggle('is-error', isError);
    requestAnimationFrame(() => {
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      if (max <= 0) {
        el.scrollLeft = 0;
        return;
      }
      el.scrollLeft = stickToEnd ? max : Math.min(prevScrollLeft, max);
    });
  }

  function setLiveStatus(text) {
    const next = String(text || '').trim() || 'Ready';
    const changed = next !== statusLive;
    statusLive = next;
    if (statusFlash) {
      // Chip still shows a flash; still record queue transitions in the log.
      if (changed) {
        pushStatusLog(statusLive, false);
        if (
          statusLive !== 'Ready' &&
          !isFavoritesPage() &&
          !isPlaylistDetailPage()
        ) {
          showOffpageStatusToast(statusLive, false);
        }
      }
      return;
    }
    paintStatus();
  }

  /** Status chip on the command rail (flash message or live queue state). */
  function ensureStatusBar() {
    // Off library pages there is no toolbar; callers must not force-create one.
    if (!isFavoritesPage() && !isPlaylistDetailPage()) {
      ensureStatusLogDialog();
      return (
        qs(document, `.${NS}-msgbar[data-role="status"]`) ||
        qs(document, `.${NS}-error[data-role="error"]`) ||
        qs(document, `.${NS}-error[data-role="status"]`) ||
        null
      );
    }
    const controls = qs(document, `.${NS}-controls`) || ensureControls();
    const rail = qs(controls, `.${NS}-rail-command`) || controls;
    let status =
      qs(controls, `.${NS}-msgbar[data-role="status"]`) ||
      qs(document, `.${NS}-msgbar[data-role="status"]`) ||
      qs(document, `.${NS}-error[data-role="error"]`) ||
      qs(document, `.${NS}-error[data-role="status"]`);
    if (!status) {
      status = document.createElement('div');
      status.className = `${NS}-msgbar ${NS}-error`;
      status.dataset.role = 'status';
      status.dataset.hxyrule = '1';
      status.setAttribute('role', 'button');
      status.tabIndex = 0;
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-label', 'Status log');
      const inner = document.createElement('span');
      inner.className = `${NS}-message-text`;
      inner.textContent = statusFlash || statusLive || 'Ready';
      status.appendChild(inner);
    } else {
      status.classList.add(`${NS}-msgbar`, `${NS}-error`);
      status.classList.remove(`${NS}-status`);
      status.dataset.role = 'status';
      status.setAttribute('role', 'button');
      status.tabIndex = 0;
      status.setAttribute('aria-label', 'Status log');
      if (!qs(status, `.${NS}-message-text`)) {
        const prev = String(status.textContent || '').trim();
        const inner = document.createElement('span');
        inner.className = `${NS}-message-text`;
        inner.textContent = prev || statusFlash || statusLive || 'Ready';
        status.replaceChildren(inner);
        status.dataset.logBound = '';
      }
    }
    if (status.parentElement !== rail) rail.appendChild(status);
    status.hidden = false;
    status.removeAttribute('hidden');
    ensureStatusLogDialog();
    bindStatusLogUi(status);
    return status;
  }

  /** Brand / collection chip on the title chrome row (left) — toggles Command+Match/View/Select. */
  function ensureFavCountBar() {
    hideNativeHeadline();
    const controls = qs(document, `.${NS}-controls`) || ensureControls();
    const host =
      qs(document, `.${NS}-playlist-native-title`) ||
      qs(document, `.${NS}-favorites-lib-row`) ||
      (isPlaylistDetailPage()
        ? placePlaylistNativeTitle()
        : isFavoritesPage()
          ? placeFavoritesLibraryTitleRow()
          : null);
    let chip = qs(document, `.${NS}-favcount`);
    if (!chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `${NS}-brand ${NS}-favcount`;
      chip.dataset.hxyrule = '1';
      chip.dataset.role = 'favcount';
      chip.dataset.act = 'toggle-toolbar-middle';
      chip.setAttribute('aria-expanded', 'true');
      chip.title = 'Hide Command, Match, View, and Select (F)';
    } else {
      if (chip.tagName !== 'BUTTON') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = chip.className;
        btn.textContent = chip.textContent;
        for (const { name, value } of [...chip.attributes]) {
          if (name === 'class' || name === 'type') continue;
          btn.setAttribute(name, value);
        }
        chip.replaceWith(btn);
        chip = btn;
      }
      chip.classList.add(`${NS}-brand`, `${NS}-favcount`);
      chip.dataset.role = 'favcount';
      chip.dataset.act = 'toggle-toolbar-middle';
      chip.type = 'button';
    }
    // Leave the command rail — brand now lives on the first chrome row.
    qsa(controls, `.${NS}-favcount`).forEach((el) => {
      if (el !== chip) el.remove();
    });
    if (host && (chip.parentElement !== host || host.firstElementChild !== chip)) {
      host.insertBefore(chip, host.firstChild);
    }
    if (chip.dataset.hxyruleFavToggleBound !== '1') {
      chip.dataset.hxyruleFavToggleBound = '1';
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleToolbarMiddle();
      });
    }
    updateFavCountBar();
    syncToolbarMiddleCollapsed(controls);
    return chip;
  }

  /** Pages cluster on the nav rail (rail-label + host, like other rails). */
  function ensurePagesStep() {
    const row = ensureJumpRow();
    let step = qs(document, `.${NS}-pages-step`);
    const bad =
      !step ||
      !qs(step, '[data-role="pages-host"]') ||
      !qs(step, `[data-role="pages-label"], .${NS}-rail-label`) ||
      qs(step, `.${NS}-sep`) ||
      qs(step, `.${NS}-step-name`);
    if (bad) {
      // Rescue native pager / compact pager before destroying the old host.
      const rescued = [];
      const oldHost = step && qs(step, '[data-role="pages-host"]');
      if (oldHost) {
        [...oldHost.children].forEach((child) => {
          rescued.push(child);
          child.remove();
        });
      }
      step?.remove();
      step = document.createElement('section');
      step.className = `${NS}-cluster ${NS}-pages-step`;
      step.dataset.hxyrule = '1';
      step.innerHTML = `
        <span class="${NS}-rail-label" data-role="pages-label">Pages</span>
        <div class="${NS}-pages-host" data-role="pages-host"></div>
      `;
      const host = qs(step, '[data-role="pages-host"]');
      rescued.forEach((child) => host?.appendChild(child));
    }
    step.setAttribute(
      'aria-label',
      isPlaylistDetailPage() ? 'Playlist pages' : 'Favorites pages',
    );
    if (step.parentElement !== row) row.insertBefore(step, row.firstChild);
    return step;
  }

  /**
   * Control stack: fixed to the viewport top via CSS. Always park on
   * document.body — never inside the list box. Site get_block / list reflows
   * replace box children and used to wipe the toolbar on refresh.
   */
  function ensureControlStack() {
    let stack = qs(document, `.${NS}-topstack`);
    if (!stack) {
      stack = document.createElement('div');
      stack.className = `${NS}-topstack`;
      stack.dataset.hxyrule = '1';
    }
    const box = listBoxEl();
    if (box) box.classList.add(`${NS}-fav-box`);
    const list = favoritesListEl();
    const playlist = isPlaylistDetailPage();
    stack.classList.toggle(`${NS}-topstack--playlist`, playlist);
    if (list) list.classList.add(`${NS}-thumbs-clear`);
    if (document.body) {
      if (stack.parentElement !== document.body) {
        document.body.appendChild(stack);
      }
    }
    return stack;
  }

  function listBoxEl() {
    if (isFavoritesPage()) return qs(document, '#list_videos_my_favourite_videos');
    if (isPlaylistDetailPage()) {
      const isFavBox = (el) => el && /favourites?|favorite/i.test(String(el.id || ''));
      const hasList = (el) =>
        !!el?.querySelector?.('.item.thumb, .thumbs, [id$="_items"]');
      const named = [
        ...qsa(document, '[id^="list_videos"][id*="playlist"]'),
        qs(document, '#list_videos_common_videos_list'),
      ].filter((el) => el && !isFavBox(el));
      const hit = named.find(hasList) || named[0];
      if (hit) return hit;
      const thumb = qsa(document, '.thumbs').find(
        (el) =>
          !el.classList.contains(`${NS}-compact-thumbs`) &&
          !el.closest('#list_videos_my_favourite_videos'),
      );
      const box = thumb?.closest('[id^="list_videos"]');
      if (box && !isFavBox(box)) return box;
      return thumb?.closest('.box') || null;
    }
    return qs(document, '#list_videos_my_favourite_videos');
  }

  /**
   * Playlist detail pages reuse the Favourites KVS block id
   * (`list_videos_my_favourite_videos_pagination`) with fav_type:10;playlist_id:N.
   * Treat that as THIS playlist's pager, not a foreign Favorites bar.
   */
  function paginationPlaylistId(el) {
    if (!el) return '';
    const blobs = [el.getAttribute?.('data-parameters') || ''];
    qsa(el, '[data-parameters]').forEach((n) => {
      blobs.push(n.getAttribute('data-parameters') || '');
    });
    qsa(el, 'a[href]').forEach((a) => {
      blobs.push(a.getAttribute('href') || '');
    });
    const joined = blobs.join(';');
    const m =
      joined.match(/playlist_id:([1-9]\d*)/i) ||
      joined.match(/[?&]playlist_id=([1-9]\d*)/i);
    return m ? String(m[1]) : '';
  }

  function paginationBelongsToCurrentPlaylist(el) {
    if (!el || !isPlaylistDetailPage()) return false;
    const want = String(currentPlaylistIdFromPath() || '');
    if (!want) return false;
    const got = paginationPlaylistId(el);
    return !!got && got === want;
  }

  /** True when a favourite-named pager is NOT the current playlist's block. */
  function isForeignFavoritesPager(el) {
    if (!el) return false;
    const favNamed = /favourites?|favorite/i.test(String(el.id || ''));
    if (!favNamed) return false;
    if (isPlaylistDetailPage()) return !paginationBelongsToCurrentPlaylist(el);
    return false;
  }

  function listPaginationEl() {
    const pick = (el) => {
      if (!el) return null;
      if (el.id?.endsWith?.('_pagination')) return el;
      return el.closest?.('[id$="_pagination"]') || el;
    };
    const fromPagesHost = () => {
      const host = qs(document, `[data-role="pages-host"]`);
      if (!host) return null;
      const parked =
        [...host.children].find(
          (el) =>
            el.id?.endsWith?.('_pagination') ||
            el.classList?.contains(`${NS}-pagination-slot`) ||
            el.classList?.contains('pagination'),
        ) ||
        qs(host, '[id$="_pagination"]') ||
        qs(host, `.${NS}-pagination-slot`) ||
        qs(host, '.pagination');
      if (!parked || isForeignFavoritesPager(parked)) return null;
      return pick(parked);
    };
    const fromAnchor = (anchor) => {
      if (!anchor) return null;
      const inside =
        qs(anchor, '[id$="_pagination"]') ||
        qs(anchor, '.pagination')?.closest('[id$="_pagination"], .pagination');
      if (inside && !isForeignFavoritesPager(inside)) return pick(inside);
      let sib = anchor.nextElementSibling;
      for (let i = 0; sib && i < 12; i += 1, sib = sib.nextElementSibling) {
        if (sib.classList?.contains(`${NS}-topstack`)) break;
        if (sib.id?.endsWith?.('_pagination') || sib.classList?.contains('pagination')) {
          if (!isForeignFavoritesPager(sib)) return pick(sib);
        }
        const nested = qs(sib, '[id$="_pagination"], .pagination');
        if (nested && !isForeignFavoritesPager(nested)) return pick(nested);
      }
      return null;
    };

    const parked = fromPagesHost();
    if (parked) return parked;

    if (isFavoritesPage()) {
      return (
        qs(document, '#list_videos_my_favourite_videos_pagination') ||
        fromAnchor(favoritesListEl()) ||
        fromAnchor(listBoxEl()) ||
        null
      );
    }
    if (isPlaylistDetailPage()) {
      const box = listBoxEl();
      const list = favoritesListEl();
      const near = fromAnchor(box) || fromAnchor(list);
      if (near) return near;
      // Site reuses the favourites pagination id for playlist detail pages.
      const named = qs(document, '#list_videos_my_favourite_videos_pagination');
      if (named && paginationBelongsToCurrentPlaylist(named)) return pick(named);
      const byPid = qsa(document, '[id$="_pagination"], .pagination').find((el) =>
        paginationBelongsToCurrentPlaylist(el),
      );
      return byPid ? pick(byPid) : null;
    }
    const box = listBoxEl();
    return (
      fromAnchor(box) ||
      fromAnchor(favoritesListEl()) ||
      qs(document, '#list_videos_my_favourite_videos_pagination') ||
      null
    );
  }

  /** All native list pagers for the current library (including under-list copies). */
  function findNativeListPaginationNodes() {
    const out = [];
    const seen = new Set();
    const add = (el) => {
      if (!el || seen.has(el)) return;
      const wrap =
        (el.id?.endsWith?.('_pagination') && el) ||
        el.closest?.('[id$="_pagination"]') ||
        (el.classList?.contains(`${NS}-pagination-slot`) && el) ||
        el;
      if (!wrap || seen.has(wrap)) return;
      if (wrap.classList?.contains(`${NS}-compact-pager`)) return;
      if (isForeignFavoritesPager(wrap)) return;
      seen.add(wrap);
      out.push(wrap);
    };

    const host = qs(document, `[data-role="pages-host"]`);
    if (host) {
      [...host.children].forEach((child) => {
        if (
          child.id?.endsWith?.('_pagination') ||
          child.classList?.contains(`${NS}-pagination-slot`) ||
          child.classList?.contains('pagination')
        ) {
          add(child);
        }
      });
    }

    add(listPaginationEl());
    add(qs(document, '#list_videos_my_favourite_videos_pagination'));
    qsa(document, '[id^="list_videos"][id$="_pagination"]').forEach(add);
    qsa(document, 'div.pagination').forEach(add);
    const box = listBoxEl();
    const list = favoritesListEl();
    if (box) qsa(box, '[id$="_pagination"], .pagination').forEach(add);
    for (const anchor of [list, box]) {
      let sib = anchor?.nextElementSibling;
      for (let i = 0; sib && i < 12; i += 1, sib = sib.nextElementSibling) {
        if (sib.classList?.contains(`${NS}-topstack`)) break;
        if (sib.id?.endsWith?.('_pagination') || sib.classList?.contains('pagination')) add(sib);
        qsa(sib, '[id$="_pagination"], .pagination').forEach(add);
      }
    }
    return out;
  }

  /** Pagination for the current library only (no Favorites fallback on playlists). */
  function currentListPaginationEl() {
    const nodes = findNativeListPaginationNodes();
    if (!nodes.length) return null;
    // Prefer the one already parked in toolbar Pages.
    const inPages = nodes.find((el) => el.closest?.(`.${NS}-pages-host`));
    if (inPages) return inPages;
    return listPaginationEl() || nodes[0];
  }

  /** Real KVS block id for the current list (avoid bare .box without id). */
  function playlistBlockId() {
    const box = listBoxEl();
    if (box?.id && /^list_videos/i.test(box.id) && !/favourites?|favorite/i.test(box.id)) {
      return box.id;
    }
    const form = findFavoritesControlForm();
    const fromForm = form?.getAttribute('data-block-id');
    if (fromForm && !/favourites?|favorite/i.test(fromForm)) return fromForm;
    const el =
      qs(document, '[id^="list_videos"][id*="playlist"]') ||
      qs(document, '#list_videos_common_videos_list');
    return el?.id || 'list_videos_common_videos_list';
  }

  /**
   * Read the from_* key KVS uses on this playlist's pagination
   * (e.g. from_videos:2 → from_videos).
   */
  function playlistFromKey() {
    const pag = listPaginationEl() || document;
    const attrs = [];
    qsa(pag, '[data-parameters]').forEach((el) => {
      attrs.push(el.getAttribute('data-parameters') || '');
    });
    qsa(pag, 'a[href]').forEach((a) => {
      attrs.push(a.getAttribute('href') || '');
    });
    const box = listBoxEl();
    if (box) attrs.push(box.getAttribute('data-parameters') || '');
    for (const raw of attrs) {
      const m =
        String(raw).match(/(from_videos(?:_common(?:_videos_list)?)?):\d+/i) ||
        String(raw).match(/(from_[a-z0-9_]+):\d+/i) ||
        String(raw).match(/[?&](from)=(\d+)/i);
      if (m) return m[1];
    }
    const block = playlistBlockId();
    if (/common/i.test(block)) return 'from_videos';
    return `from_${block.replace(/^list_/i, '')}`;
  }

  /** Build KVS get_block query from a data-parameters string, forcing page N. */
  function kvsParamsForPage(raw, pageNum, fromKey) {
    const parts = [];
    let sawFrom = false;
    String(raw || '')
      .split(';')
      .forEach((pair) => {
        if (!pair) return;
        const idx = pair.indexOf(':');
        if (idx < 0) return;
        const k = pair.slice(0, idx);
        const v = pair.slice(idx + 1);
        if (/^from/i.test(k)) {
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(pageNum))}`);
          sawFrom = true;
        } else if (k) {
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
        }
      });
    if (!sawFrom) {
      parts.push(`${encodeURIComponent(fromKey || 'from')}=${encodeURIComponent(String(pageNum))}`);
    }
    return parts.join('&');
  }

  function parseCardsFromHtml(html, pageNum) {
    if (!html) return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const thumbs = qsa(doc, '.item.thumb');
    if (thumbs.length) {
      return thumbs
        .map((el, index) => {
          const checkbox =
            qs(el, 'input.checkbox[name="delete[]"]') ||
            qs(el, 'input[name="delete[]"]') ||
            qs(el, 'input[type="checkbox"]');
          const link = qs(el, 'a.th.js-open-popup, a.th, a[href*="/video/"]');
          const videoId =
            checkbox?.value || (link?.getAttribute('href') || '').match(/\/video\/(\d+)\//)?.[1];
          if (!videoId) return null;
          const titleEl = qs(el, '.thumb_title') || (link && qs(link, '.thumb_title'));
          const rawTitle =
            titleEl?.textContent ||
            link?.getAttribute('title') ||
            link?.textContent?.trim() ||
            videoId;
          const href = link?.getAttribute('href') || '';
          const meta = cardMetaFromEl(el);
          return {
            videoId: String(videoId),
            detailUrl: href.startsWith('http')
              ? href
              : href
                ? `https://rule34video.com${href}`
                : `https://rule34video.com/video/${videoId}/v/`,
            title: String(rawTitle).trim(),
            favoritePage: pageNum,
            cardIndex: index,
            durationSec: cardDurationSec(el),
            thumbUrl: cardThumbUrl(el),
            previewUrl: cardPreviewUrl(el),
            viewsText: meta.viewsText,
            ratingText: meta.ratingText,
            addedText: meta.addedText,
          };
        })
        .filter(Boolean);
    }
    const items = [];
    const seen = new Set();
    qsa(doc, 'input[name="delete[]"]').forEach((input, index) => {
      const id = String(input.value || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push({
        videoId: id,
        detailUrl: `https://rule34video.com/video/${id}/v/`,
        title: id,
        favoritePage: pageNum,
        cardIndex: index,
        durationSec: null,
        thumbUrl: '',
        previewUrl: '',
        viewsText: '',
        ratingText: '',
        addedText: '',
      });
    });
    return items;
  }

  /**
   * Fetch a playlist page using the same get_block URL shape as native
   * pagination (data-parameters on the live page). Falls back to full-page ?from=.
   */
  async function fetchPlaylistPageInContent(page) {
    const pid = currentPlaylistIdFromPath();
    if (!pid) throw new Error('playlist id missing');
    const pageNum = Number(page);
    if (!Number.isInteger(pageNum) || pageNum < 1) throw new Error('invalid page');
    const blockId = playlistBlockId();
    const fromKey = playlistFromKey();
    const pag = listPaginationEl() || document;

    let paramQuery = '';
    for (const el of qsa(pag, '[data-parameters]')) {
      const raw = el.getAttribute('data-parameters') || '';
      if (parsePageFromParams(raw) === pageNum) {
        paramQuery = kvsParamsForPage(raw, pageNum, fromKey);
        break;
      }
    }
    if (!paramQuery) {
      const sample =
        qs(pag, '[data-parameters]')?.getAttribute('data-parameters') ||
        listBoxEl()?.getAttribute('data-parameters') ||
        `${fromKey}:1`;
      paramQuery = kvsParamsForPage(sample, pageNum, fromKey);
    }

    const urls = [];
    const push = (u) => {
      if (u && !urls.includes(u)) urls.push(u);
    };
    if (pageNum === 1) push(`/my/playlists/${pid}/`);
    push(
      `/my/playlists/${pid}/?mode=async&function=get_block&block_id=${encodeURIComponent(blockId)}&${paramQuery}`,
    );
    push(`/my/playlists/${pid}/?${fromKey}=${pageNum}`);
    push(`/my/playlists/${pid}/?from=${pageNum}`);
    push(`/my/playlists/${pid}/${pageNum}/`);

    let lastLen = 0;
    let lastHtml = '';
    for (const url of urls) {
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html, */*;q=0.1',
        },
      });
      const text = await res.text();
      lastLen = text.length;
      if (!res.ok) continue;
      const items = parseCardsFromHtml(text, pageNum);
      if (items.length) {
        return {
          page: pageNum,
          items,
          maxPage: maxPageNumber(),
          sourceUrl: url,
          html: text,
          blockId,
          fromKey,
        };
      }
      if (/item[\s_-]+thumb|name=["']delete\[]["']/i.test(text) && !lastHtml) lastHtml = text;
    }
    if (lastHtml) {
      const items = parseCardsFromHtml(lastHtml, pageNum);
      if (items.length) {
        return { page: pageNum, items, maxPage: maxPageNumber(), html: lastHtml, blockId, fromKey };
      }
    }
    throw new Error(`failed to load playlist ${pid} page ${pageNum} (last response ${lastLen} bytes)`);
  }

  function isProtectedBottomEl(el) {
    if (!el) return true;
    if (el.classList?.contains(`${NS}-topstack`)) return true;
    if (el.classList?.contains(`${NS}-controls`)) return true;
    if (el.classList?.contains(`${NS}-toolbar`)) return true;
    if (el.classList?.contains(`${NS}-filterbar`)) return true;
    if (el.classList?.contains(`${NS}-jumprow`)) return true;
    if (el.classList?.contains(`${NS}-jumpbar`)) return true;
    if (el.classList?.contains(`${NS}-favcount`)) return true;
    if (el.classList?.contains(`${NS}-thumbs-clear`)) return true;
    if (el.classList?.contains(`${NS}-compact-thumbs`)) return true;
    if (el.classList?.contains(`${NS}-compact-pager`)) return true;
    if (el.classList?.contains('thumbs')) return true;
    if (el.id === 'list_videos_my_favourite_videos_items') return true;
    if (el.id?.endsWith?.('_items')) return true;
    // Native pagination belongs in toolbar Pages only. Leftovers under the
    // list must not be protected — otherwise they stay visible forever.
    if (
      el.id === 'list_videos_my_favourite_videos_pagination' ||
      el.id?.endsWith?.('_pagination') ||
      el.classList?.contains(`${NS}-pagination-slot`) ||
      el.classList?.contains('pagination')
    ) {
      return !!el.closest(`.${NS}-topstack`);
    }
    if (el.querySelector?.(
      '.item.thumb, .thumbs, .hxyrule-topstack, .hxyrule-compact-pager',
    )) {
      return true;
    }
    // A wrapper that still holds a parked-or-stray pager: protect only if the
    // pager itself is already inside the toolbar.
    const nestedPag = el.querySelector?.(
      '.pagination, .hxyrule-pagination-slot, #list_videos_my_favourite_videos_pagination, [id$="_pagination"]',
    );
    if (nestedPag) return !!nestedPag.closest(`.${NS}-topstack`);
    return false;
  }

  /** Keep one native pager in toolbar Pages; hide any copy left under the card list. */
  function suppressStrayNativePagination(pagesHost, keep) {
    const host = pagesHost || qs(document, `[data-role="pages-host"]`);
    const primary = keep || currentListPaginationEl();
    // Never blank the list: if we have nothing to keep, do not hide strays.
    if (!primary) return;
    const hide = (el) => {
      if (!el || !el.isConnected) return;
      if (el === primary || primary.contains(el) || el.contains(primary)) return;
      if (host && (el === host || host.contains(el))) return;
      if (el.closest(`.${NS}-topstack`)) return;
      if (el.closest(`.${NS}-compact-pager`)) return;
      el.classList.add('hxyrule-hide-native');
      el.style.setProperty('display', 'none', 'important');
    };
    findNativeListPaginationNodes().forEach((el) => {
      if (el === primary) return;
      // Do not destroy parked host nodes here — mount() dedupes host children.
      // Removing non-primary host nodes used to delete the real pager when
      // primary briefly pointed at a bottom re-insert.
      if (host && host.contains(el)) return;
      hide(el);
    });
    const list = favoritesListEl();
    const box = listBoxEl();
    if (box) {
      qsa(box, '.pagination, [id$="_pagination"]').forEach(hide);
      [...box.children].forEach((child) => {
        if (child === primary || child.contains(primary)) return;
        if (
          child.id?.endsWith?.('_pagination') ||
          child.classList?.contains('pagination') ||
          child.classList?.contains(`${NS}-pagination-slot`)
        ) {
          hide(child);
        }
      });
    }
    for (const anchor of [list, box]) {
      let sib = anchor?.nextElementSibling;
      for (let i = 0; sib && i < 16; i += 1) {
        if (sib.classList?.contains(`${NS}-topstack`)) break;
        const next = sib.nextElementSibling;
        if (
          sib.id?.endsWith?.('_pagination') ||
          sib.classList?.contains('pagination') ||
          sib.classList?.contains(`${NS}-pagination-slot`) ||
          qs(sib, '.pagination, [id$="_pagination"]')
        ) {
          hide(sib);
        }
        sib = next;
      }
    }
  }

  function pagerHasPageControls(pag) {
    if (!pag) return false;
    return paginationItemEls(pag).some((el) => {
      if (el.classList?.contains('jump_to') || el.classList?.contains(`${NS}-hide-native-jump`)) {
        return false;
      }
      return true;
    });
  }

  /**
   * Mount the native list pager into toolbar Pages (Jump's left).
   * mode "show" = normal/Show-all view; "park" = Compact owns the slot (CSS hides).
   */
  function mountNativePaginationInToolbarPages(pagesHost, { mode = 'show' } = {}) {
    const pagesStep = ensurePagesStep();
    const host =
      pagesHost ||
      qs(pagesStep, '[data-role="pages-host"]') ||
      qs(document, `[data-role="pages-host"]`);
    if (!host?.isConnected) return null;

    if (mode === 'show') {
      qsa(host, `.${NS}-compact-pager`).forEach((el) => el.remove());
      qsa(document, `.${NS}-compact-pager`).forEach((el) => el.remove());
    }

    const nodes = findNativeListPaginationNodes();
    let pag =
      nodes.find((el) => el.parentElement === host) ||
      nodes.find((el) => el.closest?.(`.${NS}-pages-host`) === host) ||
      currentListPaginationEl() ||
      nodes[0] ||
      null;
    if (!pag) {
      // Do not suppress when we failed to find a pager — that hid the only bar.
      return null;
    }

    pag.classList.add(`${NS}-pagination-slot`);
    if (pag.parentElement !== host) host.appendChild(pag);

    // Pin into the Pages slot — kill site float/clear that drops it under cards.
    const pin = (el) => {
      if (!el) return;
      el.style.setProperty('position', 'static', 'important');
      el.style.setProperty('float', 'none', 'important');
      el.style.setProperty('clear', 'none', 'important');
      el.style.setProperty('width', 'auto', 'important');
      el.style.setProperty('max-width', '100%', 'important');
      el.style.setProperty('margin', '0', 'important');
    };
    pin(pag);
    qsa(pag, '.pagination').forEach(pin);
    if (mode === 'show') {
      pag.classList.remove('hxyrule-hide-native');
      pag.style.setProperty('display', 'flex', 'important');
      qsa(pag, '.pagination').forEach((el) => {
        el.classList.remove('hxyrule-hide-native');
        el.style.setProperty('display', 'flex', 'important');
      });
      qsa(pag, '.item').forEach((el) => {
        if (!el.classList.contains('jump_to') && !el.classList.contains(`${NS}-hide-native-jump`)) {
          el.classList.remove('hxyrule-hide-native');
          if (el.style.getPropertyValue('display') === 'none') el.style.removeProperty('display');
        }
      });
      compactNativePagination(pag);
    } else {
      // Compact: leave visibility to html.hxyrule-compact-active CSS.
      pag.classList.remove('hxyrule-hide-native');
      pag.style.removeProperty('display');
      qsa(pag, '.pagination').forEach((el) => {
        el.classList.remove('hxyrule-hide-native');
        el.style.removeProperty('display');
      });
    }

    // Dedupe inside Pages host — keep the mounted pager only.
    [...host.children].forEach((el) => {
      if (el === pag) return;
      if (el.classList?.contains(`${NS}-compact-pager`)) return;
      if (
        el.id?.endsWith?.('_pagination') ||
        el.classList?.contains(`${NS}-pagination-slot`) ||
        el.classList?.contains('pagination')
      ) {
        el.remove();
      }
    });

    if (mode === 'show' && !pagerHasPageControls(pag)) {
      // Mounted node is empty/broken — do not suppress bottom copies.
      return pag;
    }
    suppressStrayNativePagination(host, pag);
    return pag;
  }

  /** Show the native pager in toolbar Pages (normal / Show-all view). */
  function revealNativePaginationInPages(pagesHost) {
    return mountNativePaginationInToolbarPages(pagesHost, { mode: 'show' });
  }

  /** Park native pager in Pages while Compact owns the slot (CSS hides it). */
  function parkNativePaginationForCompact(pagesHost) {
    return mountNativePaginationInToolbarPages(pagesHost, { mode: 'park' });
  }

  function trimBelowControls(stack) {
    if (!stack) return;
    const wrap = qs(document, '.page__wrapper') || qs(document, '.page-wrapper');
    if (wrap) {
      wrap.style.setProperty('min-height', '0', 'important');
      wrap.style.setProperty('height', 'auto', 'important');
    }
    const main = qs(document, '.page__main') || qs(document, '.main');
    if (main) {
      main.style.setProperty('flex', '0 0 auto', 'important');
      main.style.setProperty('min-height', '0', 'important');
    }

    // Stack is parked on document.body (fixed toolbar). Never walk body
    // siblings — that hid the entire page (card grid) after the body move.
    if (stack.parentElement === document.body) {
      // Undo a prior bad pass that stamped hide-native on page chrome.
      [wrap, main, listBoxEl(), favoritesListEl()].filter(Boolean).forEach((el) => {
        el.classList.remove('hxyrule-hide-native');
        if (el.style.getPropertyValue('display') === 'none') el.style.removeProperty('display');
      });
      qsa(
        document,
        '.page__wrapper, .page-wrapper, .page__main, .main, .container--big, .container, .columns_spots, .spots',
      ).forEach((el) => {
        el.classList.remove('hxyrule-hide-native');
        if (
          el.querySelector?.('.item.thumb, .thumbs, [id^="list_videos"], .hxyrule-compact-thumbs') &&
          el.style.getPropertyValue('display') === 'none'
        ) {
          el.style.removeProperty('display');
        }
      });
      // Body children that still hold the card grid (stamped by the bad walk).
      [...document.body.children].forEach((el) => {
        if (el === stack || el.classList?.contains(`${NS}-topstack`)) return;
        if (!el.classList?.contains('hxyrule-hide-native')) return;
        if (el.querySelector?.('.item.thumb, .thumbs, [id^="list_videos"], .hxyrule-compact-thumbs')) {
          el.classList.remove('hxyrule-hide-native');
          if (el.style.getPropertyValue('display') === 'none') el.style.removeProperty('display');
        }
      });
      return;
    }

    // Legacy: stack still sits next to the list inside the page branch.
    if (stack.classList?.contains(`${NS}-topstack--playlist`)) return;
    let sib = stack.nextElementSibling;
    while (sib) {
      const next = sib.nextElementSibling;
      // Never hide pagination / our controls (they may briefly sit after stack
      // before layout moves them inside).
      if (!isProtectedBottomEl(sib)) {
        sib.classList.add('hxyrule-hide-native');
      }
      sib = next;
    }
    // Footer chrome only — do not stamp .columns_spots / .spots (may wrap cards).
    qsa(document, '.footer, .page__footer, .footer_spots, .footer_holder').forEach((el) => {
      if (!isProtectedBottomEl(el)) el.classList.add('hxyrule-hide-native');
    });
  }

  /**
   * Fixed top toolbar (Hentai-style rails):
   * - Title chrome: brand (left) · NAME (playlist center) · site + Libraries (right)
   * - Command: Sync/Queue/Index/Edit · status (collapsible with Match/View/Select)
   * - Match · View · Select (collapsible)
   * - Nav: Pages · Jump
   */
  function layoutTopControls() {
    hideNativeControls();
    hideNativeJumpControls();
    hideNativeHeadline();
    const stack = ensureControlStack();
    const controls = ensureControls();
    ensureStatusBar();
    const jump = ensureJumpBar();
    const pagesStep = ensurePagesStep();
    const row = ensureJumpRow();
    paintStatus();
    syncToolbarMiddleCollapsed(controls);
    syncCompactSortControls();

    const pagesHost = qs(pagesStep, '[data-role="pages-host"]');
    if (compactViewActive) {
      parkNativePaginationForCompact(pagesHost);
      ensureCompactPagerMounted();
    } else {
      revealNativePaginationInPages(pagesHost);
    }

    // Nav rail DOM order: Pages → sep → Jump (status lives on the command rail).
    const tailSep = qs(row, `.${NS}-nav-tail-sep`);
    if (pagesStep.parentElement !== row || row.firstElementChild !== pagesStep) {
      row.insertBefore(pagesStep, row.firstChild);
    }
    if (tailSep) {
      if (pagesStep.nextElementSibling !== tailSep) {
        pagesStep.insertAdjacentElement('afterend', tailSep);
      }
      if (jump.parentElement !== row || tailSep.nextElementSibling !== jump) {
        tailSep.insertAdjacentElement('afterend', jump);
      }
    } else if (jump.parentElement !== row || pagesStep.nextElementSibling !== jump) {
      pagesStep.insertAdjacentElement('afterend', jump);
    }
    // Drop legacy status chips that still sit on the jump row.
    qsa(row, `[data-role="status"], .${NS}-msgbar`).forEach((el) => {
      if (el.closest(`.${NS}-rail-command`)) return;
      el.remove();
    });

    const list = favoritesListEl();
    if (list) list.classList.add(`${NS}-thumbs-clear`);
    if (list) moveLargeNativePanelBelowCards(list);

    const title = isPlaylistDetailPage()
      ? placePlaylistNativeTitle()
      : isFavoritesPage()
        ? placeFavoritesLibraryTitleRow()
        : null;
    ensureFavCountBar();
    if (isPlaylistDetailPage() || isFavoritesPage()) hideNativeMyFavoritesNavLinks();
    const ordered = [title, controls, row].filter(Boolean);
    ordered.forEach((el, i) => {
      if (el.parentElement !== stack) stack.appendChild(el);
      const wantPrev = i === 0 ? null : ordered[i - 1];
      if (wantPrev) {
        if (wantPrev.nextElementSibling !== el) wantPrev.insertAdjacentElement('afterend', el);
      } else if (stack.firstElementChild !== el) {
        stack.insertBefore(el, stack.firstChild);
      }
    });
    // Keep exactly title? + controls + jumprow — stray siblings become a 4th toolbar row.
    Array.from(stack.children).forEach((child) => {
      if (!ordered.includes(child)) child.remove();
    });
    // Stack stays on document.body (see ensureControlStack). Do not re-parent
    // it after the list — that put it inside the list box where site reflows
    // destroyed it on refresh.
    if (compactViewActive) {
      ensureCompactPagerMounted();
      qsa(document, `.${NS}-compact-pager`).forEach((el) => {
        el.classList.remove('hxyrule-hide-native');
        el.style.removeProperty('display');
      });
    } else {
      // Remount after stack/list reflow — keeps native pager in Pages (left of Jump).
      revealNativePaginationInPages(qs(pagesStep, '[data-role="pages-host"]'));
    }
    // Drop legacy playlist spacer if an older build left one behind.
    qs(stack, `.${NS}-gap-pag-jump`)?.remove();
    if (isPlaylistDetailPage()) {
      hideOrphanPlaylistHeadlines(qs(stack, `.${NS}-playlist-native-title`));
    }
    trimBelowControls(stack);
    ensureCardGridVisible();
    syncFixedToolbarInset(stack);
  }

  /** Move the nearest original large dark panel above the cards below them, intact. */
  function moveLargeNativePanelBelowCards(list) {
    if (!list || !list.isConnected) return null;
    // Exact Rule34Video structure supplied from the live page:
    //   div.header
    //     > button.burger
    //     > div.container > div.columns
    //     > div.filters_wrap
    // This whole native header is the large black rectangle the user wants
    // below the video cards. Move the original outer node intact; do not clone
    // or rebuild its inner .columns/header controls.
    const nativeHeaders = [...document.querySelectorAll('div.header')].filter((node) => {
      const children = [...node.children];
      return (
        children.some((child) => child.matches('button.burger')) &&
        children.some((child) => child.matches('.container') && child.querySelector(':scope > .columns')) &&
        children.some((child) => child.matches('.filters_wrap'))
      );
    });
    if (nativeHeaders.length) {
      const pageKind = isPlaylistDetailPage() ? 'playlist' : 'favorites';
      nativeHeaders.forEach((node) => {
        node.dataset.hxyruleDarkPanelMoved = '1';
        node.dataset.hxyruleDarkPanelPage = pageKind;
      });
      // Playlist can contain a hidden/template header plus the visible black
      // panel. Move every exact structural match so querySelector order cannot
      // leave the visible duplicate behind at the top.
      const nativeHeader = nativeHeaders
        .map((node, index) => {
          const rect = node.getBoundingClientRect();
          return { node, index, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
        })
        .sort((a, b) => a.area - b.area || a.index - b.index)
        .map((entry) => entry.node);
      // `.header` is styled as a page-level block. Nesting it beside `.thumbs`
      // makes the site's selectors collapse/hide it. Keep its original body
      // child level and place it after the body-level branch containing cards.
      let pageBranch = list;
      while (pageBranch.parentElement && pageBranch.parentElement !== document.body) {
        pageBranch = pageBranch.parentElement;
      }
      if (isPlaylistDetailPage()) {
        // Playlist skins can keep `.header` visually pinned by their original
        // wrapper/ordering rules. Make the requested placement deterministic:
        // keep the intact header as a body child after all normal page content.
        const tail = [...document.body.children].slice(-nativeHeader.length);
        const alreadyAtBottom = nativeHeader.every(
          (node, index) => node.parentElement === document.body && tail[index] === node,
        );
        if (!alreadyAtBottom) nativeHeader.forEach((node) => document.body.appendChild(node));
      } else if (pageBranch.parentElement === document.body) {
        // Favorites and playlist use the same exact native header. Always keep
        // it as a body child immediately after the complete card-page branch.
        const visibleHeader = nativeHeader[nativeHeader.length - 1];
        if (pageBranch.nextElementSibling !== visibleHeader) {
          pageBranch.insertAdjacentElement('afterend', visibleHeader);
        }
      }
      return nativeHeader[nativeHeader.length - 1];
    }
    const candidates = [];
    const seen = new Set();
    const collectPrevious = (anchor) => {
      let node = anchor?.previousElementSibling;
      while (node) {
        if (!seen.has(node)) {
          seen.add(node);
          candidates.push({ node, anchor });
        }
        node = node.previousElementSibling;
      }
    };
    // The native panel is not consistent between skins: it can be a sibling of
    // the thumbs, a sibling of the list box, or a transparent wrapper whose
    // child owns the black background. Walk the list's ancestor path so we move
    // the original outer panel instead of reconstructing any of its contents.
    let cursor = list;
    while (cursor && cursor !== document.body) {
      collectPrevious(cursor);
      cursor = cursor.parentElement;
    }
    const box = listBoxEl();
    if (box && box !== list) collectPrevious(box);

    const listRect = list.getBoundingClientRect();
    const isDarkColor = (color) => {
      const match = String(color || '').match(
        /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i,
      );
      if (!match || (match[4] != null && Number(match[4]) < 0.2)) return false;
      return Number(match[1]) < 70 && Number(match[2]) < 70 && Number(match[3]) < 70;
    };
    const hasDarkSurface = (node) => {
      if (isDarkColor(getComputedStyle(node).backgroundColor)) return true;
      // A number of Rule34Video skins paint the visible square on a single
      // child while leaving the panel wrapper transparent.
      return [...node.children].some((child) => {
        const rect = child.getBoundingClientRect();
        return (
          rect.width >= Math.max(280, listRect.width * 0.55) &&
          rect.height >= 55 &&
          isDarkColor(getComputedStyle(child).backgroundColor)
        );
      });
    };
    let dark = candidates
      .filter(({ node }) => {
        if (!node.isConnected || node.dataset?.hxyruleDarkPanelMoved === '1') return false;
        if (node.matches('header, nav, .header, .navigation, .footer, .page__footer')) return false;
        if (node.matches(`.${NS}-topstack, .${NS}-controls`) || node.querySelector(`.${NS}-topstack`)) return false;
        if (node.matches('.headline') || node.classList.contains(`${NS}-playlist-native-title`)) return false;
        if (node.querySelector('.item.thumb, .thumbs')) return false;
        const rect = node.getBoundingClientRect();
        if (rect.height < 55 || rect.width < Math.max(280, listRect.width * 0.55)) return false;
        if (rect.bottom > listRect.top + 8) return false;
        return hasDarkSurface(node);
      })
      .sort((a, b) => b.node.getBoundingClientRect().bottom - a.node.getBoundingClientRect().bottom)[0];
    // Last-resort visual lookup: some skins nest the black surface several
    // wrappers deep, so it is neither a sibling nor an immediate child of one.
    // Find the actual painted rectangle, then promote through same-sized
    // wrappers to preserve the complete native panel unchanged.
    if (!dark) {
      const surfaces = [...document.body.querySelectorAll('*')]
        .filter((node) => {
          if (!node.isConnected || node.contains(list) || list.contains(node)) return false;
          if (node.closest(`header, nav, .header, .navigation, .footer, .page__footer, .${NS}-topstack`)) {
            return false;
          }
          if (node.querySelector('.item.thumb, .thumbs')) return false;
          const rect = node.getBoundingClientRect();
          return (
            rect.height >= 55 &&
            rect.width >= Math.max(280, listRect.width * 0.55) &&
            rect.bottom <= listRect.top + 8 &&
            isDarkColor(getComputedStyle(node).backgroundColor)
          );
        })
        .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      let node = surfaces[0] || null;
      if (node) {
        const paintedRect = node.getBoundingClientRect();
        while (node.parentElement && node.parentElement !== document.body) {
          const parent = node.parentElement;
          if (parent.contains(list) || parent.querySelector(`.${NS}-topstack`)) break;
          const rect = parent.getBoundingClientRect();
          if (rect.width < paintedRect.width * 0.9 || rect.height < paintedRect.height * 0.9) break;
          if (rect.bottom > listRect.top + 8) break;
          node = parent;
        }
        dark = { node, anchor: list };
      }
    }
    if (!dark) return null;

    const { node, anchor } = dark;
    node.dataset.hxyruleDarkPanelMoved = '1';
    // Always land immediately below the cards. This also works when the panel
    // originated in a higher-level wrapper discovered by the visual fallback.
    list.insertAdjacentElement('afterend', node);
    return node;
  }

  /** Site pagination uses skin-specific high-priority dimensions; lock the live nodes directly. */
  function compactNativePagination(pag) {
    if (!pag) return;
    const TILE = '#2f3b46';
    const CTRL = '44px';
    const FONT = '14px';
    const RADIUS = '8px';
    const set = (el, prop, value) => el.style.setProperty(prop, value, 'important');
    [pag, ...qsa(pag, '.pagination')].forEach((el) => {
      set(el, 'height', CTRL);
      set(el, 'min-height', CTRL);
      set(el, 'max-height', CTRL);
      set(el, 'padding-top', '0');
      set(el, 'padding-bottom', '0');
      set(el, 'margin-top', '0');
      set(el, 'margin-bottom', '0');
      set(el, 'box-sizing', 'border-box');
      set(el, 'align-items', 'center');
    });
    qsa(pag, '.item').forEach((el) => {
      if (el.classList.contains('jump_to') || el.classList.contains(`${NS}-hide-native-jump`)) return;
      set(el, 'display', 'inline-flex');
      set(el, 'flex', '0 0 auto');
      set(el, 'align-items', 'center');
      set(el, 'justify-content', 'center');
      set(el, 'width', 'auto');
      set(el, 'min-width', CTRL);
      set(el, 'height', CTRL);
      set(el, 'min-height', CTRL);
      set(el, 'max-height', CTRL);
      set(el, 'margin', '0 2px');
      set(el, 'padding', '0');
      set(el, 'font-size', FONT);
      set(el, 'line-height', '22px');
      set(el, 'box-sizing', 'border-box');
      set(el, 'border-radius', RADIUS);
      const inner = qsa(el, ':scope > a, :scope > button, :scope > span');
      if (!inner.length) set(el, 'padding', '8px 12px');
      // Numeric pages get fill from paintPageButton; nav (… / First / Last / Next) need TILE here.
      const isNumeric = !!pageNumberFromPagItem(el);
      if (!isNumeric) {
        set(el, 'background', TILE);
        set(el, 'background-color', TILE);
        set(el, 'color', '#fff');
      }
      inner.forEach((child) => {
        set(child, 'display', 'inline-flex');
        set(child, 'align-items', 'center');
        set(child, 'justify-content', 'center');
        set(child, 'width', 'auto');
        set(child, 'min-width', CTRL);
        set(child, 'height', CTRL);
        set(child, 'min-height', CTRL);
        set(child, 'max-height', CTRL);
        set(child, 'margin', '0');
        set(child, 'padding', '8px 12px');
        set(child, 'font-size', FONT);
        set(child, 'line-height', '22px');
        set(child, 'box-sizing', 'border-box');
        set(child, 'border-radius', RADIUS);
        if (
          !isNumeric &&
          !child.classList.contains(`${NS}-page-chrome`) &&
          !child.classList.contains(`${NS}-page-local`)
        ) {
          set(child, 'background', TILE);
          set(child, 'background-color', TILE);
          set(child, 'color', '#fff');
        }
      });
    });
    englishPaginationNavLabels(pag);
  }

  /** Replace prev/next arrow glyphs with English text. */
  function englishPaginationNavLabels(pag) {
    if (!pag) return;
    qsa(pag, '.item').forEach((el) => {
      if (el.classList.contains('jump_to') || el.classList.contains(`${NS}-hide-native-jump`)) return;
      if (!isNextPrevControl(el)) return;
      const btn = resolvePageButton(el) || el;
      const cls = `${el.className || ''} ${btn.className || ''}`;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      let label = null;
      if (/\bprev/i.test(cls) || /^(«|‹|<<|<|←|prev|previous)$/i.test(text)) label = 'Prev';
      else if (/\bnext/i.test(cls) || /^(»|›|>>|>|→|next)$/i.test(text)) label = 'Next';
      if (!label) {
        const n = parsePageFromParams(
          btn.getAttribute?.('data-parameters') || el.getAttribute?.('data-parameters') || '',
        );
        const cur = currentPageNumber();
        if (n && cur && n < cur) label = 'Prev';
        else if (n && cur && n > cur) label = 'Next';
      }
      if (!label) return;
      if (btn === el) {
        el.textContent = label;
      } else {
        btn.textContent = label;
      }
      el.dataset.hxyruleNav = label.toLowerCase();
    });
  }

  let fixedToolbarResizeObserver = null;
  function syncFixedToolbarInset(stack = qs(document, `.${NS}-topstack`)) {
    if (!stack) return;
    const apply = () => {
      if (!document.body.contains(stack)) return;
      const height = Math.ceil(stack.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty(
          '--hxyrule-fixed-toolbar-height',
          `${height + 3}px`,
        );
      }
    };
    apply();
    if (typeof ResizeObserver === 'function') {
      fixedToolbarResizeObserver?.disconnect();
      fixedToolbarResizeObserver = new ResizeObserver(apply);
      fixedToolbarResizeObserver.observe(stack);
    }
  }

  function findNativeJumpControls() {
    const pag = currentListPaginationEl();
    const scope =
      pag?.parentElement ||
      listBoxEl() ||
      qs(document, '#list_videos_my_favourite_videos') ||
      document.body;
    if (!scope) return null;
    for (const input of qsa(
      scope,
      'input[type="text"], input[type="number"], input[type="search"], input:not([type])',
    )) {
      if (input.closest(`.${NS}-toolbar, .${NS}-jumpbar`)) continue;
      let node = input;
      for (let depth = 0; depth < 5 && node; depth += 1, node = node.parentElement) {
        const t = String(node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (t.length <= 100 && /jump\s*to/i.test(t)) {
          let ok = null;
          let sib = input.nextElementSibling;
          while (sib) {
            if (sib.matches?.('input[type="button"], input[type="submit"], button')) {
              ok = sib;
              break;
            }
            const inner = qs(sib, 'input[type="button"], input[type="submit"], button');
            if (inner) {
              ok = inner;
              break;
            }
            sib = sib.nextElementSibling;
          }
          if (!ok) {
            const buttons = qsa(node, 'input[type="button"], input[type="submit"], button');
            ok =
              buttons.find((b) =>
                /^(ok|go|jump)$/i.test(String(b.value || b.textContent || '').trim()),
              ) || buttons[0] || null;
          }
          return { input, ok, wrap: node };
        }
      }
    }
    return null;
  }

  function hideNativeJumpControls() {
    const ctl = findNativeJumpControls();
    if (!ctl?.wrap) return;
    // Only hide the native Jump-to chip — never the whole pagination bar.
    let wrap = ctl.wrap;
    if (
      /_pagination$/i.test(wrap.id || '') ||
      wrap.id === 'list_videos_my_favourite_videos_pagination' ||
      wrap.classList?.contains('pagination') ||
      wrap.querySelector?.('.pagination .item:not(.jump_to)')
    ) {
      wrap =
        ctl.input?.closest?.('.item.jump_to, .jump_to') ||
        qs(wrap, '.item.jump_to, .jump_to') ||
        null;
    }
    if (!wrap) return;
    wrap.classList.add(`${NS}-hide-native-jump`);
  }

  function firstMatch(root, selectors) {
    for (const sel of selectors) {
      const el = qs(root, sel);
      if (el) return el;
    }
    return null;
  }

  /** Swap favorites list + pagination from a KVS get_block HTML fragment. */
  function applyFavoritesBlockHtml(html) {
    if (!html) return false;
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Always replace the *native* list — never listRoot() while Compact is
    // active (that points at .hxyrule-compact-thumbs). Writing site HTML into
    // the compact host strips data-hxyrule-compact markers; ensureCardGridVisible
    // then unhides the native grid and the user sees 12 junk cards + 12 real ones.
    const curItems = favoritesListEl();
    const newItems = firstMatch(doc, [
      '#list_videos_my_favourite_videos_items',
      '#list_videos_common_videos_list_items',
      '[id^="list_videos"][id$="_items"]',
      '.thumbs',
    ]);
    if (curItems) {
      if (newItems) {
        curItems.innerHTML = newItems.innerHTML;
      } else {
        const thumbs = qsa(doc, '.item.thumb');
        if (!thumbs.length) return false;
        curItems.innerHTML = thumbs.map((t) => t.outerHTML).join('');
      }
    } else {
      return false;
    }

    const curPag = currentListPaginationEl();
    const newPag = firstMatch(doc, [
      '#list_videos_my_favourite_videos_pagination',
      '[id$="_pagination"]',
      '.pagination',
    ]);
    if (curPag && newPag) {
      if (newPag.id === 'list_videos_my_favourite_videos_pagination') {
        curPag.innerHTML = newPag.innerHTML;
      } else {
        const pagInner = qs(curPag, '.pagination');
        if (pagInner && newPag.classList.contains('pagination')) {
          pagInner.outerHTML = newPag.outerHTML;
        } else if (pagInner) {
          pagInner.innerHTML = newPag.innerHTML;
        } else {
          curPag.innerHTML = newPag.outerHTML;
        }
      }
      delete curPag.dataset.hxyrulePagWired;
    }

    hideNativeJumpControls();
    // DOM swap drops KVS ajax success hooks — re-bind the site's own lazyload only.
    reinitPageThumbLazyload();
    layoutTopControls();
    // Site per-node pagination + fancybox-ajax handlers die with this replace.
    extensionOwnsPagination = true;
    // Rebind [data-fancybox="ajax"] in page MAIN world (KVS normally does this
    // in get_block success). Without it, online play / Cmd+click open nothing.
    send('PAGE_REBIND_POPUPS', {}).catch(() => {});
    return true;
  }

  /**
   * Re-bind the page's native KVS/jQuery lazyload after list HTML replace or
   * boot unhide. Runs in MAIN world via background (inline <script> inject is
   * blocked by site CSP — that left thumbs stuck after pagination).
   */
  function reinitPageThumbLazyload() {
    send('PAGE_REINIT_LAZYLOAD', {}).catch(() => {});
  }

  function markActivePage(page) {
    const root = currentListPaginationEl();
    if (!root) return;
    paginationItemEls(root).forEach((el) => {
      const n = pageNumberFromPagItem(el);
      const on = n === page;
      el.classList.toggle('active', on);
      resolvePageButton(el).classList.toggle('active', on);
    });
  }

  /**
   * Navigate favorites list to page N by fetching the KVS block (same as
   * Select pages / Scan nearby) and replacing the list DOM. Synthetic clicks
   * on pagination do not work from the extension isolated world.
   */
  async function goToFavoritesPage(pageNum) {
    const page = Number(pageNum);
    if (!Number.isInteger(page) || page < 1) return false;
    const maxP = maxPageNumber();
    if (page > maxP) {
      setError(`Page ${page} exceeds max ${maxP}`);
      return false;
    }
    if (page === currentPageNumber() && parseCards().length) {
      setError('');
      return true;
    }

    ignoreMutationsUntil = Date.now() + 900;
    // Single HTML fetch — the previous path fetched twice (items then html).
    let htmlData = null;
    try {
      if (isPlaylistDetailPage()) {
        const pid = currentPlaylistIdFromPath();
        htmlData = await send('FETCH_PLAYLIST_PAGE', {
          playlistId: pid,
          page,
          blockId: playlistBlockId(),
          fromKey: playlistFromKey(),
          includeHtml: true,
        });
      } else {
        htmlData = await send('FETCH_FAVORITES_PAGE', { page, includeHtml: true });
      }
    } catch (_) {
      htmlData = null;
    }
    if (!htmlData?.html || !applyFavoritesBlockHtml(htmlData.html)) {
      if (isPlaylistDetailPage()) {
        const pid = currentPlaylistIdFromPath();
        const key = playlistFromKey() || 'from';
        location.assign(`https://rule34video.com/my/playlists/${pid}/?${key}=${page}`);
      } else {
        location.assign(
          `https://rule34video.com/my/favourites/videos/?from_my_fav_videos=${page}`,
        );
      }
      return true;
    }
    markActivePage(page);

    try {
      const url = new URL(location.href);
      if (isPlaylistDetailPage()) {
        const key = playlistFromKey() || 'from';
        url.searchParams.set(key, String(page));
      } else {
        url.searchParams.set('from_my_fav_videos', String(page));
      }
      history.pushState({ hxyrulePage: page }, '', url.pathname + url.search);
    } catch (_) {
      /* ignore */
    }

    pageFinger = '';
    // Must force: ignoreMutationsUntil was just armed for the HTML replace and
    // would otherwise skip wiring. Light mode skips queue/nearby-page work.
    await onListChanged({ force: true, light: true });
    reinitPageThumbLazyload();
    return true;
  }

  /**
   * Force re-fetch of the current list page HTML (cards + pagination), even
   * when already on that page. Used after fav-add / playlist-add so the
   * toolbar pager and thumbs match the site.
   */
  async function reloadCurrentListPageForced() {
    const page = Math.max(1, Number(currentPageNumber()) || 1);
    ignoreMutationsUntil = Date.now() + 1200;
    let htmlData = null;
    try {
      if (isPlaylistDetailPage()) {
        const pid = currentPlaylistIdFromPath();
        if (!pid) return false;
        htmlData = await send('FETCH_PLAYLIST_PAGE', {
          playlistId: pid,
          page,
          blockId: playlistBlockId(),
          fromKey: playlistFromKey(),
          includeHtml: true,
        });
      } else {
        htmlData = await send('FETCH_FAVORITES_PAGE', { page, includeHtml: true });
      }
    } catch (_) {
      htmlData = null;
    }
    if (!htmlData?.html || !applyFavoritesBlockHtml(htmlData.html)) return false;
    markActivePage(page);
    pageFinger = '';
    await onListChanged({ force: true, light: true });
    reinitPageThumbLazyload();
    scheduleOrdinalRepaint();
    paintPaginationLocalMarks();
    layoutTopControls();
    return true;
  }

  async function findPageForOrdinal(seq) {
    const info = await send('HELPER_ORDINALS_BY_SEQ', { seq });
    if (!info?.found || !info.videoId) {
      throw new Error(`Seq ${seq} not found (run Renumber or browse that video first)`);
    }
    const videoId = String(info.videoId);
    const maxP = maxPageNumber();
    const per = cardsPerPageEstimate();
    const maxSeq =
      Number(info.maxSeq) || scanFavTotal || detectFavoritesTotal() || seq;
    let guess = Math.floor((maxSeq - seq) / per) + 1;
    guess = Math.min(maxP, Math.max(1, guess));

    const pageHas = async (p) => {
      if (p === currentPageNumber()) {
        return parseCards().some((c) => c.videoId === videoId);
      }
      const data = await fetchListPage(p);
      return (data.items || []).some((it) => String(it.videoId) === videoId);
    };

    if (await pageHas(guess)) return { page: guess, videoId };
    for (let d = 1; d <= 10; d += 1) {
      if (guess - d >= 1 && (await pageHas(guess - d))) {
        return { page: guess - d, videoId };
      }
      if (guess + d <= maxP && (await pageHas(guess + d))) {
        return { page: guess + d, videoId };
      }
    }
    throw new Error(`Seq ${seq} video is not in favorites pages (maybe unfavorited)`);
  }

  function ensureJumpBar() {
    hideNativeJumpControls();

    let bar = qs(document, `.${NS}-jumpbar`);
    // Recreate if older boxed step / nested-field layout is still around.
    if (
      bar &&
      (!qs(bar, `[data-role="jump-label"], .${NS}-rail-label`) ||
        !qs(bar, `.${NS}-paren`) ||
        qs(bar, `.${NS}-sep`) ||
        qs(bar, `.${NS}-step-name`) ||
        qs(bar, `.${NS}-field`) ||
        qs(bar, `.${NS}-jump-field`) ||
        qs(bar, `.${NS}-jumpbar__slash`))
    ) {
      bar.remove();
      bar = null;
    }
    if (!bar) {
      bar = document.createElement('section');
      bar.className = `${NS}-cluster ${NS}-jumpbar`;
      bar.dataset.hxyrule = '1';
      bar.setAttribute('aria-label', 'Jump');
      bar.innerHTML = `
        <span class="${NS}-rail-label" data-role="jump-label">Jump</span>
        <span class="${NS}-paren-field">
          <span class="${NS}-paren">(</span>
          <input type="text" inputmode="numeric" autocomplete="off" data-role="page-jump" placeholder="page" aria-label="Page" />
          <span class="${NS}-paren-sep">/</span>
          <input type="text" inputmode="numeric" autocomplete="off" data-role="seq-jump" placeholder="seq" aria-label="Sequence" />
          <span class="${NS}-paren">)</span>
        </span>
      `;
    }
    const row = ensureJumpRow();
    let tailSep = qs(row, `.${NS}-nav-tail-sep`);
    if (!tailSep) {
      tailSep = document.createElement('span');
      tailSep.className = `${NS}-rail-sep ${NS}-nav-tail-sep`;
      tailSep.setAttribute('aria-hidden', 'true');
    }
    if (bar.parentElement !== row) row.appendChild(bar);
    if (tailSep.parentElement !== row || bar.previousElementSibling !== tailSep) {
      row.insertBefore(tailSep, bar);
    }

    if (bar.dataset.wired === '1') return bar;
    bar.dataset.wired = '1';

    const pageInput = qs(bar, '[data-role="page-jump"]');
    const seqInput = qs(bar, '[data-role="seq-jump"]');

    const runPageJump = async () => {
      const page = Number(String(pageInput.value || '').trim());
      if (!Number.isInteger(page) || page < 1) {
        setError('Enter a valid page number');
        return;
      }
      setError('');
      pageInput.disabled = true;
      seqInput.disabled = true;
      try {
        // Compact Pages owns the match list — Jump page must target compact pages.
        if (compactViewActive) {
          const max = compactPageCount();
          if (page > max) {
            setError(`Compact has ${max} page${max === 1 ? '' : 's'}`);
            return;
          }
          await goCompactPage(page);
          return;
        }
        const ok = await goToFavoritesPage(page);
        if (!ok) setError(`Could not open page ${page}`);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        pageInput.disabled = false;
        seqInput.disabled = false;
      }
    };

    const runSeqJump = async () => {
      const seq = Number(String(seqInput.value || '').trim());
      if (!Number.isInteger(seq) || seq < 1) {
        setError('Enter a valid sequence number');
        return;
      }
      setError('');
      seqInput.disabled = true;
      pageInput.disabled = true;
      try {
        // Compact Pages owns the match list — Jump seq must target compact pages
        // (native goToFavoritesPage would replace/unhide the wrong grid).
        if (compactViewActive) {
          const info = await send('HELPER_ORDINALS_BY_SEQ', { seq });
          if (!info?.found || !info.videoId) {
            throw new Error(
              `Seq ${seq} not found (run Renumber or browse that video first)`,
            );
          }
          const videoId = String(info.videoId);
          const idx = compactMatchedItems.findIndex(
            (v) => String(v?.videoId) === videoId,
          );
          if (idx < 0) {
            throw new Error(`Seq ${seq} is not in the current Compact list`);
          }
          const per = compactPerPage();
          const page = Math.floor(idx / per) + 1;
          const max = compactPageCount();
          if (page > max) {
            setError(`Compact has ${max} page${max === 1 ? '' : 's'}`);
            return;
          }
          pageInput.value = String(page);
          if (page !== compactPage) await goCompactPage(page);
          const host = qs(document, `.${NS}-compact-thumbs`);
          const cardEl = qsa(
            host || document,
            `.item.thumb[data-hxyrule-compact="1"]`,
          ).find((el) => {
            const box =
              qs(el, 'input.checkbox[name="delete[]"]') ||
              qs(el, 'input[name="delete[]"]') ||
              qs(el, 'input[type="checkbox"]');
            return String(box?.value || '') === videoId;
          });
          cardEl?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
          return;
        }
        const hit = await findPageForOrdinal(seq);
        pageInput.value = String(hit.page);
        const ok = await goToFavoritesPage(hit.page);
        if (!ok) setError(`Could not open page ${hit.page} for seq ${seq}`);
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        seqInput.disabled = false;
        pageInput.disabled = false;
      }
    };

    pageInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      runPageJump();
    });
    seqInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      runSeqJump();
    });
    return bar;
  }

  let scanMatched = null;
  let scanFavTotal = null;
  /** Authoritative library total after index/delete — beats stale-high site DOM. */
  let knownLibraryTotal = null;
  /** Full-page card count (never last-page short count). */
  let stablePerPage = null;
  let selCountCached = 0;
  /** While Page range is collecting: { base, fetched, total } for Clear · N + (a/b). */
  let selProgress = null;
  /** True while collectPages is in flight (only one Page range at a time). */
  let selCollectRunning = false;
  /** Set by Clear to abort the in-flight collectPages loop. */
  let selCollectCancel = false;
  let downloadProgressLabel = 'idle'; // e.g. "0/3" while queue session runs
  let dlSession = { active: false, total: 0, baselineCompleted: 0 };
  let rebuildRunning = false;
  let renumberPollTimer = null;
  let lastRenumberStats = null; // { done, total } pages after last successful renumber
  let renumberProgressLabel = ''; // e.g. "3/100" while background renumber runs
  let indexRunning = false;
  /** '' | 'crawl' (Build/Rebuild) | 'sex' (Tag sex / Retag sex). */
  let indexJobKind = '';
  /** True while a sex-delta (incremental) Tag sex job is active. */
  let indexSexDelta = false;
  let indexPollTimer = null;
  let lastIndexStats = null; // { done, total } pages after last successful index build
  let indexProgressLabel = ''; // e.g. "3/100" while background index runs
  let filterRunning = false;
  let playlistRunning = false;
  let playlistCancel = false;
  /** Closes the in-flight Add to playlist modal when Stop is pressed. */
  let playlistModalAbort = null;
  let playlistProgressLabel = ''; // e.g. "3/40" while SW playlist-add job runs
  let playlistPollTimer = null;
  let favAddRunning = false;
  let favAddCancel = false;
  let favAddProgressLabel = ''; // e.g. "3/40" while SW fav-add job runs
  let favAddPollTimer = null;
  let deleteRunning = false;
  let pruneRunning = false;
  let favIndexCache = null;
  /**
   * Dual collection toggles (same state keys, page-dependent meaning):
   * - Playlist page: Favorited / Unfavorited  → vs My Favorites index
   * - Favorites page: In playlist / Not in playlist → vs union of playlist indexes
   * favoriteOn = include members of the comparison set; playlistOn = include non-members.
   */
  let myFavIdSet = null;
  let playlistMembershipSet = null;
  let playlistMembershipScopes = null;
  let filterState = {
    localOn: true,
    cloudOn: true,
    favoriteOn: true,
    playlistOn: true,
    /** Futa/Straight from detail-page futanari tags (index sexGroup). */
    futaOn: true,
    straightOn: true,
    durMinMin: '',
    durMaxMin: '',
    /** Contiguous substring on title + Favorites seq prefix (case-insensitive). */
    titleQuery: '',
    matchedIds: null, // Set | null (null = filter inactive)
    matchCount: null,
    active: false,
  };
  /** Compact matches view: hide native thumbs, show only matched cards (sorted). */
  let compactViewActive = false;
  /** Full match list for compact view; rendered a page at a time. */
  let compactMatchedItems = [];
  let compactPage = 1;
  /** Hide Command + Match / View / Select rails (brand button or F). */
  let toolbarMiddleCollapsed = false;
  /**
   * Compact list sort: favorited (Favorites) | seq (playlist, renumber ordinals) |
   * uploaded | duration | views | rating + -asc|-desc.
   * Active field button shows ↓/↑; click again toggles direction.
   */
  let compactSortKey = 'uploaded-desc';
  /** Persisted View: compact | matches | all. */
  let viewMode = 'compact';
  /** True while boot (or explicit apply) is restoring the persisted View. */
  let viewRestorePending = false;
  /** True while favorites/playlist boot is still running (before first paint settle). */
  let bootInProgress = false;
  /** Persisted Select page-range inputs (survive control rebuilds). */
  let selectStartSaved = '';
  let selectEndSaved = '';
  /** Persisted Select seq-range inputs (title prefix / Renumber ordinals). */
  let selectSeqStartSaved = '';
  let selectSeqEndSaved = '';
  /** Guard so compact-page upload-meta fetches do not clobber a newer page. */
  let uploadMetaEnrichGen = 0;
  /** Debounce Compact / Show matches refresh after Match rule edits (esp. Duration). */
  let matchViewReapplyTimer = null;
  let matchViewReapplyGen = 0;
  const STORAGE_FILTERS = 'hxyruleToolbarFilters';
  const COMPACT_SORT_FIELDS = new Set([
    'favorited',
    'seq',
    'uploaded',
    'duration',
    'views',
    'rating',
  ]);
  const COMPACT_SORT_KEYS = new Set([
    'favorited-desc', 'favorited-asc',
    'seq-desc', 'seq-asc',
    'uploaded-desc', 'uploaded-asc',
    'duration-desc', 'duration-asc',
    'views-desc', 'views-asc',
    'rating-desc', 'rating-asc',
  ]);

  /** Favorites default = collection order; playlist default = renumber Seq. */
  function defaultCompactSortKey() {
    return isPlaylistDetailPage() ? 'seq-desc' : 'favorited-desc';
  }

  const storageGet = (defaults) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(defaults, (value) => resolve(value || defaults));
      } catch (_) {
        resolve(defaults);
      }
    });
  const storageSet = (value) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.set(value, () => resolve());
      } catch (_) {
        resolve();
      }
    });

  function defaultToolbarFilters() {
    return {
      localOn: true,
      cloudOn: true,
      favoriteOn: true,
      playlistOn: true,
      futaOn: true,
      straightOn: true,
      durMinMin: '',
      durMaxMin: '',
      titleQuery: '',
      viewMode: 'compact',
      selectStart: '',
      selectEnd: '',
      selectSeqStart: '',
      selectSeqEnd: '',
      compactSortKey: defaultCompactSortKey(),
      toolbarMiddleCollapsed: false,
    };
  }

  function normalizeViewMode(raw) {
    if (
      raw === 'compact' ||
      raw === 'matches' ||
      raw === 'all' ||
      raw === 'selected'
    ) {
      return raw;
    }
    return 'compact';
  }

  /** View seg highlight: trust persisted/target mode while a View apply is in flight. */
  function uiViewMode() {
    if (viewRestorePending || filterRunning) return normalizeViewMode(viewMode);
    if (compactViewActive) {
      return normalizeViewMode(viewMode) === 'selected' ? 'selected' : 'compact';
    }
    // Persisted Compact intent wins over a stale active match set (boot used to
    // highlight Show matches when Compact mount failed after setting active).
    const mode = normalizeViewMode(viewMode);
    if (mode === 'compact' || mode === 'selected') return mode;
    if (filterState.active) return 'matches';
    return 'all';
  }

  function viewButtonsLocked() {
    return !!(filterRunning || viewRestorePending);
  }

  /** Hide native cards before Compact host exists so refresh never flashes Show all. */
  function hideNativeListForPendingCompact() {
    const list = favoritesListEl();
    if (!list) return;
    // Class-only: CSS hides child .item.thumb. Never display:none the list
    // shell — that left a blank card area when Compact restore failed.
    list.classList.add(`${NS}-native-thumbs-hidden`);
    if (list.style.getPropertyValue('display') === 'none') list.style.removeProperty('display');
  }

  function clearPendingNativeListHide() {
    qsa(document, `.${NS}-native-thumbs-hidden`).forEach((el) => {
      if (el.classList.contains(`${NS}-compact-thumbs`)) return;
      el.classList.remove(`${NS}-native-thumbs-hidden`);
      if (el.style.getPropertyValue('display') === 'none') el.style.removeProperty('display');
      if (el.style.getPropertyValue('visibility') === 'hidden') {
        el.style.removeProperty('visibility');
      }
    });
  }

  /**
   * After Compact / pending hide, native thumbs are display:none while reload
   * may have already run lazyload. Kick again once they have layout.
   */
  function kickNativeThumbLazyloadAfterReveal() {
    const run = () => {
      try {
        reinitPageThumbLazyload();
      } catch (_) {
        /* ignore */
      }
    };
    run();
    requestAnimationFrame(() => {
      run();
      setTimeout(run, 120);
    });
  }

  function readSelectRangeFromDom() {
    const bar = qs(document, `.${NS}-controls`) || document;
    const startEl = qs(bar, '[data-role="select-start"]');
    const endEl = qs(bar, '[data-role="select-end"]');
    const seqStartEl = qs(bar, '[data-role="select-seq-start"]');
    const seqEndEl = qs(bar, '[data-role="select-seq-end"]');
    return {
      selectStart: startEl
        ? String(startEl.value || '').trim()
        : String(selectStartSaved || ''),
      selectEnd: endEl
        ? String(endEl.value || '').trim()
        : String(selectEndSaved || ''),
      selectSeqStart: seqStartEl
        ? String(seqStartEl.value || '').trim()
        : String(selectSeqStartSaved || ''),
      selectSeqEnd: seqEndEl
        ? String(seqEndEl.value || '').trim()
        : String(selectSeqEndSaved || ''),
    };
  }

  function toolbarFiltersSnapshot() {
    const range = readSelectRangeFromDom();
    selectStartSaved = range.selectStart;
    selectEndSaved = range.selectEnd;
    selectSeqStartSaved = range.selectSeqStart;
    selectSeqEndSaved = range.selectSeqEnd;
    // Prefer live Compact DOM over a stale viewMode / active-match pair.
    const savedMode = normalizeViewMode(viewMode);
    const liveMode = compactViewActive
      ? savedMode === 'selected'
        ? 'selected'
        : 'compact'
      : savedMode === 'compact' || savedMode === 'selected'
        ? savedMode
        : filterState.active
          ? 'matches'
          : savedMode;
    return {
      localOn: !!filterState.localOn,
      cloudOn: !!filterState.cloudOn,
      favoriteOn: !!filterState.favoriteOn,
      playlistOn: !!filterState.playlistOn,
      futaOn: !!filterState.futaOn,
      straightOn: !!filterState.straightOn,
      durMinMin: String(filterState.durMinMin || ''),
      durMaxMin: String(filterState.durMaxMin || ''),
      titleQuery: String(filterState.titleQuery || ''),
      viewMode: normalizeViewMode(liveMode),
      selectStart: selectStartSaved,
      selectEnd: selectEndSaved,
      selectSeqStart: selectSeqStartSaved,
      selectSeqEnd: selectSeqEndSaved,
      compactSortKey: parseCompactSortKey(compactSortKey).key,
      toolbarMiddleCollapsed: !!toolbarMiddleCollapsed,
    };
  }

  function isFlatToolbarFiltersBag(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    return (
      Object.prototype.hasOwnProperty.call(raw, 'localOn') ||
      Object.prototype.hasOwnProperty.call(raw, 'viewMode') ||
      Object.prototype.hasOwnProperty.call(raw, 'compactSortKey') ||
      Object.prototype.hasOwnProperty.call(raw, 'toolbarMiddleCollapsed')
    );
  }

  async function saveFilterState() {
    const data = await storageGet({ [STORAGE_FILTERS]: {} });
    let all = data[STORAGE_FILTERS];
    if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
    if (isFlatToolbarFiltersBag(all)) {
      all = { favorites: { ...all } };
    }
    all[indexScopeKey()] = toolbarFiltersSnapshot();
    await storageSet({ [STORAGE_FILTERS]: all });
  }

  function syncToolbarInputsFromState() {
    const bar = qs(document, `.${NS}-controls`) || qs(document, `.${NS}-filterbar`);
    if (!bar) return;
    const minIn = qs(bar, '[data-role="dur-min"]');
    const maxIn = qs(bar, '[data-role="dur-max"]');
    if (minIn) minIn.value = filterState.durMinMin || '';
    if (maxIn) maxIn.value = filterState.durMaxMin || '';
    const titleIn = qs(bar, '[data-role="title-query"]');
    if (titleIn) titleIn.value = filterState.titleQuery || '';
    const startIn = qs(bar, '[data-role="select-start"]');
    const endIn = qs(bar, '[data-role="select-end"]');
    if (startIn) startIn.value = selectStartSaved || '';
    if (endIn) endIn.value = selectEndSaved || '';
    const seqStartIn = qs(bar, '[data-role="select-seq-start"]');
    const seqEndIn = qs(bar, '[data-role="select-seq-end"]');
    if (seqStartIn) seqStartIn.value = selectSeqStartSaved || '';
    if (seqEndIn) seqEndIn.value = selectSeqEndSaved || '';
    syncPageRangePlaceholders();
    syncSeqRangeClamp();
  }

  function applyToolbarFilters(raw) {
    const saved = raw && typeof raw === 'object' ? raw : {};
    const f = { ...defaultToolbarFilters(), ...saved };
    filterState.localOn = f.localOn !== false;
    filterState.cloudOn = f.cloudOn !== false;
    filterState.favoriteOn = f.favoriteOn !== false;
    filterState.playlistOn = f.playlistOn !== false;
    filterState.futaOn = f.futaOn !== false;
    filterState.straightOn = f.straightOn !== false;
    if (!filterState.localOn && !filterState.cloudOn) {
      filterState.localOn = true;
      filterState.cloudOn = true;
    }
    if (!filterState.favoriteOn && !filterState.playlistOn) {
      filterState.favoriteOn = true;
      filterState.playlistOn = true;
    }
    if (!filterState.futaOn && !filterState.straightOn) {
      filterState.futaOn = true;
      filterState.straightOn = true;
    }
    filterState.durMinMin = String(f.durMinMin || '');
    filterState.durMaxMin = String(f.durMaxMin || '');
    filterState.titleQuery = String(f.titleQuery || '');
    compactSortKey = parseCompactSortKey(f.compactSortKey).key;
    toolbarMiddleCollapsed = !!f.toolbarMiddleCollapsed;
    viewMode = normalizeViewMode(f.viewMode);
    selectStartSaved = String(f.selectStart || '');
    selectEndSaved = String(f.selectEnd || '');
    selectSeqStartSaved = String(f.selectSeqStart || '');
    selectSeqEndSaved = String(f.selectSeqEnd || '');
    const bar = qs(document, `.${NS}-controls`) || qs(document, `.${NS}-filterbar`);
    syncToolbarInputsFromState();
    syncToolbarMiddleCollapsed(bar);
    syncCompactSortControls();
    updateFilterBarLabels();
  }

  async function loadToolbarFilters() {
    const data = await storageGet({ [STORAGE_FILTERS]: {} });
    const raw = data[STORAGE_FILTERS];
    let bag = {};
    if (isFlatToolbarFiltersBag(raw)) {
      bag = raw;
    } else if (raw && typeof raw === 'object') {
      bag = raw[indexScopeKey()] || {};
    }
    applyToolbarFilters(bag);
  }

  let restoreViewGeneration = 0;

  async function restoreToolbarView({ ensureIndex = true } = {}) {
    const gen = ++restoreViewGeneration;
    const mode = normalizeViewMode(viewMode);
    viewRestorePending =
      mode === 'compact' || mode === 'matches' || mode === 'selected';
    if (mode === 'compact' || mode === 'selected') hideNativeListForPendingCompact();
    updateFilterBarLabels();
    try {
      if (mode === 'selected') {
        try {
          await applySelectedCompactView({ quiet: true });
        } catch (_) {
          /* selection or index may be unavailable */
        }
        return;
      }
      if (mode === 'compact') {
        try {
          await applyCompactMatchesView({ ensureIndex, quiet: true });
        } catch (_) {
          /* index may be unavailable */
        }
        return;
      }
      if (mode === 'matches') {
        try {
          await applyLibraryFilter({ ensureIndex, quiet: true });
        } catch (_) {
          /* index may be unavailable */
        }
        return;
      }
      exitCompactView();
      filterState.active = false;
      filterState.matchedIds = null;
      filterState.matchCount = null;
      viewDeps = null;
      applyFilterToCurrentPage();
      updateFilterBarLabels();
    } finally {
      // A newer restore (library switch / retry) owns the pending flags.
      if (gen !== restoreViewGeneration) return;
      viewRestorePending = false;
      // If Compact restore failed, drop the pending native hide so the page is usable.
      // Also clear any half-applied match state so UI does not stick on Show matches.
      if (mode === 'compact' && !compactViewActive) {
        filterState.active = false;
        filterState.matchedIds = null;
        filterState.matchCount = null;
        viewDeps = null;
        viewMode = 'compact';
        document.documentElement.classList.remove(`${NS}-compact-active`);
        clearPendingNativeListHide();
        favoritesListEl()?.classList?.remove(`${NS}-native-thumbs-hidden`);
      }
      ensureCardGridVisible();
      updateFilterBarLabels();
    }
  }

  function indexIdleLabel() {
    return favIndexCache?.videos?.length ? 'Rebuild index' : 'Build index';
  }

  /** Idle Tag sex button: first baseline vs wipe-and-retag escape hatch. */
  function sexIdleLabel() {
    return indexHasSexBaseline(favIndexCache?.videos) ? 'Retag sex' : 'Tag sex';
  }

  /** User-facing live status for Tag sex (no internal “delta” jargon). */
  function sexTaggingLiveLabel({
    continueOnly = false,
    listChanged = false,
    left = 0,
    retagAll = false,
  } = {}) {
    if (retagAll) return 'Retagging all…';
    if (continueOnly) {
      const n = formatFavCount(Math.max(0, Number(left) || 0));
      return listChanged
        ? `List changed · tagging new + remaining (${n})…`
        : `Continuing sex tags (${n} left)…`;
    }
    return 'Tagging sex…';
  }

  async function confirmRetagAllSex() {
    return confirmModal({
      title: 'Retag all videos?',
      body: 'Clears all Futa/Straight labels and rebuilds them from each video page.',
      okLabel: 'Retag all',
      cancelLabel: 'Cancel',
      danger: true,
      modern: true,
    });
  }

  function parseCompactSortKey(key) {
    let raw = String(key || '');
    // Favorited (Favorites) ↔ Seq (playlist renumber ordinals); UI differs per page.
    if (isPlaylistDetailPage() && raw.startsWith('favorited-')) {
      raw = raw.replace(/^favorited-/, 'seq-');
    } else if (!isPlaylistDetailPage() && raw.startsWith('seq-')) {
      raw = raw.replace(/^seq-/, 'favorited-');
    }
    const fallback = defaultCompactSortKey();
    let k = COMPACT_SORT_KEYS.has(raw) ? raw : fallback;
    let desc = k.endsWith('-desc');
    let field = k.replace(/-asc$|-desc$/, '');
    if (isPlaylistDetailPage() && field === 'favorited') {
      field = 'seq';
      k = composeCompactSortKey(field, desc);
    } else if (!isPlaylistDetailPage() && field === 'seq') {
      field = 'favorited';
      k = composeCompactSortKey(field, desc);
    } else if (!COMPACT_SORT_FIELDS.has(field)) {
      k = fallback;
      desc = k.endsWith('-desc');
      field = k.replace(/-asc$|-desc$/, '');
    }
    return { field, desc, key: k };
  }

  function composeCompactSortKey(field, desc) {
    let f = COMPACT_SORT_FIELDS.has(field) ? field : 'uploaded';
    if (isPlaylistDetailPage() && f === 'favorited') f = 'seq';
    if (!isPlaylistDetailPage() && f === 'seq') f = 'favorited';
    return `${f}-${desc ? 'desc' : 'asc'}`;
  }

  function compareNullableNumber(a, b, desc) {
    const aOk = a != null && Number.isFinite(a);
    const bOk = b != null && Number.isFinite(b);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return desc ? b - a : a - b;
  }

  function parseCountText(text) {
    const s = String(text || '').trim().toUpperCase().replace(/,/g, '');
    const m = s.match(/^([\d.]+)\s*([KMB])?/);
    if (!m) return null;
    let n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    const u = m[2];
    if (u === 'K') n *= 1e3;
    else if (u === 'M') n *= 1e6;
    else if (u === 'B') n *= 1e9;
    return n;
  }

  function parseRatingValue(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const pct = s.match(/([\d.]+)\s*%/);
    if (pct) {
      const n = Number(pct[1]);
      return Number.isFinite(n) ? n : null;
    }
    const m = s.match(/^([\d.]+)/);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Higher = more recently favorited on the Favorites list.
   * Lower page/card index = nearer the front of the site list.
   */
  function favoritedOrderKey(item) {
    const page = Number(item?.favoritePage) || 0;
    const card = Number(item?.cardIndex) || 0;
    return -(page * 10000 + card);
  }

  /**
   * Higher = newer site upload. Rule34Video ids are monotonic with post_date;
   * list-card `.added` is favorites/playlist import time and must not drive this.
   */
  function uploadedOrderKey(item) {
    const id = Number(item?.videoId);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  /** Site upload relative age for the calendar row (not list-import `.added`). */
  function uploadedTextForItem(item) {
    return normalizeMetaText(item?.uploadedText);
  }

  function viewsForItem(item) {
    return parseCountText(item?.viewsText);
  }

  function ratingForItem(item) {
    return parseRatingValue(item?.ratingText);
  }

  function durationForItem(item) {
    const n = coerceDurationSec(item?.durationSec);
    return n == null ? null : n;
  }

  /** Renumber / Favorites ordinal (1…N). Null when unknown. */
  function seqOrderKey(item) {
    const n = Number(item?.ordinal);
    if (Number.isFinite(n) && n > 0) return n;
    return ordinalFromTitle(item?.title);
  }

  /**
   * Attach Helper renumber ordinals (and title-prefix fallbacks) for Seq sort.
   * Mutates items in place; safe on index rows shared with favIndexCache.
   */
  async function ensureCompactItemOrdinals(items) {
    const list = Array.isArray(items) ? items : [];
    list.forEach((v) => {
      const cur = Number(v?.ordinal);
      if (Number.isFinite(cur) && cur > 0) return;
      const fromTitle = ordinalFromTitle(v?.title);
      if (fromTitle) v.ordinal = fromTitle;
    });
    const missing = list.filter((v) => {
      const n = Number(v?.ordinal);
      return !(Number.isFinite(n) && n > 0);
    });
    if (!missing.length) return list;
    const map = {};
    const CHUNK = 500;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK).map((v) => String(v.videoId));
      try {
        const looked = await send('HELPER_ORDINALS_LOOKUP', { videoIds: chunk });
        Object.assign(map, looked?.ordinals || {});
      } catch (_) {
        /* Helper optional */
      }
    }
    list.forEach((v) => {
      const cur = Number(v?.ordinal);
      if (Number.isFinite(cur) && cur > 0) return;
      const seq = Number(map[String(v.videoId)]);
      if (Number.isFinite(seq) && seq > 0) v.ordinal = seq;
    });
    return list;
  }

  function sortCompactItems(items, sortKey = compactSortKey) {
    const list = Array.isArray(items) ? [...items] : [];
    const { field, desc } = parseCompactSortKey(sortKey);
    list.sort((a, b) => {
      let cmp = 0;
      if (field === 'duration') {
        cmp = compareNullableNumber(durationForItem(a), durationForItem(b), desc);
      } else if (field === 'views') {
        cmp = compareNullableNumber(viewsForItem(a), viewsForItem(b), desc);
      } else if (field === 'rating') {
        cmp = compareNullableNumber(ratingForItem(a), ratingForItem(b), desc);
      } else if (field === 'uploaded') {
        cmp = compareNullableNumber(uploadedOrderKey(a), uploadedOrderKey(b), desc);
      } else if (field === 'seq') {
        cmp = compareNullableNumber(seqOrderKey(a), seqOrderKey(b), desc);
      } else {
        // Favorited: Favorites collection order (page + card).
        cmp = compareNullableNumber(favoritedOrderKey(a), favoritedOrderKey(b), desc);
      }
      if (cmp) return cmp;
      const pageCmp = (Number(a?.favoritePage) || 0) - (Number(b?.favoritePage) || 0);
      if (pageCmp) return pageCmp;
      const cardCmp = (Number(a?.cardIndex) || 0) - (Number(b?.cardIndex) || 0);
      if (cardCmp) return cardCmp;
      return String(a?.videoId || '').localeCompare(String(b?.videoId || ''), undefined, { numeric: true });
    });
    return list;
  }

  function syncCompactSortControls() {
    const bar = qs(document, `.${NS}-controls`);
    if (!bar) return;
    const { field, desc } = parseCompactSortKey(compactSortKey);
    const arrow = desc ? '↓' : '↑';
    qsa(bar, '[data-act="compact-sort-field"]').forEach((btn) => {
      const active = btn.dataset.sortField === field;
      const base = btn.dataset.sortLabel || btn.textContent.replace(/\s*[↑↓]\s*$/, '').trim();
      if (!btn.dataset.sortLabel) btn.dataset.sortLabel = base;
      btn.classList.toggle('is-active-sort', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.disabled = !compactViewActive;
      if (active) {
        btn.textContent = `${base} ${arrow}`;
        btn.title = desc
          ? `${base} descending · click for ascending`
          : `${base} ascending · click for descending`;
        btn.setAttribute(
          'aria-label',
          desc ? `Sort by ${base}, descending` : `Sort by ${base}, ascending`,
        );
      } else {
        btn.textContent = base;
        btn.title = `Sort by ${base}`;
        btn.setAttribute('aria-label', `Sort by ${base}`);
      }
    });
    const tools = qs(bar, `.${NS}-compact-tools`);
    if (tools) {
      const open = !!compactViewActive;
      tools.classList.toggle('is-open', open);
      tools.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
  }

  async function applyCompactSortPreference(nextKey, { render = true } = {}) {
    const { key, field, desc } = parseCompactSortKey(nextKey);
    compactSortKey = key;
    syncCompactSortControls();
    saveFilterState().catch(() => {});
    if (compactViewActive && compactMatchedItems.length) {
      if (field === 'seq') {
        compactMatchedItems = await ensureCompactItemOrdinals(compactMatchedItems);
      }
      compactMatchedItems = sortCompactItems(compactMatchedItems, key);
      compactPage = 1;
      if (render) {
        renderCompactPage();
        updateFilterBarLabels();
        updateToolbarLabels();
        const activeField = qs(
          document,
          `.${NS}-controls [data-act="compact-sort-field"][data-sort-field="${field}"]`,
        );
        const label = activeField?.dataset?.sortLabel || field;
        setFlash(`Matches sort · ${label} ${desc ? '↓' : '↑'}`);
      }
    }
  }

  async function applyCompactSortField(field) {
    const { field: cur, desc } = parseCompactSortKey(compactSortKey);
    const nextField = String(field || '').trim() || defaultCompactSortKey().replace(/-asc$|-desc$/, '');
    if (nextField === cur) {
      await applyCompactSortPreference(composeCompactSortKey(nextField, !desc));
    } else {
      await applyCompactSortPreference(composeCompactSortKey(nextField, true));
    }
  }

  function syncToolbarMiddleCollapsed(box = qs(document, `.${NS}-controls`)) {
    if (!box) return;
    box.classList.toggle(`${NS}-middle-collapsed`, toolbarMiddleCollapsed);
    const fav = qs(document, `[data-role="favcount"], .${NS}-favcount`);
    if (fav) {
      fav.setAttribute('aria-expanded', toolbarMiddleCollapsed ? 'false' : 'true');
      fav.title = toolbarMiddleCollapsed
        ? 'Show Command, Match, View, and Select (F)'
        : 'Hide Command, Match, View, and Select (F)';
    }
    syncFixedToolbarInset();
  }

  function toggleToolbarMiddle() {
    toolbarMiddleCollapsed = !toolbarMiddleCollapsed;
    syncToolbarMiddleCollapsed();
    saveFilterState().catch(() => {});
  }

  function isEditableKeyTarget(el) {
    if (!el || !(el instanceof Element)) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return !!el.closest('input, textarea, select, [contenteditable="true"]');
  }

  function onToggleToolbarHotkey(e) {
    if (e.key !== 'f' && e.key !== 'F') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditableKeyTarget(e.target)) return;
    if (document.querySelector('dialog[open]')) return;
    // Online small-window / fullscreen owns F (window capture beats site player).
    if (
      onlinePlaybackSession ||
      document.documentElement.classList.contains(`${NS}-online-playing`)
    ) {
      if (onlinePlaybackSession?.surface) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleOnlineSurfaceFullscreen(onlinePlaybackSession);
      }
      return;
    }
    if (!isFavoritesPage() && !isPlaylistDetailPage()) return;
    e.preventDefault();
    e.stopPropagation();
    toggleToolbarMiddle();
  }
  // Window capture beats site player F handlers; document alone can lose the race.
  window.addEventListener('keydown', onToggleToolbarHotkey, true);
  /**
   * Snapshot of a live native card (clone + pixel metrics) taken before the
   * native grid is hidden. Reused across compact pages so getComputedStyle on
   * display:none samples cannot collapse thumb width.
   */
  let compactCardTemplate = null;
  /**
   * Dirty flags: set when stores may lag behind site/disk; cleared by Scan,
   * Build/Rebuild, or successful index patches. Show matches refreshes only
   * what is dirty/missing — no background auto-sync on every favorite change.
   */
  let diskIndexDirty = false;
  let listIndexDirty = false;
  let favoritesIndexDirty = false;
  let playlistIndexesDirty = false;
  let lastDiskScanAt = 0;
  /** Helper video root mount: true/false after health/scan; null until probed. */
  let videoRootExists = null;
  /** Which stores the frozen View depended on (set by Show matches). */
  let viewDeps = null;
  /** Separate from list Build index so Favorites can be indexed from a playlist page. */
  let favoritesRemoteIndexRunning = false;

  function diskFilterIsAll() {
    return filterState.localOn && filterState.cloudOn;
  }

  function collectionFilterIsAll() {
    return filterState.favoriteOn && filterState.playlistOn;
  }

  /** Both on = no Futa/Straight restriction (Gay/Music/Iwara/unknown still shown). */
  function sexFilterIsAll() {
    return filterState.futaOn && filterState.straightOn;
  }

  function videoSexGroupSet(video) {
    return new Set(
      String(video?.sexGroup || '')
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  function countSexTagged(videos) {
    return (Array.isArray(videos) ? videos : []).reduce(
      (n, v) => n + (videoSexGroupSet(v).size ? 1 : 0),
      0,
    );
  }

  function countSexUntagged(videos) {
    return (Array.isArray(videos) ? videos : []).reduce(
      (n, v) => n + (videoSexGroupSet(v).size ? 0 : 1),
      0,
    );
  }

  /** Broken Tag sex used to dual-label almost everything as futa,straight. */
  function countSexDualLabeled(videos) {
    return (Array.isArray(videos) ? videos : []).reduce((n, v) => {
      const g = videoSexGroupSet(v);
      return n + (g.has('futa') && g.has('straight') ? 1 : 0);
    }, 0);
  }

  function sexLabelsLookCorrupt(videos) {
    const list = Array.isArray(videos) ? videos : [];
    if (list.length < 12) return false;
    const dual = countSexDualLabeled(list);
    return dual / list.length >= 0.5;
  }

  /** True once a full Tag (or any prior sex label) exists on this index. */
  function indexHasSexBaseline(videos) {
    return countSexTagged(videos) > 0;
  }

  /** Same fingerprint as background sexMembershipSigFromVideos (id set, not titles). */
  function sexMembershipSigFromVideos(videos) {
    const ids = (Array.isArray(videos) ? videos : [])
      .map((v) => String(v?.videoId || '').trim())
      .filter((id) => /^[1-9]\d*$/.test(id));
    ids.sort();
    let h = 2166136261;
    for (const id of ids) {
      for (let i = 0; i < id.length; i += 1) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      h ^= 124;
      h = Math.imul(h, 16777619);
    }
    return `${ids.length}:${(h >>> 0).toString(16)}`;
  }

  /** True when index membership drifted since last Tag sex pause (id set). */
  function sexMembershipChangedSincePause(videos, storedSig) {
    const prev = String(storedSig || '').trim();
    if (!prev) return false;
    return prev !== sexMembershipSigFromVideos(videos);
  }

  /** Newest-first page size guess for "small add → page-1 sex classify". */
  const SEX_AUTO_PAGE1_MAX = 12;

  function collectionFilterLabels() {
    if (isPlaylistDetailPage()) return { member: 'Favorited', nonMember: 'Unfavorited' };
    return { member: 'In playlist', nonMember: 'Not in playlist' };
  }

  function stampViewDeps() {
    viewDeps = {
      disk: !diskFilterIsAll(),
      list: true,
      fav: !collectionFilterIsAll() && isPlaylistDetailPage(),
      playlist: !collectionFilterIsAll() && !isPlaylistDetailPage(),
    };
  }

  function frozenViewStoresDirty() {
    if (!filterState.active && !filterState.matchedIds) return false;
    const deps = viewDeps || {
      disk: true,
      list: true,
      fav: true,
      playlist: true,
    };
    return !!(
      (deps.disk && diskIndexDirty) ||
      (deps.list && listIndexDirty) ||
      (deps.fav && favoritesIndexDirty) ||
      (deps.playlist && playlistIndexesDirty)
    );
  }

  /**
   * Drop frozen Compact / Show matches (store edits, downloads). Match chip /
   * Duration edits do not use this — they refresh the active View in place.
   */
  function invalidateFrozenView() {
    const hadView = !!(filterState.active || filterState.matchedIds || compactViewActive);
    exitCompactView();
    if (!hadView && !filterState.active && !filterState.matchedIds) return;
    filterState.active = false;
    filterState.matchedIds = null;
    filterState.matchCount = null;
    viewDeps = null;
    applyFilterToCurrentPage();
  }

  /** Drop frozen View when a store it depended on changed (Edit, download, dirty). */
  function invalidateFrozenViewForStoreChange() {
    if (!filterState.active && !filterState.matchedIds && !compactViewActive) return;
    // Edit patches always clear View (selection set changed). Dirty-only paths
    // use frozenViewStoresDirty via All matches; downloads pass forceDisk below.
    invalidateFrozenView();
    updateFilterBarLabels();
  }

  /**
   * Unfavorite / Remove from list / Move off Favorites: drop ids from the
   * active Compact / Show matches set without leaving that View.
   */
  function pruneIdsFromActiveMatchView(ids) {
    const want = new Set((ids || []).map(String).filter(Boolean));
    if (!want.size) return;
    // Compact hides the native grid; always drop those nodes too so List /
    // List (match) do not keep unfavorited videos until a full refresh.
    removeListCardsByIds([...want]);
    const hadView = !!(filterState.active || filterState.matchedIds || compactViewActive);
    if (!hadView) {
      updateFilterBarLabels();
      return;
    }

    if (filterState.matchedIds) {
      want.forEach((id) => filterState.matchedIds.delete(id));
      filterState.matchCount = filterState.matchedIds.size;
    }

    if (compactViewActive) {
      const next = compactMatchedItems.filter((v) => !want.has(String(v.videoId)));
      if (next.length !== compactMatchedItems.length) {
        compactMatchedItems = next;
        filterState.matchCount = next.length;
        if (filterState.matchedIds) {
          filterState.matchedIds = new Set(next.map((v) => String(v.videoId)));
        }
        const pages = Math.max(1, compactPageCount());
        if (compactPage > pages) compactPage = pages;
        try {
          renderCompactPage();
          wireCardClicks();
          syncCompactSortControls();
        } catch (_) {
          /* list host may be mid-replace */
        }
        refreshLookup().catch(() => {});
        restoreSelectionToPage(parseCards()).catch(() => {});
      }
    } else if (filterState.active) {
      applyFilterToCurrentPage();
    }

    updateFilterBarLabels();
    updateToolbarLabels();
    saveFilterState().catch(() => {});
  }

  function invalidateFrozenViewIfDiskChanged() {
    // Boot restores Compact before Scan; queue status must not wipe that View.
    if (bootInProgress) return;
    if (!filterState.active && !filterState.matchedIds && !compactViewActive) return;
    if (viewDeps && !viewDeps.disk) return;
    invalidateFrozenView();
    updateFilterBarLabels();
  }

  /**
   * Match chips / duration change rules. Keep Compact / Show matches and refresh
   * that View with the new rules (Reset Match uses the same path).
   */
  function onMatchRuleEdited({ immediate = false } = {}) {
    const keepMode = uiViewMode();
    updateFilterBarLabels();
    saveFilterState().catch(() => {});
    // Show selected ignores Match chips — keep the selection Compact as-is.
    if (keepMode === 'selected') return;
    if (keepMode !== 'compact' && keepMode !== 'matches') return;
    viewMode = keepMode;
    scheduleMatchViewReapply({ immediate });
  }

  function scheduleMatchViewReapply({ immediate = false } = {}) {
    matchViewReapplyGen += 1;
    const gen = matchViewReapplyGen;
    if (matchViewReapplyTimer) {
      clearTimeout(matchViewReapplyTimer);
      matchViewReapplyTimer = null;
    }
    const run = () => {
      matchViewReapplyTimer = null;
      reapplyCurrentMatchView({ quiet: true, gen }).catch(() => {});
    };
    if (immediate) {
      run();
      return;
    }
    matchViewReapplyTimer = setTimeout(run, 280);
  }

  async function reapplyCurrentMatchView({ quiet = true, gen = matchViewReapplyGen } = {}) {
    const mode = normalizeViewMode(viewMode);
    if (mode === 'compact') {
      try {
        await applyCompactMatchesView({ ensureIndex: true, quiet, force: true });
      } catch (_) {
        /* index may be unavailable */
      }
    } else if (mode === 'matches') {
      try {
        await applyLibraryFilter({ ensureIndex: true, quiet, force: true });
      } catch (_) {
        /* index may be unavailable */
      }
    }
    if (gen !== matchViewReapplyGen) {
      await reapplyCurrentMatchView({ quiet, gen: matchViewReapplyGen });
    }
  }

  /**
   * Re-paint the whole video card area for the active View after the list index
   * or membership changes (Rebuild index, Unfavorite, Remove from list).
   * Index is assumed fresh in cache when ensureIndex is false.
   */
  async function refreshActiveCardArea({ quiet = true, ensureIndex = false } = {}) {
    if (!isFavoritesPage() && !isPlaylistDetailPage()) return;
    const mode = uiViewMode();
    if (mode === 'selected') {
      try {
        await applySelectedCompactView({ quiet });
      } catch (_) {
        /* selection or index may be unavailable */
      }
      return;
    }
    if (mode === 'compact') {
      try {
        await applyCompactMatchesView({ ensureIndex, quiet, force: true });
      } catch (_) {
        /* index may be unavailable */
      }
      return;
    }
    if (mode === 'matches') {
      try {
        await applyLibraryFilter({ ensureIndex, quiet, force: true });
      } catch (_) {
        /* index may be unavailable */
      }
      return;
    }
    // Show all: native grid membership is site-owned; refresh seq + local marks.
    try {
      const cards = parseCards();
      await applyOrdinalsToCards(cards);
      const matches = lastMatches || {};
      cards.forEach((card) => renderStatus(card, matches[card.videoId], scanned));
      syncCurrentPageLocalMark(cards, matches);
      scheduleEvaluateVisiblePages();
      if (!(bootInProgress && !scanned)) {
        await refreshLookup().catch(() => {});
      }
    } catch (_) {
      /* ignore */
    }
    ensureCardGridVisible();
    updateFilterBarLabels();
    updateToolbarLabels();
  }

  function indexCountDrifted(liveTotal, indexed) {
    const live = Number(liveTotal) || 0;
    const n = Number(indexed) || 0;
    if (!live || !n) return false;
    // Only refresh when the index is short. A larger stored index must not
    // trigger Compact → full Refresh loops (abs drift used to do that).
    return n + Math.max(5, Math.floor(live * 0.02)) < live;
  }

  function selectionItemsForIds(itemsMap, ids) {
    const map = itemsMap || {};
    return (ids || []).map((id) => {
      const key = String(id);
      const hit = map[key];
      if (hit) {
        return {
          videoId: key,
          title: hit.title || key,
          detailUrl: hit.detailUrl || `https://rule34video.com/video/${key}/v/`,
          favoritePage: Number(hit.favoritePage) || 0,
          cardIndex: Number.isInteger(hit.cardIndex) ? hit.cardIndex : 0,
          durationSec: coerceDurationSec(hit.durationSec),
        };
      }
      return {
        videoId: key,
        title: key,
        detailUrl: `https://rule34video.com/video/${key}/v/`,
        favoritePage: 0,
        cardIndex: 0,
        durationSec: null,
      };
    });
  }

  function ordinalFromTitle(title) {
    const m = String(title || '').match(ORDINAL_PREFIX_RE);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  async function persistIndex(scope, videos) {
    const list = Array.isArray(videos) ? videos : [];
    const next = {
      builtAt: Date.now(),
      favTotal: list.length,
      videos: list,
      scope: scope || 'favorites',
    };
    // Omit sexMembershipSig so background setFavIndex keeps the Tag sex pause fingerprint.
    const saved =
      (await send('FAV_INDEX_SET', { index: next, scope: scope || 'favorites' })) || next;
    if (scope === indexScopeKey()) {
      favIndexCache = saved;
      listIndexDirty = false;
      lastIndexStats = lastIndexStats || null;
      // Never raise brand / title totals from a bloated index length.
      const siteLock = optionalNonNegInt(siteNativeTitleCount);
      applyKnownLibraryTotal(
        siteLock != null && list.length > siteLock ? siteLock : list.length,
      );
      refreshScanLabelCounts();
      updateFavCountBar();
    }
    if (scope === 'favorites') {
      myFavIdSet = new Set(list.map((v) => String(v.videoId)));
      favoritesIndexDirty = false;
      if (!isPlaylistDetailPage()) {
        favIndexCache = saved;
        listIndexDirty = false;
        const siteLock = optionalNonNegInt(siteNativeTitleCount);
        applyKnownLibraryTotal(
          siteLock != null && list.length > siteLock ? siteLock : list.length,
        );
        refreshScanLabelCounts();
        updateFavCountBar();
      }
    }
    if (String(scope || '').startsWith('playlist:')) {
      invalidatePlaylistMembershipCache();
      playlistIndexesDirty = false;
    }
    updateFilterBarLabels();
    return saved;
  }

  /** Remove ids from a stored list index. Never writes a brand-new partial index. */
  async function patchIndexRemoveIds(scope, ids) {
    const want = new Set((ids || []).map(String).filter(Boolean));
    if (!want.size) return null;
    const touchingActiveScope =
      scope === indexScopeKey() ||
      (scope === 'favorites' && !isPlaylistDetailPage());
    let idx;
    try {
      idx = await send('FAV_INDEX_GET', { scope });
    } catch (_) {
      idx = null;
    }
    if (!idx?.videos?.length) {
      if (scope === indexScopeKey()) listIndexDirty = true;
      if (scope === 'favorites') {
        favoritesIndexDirty = true;
        myFavIdSet = null;
      }
      if (String(scope).startsWith('playlist:')) playlistIndexesDirty = true;
      // Keep Compact / Show matches; only drop the removed ids from the View.
      if (touchingActiveScope) pruneIdsFromActiveMatchView([...want]);
      return null;
    }
    const videos = idx.videos.filter((v) => !want.has(String(v.videoId)));
    if (videos.length === idx.videos.length) {
      // Site remove succeeded but index already lacked these ids — still drop
      // them from Compact / Show matches so the View does not go stale.
      if (touchingActiveScope) pruneIdsFromActiveMatchView([...want]);
      return idx;
    }
    const next = await persistIndex(scope, videos);
    // Keep Compact / Show matches; only drop the removed ids from the View.
    if (touchingActiveScope) pruneIdsFromActiveMatchView([...want]);
    return next;
  }

  /**
   * Assign favoritePage / cardIndex from newest-first array order.
   * Favorited Compact sort keys off these fields — must stay dense and unique.
   */
  function reassignIndexPageCards(videos, pageSize) {
    const list = Array.isArray(videos) ? videos : [];
    const per = Math.max(1, Number(pageSize) || 12);
    list.forEach((v, i) => {
      if (!v || typeof v !== 'object') return;
      v.favoritePage = Math.floor(i / per) + 1;
      v.cardIndex = i % per;
    });
    return list;
  }

  /** Duplicate or missing page/card slots break Favorited order after patch-adds. */
  function indexPageCardsLookCorrupt(videos) {
    const list = Array.isArray(videos) ? videos : [];
    if (list.length < 2) return false;
    const seen = new Set();
    for (let i = 0; i < list.length; i += 1) {
      const page = Number(list[i]?.favoritePage) || 0;
      const card = Number.isInteger(list[i]?.cardIndex) ? list[i].cardIndex : -1;
      if (page < 1 || card < 0) return true;
      const key = `${page}:${card}`;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }

  /**
   * Add items to an existing list index. If no index exists yet, mark dirty
   * instead of writing a tiny partial index that would break Show matches.
   * Site lists are newest-first: prepend new ids and renumber page/card so
   * Favorited Compact sort matches collection order (never append with a
   * shared cardIndex 0 — that left new favorites mid-list after renumber).
   */
  async function patchIndexAddItems(scope, items) {
    const batch = Array.isArray(items) ? items : [];
    if (!batch.length) return null;
    let idx;
    try {
      idx = await send('FAV_INDEX_GET', { scope });
    } catch (_) {
      idx = null;
    }
    if (!idx?.videos?.length) {
      if (scope === indexScopeKey()) listIndexDirty = true;
      if (scope === 'favorites') {
        favoritesIndexDirty = true;
        if (myFavIdSet) batch.forEach((it) => myFavIdSet.add(String(it.videoId)));
        else myFavIdSet = null;
      }
      if (String(scope).startsWith('playlist:')) playlistIndexesDirty = true;
      invalidateFrozenViewForStoreChange();
      return null;
    }
    const prior = Array.isArray(idx.videos) ? idx.videos : [];
    const seen = new Set(prior.map((v) => String(v.videoId)));
    // Last in batch = most recently favorited (site puts it at the front).
    const newRows = [];
    const addedIds = [];
    for (let i = batch.length - 1; i >= 0; i -= 1) {
      const it = batch[i];
      const id = String(it?.videoId || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      addedIds.push(id);
      newRows.push({
        videoId: id,
        title: it.title || id,
        detailUrl: it.detailUrl || `https://rule34video.com/video/${id}/v/`,
        favoritePage: 1,
        cardIndex: 0,
        durationSec: coerceDurationSec(it.durationSec),
        thumbUrl: normalizeThumbUrl(it.thumbUrl),
        previewUrl: normalizeThumbUrl(it.previewUrl),
        viewsText: normalizeMetaText(it.viewsText),
        ratingText: normalizeMetaText(it.ratingText),
        addedText: normalizeMetaText(it.addedText),
        uploadedText: normalizeMetaText(it.uploadedText),
        sexGroup: String(it.sexGroup || '').trim(),
      });
    }
    if (!newRows.length) {
      if (scope === 'favorites') {
        myFavIdSet = new Set(prior.map((v) => String(v.videoId)));
        favoritesIndexDirty = false;
      }
      return idx;
    }
    // addedIds was filled newest-first; reverse for callers that expect add order.
    addedIds.reverse();
    const videos = reassignIndexPageCards(
      [...newRows, ...prior],
      cardsPerPageEstimate(),
    );
    const next = await persistIndex(scope, videos);
    invalidateFrozenViewForStoreChange();
    // Sex baseline exists → auto-fill labels for new ids (page-1 or delta job).
    scheduleSexAutoAfterAdd(scope, addedIds).catch(() => {});
    return next;
  }

  async function ensureMyFavIdSet({ force = false } = {}) {
    if (!force && myFavIdSet && !favoritesIndexDirty) return myFavIdSet;
    try {
      const idx = await send('FAV_INDEX_GET', { scope: 'favorites' });
      myFavIdSet = new Set((idx?.videos || []).map((v) => String(v.videoId)));
    } catch (_) {
      myFavIdSet = myFavIdSet || new Set();
    }
    return myFavIdSet;
  }

  async function ensurePlaylistMembershipSet({ force = false } = {}) {
    // Reload memory from storage when forced or empty. Do not clear
    // playlistIndexesDirty here — storage itself may still be stale after Edit.
    if (!force && playlistMembershipSet) return playlistMembershipSet;
    try {
      const data = await send('PLAYLIST_MEMBERSHIP_GET');
      playlistMembershipSet = new Set((data?.videoIds || []).map((id) => String(id)));
      playlistMembershipScopes = Array.isArray(data?.scopes) ? data.scopes : [];
    } catch (_) {
      playlistMembershipSet = playlistMembershipSet || new Set();
      playlistMembershipScopes = playlistMembershipScopes || [];
    }
    return playlistMembershipSet;
  }

  function invalidatePlaylistMembershipCache() {
    playlistMembershipSet = null;
    playlistMembershipScopes = null;
  }

  /** Disk presence for Local/Not local — scan only when missing or marked dirty. */
  async function ensureFreshDiskForMatch() {
    if (diskFilterIsAll()) return;
    // Boot paints Compact from the list index first; outer doScan re-applies
    // Local/Not-local after disk marks exist. Nested Scan here made restore
    // slower than Show-all → click Compact.
    if (bootInProgress) return;
    if (!scanned || !localIdSet.size || diskIndexDirty) {
      await doScan();
    }
  }

  /**
   * Current list index for Show matches / Duration / cross-page Local.
   * Empty → Full Build; dirty or count drift → page-1 Refresh merge; otherwise reuse.
   * Never runs Futa/Straight (sex groups are a separate button / sex-only job).
   */
  async function ensureFreshListIndexForMatch() {
    await loadFavIndexCache();
    // Boot: never block Compact on crawl/refresh — use the stored index as-is.
    if (bootInProgress) return;
    // Drift must use title/pager — not detectFavoritesTotal (which prefers index).
    const liveTotal = liveLibraryTotalForDrift();
    const indexed = favIndexCache?.videos?.length || 0;
    if (!indexed) {
      await buildFavIndex({ force: true, mode: 'full' });
      listIndexDirty = false;
      return;
    }
    if (
      listIndexDirty ||
      indexCountDrifted(liveTotal, indexed) ||
      indexPageCardsLookCorrupt(favIndexCache?.videos)
    ) {
      // Auto Match refresh: page 1 only (do not use toolbar from–to).
      // Also recover duplicate page/card slots left by older patch-add bugs.
      await buildFavIndex({ force: true, mode: 'incremental', fromPage: 1, toPage: 1 });
      listIndexDirty = false;
    }
  }

  /** Favorites index used by Favorited/Unfavorited (and Prune keep-set). */
  async function ensureFreshFavoritesIndexForMatch({ forceRebuild = false } = {}) {
    if (forceRebuild || favoritesIndexDirty) {
      myFavIdSet = null;
    }
    await ensureMyFavIdSet({ force: forceRebuild || favoritesIndexDirty });
    if (myFavIdSet && myFavIdSet.size && !favoritesIndexDirty && !forceRebuild) {
      return myFavIdSet;
    }
    const favIdx = await send('FAV_INDEX_GET', { scope: 'favorites' });
    if (favIdx?.videos?.length && !favoritesIndexDirty && !forceRebuild) {
      myFavIdSet = new Set(favIdx.videos.map((v) => String(v.videoId)));
      return myFavIdSet;
    }
    // Boot Compact must not wait on a Favorites crawl — use whatever we have.
    if (bootInProgress) return myFavIdSet || new Set();
    // Progress stays on status / Index — never overwrite Compact / Show matches.
    await buildFavoritesIndexRemote();
    favoritesIndexDirty = false;
    return myFavIdSet;
  }

  function detectFavoritesTotal() {
    if (isPlaylistDetailPage()) {
      const trusted = trustedIndexedTotal();
      if (trusted != null) return trusted;

      // knownLibraryTotal starts null — Number(null) === 0 must not win.
      const known = optionalNonNegInt(knownLibraryTotal);
      if (known != null) return known;

      const native = qs(document, `.${NS}-playlist-native-title`);
      const stored = optionalNonNegInt(native?.dataset?.hxyrulePlaylistVideoCount);
      const dom = detectLibraryTotalFromDom();
      const indexed = Number(favIndexCache?.videos?.length) || 0;
      const maxP = playlistPaginationMax();
      const cards = Math.max(nativeListCardCount(), parseCards().length, 0);
      const per =
        (stablePerPage && stablePerPage > 0 ? stablePerPage : 0) ||
        Math.max(cards, 1);
      // No trusted full index: combine native/dom + pager lower bound. Never
      // use full-page×maxP upper bounds (see detectLibraryTotalFromDom).
      let best = 0;
      if (stored != null && stored > 0) best = Math.max(best, stored);
      if (dom) best = Math.max(best, dom);
      if (maxP > 1 && per > 0) best = Math.max(best, (maxP - 1) * per + 1);
      if (!best && indexed > 0) best = indexed;
      if (best > 0) return best;
      // Empty playlist (no cards): report 0 — do not invent per=1.
      return cards > 0 ? per : 0;
    }

    // Favorites (often thousands): index > known (post-delete) > site headline.
    // Never invent a toolbar total from pager math.
    const trusted = trustedIndexedTotal();
    if (trusted != null) return trusted;
    const known = optionalNonNegInt(knownLibraryTotal);
    if (known != null) return known;
    const dom = detectLibraryTotalFromDom();
    if (dom) return dom;
    return null;
  }

  function hasListIndexForScanFraction() {
    return (
      !listIndexDirty &&
      Array.isArray(favIndexCache?.videos) &&
      favIndexCache.videos.length > 0
    );
  }

  /** How many videos in the current list index (or visible page) are on disk. */
  function countLocalMatchesForCurrentList() {
    if (!localIdSet.size) return 0;
    const indexed = Array.isArray(favIndexCache?.videos) ? favIndexCache.videos : [];
    if (indexed.length) {
      let n = 0;
      indexed.forEach((v) => {
        if (localIdSet.has(String(v.videoId))) n += 1;
      });
      return n;
    }
    // No index yet — fall back to visible cards only (never global disk count).
    let n = 0;
    parseCards().forEach((card) => {
      if (localIdSet.has(String(card.videoId))) n += 1;
    });
    return n;
  }

  function refreshScanLabelCounts() {
    const total = detectFavoritesTotal();
    if (total != null && Number(total) >= 0) scanFavTotal = Number(total);
    if (localIdSet.size || scanned) {
      scanMatched = countLocalMatchesForCurrentList();
    }
  }

  function applyVideoRootHealth(health) {
    if (health && typeof health.directoryExists === 'boolean') {
      videoRootExists = health.directoryExists;
    }
  }

  function updateToolbarLabels() {
    updateFavCountBar();
    const root = qs(document, `.${NS}-controls`) || document;
    const scanBtn = qs(root, `[data-act="scan"]`);
    if (scanBtn) {
      // Disk mounted → local/total after Scan; unmounted → no fraction.
      const rootOk = videoRootExists === true;
      if (
        rootOk &&
        (scanned || localIdSet.size) &&
        scanMatched != null &&
        scanFavTotal != null &&
        hasListIndexForScanFraction()
      ) {
        scanBtn.textContent = `Scan local (${scanMatched}/${scanFavTotal})`;
        scanBtn.title = 'Local matches in this list / list total';
      } else {
        scanBtn.textContent = 'Scan local';
        scanBtn.title =
          videoRootExists === false
            ? 'Video root not mounted — mount the disk, then Scan local'
            : rootOk && (scanned || localIdSet.size) && !hasListIndexForScanFraction()
              ? 'Disk scanned. Build index for list-wide Scan local (local/total).'
              : 'Scan the local video root for matches on this list';
      }
    }
    const clearBtn = qs(root, `[data-act="clear"]`);
    if (clearBtn) {
      if (selProgress) {
        // N + (a/b) = selection before range · videos fetched so far / expected in range.
        clearBtn.textContent = `Clear · ${selProgress.base} + (${selProgress.fetched}/${selProgress.total})`;
        clearBtn.title = 'Stop Page range and clear selection';
      } else {
        clearBtn.textContent = `Clear · ${selCountCached}`;
        clearBtn.title = 'Clear selection';
      }
    }
    const downloading = !!(downloadProgressLabel && downloadProgressLabel !== 'idle');
    const downloadBtn = qs(root, `[data-act="download"]`);
    if (downloadBtn) {
      if (downloading) {
        downloadBtn.textContent = `+ Download (${downloadProgressLabel})`;
        downloadBtn.title = 'Append selected videos to the active download queue';
      } else {
        downloadBtn.textContent = 'Download';
        downloadBtn.title = 'Queue selected videos for download';
      }
    }
    const stopBtn = qs(root, `[data-act="stop"]`);
    if (stopBtn) {
      stopBtn.hidden = !downloading;
      stopBtn.disabled = !downloading;
      stopBtn.textContent = 'Stop';
    }
    const selectPageBtn = qs(root, `[data-act="select-page"]`);
    if (selectPageBtn) {
      const cards = parseCards().filter(
        (card) => !card.el.classList.contains(`${NS}-filtered-out`),
      );
      const allOn = cards.length > 0 && cards.every((c) => isCardChecked(c));
      selectPageBtn.textContent = allOn ? 'Deselect page' : 'This page';
      selectPageBtn.title = allOn
        ? 'Clear selection on this page'
        : 'Select all visible videos on this page (click again to deselect)';
    }
    const rebuildBtn = qs(root, `[data-act="rebuild-ordinals"]`);
    const renumberStop = qs(root, `[data-act="renumber-stop"]`);
    if (renumberStop) {
      renumberStop.hidden = !rebuildRunning;
      renumberStop.disabled = !rebuildRunning;
      renumberStop.textContent = 'Stop';
    }
    if (rebuildBtn) {
      if (rebuildRunning) {
        rebuildBtn.disabled = true;
        rebuildBtn.textContent = renumberProgressLabel
          ? `Renumber (${renumberProgressLabel})`
          : 'Renumber…';
        rebuildBtn.title = 'Renumber running (survives refresh; Stop to cancel).';
      } else if (indexRunning) {
        rebuildBtn.disabled = true;
        rebuildBtn.textContent =
          lastRenumberStats != null
            ? `Renumber (${lastRenumberStats.done}/${lastRenumberStats.total})`
            : 'Renumber';
        rebuildBtn.title =
          indexJobKind === 'sex'
            ? 'Wait for Tag sex / Retag sex to finish (or Stop it), then Renumber.'
            : 'Wait for Build/Rebuild index to finish (or Stop it), then Renumber.';
      } else {
        rebuildBtn.disabled = false;
        rebuildBtn.textContent =
          lastRenumberStats != null
            ? `Renumber (${lastRenumberStats.done}/${lastRenumberStats.total})`
            : 'Renumber';
        rebuildBtn.title =
          'Rebuild global Favorites ordinals and rename local files (survives refresh; Stop to cancel).';
      }
    }
    const favAddBtn = qs(root, `[data-act="fav-add"]`);
    const favAddStop = qs(root, `[data-act="fav-add-stop"]`);
    if (favAddStop) {
      favAddStop.hidden = !favAddRunning;
      favAddStop.disabled = !favAddRunning || favAddCancel;
      favAddStop.textContent = favAddCancel ? 'Stopping…' : 'Stop';
    }
    if (favAddBtn) {
      if (favAddRunning) {
        favAddBtn.disabled = true;
        favAddBtn.textContent = favAddProgressLabel
          ? `Adding (${favAddProgressLabel})`
          : 'Adding…';
        favAddBtn.title = 'Add to Favorites running (survives refresh; Stop to cancel).';
      } else {
        favAddBtn.disabled = false;
        favAddBtn.textContent = 'Add to Favorites';
        favAddBtn.title = 'Add selected videos to My Favorites (survives refresh; Stop to cancel).';
      }
    }
    const delBtn = qs(root, `[data-act="delete-favs"]`);
    if (delBtn && !deleteRunning) {
      delBtn.disabled = false;
      delBtn.textContent = isPlaylistDetailPage() ? 'Remove from list' : 'Unfavorite';
    }
    const pruneBtn = qs(root, `[data-act="prune-local"]`);
    if (pruneBtn && !pruneRunning) {
      pruneBtn.disabled = false;
      pruneBtn.textContent = 'Prune local';
    }
    updateFilterBarLabels();
  }

  function updateFilterBarLabels() {
    const bar = qs(document, `.${NS}-controls`) || qs(document, `.${NS}-filterbar`);
    if (!bar) return;
    const coll = collectionFilterLabels();
    const toggles = [
      ['filter-local', filterState.localOn, 'Local'],
      ['filter-cloud', filterState.cloudOn, 'Not local'],
      ['filter-favorite', filterState.favoriteOn, coll.member],
      ['filter-playlist', filterState.playlistOn, coll.nonMember],
      ['filter-futa', filterState.futaOn, 'Futa'],
      ['filter-straight', filterState.straightOn, 'Straight'],
    ];
    toggles.forEach(([act, on, label]) => {
      const btn = qs(bar, `[data-act="${act}"]`);
      if (!btn) return;
      btn.classList.toggle('is-active', !!on);
      if (label) btn.textContent = label;
      btn.removeAttribute('title');
    });
    const idxBtn = qs(bar, '[data-act="index-build"]');
    const idxStop = qs(bar, '[data-act="index-stop"]');
    const idxSex = qs(bar, '[data-act="index-sex"]');
    const idxSexStop = qs(bar, '[data-act="index-sex-stop"]');
    // Require explicit kind so a stale indexRunning never leaves Index Stop visible.
    const crawlRunning = indexRunning && indexJobKind === 'crawl';
    const sexRunning = indexRunning && indexJobKind === 'sex';
    // Index Stop only while Build/Rebuild is active — not during Tag sex / Retag sex.
    if (idxStop) {
      idxStop.hidden = !crawlRunning;
      idxStop.disabled = !crawlRunning;
      idxStop.textContent = 'Stop';
    }
    if (idxSexStop) {
      idxSexStop.hidden = !sexRunning;
      idxSexStop.disabled = !sexRunning;
      idxSexStop.textContent = 'Stop';
    }
    if (idxBtn) {
      if (crawlRunning) {
        idxBtn.disabled = true;
        idxBtn.textContent = indexProgressLabel
          ? `Indexing (${indexProgressLabel})`
          : 'Indexing…';
        idxBtn.title = 'Indexing running (survives refresh; Stop to cancel).';
      } else if (sexRunning) {
        if (lastIndexStats != null) {
          const verb = indexIdleLabel();
          idxBtn.textContent = `${verb} (${lastIndexStats.done}/${lastIndexStats.total})`;
        } else {
          idxBtn.textContent = indexIdleLabel();
        }
        idxBtn.disabled = true;
        idxBtn.title =
          'Wait for Tag sex / Retag sex to finish (or Stop it), then Build/Rebuild index.';
      } else if (rebuildRunning) {
        if (lastIndexStats != null) {
          const verb = indexIdleLabel();
          idxBtn.textContent = `${verb} (${lastIndexStats.done}/${lastIndexStats.total})`;
        } else {
          idxBtn.textContent = indexIdleLabel();
        }
        idxBtn.disabled = true;
        idxBtn.title = 'Wait for Renumber to finish (or Stop it), then Build/Rebuild index.';
      } else {
        if (lastIndexStats != null) {
          const verb = indexIdleLabel();
          idxBtn.textContent = `${verb} (${lastIndexStats.done}/${lastIndexStats.total})`;
        } else {
          idxBtn.textContent = indexIdleLabel();
        }
        idxBtn.disabled = false;
        if (favIndexCache?.videos?.length) {
          idxBtn.title =
            'Rebuild the entire list index from the site (escape hatch). Native hearts and Edit already patch the index; Tag sex / Retag sex is separate.';
        } else {
          idxBtn.title =
            'Build a full list index once (needed for Compact / Match / cross-page Local). Tag sex is separate.';
        }
      }
    }
    if (idxSex) {
      const hasList = !!(favIndexCache?.videos?.length);
      const sexVerb = sexIdleLabel();
      if (sexRunning) {
        idxSex.disabled = true;
        idxSex.textContent = indexProgressLabel
          ? indexSexDelta
            ? `Tagging remaining (${indexProgressLabel})`
            : `Tagging (${indexProgressLabel})`
          : indexSexDelta
            ? 'Continuing sex tags…'
            : 'Tagging…';
        idxSex.title = 'Tag sex / Retag sex running (survives refresh; Stop to cancel).';
      } else if (crawlRunning) {
        idxSex.disabled = true;
        idxSex.textContent = sexVerb;
        idxSex.title =
          `Wait for Build/Rebuild index to finish (or Stop it), then ${sexVerb}.`;
      } else if (rebuildRunning) {
        idxSex.disabled = true;
        idxSex.textContent = sexVerb;
        idxSex.title = `Wait for Renumber to finish (or Stop it), then ${sexVerb}.`;
      } else if (!hasList) {
        idxSex.disabled = true;
        idxSex.textContent = 'Tag sex';
        idxSex.title = 'Build index first, then Tag sex (full sex baseline).';
      } else {
        idxSex.disabled = false;
        idxSex.textContent = sexVerb;
        const left = countSexUntagged(favIndexCache?.videos);
        idxSex.title = left
          ? `Sex tags incomplete (${formatFavCount(left)} untagged). ${sexVerb} continues only the remaining videos (and any new index adds since pause; removed ids are skipped).`
          : indexHasSexBaseline(favIndexCache?.videos)
            ? 'Wipe and re-check every video. You’ll confirm first.'
            : 'Tag sex: check each video detail for futanari tag (yes=Futa, no=Straight). Small adds auto-tag afterward.';
      }
    }
    // Keep Renumber grey while index runs even if only the filter bar refreshed.
    const rebuildBtn = qs(document, `[data-act="rebuild-ordinals"]`);
    if (rebuildBtn && !rebuildRunning) {
      rebuildBtn.disabled = !!indexRunning;
      rebuildBtn.title = crawlRunning
        ? 'Wait for Build/Rebuild index to finish (or Stop it), then Renumber.'
        : sexRunning
          ? 'Wait for Tag sex / Retag sex to finish (or Stop it), then Renumber.'
          : 'Rebuild global Favorites ordinals and rename local files (survives refresh; Stop to cancel).';
    }
    const applyBtn = qs(bar, '[data-act="filter-apply"]');
    const compactBtn = qs(bar, '[data-act="filter-compact"]');
    const showAllBtn = qs(bar, '[data-act="filter-show-all"]');
    const viewUi = uiViewMode();
    const viewLocked = viewButtonsLocked();
    // View labels: List · List (match) · Matches · Selected
    // (internal modes stay all / matches / compact / selected).
    if (showAllBtn) {
      showAllBtn.disabled = viewLocked;
      showAllBtn.classList.toggle('is-active-view', viewUi === 'all');
      showAllBtn.textContent = 'List';
      showAllBtn.title = 'Full native site list (no Match filter; site pager)';
    }
    if (applyBtn) {
      if (viewLocked) {
        applyBtn.disabled = true;
        if (filterRunning && viewUi === 'matches') applyBtn.textContent = 'Filtering…';
      } else {
        applyBtn.disabled = false;
        if (filterState.active && filterState.matchCount != null && !compactViewActive) {
          applyBtn.textContent = `List (match · ${formatFavCount(filterState.matchCount)})`;
        } else {
          applyBtn.textContent = 'List (match)';
        }
      }
      applyBtn.classList.toggle('is-active-view', viewUi === 'matches');
      applyBtn.title =
        'Native site list filtered by current Match rules (grays non-matches; site pager)';
    }
    if (compactBtn) {
      if (viewLocked) {
        compactBtn.disabled = true;
        if (filterRunning && viewUi === 'compact') compactBtn.textContent = 'Loading…';
      } else {
        compactBtn.disabled = false;
        if (viewUi === 'compact' && compactViewActive && filterState.matchCount != null) {
          compactBtn.textContent = `Matches (${formatFavCount(filterState.matchCount)})`;
        } else {
          compactBtn.textContent = 'Matches';
        }
      }
      compactBtn.classList.toggle('is-active-view', viewUi === 'compact');
      compactBtn.title =
        'Match result set as full cards (paged, sortable). With default Match (all chips on) this lists the full index. Uses the list index; Build/Rebuild for membership/meta; Tag sex once for sex baseline (later adds auto-tag; Retag sex is the escape hatch). Match pager replaces the native controls in toolbar Pages.';
    }
    syncCompactSortControls();
    const viewSelectedBtn = qs(bar, `[data-act="view-selected"]`);
    if (viewSelectedBtn) {
      const n = Number(selCountCached) || 0;
      if (viewLocked) {
        viewSelectedBtn.disabled = true;
        if (filterRunning && viewUi === 'selected') {
          viewSelectedBtn.textContent = 'Loading…';
        }
      } else {
        viewSelectedBtn.disabled = n <= 0 || !!selProgress;
        if (viewUi === 'selected' && filterState.matchCount != null) {
          viewSelectedBtn.textContent = `Selected (${formatFavCount(filterState.matchCount)})`;
        } else if (n > 0) {
          viewSelectedBtn.textContent = `Selected (${formatFavCount(n)})`;
        } else {
          viewSelectedBtn.textContent = 'Selected';
        }
      }
      viewSelectedBtn.classList.toggle('is-active-view', viewUi === 'selected');
      viewSelectedBtn.title =
        n > 0
          ? 'Selection as cards (paged, sortable; ignores Match chips)'
          : 'Select videos first (This page / Page range / Seq range / All matches)';
    }
    const plBtn = qs(bar, '[data-act="playlist-add"]');
    const plStop = qs(bar, '[data-act="playlist-stop"]');
    if (plStop) {
      plStop.hidden = !playlistRunning;
      plStop.disabled = !playlistRunning || playlistCancel;
      plStop.textContent = playlistCancel ? 'Stopping…' : 'Stop';
    }
    if (plBtn) {
      if (playlistRunning) {
        plBtn.disabled = true;
        plBtn.textContent = playlistProgressLabel
          ? `Playlist (${playlistProgressLabel})`
          : 'Playlist…';
        plBtn.title = 'Add to playlist running (survives refresh; Stop to cancel).';
      } else {
        plBtn.disabled = false;
        plBtn.textContent = 'Add to playlist';
        plBtn.title = 'Add selected videos to a site playlist (survives refresh; Stop to cancel).';
      }
    }
    // Reclamp Page / Seq range when List / List (match) / Matches / Selected changes counts.
    syncPageRangePlaceholders();
    syncSeqRangeClamp();
  }

  function ensureControls() {
    let box = qs(document, `.${NS}-controls`);
    const wantFavAdd = isPlaylistDetailPage();
    // Global ordinals live in one Helper table; only Favorites may wipe-rebuild them.
    const wantRenumber = isFavoritesPage();
    // Prune compares disk to Favorites index — Favorites page only.
    const wantPrune = isFavoritesPage();
    const coll = collectionFilterLabels();
    const ok =
      box &&
      document.body.contains(box) &&
      qs(box, `.${NS}-rail-command`) &&
      qs(box, `.${NS}-rail-match`) &&
      qs(box, `.${NS}-rail-view`) &&
      qs(box, `.${NS}-rail-select`) &&
      qs(box, '[data-act="filter-local"]') &&
      qs(box, '[data-act="filter-cloud"]') &&
      qs(box, '[data-act="filter-favorite"]') &&
      qs(box, '[data-act="filter-playlist"]') &&
      qs(box, '[data-act="filter-futa"]') &&
      qs(box, '[data-act="filter-straight"]') &&
      qs(box, '[data-act="filter-show-all"]') &&
      qs(box, '[data-act="filter-compact"]') &&
      qs(box, `.${NS}-view-seg [data-act="view-selected"]`) &&
      qs(box, `.${NS}-view-seg`) &&
      qs(box, `.${NS}-compact-tools`) &&
      (isPlaylistDetailPage()
        ? !qs(box, `[data-act="compact-sort-field"][data-sort-field="favorited"]`) &&
          !!qs(box, `[data-act="compact-sort-field"][data-sort-field="seq"]`)
        : !!qs(box, `[data-act="compact-sort-field"][data-sort-field="favorited"]`) &&
          !qs(box, `[data-act="compact-sort-field"][data-sort-field="seq"]`)) &&
      qs(box, `[data-act="compact-sort-field"][data-sort-field="uploaded"]`) &&
      qs(box, `[data-act="compact-sort-field"][data-sort-field="uploaded"]`)?.dataset
        ?.sortLabel === 'Uploaded' &&
      !qs(box, '[data-act="toggle-compact-sort-dir"]') &&
      !qs(box, '[data-act="filter-reset"]') &&
      qs(box, '[data-act="reset-toolbars"]') &&
      qs(box, '[data-act="delete-favs"]') &&
      qs(box, '[data-act="index-build"]') &&
      qs(box, '[data-act="index-stop"]') &&
      qs(box, '[data-act="index-sex"]') &&
      qs(box, '[data-act="index-sex-stop"]') &&
      !qs(box, '[data-role="index-start"]') &&
      !qs(box, '[data-role="index-end"]') &&
      qs(box, '[data-act="select-page"]') &&
      qs(box, '[data-act="select-pages"]') &&
      qs(box, '[data-act="select-seqs"]') &&
      qs(box, '[data-role="select-seq-start"]') &&
      qs(box, '[data-role="select-seq-end"]') &&
      qs(box, '[data-act="select-matches"]') &&
      qs(box, '[data-act="scan"]') &&
      qs(box, '[data-act="wake-queue"]') &&
      qs(box, '[data-act="open-tasks"]') &&
      qs(box, '[data-act="playlist-add"]') &&
      qs(box, '[data-act="playlist-stop"]') &&
      qs(box, `.${NS}-dur`) &&
      qs(box, '[data-role="status"]') &&
      qs(box, '[data-act="filter-local"]')?.nextElementSibling?.getAttribute('data-act') ===
        'filter-cloud' &&
      qs(box, '[data-act="filter-futa"]')?.nextElementSibling?.getAttribute('data-act') ===
        'filter-straight' &&
      qs(box, `.${NS}-view-seg [data-act="filter-show-all"]`)?.nextElementSibling?.getAttribute(
        'data-act',
      ) === 'filter-apply' &&
      qs(box, `.${NS}-view-seg [data-act="filter-apply"]`)?.nextElementSibling?.getAttribute(
        'data-act',
      ) === 'filter-compact' &&
      qs(box, '[data-act="index-sex"]')?.nextElementSibling?.getAttribute('data-act') ===
        'index-sex-stop' &&
      !!(
        qs(box, '[data-act="scan"]').compareDocumentPosition(qs(box, '[data-act="download"]')) &
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    if (ok) {
      const hasFavAdd = !!qs(box, '[data-act="fav-add"]');
      const hasFavAddStop = !!qs(box, '[data-act="fav-add-stop"]');
      const hasRenumber = !!qs(box, '[data-act="rebuild-ordinals"]');
      const hasRenumberStop = !!qs(box, '[data-act="renumber-stop"]');
      const hasPrune = !!qs(box, '[data-act="prune-local"]');
      const favBtn = qs(box, '[data-act="fav-add"]');
      const delBtn = qs(box, '[data-act="delete-favs"]');
      const favBeforeDel =
        !favBtn ||
        !delBtn ||
        !!(favBtn.compareDocumentPosition(delBtn) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (
        wantFavAdd !== hasFavAdd ||
        wantFavAdd !== hasFavAddStop ||
        wantRenumber !== hasRenumber ||
        wantRenumber !== hasRenumberStop ||
        wantPrune !== hasPrune ||
        (hasFavAdd && !favBeforeDel)
      ) {
        box.remove();
        box = null;
      } else {
        syncToolbarMiddleCollapsed(box);
        syncCompactSortControls();
        updateToolbarLabels();
        return box;
      }
    }
    if (box) box.remove();
    qsa(document, `.${NS}-toolbar, .${NS}-filterbar`).forEach((el) => el.remove());
    box = document.createElement('div');
    box.className = `${NS}-controls`;
    box.dataset.hxyrule = '1';
    const favAdd = wantFavAdd
      ? `
            <div class="${NS}-btn-pair" role="group" aria-label="Add to Favorites controls">
              <button type="button" class="${NS}-btn" data-act="fav-add">Add to Favorites</button>
              <button type="button" class="${NS}-btn" data-act="fav-add-stop" hidden>Stop</button>
            </div>`
      : '';
    const renumberBtn = wantRenumber
      ? `
            <div class="${NS}-btn-pair" role="group" aria-label="Renumber controls">
              <button type="button" class="${NS}-btn" data-act="rebuild-ordinals">Renumber</button>
              <button type="button" class="${NS}-btn" data-act="renumber-stop" hidden>Stop</button>
            </div>`
      : '';
    const pruneBtn = wantPrune
      ? `
              <button type="button" class="${NS}-btn ${NS}-btn--danger" data-act="prune-local">Prune local</button>`
      : '';
    const deleteLabel = wantFavAdd ? 'Remove from list' : 'Unfavorite';
    const favoritedSortBtn = isPlaylistDetailPage()
      ? ''
      : `
              <button type="button" class="${NS}-btn is-active-sort" data-act="compact-sort-field" data-sort-field="favorited" data-sort-label="Favorited" aria-pressed="true" disabled>Favorited</button>`;
    const seqSortBtn = isPlaylistDetailPage()
      ? `
              <button type="button" class="${NS}-btn is-active-sort" data-act="compact-sort-field" data-sort-field="seq" data-sort-label="Seq" aria-pressed="true" disabled title="Sort by Favorites renumber sequence">Seq</button>`
      : '';
    box.innerHTML = `
      <div class="${NS}-rail ${NS}-rail-command" aria-label="Library commands">
        <div class="${NS}-pipeline ${NS}-cmd-pipeline" aria-label="Sync Queue Index Edit">
          <section class="${NS}-cluster" aria-label="Sync local library">
            <button type="button" class="${NS}-btn" data-act="scan">Scan local</button>
          </section>
          <span class="${NS}-rail-sep" aria-hidden="true"></span>
          <section class="${NS}-cluster" aria-label="Download queue">
            <div class="${NS}-btn-pair" role="group" aria-label="Download controls">
              <button type="button" class="${NS}-btn ${NS}-btn--primary" data-act="download">Download</button>
              <button type="button" class="${NS}-btn" data-act="stop" hidden>Stop</button>
            </div>
            <button type="button" class="${NS}-btn" data-act="wake-queue">Wake queue</button>
            <button type="button" class="${NS}-btn" data-act="open-tasks" aria-label="Task queue">Tasks</button>
          </section>
          <span class="${NS}-rail-sep" aria-hidden="true"></span>
          <section class="${NS}-cluster" aria-label="Index and ordinals">
            <div class="${NS}-btn-pair" role="group" aria-label="Index controls">
              <button type="button" class="${NS}-btn" data-act="index-build" title="Build a full list index once (needed for Compact / Match / cross-page Local). When an index already exists this becomes Rebuild (escape hatch). Tag sex is separate.">Build index</button>
              <button type="button" class="${NS}-btn" data-act="index-stop" hidden>Stop</button>
            </div>
            <div class="${NS}-btn-pair" role="group" aria-label="Tag sex controls">
              <button type="button" class="${NS}-btn" data-act="index-sex" title="Tag sex: check each video detail for futanari tag (yes=Futa, no=Straight). Becomes Retag sex after a baseline exists (confirm before wipe). Build index first; small adds auto-tag afterward.">Tag sex</button>
              <button type="button" class="${NS}-btn" data-act="index-sex-stop" hidden>Stop</button>
            </div>${renumberBtn}
          </section>
          <span class="${NS}-rail-sep" aria-hidden="true"></span>
          <section class="${NS}-cluster ${NS}-cluster-danger" aria-label="Edit library">
            <div class="${NS}-btn-pair" role="group" aria-label="Playlist controls">
              <button type="button" class="${NS}-btn" data-act="playlist-add">Add to playlist</button>
              <button type="button" class="${NS}-btn" data-act="playlist-stop" hidden>Stop</button>
            </div>${favAdd}
            <button type="button" class="${NS}-btn ${NS}-btn--danger" data-act="delete-favs">${deleteLabel}</button>${pruneBtn}
          </section>
        </div>
        <div class="${NS}-msgbar ${NS}-error" data-role="status" role="button" tabindex="0" aria-live="polite" aria-label="Status log">
          <span class="${NS}-message-text">Ready</span>
        </div>
      </div>
      <div class="${NS}-rail ${NS}-rail-match" aria-label="Match filters">
        <span class="${NS}-rail-label">Match</span>
        <div class="${NS}-pipeline ${NS}-match-pipeline" aria-label="Match filters">
          <button type="button" class="${NS}-chip is-active" data-act="filter-local">Local</button>
          <button type="button" class="${NS}-chip is-active" data-act="filter-cloud">Not local</button>
          <span class="${NS}-rail-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-chip is-active" data-act="filter-favorite">${coll.member}</button>
          <button type="button" class="${NS}-chip is-active" data-act="filter-playlist">${coll.nonMember}</button>
          <span class="${NS}-rail-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-chip is-active" data-act="filter-futa" title="Videos whose detail page has the futanari tag. Both Futa+Straight on = no sex restriction; turn Straight off for Futa-only. Needs Tag sex / Retag sex after Build.">Futa</button>
          <button type="button" class="${NS}-chip is-active" data-act="filter-straight" title="Videos whose detail page has no futanari tag. Both Futa+Straight on = no sex restriction; turn Futa off for Straight-only. Needs Tag sex / Retag sex after Build.">Straight</button>
          <span class="${NS}-rail-sep" aria-hidden="true"></span>
          <label class="${NS}-dur">
            <span class="${NS}-dur__label">Duration</span>
            <span class="${NS}-paren">(</span>
            <input type="number" min="0" step="1" inputmode="numeric" placeholder="min" data-role="dur-min" aria-label="Duration min" />
            <span class="${NS}-paren-sep">–</span>
            <input type="number" min="0" step="1" inputmode="numeric" placeholder="max" data-role="dur-max" aria-label="Duration max" />
            <span class="${NS}-paren">)</span>
          </label>
          <label class="${NS}-nameq" title="Match title or Favorites seq prefix (N——…) as a continuous substring (case-insensitive)">
            <span class="${NS}-nameq__label">Name</span>
            <input type="search" data-role="title-query" placeholder="contains…" aria-label="Video name or seq contains" autocomplete="off" spellcheck="false" />
          </label>
        </div>
      </div>
      <div class="${NS}-rail ${NS}-rail-view" aria-label="View mode">
        <span class="${NS}-rail-label">View</span>
        <div class="${NS}-pipeline ${NS}-browse-pipeline" aria-label="View mode">
          <div class="${NS}-btn-pair ${NS}-view-seg" role="group" aria-label="View mode">
            <button type="button" class="${NS}-btn" data-act="filter-show-all" title="Full native site list (no Match filter; site pager)">List</button>
            <button type="button" class="${NS}-btn" data-act="filter-apply" title="Native site list filtered by current Match rules (grays non-matches; site pager)">List (match)</button>
            <button type="button" class="${NS}-btn is-active-view" data-act="filter-compact" title="Match result set as full cards (paged, sortable)">Matches</button>
            <button type="button" class="${NS}-btn" data-act="view-selected" disabled title="Select videos first (This page / Page range / Seq range / All matches)">Selected</button>
          </div>
          <div class="${NS}-compact-tools" role="group" aria-label="Matches sort" aria-hidden="true">
            <span class="${NS}-chip-group-label">Sort</span>
            <div class="${NS}-btn-pair ${NS}-sort-seg" role="group" aria-label="Matches sort field">
              ${favoritedSortBtn}${seqSortBtn}
              <button type="button" class="${NS}-btn" data-act="compact-sort-field" data-sort-field="uploaded" data-sort-label="Uploaded" aria-pressed="false" disabled>Uploaded</button>
              <button type="button" class="${NS}-btn" data-act="compact-sort-field" data-sort-field="duration" data-sort-label="Duration" aria-pressed="false" disabled>Duration</button>
              <button type="button" class="${NS}-btn" data-act="compact-sort-field" data-sort-field="views" data-sort-label="Views" aria-pressed="false" disabled>Views</button>
              <button type="button" class="${NS}-btn" data-act="compact-sort-field" data-sort-field="rating" data-sort-label="Rating" aria-pressed="false" disabled>Rating</button>
            </div>
          </div>
        </div>
      </div>
      <div class="${NS}-rail ${NS}-rail-select" aria-label="Select videos">
        <span class="${NS}-rail-label">Select</span>
        <div class="${NS}-pipeline ${NS}-select-pipeline" aria-label="Select videos">
          <button type="button" class="${NS}-btn" data-act="select-page">This page</button>
          <div class="${NS}-inline-range">
            <span class="${NS}-paren-field">
              <span class="${NS}-paren">(</span>
              <input data-role="select-start" type="number" min="1" placeholder="from" aria-label="Pages start" />
              <span class="${NS}-paren-sep">–</span>
              <input data-role="select-end" type="number" min="1" placeholder="to" aria-label="Pages end" />
              <span class="${NS}-paren">)</span>
            </span>
            <button type="button" class="${NS}-btn" data-act="select-pages">Page range</button>
          </div>
          <div class="${NS}-inline-range">
            <span class="${NS}-paren-field">
              <span class="${NS}-paren">(</span>
              <input data-role="select-seq-start" type="number" min="1" placeholder="from" aria-label="Seq start" />
              <span class="${NS}-paren-sep">–</span>
              <input data-role="select-seq-end" type="number" min="1" placeholder="to" aria-label="Seq end" />
              <span class="${NS}-paren">)</span>
            </span>
            <button type="button" class="${NS}-btn" data-act="select-seqs" title="Select by title seq prefix (N——…). One side only = that single seq.">Seq range</button>
          </div>
          <button type="button" class="${NS}-btn ${NS}-btn--accent" data-act="select-matches">All matches</button>
          <button type="button" class="${NS}-btn ${NS}-btn--ghost" data-act="clear">Clear · 0</button>
        </div>
        <button type="button" class="${NS}-btn ${NS}-btn--ghost ${NS}-reset-all" data-act="reset-toolbars" title="Reset Match, View, and Select to defaults">Reset all</button>
      </div>
    `;
    const minIn = qs(box, '[data-role="dur-min"]');
    const maxIn = qs(box, '[data-role="dur-max"]');
    if (minIn) minIn.value = filterState.durMinMin;
    if (maxIn) maxIn.value = filterState.durMaxMin;
    const titleIn = qs(box, '[data-role="title-query"]');
    if (titleIn) titleIn.value = filterState.titleQuery || '';
    const startIn = qs(box, '[data-role="select-start"]');
    const endIn = qs(box, '[data-role="select-end"]');
    if (startIn) startIn.value = selectStartSaved || '';
    if (endIn) endIn.value = selectEndSaved || '';
    const seqStartIn = qs(box, '[data-role="select-seq-start"]');
    const seqEndIn = qs(box, '[data-role="select-seq-end"]');
    if (seqStartIn) seqStartIn.value = selectSeqStartSaved || '';
    if (seqEndIn) seqEndIn.value = selectSeqEndSaved || '';
    placeControls(box);
    syncToolbarMiddleCollapsed(box);
    syncCompactSortControls();
    updateToolbarLabels();
    wirePageRangeInputs(box);
    wireSeqRangeInputs(box);
    wireDurationFilterInputs(box);
    wireTitleQueryFilterInput(box);
    syncPageRangePlaceholders();
    syncSeqRangeClamp();
    return box;
  }

  function placeControls(box) {
    const stack = ensureControlStack();
    if (box.parentElement !== stack) stack.appendChild(box);
    layoutTopControls();
  }

  function ensureFilterBar() {
    return ensureControls();
  }

  /** Sex enrich UI: detail-tag progress (futanari → Futa, else Straight). */
  function formatSexIndexProgress(st) {
    const raw = String(st?.sexFilterLabel || '').toLowerCase();
    const fp = Number(st?.sexFilterPage) || 0;
    // Detail crawl: sexFilterMaxPage is the id count (delta = remaining only).
    // Do not mix in listMaxPage (favorites page count) — that made Retag look like 0/2xxx wipe.
    const detailTotal = Math.max(1, Number(st?.sexFilterMaxPage) || 0, fp || 1);
    const listTotal = Math.max(
      1,
      Number(st?.listMaxPage) || 0,
      Number(st?.sexFilterMaxPage) || 0,
      fp || 1,
    );
    // Detail futanari crawl, or legacy badge / list-filter jobs.
    if (
      raw === 'detail' ||
      raw === 'tags' ||
      raw === 'futanari'
    ) {
      return fp > 0 ? `${fp}/${detailTotal}` : '…';
    }
    if (raw === 'cards' || raw === 'badges' || raw === 'list') {
      return fp > 0 ? `${fp}/${listTotal}` : '…';
    }
    const name = raw === 'straight' ? 'Straight' : 'Futa';
    if (fp > 0) return `${name} · ${fp}/${listTotal}`;
    return name;
  }

  function formatIndexReadyStatus(st, count, maxPage) {
    const mode = String(st?.mode || '') || (st?.sexOnly ? 'sex' : '');
    if (mode === 'sex' || mode === 'sex-delta' || st?.sexOnly) {
      const left = countSexUntagged(favIndexCache?.videos);
      if (left > 0) {
        return `Sex tags incomplete · ${formatFavCount(left)} left — ${sexIdleLabel()}`;
      }
      return count
        ? `Sex tagged · ${formatFavCount(count)} videos`
        : 'Sex tagged';
    }
    if (mode === 'incremental') {
      const from = Math.max(1, Number(st?.fromPage) || 1);
      const to = Math.max(from, Number(st?.toPage) || from);
      const range = from === to ? `page ${from}` : `pages ${from}–${to}`;
      return count
        ? `Index refreshed · ${formatFavCount(count)} videos (${range} merged)`
        : `Index refreshed (${range} merged)`;
    }
    return count
      ? `Index ready · ${formatFavCount(count)} videos · ${maxPage} page${
          maxPage === 1 ? '' : 's'
        }`
      : `Index ready · ${maxPage} page${maxPage === 1 ? '' : 's'}`;
  }

  function formatListIndexProgress(st) {
    const page = Number(st?.page) || 0;
    const maxPage = Math.max(1, Number(st?.maxPage) || 1);
    const from = Math.max(0, Number(st?.fromPage) || 0);
    const to = Math.max(from, Number(st?.toPage) || from);
    if (String(st?.mode || '') === 'incremental' && from > 0) {
      const abs =
        Number(st?.absPage) > 0
          ? Number(st.absPage)
          : page > 0
            ? from + page - 1
            : from;
      // No nested parens — outer "Indexing (…)" wraps this once.
      return `Page ${abs} · ${page}/${maxPage}`;
    }
    return `${page}/${maxPage}`;
  }

  function indexJobIsSex(st) {
    if (!st) return false;
    const mode = String(st.mode || '');
    return (
      mode === 'sex' ||
      mode === 'sex-delta' ||
      !!st.sexOnly ||
      String(st.phase || '') === 'sex'
    );
  }

  function applyIndexJobProgress(st) {
    if (!st) return;
    const active = st.status === 'running' || st.status === 'stopping';
    if (st.scope === indexScopeKey()) {
      if (active && indexJobIsSex(st)) {
        indexJobKind = 'sex';
        indexSexDelta = String(st.mode || '') === 'sex-delta';
        indexProgressLabel = formatSexIndexProgress(st);
      } else if (active) {
        indexJobKind = 'crawl';
        indexSexDelta = false;
        indexProgressLabel = formatListIndexProgress(st);
      } else {
        indexJobKind = '';
        indexSexDelta = false;
        indexProgressLabel = '';
      }
      indexRunning = active;
      updateFilterBarLabels();
      return;
    }
    // Job belongs to another list — keep it running, but hide Index Stop here.
    if (indexRunning || indexProgressLabel || indexJobKind || indexSexDelta) {
      indexRunning = false;
      indexProgressLabel = '';
      indexJobKind = '';
      indexSexDelta = false;
      updateFilterBarLabels();
    }
  }

  function stopIndexPoll() {
    if (indexPollTimer) {
      clearInterval(indexPollTimer);
      indexPollTimer = null;
    }
  }

  async function adoptIndexJobResult(st) {
    if (!st) return;
    if (st.status === 'done') {
      if (st.scope === indexScopeKey()) {
        await loadFavIndexCache();
        const maxPage = Math.max(1, Number(st.maxPage) || 1);
        const count = Number(favIndexCache?.videos?.length) || 0;
        lastIndexStats = { done: maxPage, total: maxPage };
        listIndexDirty = false;
        if (!isPlaylistDetailPage()) {
          myFavIdSet = new Set((favIndexCache?.videos || []).map((v) => String(v.videoId)));
          favoritesIndexDirty = false;
        } else {
          invalidatePlaylistMembershipCache();
          playlistIndexesDirty = false;
        }
        // Lower title/scan totals BEFORE refreshScanLabelCounts — previously
        // refresh Math.max'd a stale 24 back over the fresh index count.
        if (count > 0) applyKnownLibraryTotal(count);
        refreshScanLabelCounts();
        updateFavCountBar();
        setLiveStatus(formatIndexReadyStatus(st, count, maxPage));
        // Rebuild/Build (and page merges): repaint Compact / Show matches /
        // Show-all marks from the fresh index. Sex jobs only change labels.
        if (!indexJobIsSex(st)) {
          await refreshActiveCardArea({ quiet: true, ensureIndex: false });
        }
      } else if (st.scope === 'favorites') {
        const favIdx = await send('FAV_INDEX_GET', { scope: 'favorites' });
        myFavIdSet = new Set((favIdx?.videos || []).map((v) => String(v.videoId)));
        favoritesIndexDirty = false;
        if (!isPlaylistDetailPage()) {
          favIndexCache = favIdx;
          const maxPage = Math.max(1, Number(st.maxPage) || 1);
          const count = Number(favIdx?.videos?.length) || 0;
          lastIndexStats = { done: maxPage, total: maxPage };
          listIndexDirty = false;
          if (count > 0) applyKnownLibraryTotal(count);
          refreshScanLabelCounts();
          updateFavCountBar();
          setLiveStatus(formatIndexReadyStatus(st, count, maxPage));
          if (!indexJobIsSex(st)) {
            await refreshActiveCardArea({ quiet: true, ensureIndex: false });
          }
        }
      }
    } else if (st.status === 'error') {
      if (st.scope === indexScopeKey() || st.scope === 'favorites') {
        setError(`Index failed: ${st.error || 'unknown error'}`);
      }
    } else if (st.status === 'stopped') {
      if (st.scope === indexScopeKey()) {
        lastIndexStats = null;
        setLiveStatus(indexJobIsSex(st) ? 'Tag sex stopped' : 'Index stopped');
      }
    }
  }

  async function waitForIndexJob({
    scope = '',
    progressEl = null,
    progressPrefix = 'Indexing',
  } = {}) {
    const wantScope = String(scope || '').trim();
    for (let i = 0; i < 36_000; i += 1) {
      const st = await send('INDEX_JOB_STATUS');
      applyIndexJobProgress(st);
      if (progressEl && st && (!wantScope || st.scope === wantScope)) {
        if (indexJobIsSex(st)) {
          progressEl.textContent = `${progressPrefix} (${formatSexIndexProgress(st)})`;
        } else {
          progressEl.textContent = `${progressPrefix} (${formatListIndexProgress(st)})`;
        }
      }
      if (!st || (st.status !== 'running' && st.status !== 'stopping')) {
        await adoptIndexJobResult(st);
        indexRunning = false;
        indexProgressLabel = '';
        indexJobKind = '';
        indexSexDelta = false;
        updateFilterBarLabels();
        return st;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('index job timed out');
  }

  function startIndexStatusPoll() {
    if (indexPollTimer) return;
    indexPollTimer = setInterval(() => {
      refreshIndexJobUi().catch(() => {});
    }, 1000);
  }

  async function refreshIndexJobUi() {
    const st = await send('INDEX_JOB_STATUS');
    const active = st && (st.status === 'running' || st.status === 'stopping');
    if (!active) {
      stopIndexPoll();
      if (indexRunning || indexProgressLabel || indexJobKind || indexSexDelta) {
        await adoptIndexJobResult(st);
        indexRunning = false;
        indexProgressLabel = '';
        indexJobKind = '';
        indexSexDelta = false;
        updateFilterBarLabels();
      }
      return st;
    }
    applyIndexJobProgress(st);
    if (st.scope === indexScopeKey()) startIndexStatusPoll();
    return st;
  }

  async function resumeIndexJobUiIfNeeded() {
    try {
      const st = await send('INDEX_JOB_STATUS');
      if (st && (st.status === 'running' || st.status === 'stopping') && st.scope === indexScopeKey()) {
        indexRunning = true;
        applyIndexJobProgress(st);
        updateFilterBarLabels();
        updateToolbarLabels();
        startIndexStatusPoll();
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function startBackgroundIndexJob({
    scope,
    maxPage = 1,
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
    return await send('INDEX_JOB_START', {
      scope,
      maxPage,
      playlistId,
      blockId,
      fromKey,
      libraryTotal,
      sexOnly: !!sexOnly,
      mode: String(mode || '').trim(),
      fromPage: Math.max(0, Number(fromPage) || 0),
      toPage: Math.max(0, Number(toPage) || 0),
      targetIds: Array.isArray(targetIds) ? targetIds : [],
    });
  }

  /**
   * Max page for Select · Page range inputs — follows the active View's pager
   * (Compact / Selected → compact pages; Matches / All → native list pages).
   */
  function selectRangeMaxPage() {
    if (compactViewActive) return Math.max(1, compactPageCount());
    return maxPageNumber();
  }

  /** Clamp a page number into 1..maxPage (upper bound skipped when maxPage < 1). */
  function clampPageNum(n, maxPage = maxPageNumber()) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    let p = Math.trunc(v);
    if (p < 1) p = 1;
    const max = Number(maxPage);
    if (Number.isInteger(max) && max >= 1 && p > max) p = max;
    return p;
  }

  /** Keep from/to number inputs inside 1..maxPage; set min/max attributes. */
  function clampPageRangeInputs(startIn, endIn) {
    const maxPage = selectRangeMaxPage();
    for (const el of [startIn, endIn]) {
      if (!el) continue;
      el.min = '1';
      if (maxPage >= 1) el.max = String(maxPage);
      else el.removeAttribute('max');
      const raw = String(el.value || '').trim();
      if (raw === '') continue;
      const clamped = clampPageNum(raw, maxPage);
      if (clamped != null && String(clamped) !== raw) el.value = String(clamped);
    }
  }

  /**
   * Max Favorites / playlist seq for Select · Seq range (1…N after Renumber).
   * Prefer list total; also honor the highest known index ordinal.
   */
  function selectRangeMaxSeq() {
    const total =
      optionalNonNegInt(detectFavoritesTotal()) ??
      optionalNonNegInt(scanFavTotal) ??
      optionalNonNegInt(knownLibraryTotal) ??
      optionalNonNegInt(favIndexCache?.videos?.length) ??
      0;
    let maxOrd = 0;
    const indexed = Array.isArray(favIndexCache?.videos) ? favIndexCache.videos : [];
    for (const v of indexed) {
      const fromOrd = Number(v?.ordinal);
      const seq =
        Number.isFinite(fromOrd) && fromOrd > 0
          ? Math.trunc(fromOrd)
          : ordinalFromTitle(v?.title) || 0;
      if (seq > maxOrd) maxOrd = seq;
    }
    const n = Math.max(Number(total) || 0, maxOrd);
    return n >= 1 ? n : 0;
  }

  /** Clamp a seq into 1..maxSeq (upper bound skipped when maxSeq < 1). */
  function clampSeqNum(n, maxSeq = selectRangeMaxSeq()) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    let s = Math.trunc(v);
    if (s < 1) s = 1;
    const max = Number(maxSeq);
    if (Number.isInteger(max) && max >= 1 && s > max) s = max;
    return s;
  }

  /** Keep seq from/to inputs inside 1..maxSeq; set min/max attributes. */
  function clampSeqRangeInputs(startIn, endIn) {
    const maxSeq = selectRangeMaxSeq();
    for (const el of [startIn, endIn]) {
      if (!el) continue;
      el.min = '1';
      if (maxSeq >= 1) el.max = String(maxSeq);
      else el.removeAttribute('max');
      const raw = String(el.value || '').trim();
      if (raw === '') continue;
      const clamped = clampSeqNum(raw, maxSeq);
      if (clamped != null && String(clamped) !== raw) el.value = String(clamped);
    }
  }

  function playlistIndexJobExtras() {
    if (!isPlaylistDetailPage()) return {};
    return {
      playlistId: currentPlaylistIdFromPath() || '',
      blockId: playlistBlockId(),
      fromKey: playlistFromKey(),
    };
  }

  /**
   * After index adds: if a sex baseline exists, auto-classify new ids.
   * ≤ SEX_AUTO_PAGE1_MAX → detail futanari checks (quiet).
   * Larger → sex-delta job with progress (Tag remains the full escape hatch).
   */
  async function scheduleSexAutoAfterAdd(scope, addedIds) {
    const ids = [
      ...new Set(
        (Array.isArray(addedIds) ? addedIds : [])
          .map((id) => String(id || '').trim())
          .filter((id) => /^\d+$/.test(id)),
      ),
    ];
    if (!ids.length) return;
    const scopeKey = String(scope || '').trim();
    if (!scopeKey) return;
    let idx;
    try {
      idx = await send('FAV_INDEX_GET', { scope: scopeKey });
    } catch (_) {
      return;
    }
    if (!indexHasSexBaseline(idx?.videos)) return;

    let st;
    try {
      st = await send('INDEX_JOB_STATUS');
    } catch (_) {
      st = null;
    }
    if (st?.status === 'running' || st?.status === 'stopping') {
      if (scopeKey === indexScopeKey()) {
        setLiveStatus(
          `Sex tags incomplete · ${formatFavCount(ids.length)} new — ${sexIdleLabel()} when idle`,
        );
      }
      return;
    }

    const extras =
      scopeKey === indexScopeKey()
        ? playlistIndexJobExtras()
        : scopeKey.startsWith('playlist:')
          ? { playlistId: scopeKey.slice('playlist:'.length) }
          : {};

    if (ids.length <= SEX_AUTO_PAGE1_MAX) {
      try {
        const r = await send('SEX_CLASSIFY_PAGE1', {
          scope: scopeKey,
          videoIds: ids,
          ...extras,
        });
        if (scopeKey === indexScopeKey()) await loadFavIndexCache();
        const left = Math.max(
          0,
          Number(r?.remainingCount) || (Array.isArray(r?.remaining) ? r.remaining.length : 0),
        );
        if (scopeKey === indexScopeKey()) {
          if (left) {
            setLiveStatus(
              `Sex tags incomplete · ${formatFavCount(left)} left — ${sexIdleLabel()}`,
            );
          } else if (Number(r?.tagged) > 0) {
            setLiveStatus(
              `Sex auto-tagged · ${formatFavCount(Number(r.tagged))}`,
            );
          }
          updateFilterBarLabels();
        }
      } catch (err) {
        if (scopeKey === indexScopeKey()) {
          setLiveStatus(
            `Sex auto-tag failed — ${sexIdleLabel()} (${err.message || err})`,
          );
        }
      }
      return;
    }

    // Half-large batch: visible delta crawl (not silent page-1 pretend).
    try {
      const payload = {
        scope: scopeKey,
        maxPage: Math.max(
          1,
          Math.ceil((Number(idx?.videos?.length) || ids.length) / 12),
          maxPageNumber(),
        ),
        libraryTotal: Number(idx?.videos?.length) || ids.length,
        sexOnly: true,
        mode: 'sex-delta',
        targetIds: ids,
        ...extras,
      };
      st = await startBackgroundIndexJob(payload);
      if (scopeKey === indexScopeKey()) {
        indexRunning = true;
        indexJobKind = 'sex';
        indexSexDelta = true;
        applyIndexJobProgress(st);
        updateFilterBarLabels();
        startIndexStatusPoll();
        setLiveStatus(
          sexTaggingLiveLabel({
            continueOnly: true,
            left: ids.length,
          }),
        );
      }
    } catch (err) {
      if (scopeKey === indexScopeKey()) {
        setLiveStatus(
          `Sex tags incomplete · ${formatFavCount(ids.length)} new — ${sexIdleLabel()}`,
        );
      }
    }
  }

  /**
   * Match Futa/Straight chips need sexGroup on the list index.
   * No baseline → full Tag; some untagged → sex-delta only.
   * Membership drift since pause: still delta on current untagged (new ids included;
   * removed ids are already gone from the index).
   */
  async function ensureSexGroupsInListIndex() {
    await loadFavIndexCache();
    const videos = favIndexCache?.videos || [];
    if (!videos.length) {
      throw new Error(
        'No list index — click Build index first, then Tag sex.',
      );
    }
    const tagged = countSexTagged(videos);
    const untagged = countSexUntagged(videos);
    const corrupt = sexLabelsLookCorrupt(videos);
    if (tagged > 0 && untagged === 0 && !corrupt) return favIndexCache;

    const scope = indexScopeKey();
    const delta = tagged > 0 && !corrupt;
    const listChanged = delta
      ? sexMembershipChangedSincePause(videos, favIndexCache?.sexMembershipSig)
      : false;
    const targetIds = delta
      ? videos
          .filter((v) => !videoSexGroupSet(v).size)
          .map((v) => String(v.videoId || '').trim())
          .filter(Boolean)
      : [];
    let st = await send('INDEX_JOB_STATUS');
    if (st?.status === 'running' || st?.status === 'stopping') {
      if (st.scope !== scope) {
        throw new Error(
          `Index already running for ${st.scope} (${st.page}/${st.maxPage}). Stop it first.`,
        );
      }
    } else {
      // Wipe existing labels (corrupt repair) needs an explicit confirm.
      if (!delta && tagged > 0) {
        const ok = await confirmRetagAllSex();
        if (!ok) {
          throw new Error('Retag all cancelled');
        }
      }
      const payload = {
        scope,
        maxPage: maxPageNumber(),
        libraryTotal: libraryTotalHintForIndex(),
        sexOnly: true,
        mode: delta ? 'sex-delta' : 'sex',
        targetIds,
        ...playlistIndexJobExtras(),
      };
      st = await startBackgroundIndexJob(payload);
    }
    const label = sexTaggingLiveLabel({
      continueOnly: delta,
      listChanged: delta && listChanged,
      left: targetIds.length,
      retagAll: !delta && tagged > 0,
    });
    // Sex progress belongs on the Tag sex button — never overwrite Compact /
    // Show matches with Tagging labels.
    setLiveStatus(label);
    indexRunning = true;
    indexJobKind = 'sex';
    indexSexDelta = delta || String(st?.mode || '') === 'sex-delta';
    applyIndexJobProgress(st);
    updateFilterBarLabels();
    startIndexStatusPoll();
    const finalSt = await waitForIndexJob({ scope });
    stopIndexPoll();
    indexRunning = false;
    indexProgressLabel = '';
    indexJobKind = '';
    indexSexDelta = false;
    updateFilterBarLabels();
    if (finalSt?.status === 'error') {
      throw new Error(finalSt.error || 'Tag sex failed');
    }
    if (finalSt?.status === 'stopped') {
      throw new Error('Tag sex was stopped');
    }
    await loadFavIndexCache();
    const left = countSexUntagged(favIndexCache?.videos);
    if (left > 0 && delta) {
      setLiveStatus(
        `Sex tags incomplete · ${formatFavCount(left)} left — ${sexIdleLabel()}`,
      );
    }
    return favIndexCache;
  }

  /**
   * Toolbar Tag sex / Retag sex.
   * Incomplete baseline → sex-delta (continue untagged only; new index ids included,
   * removed ids ignored). Compares membership fingerprint from last sex pause.
   * No baseline / corrupt / fully tagged Retag → full wipe-and-retag.
   */
  async function buildSexGroupsIndex() {
    setError('');
    try {
      await loadFavIndexCache();
      const videos = favIndexCache?.videos || [];
      if (!videos.length) {
        throw new Error(
          'No list index — click Build index first, then Tag sex.',
        );
      }
      const scope = indexScopeKey();
      const tagged = countSexTagged(videos);
      const untagged = countSexUntagged(videos);
      const corrupt = sexLabelsLookCorrupt(videos);
      // Incomplete (some labeled, some not) → continue; only wipe when starting
      // fresh, repairing corrupt dual-labels, or full Retag of a complete set.
      const delta = tagged > 0 && untagged > 0 && !corrupt;
      const listChanged = delta
        ? sexMembershipChangedSincePause(videos, favIndexCache?.sexMembershipSig)
        : false;
      const targetIds = delta
        ? videos
            .filter((v) => !videoSexGroupSet(v).size)
            .map((v) => String(v.videoId || '').trim())
            .filter(Boolean)
        : [];
      let st = await send('INDEX_JOB_STATUS');
      if (st?.status === 'running' || st?.status === 'stopping') {
        if (st.scope !== scope) {
          throw new Error(
            `Index already running for ${st.scope} (${st.page}/${st.maxPage}). Stop it first.`,
          );
        }
      } else {
        // Complete baseline / corrupt → wipe-and-retag needs an explicit confirm.
        if (!delta && tagged > 0) {
          const ok = await confirmRetagAllSex();
          if (!ok) return;
        }
        st = await startBackgroundIndexJob({
          scope,
          maxPage: maxPageNumber(),
          libraryTotal: libraryTotalHintForIndex(),
          sexOnly: true,
          mode: delta ? 'sex-delta' : 'sex',
          targetIds,
          ...playlistIndexJobExtras(),
        });
      }
      const label = sexTaggingLiveLabel({
        continueOnly: delta,
        listChanged: delta && listChanged,
        left: targetIds.length,
        retagAll: !delta && tagged > 0,
      });
      setLiveStatus(label);
      indexRunning = true;
      indexJobKind = 'sex';
      indexSexDelta = delta || String(st?.mode || '') === 'sex-delta';
      applyIndexJobProgress(st);
      updateFilterBarLabels();
      startIndexStatusPoll();
      const finalSt = await waitForIndexJob({ scope });
      stopIndexPoll();
      if (finalSt?.status === 'error') {
        throw new Error(finalSt.error || 'Tag sex failed');
      }
      if (finalSt?.status === 'stopped') {
        await loadFavIndexCache();
        const leftStop = countSexUntagged(favIndexCache?.videos);
        throw new Error(
          leftStop
            ? `Tag sex was stopped · ${formatFavCount(leftStop)} left — click Retag sex to continue`
            : 'Tag sex was stopped',
        );
      }
      await loadFavIndexCache();
      const taggedNow = countSexTagged(favIndexCache?.videos);
      const left = countSexUntagged(favIndexCache?.videos);
      setLiveStatus(
        left
          ? `Sex tags incomplete · ${formatFavCount(left)} left — retry ${sexIdleLabel()}`
          : taggedNow
            ? `Sex tagged · ${formatFavCount(taggedNow)}`
            : 'Sex tagging finished',
      );
    } catch (err) {
      setError(`Tag sex failed: ${err.message || String(err)}`);
    } finally {
      indexRunning = false;
      indexProgressLabel = '';
      indexJobKind = '';
      indexSexDelta = false;
      stopIndexPoll();
      updateFilterBarLabels();
      resumeIndexJobUiIfNeeded().catch(() => {});
    }
  }

  function libraryTotalHintForIndex() {
    if (isPlaylistDetailPage()) {
      const maxP = playlistPaginationMax();
      const cards = Math.max(nativeListCardCount(), parseCards().length, 1);
      const native = qs(document, `.${NS}-playlist-native-title`);
      let stored = Number(native?.dataset?.hxyrulePlaylistVideoCount || '');
      // Drop a stale page-1 total when the pager clearly has more pages.
      if (
        Number.isInteger(stored) &&
        stored > 0 &&
        maxP > 1 &&
        stored <= cards
      ) {
        delete native.dataset.hxyrulePlaylistVideoCount;
        stored = NaN;
      }
      if (Number.isInteger(stored) && stored > cards) return stored;
      const fromOrig = parsePlaylistTotalFromText(native?.dataset?.hxyruleOrigTitleText);
      if (fromOrig && fromOrig > cards) return fromOrig;
      // Multi-page playlist: do not send page-1 card count as libraryTotal.
      if (maxP > 1) return 0;
      return fromOrig || cards || Number(favIndexCache?.videos?.length) || 0;
    }
    const per = Math.max(parseCards().length, 1);
    return (
      detectLibraryTotalFromDom() ||
      (scanFavTotal > per ? scanFavTotal : 0) ||
      Number(favIndexCache?.favTotal) ||
      Number(favIndexCache?.videos?.length) ||
      0
    );
  }

  async function buildFavIndex({
    force = true,
    mode = '',
    fromPage = 0,
    toPage = 0,
  } = {}) {
    if (!force && favIndexCache?.videos?.length) return favIndexCache;
    setError('');
    const scope = indexScopeKey();
    try {
      await loadFavIndexCache();
      let crawlMode = String(mode || '')
        .trim()
        .toLowerCase();
      if (crawlMode !== 'incremental' && crawlMode !== 'full') {
        // Empty = full Build; existing = silent page-1 merge (auto dirty/drift).
        // Toolbar Rebuild always passes mode: 'full'.
        crawlMode = favIndexCache?.videos?.length ? 'incremental' : 'full';
      }
      let range = { fromPage: 1, toPage: 1 };
      if (crawlMode === 'incremental') {
        if (Number(fromPage) > 0 || Number(toPage) > 0) {
          const a = Math.max(1, Number(fromPage) || 1);
          const b = Math.max(1, Number(toPage) || a);
          range = { fromPage: Math.min(a, b), toPage: Math.max(a, b) };
        } else {
          range = { fromPage: 1, toPage: 1 };
        }
      }
      let st = await send('INDEX_JOB_STATUS');
      if (st?.status === 'running' || st?.status === 'stopping') {
        if (st.scope !== scope) {
          throw new Error(
            `Index already running for ${st.scope} (${st.page}/${st.maxPage}). Stop it first.`,
          );
        }
      } else {
        const payload = {
          scope,
          maxPage:
            crawlMode === 'incremental' ? range.toPage : maxPageNumber(),
          libraryTotal:
            crawlMode === 'incremental' ? 0 : libraryTotalHintForIndex(),
          mode: crawlMode,
          fromPage: crawlMode === 'incremental' ? range.fromPage : 0,
          toPage: crawlMode === 'incremental' ? range.toPage : 0,
        };
        if (isPlaylistDetailPage()) {
          payload.playlistId = currentPlaylistIdFromPath() || '';
          payload.blockId = playlistBlockId();
          payload.fromKey = playlistFromKey();
        }
        st = await startBackgroundIndexJob(payload);
      }
      indexRunning = true;
      indexJobKind = 'crawl';
      applyIndexJobProgress(st);
      updateFilterBarLabels();
      startIndexStatusPoll();
      const finalSt = await waitForIndexJob({ scope });
      stopIndexPoll();
      if (finalSt?.status === 'error') {
        throw new Error(finalSt.error || 'index failed');
      }
      if (finalSt?.status === 'stopped') {
        lastIndexStats = null;
        return favIndexCache;
      }
      await loadFavIndexCache();
      return favIndexCache;
    } catch (err) {
      setError(`Index failed: ${err.message || String(err)}`);
      return favIndexCache;
    } finally {
      indexRunning = false;
      indexProgressLabel = '';
      indexJobKind = '';
      indexSexDelta = false;
      stopIndexPoll();
      updateFilterBarLabels();
      // If job still running (e.g. navigated away mid-wait), reconnect UI.
      resumeIndexJobUiIfNeeded().catch(() => {});
    }
  }

  async function confirmRebuildIndex() {
    const ok = await confirmModal({
      title: 'Rebuild index',
      body:
        'Rebuild the entire list index (all pages).\n' +
        'Use this only when the index drifted from the site (other device, missed native click).\n' +
        'This does not tag sex — use Tag sex / Retag sex separately.\n' +
        'Large libraries may take a while and can hit site rate limits.',
      okLabel: 'Rebuild',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    await buildFavIndex({ force: true, mode: 'full' });
  }

  /**
   * Build/refresh the Favorites index via background job (works on playlist pages).
   * Does not replace favIndexCache when the current page is a playlist.
   * Progress stays on status + Index; adoptIndexJobResult repaints the card area.
   */
  async function buildFavoritesIndexRemote() {
    if (favoritesRemoteIndexRunning) {
      for (let i = 0; i < 600 && favoritesRemoteIndexRunning; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
      await ensureMyFavIdSet({ force: true });
      return myFavIdSet;
    }
    favoritesRemoteIndexRunning = true;
    try {
      setLiveStatus('Indexing Favorites…');
      let st = await send('INDEX_JOB_STATUS');
      if (st?.status === 'running' || st?.status === 'stopping') {
        if (st.scope !== 'favorites') {
          throw new Error(
            `Index already running for ${st.scope} (${st.page}/${st.maxPage}). Stop it first.`,
          );
        }
      } else {
        let favTotal = 0;
        try {
          const favIdx = await send('FAV_INDEX_GET', { scope: 'favorites' });
          favTotal = Number(favIdx?.favTotal) || Number(favIdx?.videos?.length) || 0;
        } catch (_) {
          /* ignore */
        }
        if (!favTotal && !isPlaylistDetailPage()) {
          favTotal = libraryTotalHintForIndex();
        }
        const favMode = favTotal > 0 ? 'incremental' : 'full';
        st = await startBackgroundIndexJob({
          scope: 'favorites',
          maxPage: favMode === 'incremental' ? 1 : maxPageNumber(),
          libraryTotal: favMode === 'incremental' ? 0 : favTotal,
          mode: favMode,
          fromPage: favMode === 'incremental' ? 1 : 0,
          toPage: favMode === 'incremental' ? 1 : 0,
        });
      }
      if (!isPlaylistDetailPage()) {
        indexRunning = true;
        indexJobKind = 'crawl';
        applyIndexJobProgress(st);
        updateFilterBarLabels();
        startIndexStatusPoll();
      }
      const finalSt = await waitForIndexJob({ scope: 'favorites' });
      if (finalSt?.status === 'error') {
        throw new Error(finalSt.error || 'Favorites index failed');
      }
      if (finalSt?.status === 'stopped') {
        throw new Error('Favorites index was stopped');
      }
      await ensureMyFavIdSet({ force: true });
      return myFavIdSet;
    } finally {
      favoritesRemoteIndexRunning = false;
      if (!isPlaylistDetailPage()) {
        indexRunning = false;
        indexProgressLabel = '';
        indexJobKind = '';
        indexSexDelta = false;
        stopIndexPoll();
        updateFilterBarLabels();
        resumeIndexJobUiIfNeeded().catch(() => {});
      }
    }
  }

  async function doStopIndexJob() {
    try {
      await send('INDEX_JOB_STOP');
      setLiveStatus(
        indexJobKind === 'sex' ? 'Stopping Tag sex…' : 'Stopping index…',
      );
      indexRunning = true;
      updateFilterBarLabels();
      startIndexStatusPoll();
      await waitForIndexJob({ scope: indexScopeKey() });
      lastIndexStats = null;
    } catch (err) {
      setError(`Stop index failed: ${err.message || String(err)}`);
    } finally {
      indexRunning = false;
      indexProgressLabel = '';
      indexJobKind = '';
      indexSexDelta = false;
      lastIndexStats = null;
      stopIndexPoll();
      updateFilterBarLabels();
    }
  }

  function applyRenumberJobProgress(st) {
    if (!st) return;
    const active = st.status === 'running' || st.status === 'stopping';
    if (!isFavoritesPage()) {
      if (rebuildRunning || renumberProgressLabel) {
        rebuildRunning = false;
        renumberProgressLabel = '';
        updateToolbarLabels();
      }
      return;
    }
    rebuildRunning = active;
    if (!active) {
      renumberProgressLabel = '';
    } else if (st.phase === 'renaming') {
      renumberProgressLabel = 'renaming…';
    } else {
      const page = Number(st.page) || 0;
      const maxPage = Math.max(1, Number(st.maxPage) || 1);
      renumberProgressLabel = `${page}/${maxPage}`;
    }
    updateToolbarLabels();
  }

  function stopRenumberPoll() {
    if (renumberPollTimer) {
      clearInterval(renumberPollTimer);
      renumberPollTimer = null;
    }
  }

  async function adoptRenumberJobResult(st) {
    if (!st || !isFavoritesPage()) return;
    if (st.status === 'done') {
      const maxPage = Math.max(1, Number(st.maxPage) || 1);
      lastRenumberStats = { done: maxPage, total: maxPage };
      scanFavTotal = Number(st.result?.count) || scanFavTotal;
      try {
        const scan = await send('HELPER_SCAN');
        videoRootExists = true;
        scanned = true;
        const matches = scan.matches || {};
        localIdSet = new Set(Object.keys(matches).map(String));
        lastMatches = matches;
        refreshScanLabelCounts();
      } catch (err) {
        if (/not mounted or missing/i.test(String(err?.message || err || ''))) {
          videoRootExists = false;
        }
      }
      const cards = parseCards();
      await applyOrdinalsToCards(cards);
      cards.forEach((card) => renderStatus(card, lastMatches[card.videoId], scanned));
      syncCurrentPageLocalMark(cards, lastMatches);
      scheduleEvaluateVisiblePages();
      const total = Number(st.result?.count) || 0;
      const renamed = Number(st.result?.renamed) || 0;
      const errCount = Number(st.result?.errorCount) || 0;
      const msg =
        `Renumbered ${total}` +
        (renamed ? `, renamed ${renamed} file(s)` : ', no files needed rename') +
        (errCount ? ` (${errCount} rename error(s))` : '') +
        '.';
      if (errCount) setError(msg);
      else setError('');
      setLiveStatus(msg);
    } else if (st.status === 'error') {
      setError(`Renumber failed: ${st.error || 'unknown error'}`);
    } else if (st.status === 'stopped') {
      lastRenumberStats = null;
      setLiveStatus('Renumber stopped');
    }
  }

  async function waitForRenumberJob() {
    for (let i = 0; i < 36_000; i += 1) {
      const st = await send('RENUMBER_JOB_STATUS');
      applyRenumberJobProgress(st);
      if (!st || (st.status !== 'running' && st.status !== 'stopping')) {
        await adoptRenumberJobResult(st);
        rebuildRunning = false;
        renumberProgressLabel = '';
        updateToolbarLabels();
        return st;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('renumber job timed out');
  }

  function startRenumberStatusPoll() {
    if (renumberPollTimer) return;
    renumberPollTimer = setInterval(() => {
      refreshRenumberJobUi().catch(() => {});
    }, 1000);
  }

  async function refreshRenumberJobUi() {
    const st = await send('RENUMBER_JOB_STATUS');
    const active = st && (st.status === 'running' || st.status === 'stopping');
    if (!active) {
      stopRenumberPoll();
      if (rebuildRunning || renumberProgressLabel) {
        await adoptRenumberJobResult(st);
        rebuildRunning = false;
        renumberProgressLabel = '';
        updateToolbarLabels();
      }
      return st;
    }
    applyRenumberJobProgress(st);
    if (isFavoritesPage()) startRenumberStatusPoll();
    return st;
  }

  async function resumeRenumberJobUiIfNeeded() {
    try {
      const st = await send('RENUMBER_JOB_STATUS');
      if (st && (st.status === 'running' || st.status === 'stopping') && isFavoritesPage()) {
        rebuildRunning = true;
        applyRenumberJobProgress(st);
        updateToolbarLabels();
        startRenumberStatusPoll();
      }
    } catch (_) {
      /* ignore */
    }
  }

  function applyPlaylistAddJobProgress(st) {
    if (!st) return;
    const active = st.status === 'running' || st.status === 'stopping';
    playlistRunning = active || !!playlistModalAbort;
    playlistCancel = active && (!!st.cancelRequested || st.status === 'stopping');
    if (active) {
      const done = Number(st.done) || 0;
      const total = Math.max(1, Number(st.total) || 1);
      if (st.phase === 'move') playlistProgressLabel = `moving · ${done}/${total}`;
      else playlistProgressLabel = `${done}/${total}`;
    } else if (!playlistModalAbort) {
      playlistProgressLabel = '';
    }
    updateFilterBarLabels();
  }

  function stopPlaylistAddPoll() {
    if (playlistPollTimer) {
      clearInterval(playlistPollTimer);
      playlistPollTimer = null;
    }
  }

  function selectionItemsFromJob(result, ids) {
    const items = result?.items && typeof result.items === 'object' ? result.items : {};
    return (ids || []).map((id) => {
      const key = String(id);
      const hit = items[key];
      if (hit) return hit;
      return {
        videoId: key,
        title: key,
        detailUrl: `https://rule34video.com/video/${key}/v/`,
        favoritePage: 0,
        cardIndex: 0,
        durationSec: null,
      };
    });
  }

  async function adoptPlaylistAddJobResult(st) {
    if (!st) return;
    const result = st.result || null;
    if (st.status === 'error') {
      setError(`Playlist failed: ${st.error || 'unknown error'}`);
      return;
    }
    if (st.status !== 'done' && st.status !== 'stopped') return;
    if (!result) {
      if (st.status === 'stopped') setFlash('Playlist add stopped');
      return;
    }
    const mode = result.mode === 'move' ? 'move' : 'save';
    const playlistIds = Array.isArray(result.playlistIds) ? result.playlistIds : [];
    const okBy = result.okIdsByPlaylist || {};
    let patched = 0;
    for (const pid of playlistIds) {
      const ids = Array.isArray(okBy[pid]) ? okBy[pid] : [];
      if (!ids.length) continue;
      await patchIndexAddItems(`playlist:${pid}`, selectionItemsFromJob(result, ids));
      patched = Math.max(patched, ids.length);
    }
    const currentPid = currentPlaylistIdFromPath();
    const currentScope = indexScopeKey();
    const sourceScope = String(result.sourceScope || '');
    const movedIds = Array.isArray(result.moveOkIds)
      ? result.moveOkIds
      : mode === 'move' && Array.isArray(okBy[playlistIds[playlistIds.length - 1]])
        ? okBy[playlistIds[playlistIds.length - 1]]
        : [];
    let addedToCurrent = 0;
    let removedFromCurrent = 0;
    if (
      isPlaylistDetailPage() &&
      currentPid &&
      playlistIds.some((pid) => String(pid) === String(currentPid))
    ) {
      const ids = Array.isArray(okBy[currentPid]) ? okBy[currentPid] : [];
      if (ids.length) {
        addedToCurrent = ids.length;
      } else if (
        playlistIds.length === 1 &&
        String(playlistIds[0]) === String(currentPid)
      ) {
        addedToCurrent = Number(result.ok) || 0;
      }
    }
    if (mode === 'move' && movedIds.length && sourceScope && sourceScope === currentScope) {
      removedFromCurrent = movedIds.length;
    }
    if (mode === 'move') {
      if (movedIds.length) {
        await patchIndexRemoveIds('favorites', movedIds);
        if (!isPlaylistDetailPage() && sourceScope === 'favorites') {
          removeListCardsByIds(movedIds);
        }
      }
      if (st.status === 'stopped') {
        setFlash(`Stopped · moved/saved ~${Number(result.ok) || 0}`);
      } else if (result.failed) {
        setError(
          `Moved ~${movedIds.length || Number(result.ok) || 0}` +
            ` · ${result.failed} API fail` +
            (result.errors?.[0] ? ` (${result.errors[0]})` : ''),
        );
      } else {
        setFlash(`Moved ${movedIds.length || Number(result.ok) || 0}`);
      }
    } else if (st.status === 'stopped') {
      if (!patched && (Number(result.ok) || 0) > 0) {
        playlistIndexesDirty = true;
        invalidatePlaylistMembershipCache();
        invalidateFrozenViewForStoreChange();
      }
      setFlash(`Stopped · ~${Number(result.ok) || 0} saved`);
    } else if ((Number(result.ok) || 0) === 0) {
      setError(
        `Save failed for all targets` +
          (result.errors?.length ? `: ${result.errors.slice(0, 3).join('; ')}` : ''),
      );
    } else {
      if (!patched) {
        playlistIndexesDirty = true;
        invalidatePlaylistMembershipCache();
        invalidateFrozenViewForStoreChange();
      }
      const parts = [
        `Saved ~${patched || Number(result.ok) || 0} → ${playlistIds.length} playlist(s) (Favorites kept)`,
      ];
      if (result.failed) parts.push(`${result.failed} API fail`);
      if (result.failed) setError(parts.join(' · '));
      else setFlash(parts[0]);
    }
    invalidatePlaylistMembershipCache();
    hideNativeControls();
    const mutatedOk =
      addedToCurrent > 0 ||
      removedFromCurrent > 0 ||
      (Number(result.ok) || 0) > 0 ||
      patched > 0;
    if (mutatedOk) {
      await refreshUiAfterLibraryMutateJob({
        addedToCurrent,
        removedFromCurrent,
        reloadList: addedToCurrent > 0 || removedFromCurrent > 0,
      });
    }
  }

  async function waitForPlaylistAddJob() {
    for (let i = 0; i < 36_000; i += 1) {
      const st = await send('PLAYLIST_ADD_JOB_STATUS');
      applyPlaylistAddJobProgress(st);
      if (!st || (st.status !== 'running' && st.status !== 'stopping')) {
        await adoptPlaylistAddJobResult(st);
        playlistRunning = !!playlistModalAbort;
        playlistProgressLabel = '';
        playlistCancel = false;
        updateFilterBarLabels();
        return st;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('playlist-add job timed out');
  }

  function startPlaylistAddStatusPoll() {
    if (playlistPollTimer) return;
    playlistPollTimer = setInterval(() => {
      refreshPlaylistAddJobUi().catch(() => {});
    }, 1000);
  }

  async function refreshPlaylistAddJobUi() {
    const st = await send('PLAYLIST_ADD_JOB_STATUS');
    const active = st && (st.status === 'running' || st.status === 'stopping');
    if (!active) {
      stopPlaylistAddPoll();
      if (playlistRunning && !playlistModalAbort) {
        await adoptPlaylistAddJobResult(st);
        playlistRunning = false;
        playlistProgressLabel = '';
        playlistCancel = false;
        updateFilterBarLabels();
      }
      return st;
    }
    applyPlaylistAddJobProgress(st);
    startPlaylistAddStatusPoll();
    return st;
  }

  async function resumePlaylistAddJobUiIfNeeded() {
    try {
      const st = await send('PLAYLIST_ADD_JOB_STATUS');
      if (st && (st.status === 'running' || st.status === 'stopping')) {
        playlistRunning = true;
        applyPlaylistAddJobProgress(st);
        updateFilterBarLabels();
        startPlaylistAddStatusPoll();
      }
    } catch (_) {
      /* ignore */
    }
  }

  function applyFavAddJobProgress(st) {
    if (!st) return;
    const active = st.status === 'running' || st.status === 'stopping';
    favAddRunning = active;
    favAddCancel = active && (!!st.cancelRequested || st.status === 'stopping');
    if (active) {
      const done = Number(st.done) || 0;
      const total = Math.max(1, Number(st.total) || 1);
      favAddProgressLabel = `${done}/${total}`;
    } else {
      favAddProgressLabel = '';
    }
    updateToolbarLabels();
  }

  function stopFavAddPoll() {
    if (favAddPollTimer) {
      clearInterval(favAddPollTimer);
      favAddPollTimer = null;
    }
  }

  async function adoptFavAddJobResult(st) {
    if (!st) return;
    const result = st.result || null;
    if (st.status === 'error') {
      setError(`Favorites failed: ${st.error || 'unknown error'}`);
      return;
    }
    if (st.status !== 'done' && st.status !== 'stopped') return;
    if (!result) {
      if (st.status === 'stopped') setFlash('Add to Favorites stopped');
      return;
    }
    const okIds = Array.isArray(result.okIds) ? result.okIds : [];
    if (okIds.length) {
      await patchIndexAddItems('favorites', selectionItemsFromJob(result, okIds));
      // okIds are add-order (oldest first); claim wants newest-first.
      await claimNewestOrdinals([...okIds].reverse());
      if (isFavoritesPage()) scheduleOrdinalRepaint([0, 300]);
    }
    const okCount = Math.max(okIds.length, Number(result.ok) || 0);
    if (st.status === 'stopped') {
      setFlash(`Stopped · added ${Number(result.ok) || 0}/${Number(result.total) || 0}`);
    } else if ((Number(result.ok) || 0) === 0) {
      setError(
        `Add to Favorites failed for all ${Number(result.failed) || 0}` +
          (result.errors?.length ? `: ${result.errors.slice(0, 3).join('; ')}` : ''),
      );
    } else if (result.failed) {
      setError(
        `Added ${result.ok}/${result.total} · ${result.failed} failed` +
          (result.errors?.[0] ? ` (${result.errors[0]})` : ''),
      );
    } else {
      setFlash(`Added ${result.ok}`);
    }
    if (okCount > 0) {
      const onFavorites = !isPlaylistDetailPage();
      await refreshUiAfterLibraryMutateJob({
        addedToCurrent: onFavorites ? okCount : 0,
        removedFromCurrent: 0,
        reloadList: onFavorites,
      });
    }
  }

  async function waitForFavAddJob() {
    for (let i = 0; i < 36_000; i += 1) {
      const st = await send('FAV_ADD_JOB_STATUS');
      applyFavAddJobProgress(st);
      if (!st || (st.status !== 'running' && st.status !== 'stopping')) {
        await adoptFavAddJobResult(st);
        favAddRunning = false;
        favAddProgressLabel = '';
        favAddCancel = false;
        updateToolbarLabels();
        return st;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('fav-add job timed out');
  }

  function startFavAddStatusPoll() {
    if (favAddPollTimer) return;
    favAddPollTimer = setInterval(() => {
      refreshFavAddJobUi().catch(() => {});
    }, 1000);
  }

  async function refreshFavAddJobUi() {
    const st = await send('FAV_ADD_JOB_STATUS');
    const active = st && (st.status === 'running' || st.status === 'stopping');
    if (!active) {
      stopFavAddPoll();
      if (favAddRunning) {
        await adoptFavAddJobResult(st);
        favAddRunning = false;
        favAddProgressLabel = '';
        favAddCancel = false;
        updateToolbarLabels();
      }
      return st;
    }
    applyFavAddJobProgress(st);
    startFavAddStatusPoll();
    return st;
  }

  async function resumeFavAddJobUiIfNeeded() {
    try {
      const st = await send('FAV_ADD_JOB_STATUS');
      if (st && (st.status === 'running' || st.status === 'stopping')) {
        favAddRunning = true;
        applyFavAddJobProgress(st);
        updateToolbarLabels();
        startFavAddStatusPoll();
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function resumeBackgroundJobsUi() {
    await resumeIndexJobUiIfNeeded();
    await resumeRenumberJobUiIfNeeded();
    await resumePlaylistAddJobUiIfNeeded();
    await resumeFavAddJobUiIfNeeded();
  }

  async function doStopRenumberJob() {
    try {
      await send('RENUMBER_JOB_STOP');
      setLiveStatus('Stopping renumber…');
      rebuildRunning = true;
      updateToolbarLabels();
      startRenumberStatusPoll();
      await waitForRenumberJob();
      lastRenumberStats = null;
    } catch (err) {
      setError(`Stop renumber failed: ${err.message || String(err)}`);
    } finally {
      rebuildRunning = false;
      renumberProgressLabel = '';
      lastRenumberStats = null;
      stopRenumberPoll();
      updateToolbarLabels();
    }
  }

  function readDurationFilterInputs() {
    const bar = qs(document, `.${NS}-controls`) || qs(document, `.${NS}-filterbar`);
    const minIn = bar && qs(bar, '[data-role="dur-min"]');
    const maxIn = bar && qs(bar, '[data-role="dur-max"]');
    filterState.durMinMin = minIn ? String(minIn.value || '').trim() : '';
    filterState.durMaxMin = maxIn ? String(maxIn.value || '').trim() : '';
    const minMin = filterState.durMinMin === '' ? null : Number(filterState.durMinMin);
    const maxMin = filterState.durMaxMin === '' ? null : Number(filterState.durMaxMin);
    return {
      minSec: Number.isFinite(minMin) && minMin >= 0 ? Math.round(minMin * 60) : null,
      maxSec: Number.isFinite(maxMin) && maxMin >= 0 ? Math.round(maxMin * 60) : null,
    };
  }

  function readTitleQueryFilter() {
    const bar = qs(document, `.${NS}-controls`) || qs(document, `.${NS}-filterbar`);
    const titleIn = bar && qs(bar, '[data-role="title-query"]');
    filterState.titleQuery = titleIn
      ? String(titleIn.value || '').trim()
      : String(filterState.titleQuery || '').trim();
    return filterState.titleQuery;
  }

  function videoMatchesFilters(video, { minSec, maxSec, titleQuery }) {
    const id = String(video.videoId);
    const onDisk = localIdSet.has(id) || isCardLocal(id);
    if (!diskFilterIsAll()) {
      if (!filterState.localOn && !filterState.cloudOn) return false;
      if (filterState.localOn && !filterState.cloudOn && !onDisk) return false;
      if (!filterState.localOn && filterState.cloudOn && onDisk) return false;
    }
    if (!collectionFilterIsAll()) {
      if (!filterState.favoriteOn && !filterState.playlistOn) return false;
      // favoriteOn = members of comparison set; playlistOn = non-members.
      if (isPlaylistDetailPage()) {
        const inSet = !!(myFavIdSet && myFavIdSet.has(id));
        if (filterState.playlistOn && !filterState.favoriteOn && inSet) return false;
        if (filterState.favoriteOn && !filterState.playlistOn && !inSet) return false;
      } else {
        const inSet = !!(playlistMembershipSet && playlistMembershipSet.has(id));
        if (filterState.playlistOn && !filterState.favoriteOn && inSet) return false;
        if (filterState.favoriteOn && !filterState.playlistOn && !inSet) return false;
      }
    }
    if (!sexFilterIsAll()) {
      if (!filterState.futaOn && !filterState.straightOn) return false;
      const groups = videoSexGroupSet(video);
      const isFuta = groups.has('futa');
      const isStraight = groups.has('straight');
      if (filterState.futaOn && !filterState.straightOn && !isFuta) return false;
      if (!filterState.futaOn && filterState.straightOn && !isStraight) return false;
    }
    if (minSec != null || maxSec != null) {
      const dur = coerceDurationSec(video.durationSec);
      if (dur == null) return false;
      if (minSec != null && dur < minSec) return false;
      if (maxSec != null && dur > maxSec) return false;
    }
    const q = String(titleQuery || '').trim().toLowerCase();
    if (q) {
      // Include Favorites seq prefix ("N——…") so Name can match ordinals too.
      const raw = String(video?.title || '');
      const bare = bareTitle(raw);
      const seq = seqOrderKey(video);
      const display = seq != null ? titledWithOrdinal(seq, bare) : raw;
      const hay = `${display}\n${raw}\n${bare}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function applyFilterToCurrentPage() {
    const cards = parseCards();
    // Compact view already contains only matches — never gray those cards out.
    const matched =
      !compactViewActive && filterState.active && filterState.matchedIds
        ? filterState.matchedIds
        : null;
    ignoreMutationsUntil = Date.now() + 400;
    cards.forEach((card) => {
      const on = matched ? matched.has(String(card.videoId)) : true;
      card.el.classList.toggle(`${NS}-filtered-out`, matched ? !on : false);
      if (card.checkbox) card.checkbox.disabled = matched ? !on : false;
      const rail = qs(card.el, `.${NS}-pick`);
      if (rail) {
        if (matched && !on) {
          rail.setAttribute('aria-disabled', 'true');
          rail.tabIndex = -1;
        } else {
          rail.removeAttribute('aria-disabled');
          rail.tabIndex = 0;
        }
      }
    });
  }

  function liveThumbUrlMap() {
    const map = new Map();
    const list = favoritesListEl() || document;
    qsa(list, '.item.thumb').forEach((el) => {
      if (el.dataset?.hxyruleCompact === '1') return;
      if (el.closest(`.${NS}-compact-thumbs`)) return;
      const link = qs(el, 'a.th.js-open-popup, a.th, a[href*="/video/"]');
      const checkbox =
        qs(el, 'input.checkbox[name="delete[]"]') ||
        qs(el, 'input[name="delete[]"]') ||
        qs(el, 'input[type="checkbox"]');
      const id =
        checkbox?.value || (link?.getAttribute('href') || '').match(/\/video\/(\d+)\//)?.[1];
      if (!id) return;
      const thumb = cardThumbUrl(el);
      if (thumb) map.set(String(id), thumb);
    });
    return map;
  }

  function compactPerPage() {
    const n = cardsPerPageEstimate();
    return n > 0 ? n : 24;
  }

  function compactPageCount() {
    const per = compactPerPage();
    const total = compactMatchedItems.length;
    if (!total) return 1;
    return Math.max(1, Math.ceil(total / per));
  }

  function sampleNativeCardEl() {
    const list = favoritesListEl();
    if (!list) return null;
    return (
      qsa(list, '.item.thumb').find(
        (el) => el.dataset?.hxyruleCompact !== '1' && !el.closest(`.${NS}-compact-thumbs`),
      ) || null
    );
  }

  function thumbVideoIdFromEl(el) {
    if (!(el instanceof Element)) return '';
    const checkbox =
      qs(el, 'input.checkbox[name="delete[]"]') ||
      qs(el, 'input[name="delete[]"]') ||
      qs(el, 'input[type="checkbox"]');
    const link = qs(el, 'a.th.js-open-popup, a.th, a[href*="/video/"]');
    const vid =
      checkbox?.value ||
      (link?.getAttribute('href') || '').match(/\/video\/(\d+)\//)?.[1];
    return String(vid || '').trim();
  }

  function findNativeCardEl(videoId) {
    const id = String(videoId);
    const list = favoritesListEl() || document;
    return (
      qsa(list, '.item.thumb').find((el) => {
        if (el.dataset?.hxyruleCompact === '1') return false;
        if (el.closest(`.${NS}-compact-thumbs`)) return false;
        return thumbVideoIdFromEl(el) === id;
      }) || null
    );
  }

  /**
   * Drop native + compact cards for ids just removed from this list.
   * Compact sits beside a hidden native grid; parseCards() only sees compact
   * clones, so List would keep deleted videos until a full refresh.
   */
  function removeListCardsByIds(ids) {
    const want = new Set((ids || []).map(String).filter(Boolean));
    if (!want.size) return 0;
    ignoreMutationsUntil = Math.max(ignoreMutationsUntil || 0, Date.now() + 1200);
    const roots = [favoritesListEl(), qs(document, `.${NS}-compact-thumbs`)].filter(
      Boolean,
    );
    const seen = new Set();
    let n = 0;
    roots.forEach((root) => {
      qsa(root, '.item.thumb').forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        const id = thumbVideoIdFromEl(el);
        if (!id || !want.has(id)) return;
        try {
          el.remove();
          n += 1;
        } catch (_) {
          /* ignore */
        }
      });
    });
    return n;
  }

  function stripHxyruleCardChrome(el) {
    if (!el) return;
    qsa(el, `.${NS}-pick, .${NS}-status`).forEach((node) => node.remove());
    el.classList.remove(
      `${NS}-card`,
      `${NS}-picked`,
      `${NS}-filtered-out`,
      `${NS}-compact-native-hidden`,
      'selected',
    );
    el.querySelectorAll('.hxyrule-hide-native').forEach((node) => {
      node.classList.remove('hxyrule-hide-native');
    });
    delete el.dataset.hxyruleCheckBound;
    const link = qs(el, 'a.th.js-open-popup, a.th');
    if (!link) return;
    const title = qs(el, '.thumb_title');
    const info = qs(el, '.thumb_info');
    if (title && title.parentElement !== link) link.appendChild(title);
    if (info && info.parentElement !== link) link.appendChild(info);
  }

  function captureCompactCardTemplate() {
    if (compactCardTemplate?.clone) return compactCardTemplate;
    const sample = sampleNativeCardEl();
    if (!sample) return compactCardTemplate;
    const metrics = {};
    try {
      const rect = sample.getBoundingClientRect();
      const cs = getComputedStyle(sample);
      // Prefer %-width so compact cards keep the native column count. Locking
      // getBoundingClientRect() px (+ min-width) made cards too wide and left
      // an empty right column (e.g. 2 cards in a 3-col row).
      const cssWidth = String(cs.width || '').trim();
      const parentW =
        sample.parentElement?.getBoundingClientRect?.().width ||
        sample.offsetParent?.getBoundingClientRect?.().width ||
        0;
      if (cssWidth.endsWith('%')) {
        metrics.width = cssWidth;
      } else if (parentW > 1 && rect.width > 1) {
        const pct = Math.min(100, (rect.width / parentW) * 100);
        if (pct >= 10 && pct <= 55) metrics.width = `${pct.toFixed(4)}%`;
      } else if (cssWidth && cssWidth !== 'auto' && cssWidth !== '0px') {
        metrics.width = cssWidth;
      }
      const cssMax = String(cs.maxWidth || '').trim();
      if (cssMax && cssMax !== 'none' && cssMax !== '0px') metrics.maxWidth = cssMax;
      ['float', 'display'].forEach((prop) => {
        const val = cs.getPropertyValue(prop);
        if (val) metrics[prop] = val;
      });
      metrics.boxSizing = 'border-box';
      // Prefer the site poster box (.wrap_image uses padding-bottom:69%).
      // Measuring a.th itself can pick up our temporary 4/3 fallback and bake
      // a taller ratio into every compact card (dark strip under the poster).
      const wrap =
        qs(sample, 'a.th .img.wrap_image, a.th .wrap_image') ||
        qs(sample, 'a.th img, img');
      if (wrap) {
        const ir = wrap.getBoundingClientRect();
        if (ir.width > 1 && ir.height > 1) {
          const ratio = ir.height / ir.width;
          // Guard against measuring a mis-sized donor (e.g. 4/3 fallback).
          metrics.imgAspect = (
            ratio > 0.55 && ratio < 0.85 ? ratio : 0.69
          ).toFixed(5);
        }
      }
      if (!metrics.imgAspect) metrics.imgAspect = '0.69';
    } catch (_) {
      /* ignore */
    }
    const clone = sample.cloneNode(true);
    stripHxyruleCardChrome(clone);
    compactCardTemplate = { clone, metrics };
    return compactCardTemplate;
  }

  function applyCompactCardMetrics(el, metrics) {
    if (!el || !metrics) return;
    el.style.setProperty('box-sizing', 'border-box');
    const map = {
      width: 'width',
      maxWidth: 'max-width',
      float: 'float',
      display: 'display',
    };
    Object.entries(map).forEach(([key, cssProp]) => {
      const val = metrics[key];
      if (val) el.style.setProperty(cssProp, val);
    });
    // Never re-apply donor min-width — it forces an empty trailing column.
    el.style.removeProperty('min-width');
    const link = qs(el, 'a.th.js-open-popup, a.th') || qs(el, 'a[href*="/video/"]');
    // Lock thumb box aspect on a.th so hover <video> / absolute poster cannot
    // change card height (float-grid reflow → vertical twitch).
    if (link && metrics.imgAspect) {
      link.style.setProperty('aspect-ratio', `1 / ${metrics.imgAspect}`);
    }
    const img = qs(el, 'a.th > img, a.th img');
    if (img) {
      img.style.position = 'absolute';
      img.style.inset = '0';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.display = 'block';
      img.style.removeProperty('aspect-ratio');
    }
  }

  function fillCompactThumbInfo(el, video, { preferExisting = false } = {}) {
    const link =
      qs(el, 'a.th.js-open-popup, a.th') || qs(el, 'a[href*="/video/"]');
    if (!link) return;
    const pick = qs(el, `.${NS}-pick`);
    // Prefer the visible pick-rail info. Avoid filling a hidden duplicate left
    // inside a.th (overflow:hidden) — that made off-page sample cards look bare.
    let info =
      (pick && (qs(pick, ':scope > .thumb_info') || qs(pick, '.thumb_info'))) ||
      qs(el, ':scope > .thumb_info') ||
      qs(link, ':scope > .thumb_info') ||
      qs(el, '.thumb_info') ||
      qs(link, '.thumb_info');
    const live = cardMetaFromEl(el);
    const views =
      normalizeMetaText(video?.viewsText) ||
      (preferExisting ? live.viewsText : '') ||
      '';
    const rating =
      normalizeMetaText(video?.ratingText) ||
      (preferExisting ? live.ratingText : '') ||
      '';
    // Calendar row = site upload time. Never use live `.added` or indexed
    // list-import `addedText` — both are favorites/playlist add time on this site.
    const added = uploadedTextForItem(video) || '';
    if (!views && !rating && !added) {
      if (preferExisting && info && (live.viewsText || live.ratingText)) {
        return;
      }
    }
    if (!info) {
      info = document.createElement('div');
      info.className = 'thumb_info';
      if (pick) pick.appendChild(info);
      else link.appendChild(info);
    }
    // Drop stray copies so we never leave filled meta clipped under a.th.
    qsa(el, '.thumb_info').forEach((node) => {
      if (node !== info) node.remove();
    });
    if (pick && info.parentElement !== pick) pick.appendChild(info);
    info.innerHTML = '';
    const append = (className, text) => {
      if (!text) return;
      const node = document.createElement('div');
      node.className = className;
      node.textContent = text;
      info.appendChild(node);
    };
    append('views', views);
    append('rating', rating);
    append('added', added);
  }

  /**
   * Resolve site upload relative times for the visible compact page.
   * Favorites/playlist list HTML only exposes import time in `.added`.
   */
  async function enrichUploadedTextForCompactSlice(slice) {
    const items = Array.isArray(slice) ? slice : [];
    const need = items
      .map((it) => String(it?.videoId || '').trim())
      .filter((id) => /^\d+$/.test(id) && !uploadedTextForItem(
        compactMatchedItems.find((v) => String(v?.videoId) === id) || items.find((v) => String(v?.videoId) === id),
      ));
    if (!need.length) return;
    const gen = ++uploadMetaEnrichGen;
    let data;
    try {
      data = await send('UPLOAD_META_LOOKUP', { videoIds: need });
    } catch (_) {
      return;
    }
    if (gen !== uploadMetaEnrichGen || !compactViewActive) return;
    const results = data?.results && typeof data.results === 'object' ? data.results : {};
    const updates = new Map();
    Object.entries(results).forEach(([id, row]) => {
      const text = normalizeMetaText(row?.uploadedText);
      if (text) updates.set(String(id), text);
    });
    if (!updates.size) return;

    compactMatchedItems = compactMatchedItems.map((v) => {
      const text = updates.get(String(v?.videoId || ''));
      if (!text) return v;
      return { ...v, uploadedText: text };
    });

    const host = qs(document, `.${NS}-compact-thumbs`);
    if (host) {
      qsa(host, `.item.thumb[data-hxyrule-compact="1"]`).forEach((el) => {
        const id =
          qs(el, 'input.checkbox[name="delete[]"], input[name="delete[]"], input[type="checkbox"]')
            ?.value ||
          (qs(el, 'a[href*="/video/"]')?.getAttribute('href') || '').match(/\/video\/(\d+)\//)?.[1];
        const text = id ? updates.get(String(id)) : '';
        if (!text) return;
        const video = compactMatchedItems.find((v) => String(v?.videoId) === String(id));
        fillCompactThumbInfo(el, video || { uploadedText: text }, { preferExisting: false });
      });
    }

    patchUploadedTextInIndex(updates).catch(() => {});
  }

  async function patchUploadedTextInIndex(updates) {
    if (!(updates instanceof Map) || !updates.size) return;
    const scope = indexScopeKey();
    let idx;
    try {
      idx = await send('FAV_INDEX_GET', { scope });
    } catch (_) {
      return;
    }
    if (!idx?.videos?.length) return;
    let changed = 0;
    const videos = idx.videos.map((v) => {
      const text = updates.get(String(v?.videoId || ''));
      if (!text || normalizeMetaText(v.uploadedText) === text) return v;
      changed += 1;
      return { ...v, uploadedText: text };
    });
    if (!changed) return;
    try {
      await send('FAV_INDEX_SET', {
        index: {
          ...idx,
          videos,
          favTotal: videos.length,
          builtAt: idx.builtAt || Date.now(),
          scope,
        },
        scope,
      });
    } catch (_) {
      /* ignore */
    }
  }

  function applyCompactCardDuration(link, video, { preferExisting = false } = {}) {
    if (!link) return;
    const durText = formatClockDuration(video?.durationSec);
    const root = link.closest('.item.thumb') || link;
    let time = qs(link, '.time') || qs(root, '.time');
    if (durText) {
      if (!time) {
        time = document.createElement('span');
        time.className = 'time';
        link.appendChild(time);
      } else if (time.parentElement !== link) {
        link.appendChild(time);
      }
      time.textContent = durText;
      return;
    }
    if (preferExisting && time && String(time.textContent || '').trim()) {
      if (time.parentElement !== link) link.appendChild(time);
      return;
    }
    // Drop donor sample duration when this video has no known length.
    time?.remove();
  }

  /**
   * Fresh <img> so cloned donor pixels never flash, and strip hover-preview
   * attrs that point at CDN files (no /video/{id}/ to rewrite).
   */
  function replaceCompactCardImg(link, { thumbUrl, title } = {}) {
    if (!link) return null;
    qsa(link, 'video, source').forEach((node) => node.remove());
    const img = document.createElement('img');
    img.alt = title || '';
    img.loading = 'eager';
    img.decoding = 'async';
    if (thumbUrl) {
      img.src = thumbUrl;
      img.setAttribute('data-original', thumbUrl);
    } else {
      img.classList.add(`${NS}-compact-missing-thumb`);
    }
    const old = qs(link, 'img');
    if (old) old.replaceWith(img);
    else link.insertBefore(img, link.firstChild);
    return img;
  }

  function stripStaleCompactHoverMedia(el, id) {
    if (!el) return;
    const mediaAttrs = [
      'data-preview',
      'data-src',
      'data-mid',
      'data-trailer',
      'data-video',
      'data-mp4',
      'data-webm',
      'data-original',
      'data-lazy-src',
      'data-thumb',
      'srcset',
    ];
    const keepIfOwnsId = (raw) => {
      const u = String(raw || '');
      if (!u) return false;
      // Only keep URLs that clearly belong to this video id.
      return (
        u.includes(`/video/${id}/`) ||
        u.includes(`/popup-video/${id}/`) ||
        u.includes(`/${id}/`) ||
        u.includes(`_${id}.`) ||
        u.includes(`/${id}.`)
      );
    };
    qsa(el, 'a, img, video, source, [data-preview], [data-src], [data-mid]').forEach((node) => {
      mediaAttrs.forEach((attr) => {
        const raw = node.getAttribute(attr);
        if (!raw) return;
        if (attr === 'data-original' || attr === 'data-thumb' || attr === 'data-lazy-src') {
          // Thumb attrs are reapplied from thumbUrl after this pass.
          node.removeAttribute(attr);
          return;
        }
        if (!keepIfOwnsId(raw)) node.removeAttribute(attr);
      });
    });
    qsa(el, 'video, source').forEach((node) => {
      if (node.closest('a.th, .th')) node.remove();
    });
  }

  function readCompactHoverPreviewUrl(root) {
    if (!root) return '';
    const nodes = [root, ...qsa(root, 'a.th, a, img')];
    const attrs = ['data-preview', 'data-trailer', 'data-video', 'data-mp4', 'data-webm', 'data-mid'];
    for (const node of nodes) {
      if (!node?.getAttribute) continue;
      for (const attr of attrs) {
        const raw = String(node.getAttribute(attr) || '').trim();
        if (!raw || /grey\.gif|spacer|blank|lazy/i.test(raw)) continue;
        if (/\.(?:mp4|webm|gif|webp)(?:$|\?)/i.test(raw) || /preview|trailer/i.test(raw)) {
          return raw.startsWith('//') ? `https:${raw}` : raw;
        }
      }
    }
    return '';
  }

  function rewriteCompactCardIdentity(
    el,
    video,
    thumbUrl,
    { preferExistingMeta = false, keepHoverPreview = false } = {},
  ) {
    const id = String(video.videoId);
    const title = String(video.title || id).trim() || id;
    // Never trust index/sample detailUrl when it points at another video — that
    // left-click (videoId) worked while right-click Open link opened the donor.
    const detailUrl = detailUrlForVideoId(id, video.detailUrl);
    const popupUrl = popupUrlForVideoId(id);
    const checkbox =
      qs(el, 'input.checkbox[name="delete[]"]') ||
      qs(el, 'input[name="delete[]"]') ||
      qs(el, 'input[type="checkbox"]');
    if (checkbox) checkbox.value = id;

    // Sample clones keep the donor card's video_* class and fancybox data-href.
    // Without rewriting those, online play always opens the sample (often fav #1).
    const oldId =
      (el.className.match(/\bvideo_(\d+)\b/) || [])[1] ||
      (() => {
        const href =
          qs(el, 'a.th.js-open-popup, a.th')?.getAttribute('href') ||
          qs(el, 'a[href*="/video/"]')?.getAttribute('href') ||
          '';
        return (
          href.match(/\/popup-video\/(\d+)\//i)?.[1] ||
          href.match(/(?:^|https?:\/\/[^/]+)\/video\/(\d+)\//i)?.[1] ||
          ''
        );
      })();
    // Prefer indexed preview; fall back to same-card native preview only.
    const indexedPreview = normalizeThumbUrl(video?.previewUrl);
    const keepPreview =
      indexedPreview ||
      (keepHoverPreview ? readCompactHoverPreviewUrl(el) : '');
    Array.from(el.classList).forEach((cls) => {
      if (/^video_\d+$/.test(cls) && cls !== `video_${id}`) el.classList.remove(cls);
    });
    el.classList.add(`video_${id}`);

    const rewriteUrlAttr = (node, attr) => {
      const raw = node.getAttribute(attr);
      if (!raw) return;
      let next = raw;
      if (oldId && oldId !== id) {
        next = next
          .replaceAll(`/popup-video/${oldId}/`, `/popup-video/${id}/`)
          .replaceAll(`/video/${oldId}/`, `/video/${id}/`);
      }
      if (/\/popup-video\/\d+\//i.test(next) && !next.includes(`/popup-video/${id}/`)) {
        next = popupUrl;
      } else if (
        /(?:^|https?:\/\/[^/]+)\/video\/\d+\//i.test(next) &&
        !/\/popup-video\//i.test(next) &&
        !next.includes(`/video/${id}/`)
      ) {
        next = detailUrl;
      }
      if (next !== raw) node.setAttribute(attr, next);
    };
    qsa(el, 'a[href], [data-href]').forEach((node) => {
      ['href', 'data-href'].forEach((attr) => {
        rewriteUrlAttr(node, attr);
      });
    });
    qsa(el, 'a.js-click[data-fancybox="ajax"], [data-fancybox="ajax"]').forEach((node) => {
      const cur = node.getAttribute('data-href') || node.getAttribute('href') || '';
      if (!cur.includes(`/popup-video/${id}/`)) {
        node.setAttribute('data-href', popupUrl);
      }
    });

    const link =
      qs(el, 'a.th.js-open-popup, a.th') ||
      qs(el, 'a[href*="/video/"]');
    if (!link) return;
    // Property + attribute so contextmenu linkUrl and Open-in-new-tab agree.
    link.setAttribute('href', detailUrl);
    link.href = detailUrl;
    link.title = title;
    link.setAttribute('title', title);
    // Final sweep: any leftover donor href on this card (nested anchors, etc.).
    qsa(el, 'a[href]').forEach((node) => {
      const href = node.getAttribute('href') || '';
      if (!hrefVideoIdMismatch(href, id)) return;
      if (/\/popup-video\//i.test(href)) node.setAttribute('href', popupUrl);
      else node.setAttribute('href', detailUrl);
    });
    // Donor sample (fav #1) CDN previews cannot be rewritten by video id — drop them.
    if (!keepHoverPreview || indexedPreview) stripStaleCompactHoverMedia(el, id);
    replaceCompactCardImg(link, { thumbUrl, title });
    if (keepPreview) {
      // Keep preview only on dataset — data-preview attrs re-enable site hover.
      el.dataset.hxyrulePreview = keepPreview;
      disarmCompactSiteHoverAttrs(el, keepPreview);
    } else {
      delete el.dataset.hxyrulePreview;
      disarmCompactSiteHoverAttrs(el, '');
    }
    applyCompactCardDuration(link, video, { preferExisting: preferExistingMeta });
    let titleEl = qs(el, '.thumb_title') || qs(link, '.thumb_title');
    if (!titleEl) {
      titleEl = document.createElement('strong');
      titleEl.className = 'thumb_title title';
      link.appendChild(titleEl);
    }
    titleEl.textContent = title;
    delete titleEl.dataset.hxyruleOrigTitle;
    fillCompactThumbInfo(el, video, { preferExisting: preferExistingMeta });
  }

  function buildCompactCardEl(video, thumbUrl, sample, metrics) {
    const id = String(video.videoId);
    const title = String(video.title || id).trim() || id;
    const detailUrl = detailUrlForVideoId(id, video.detailUrl);
    const favPage = Number(video.favoritePage) || 0;
    const cardIndex = Number.isInteger(video.cardIndex) ? video.cardIndex : 0;
    const exact = findNativeCardEl(id);

    let el;
    if (exact) {
      el = exact.cloneNode(true);
      stripHxyruleCardChrome(el);
      // Fresh <img> avoids flash; keep this card's own hover preview URL.
      rewriteCompactCardIdentity(el, video, thumbUrl, {
        preferExistingMeta: true,
        keepHoverPreview: true,
      });
    } else if (sample) {
      el = sample.cloneNode(true);
      stripHxyruleCardChrome(el);
      rewriteCompactCardIdentity(el, video, thumbUrl, {
        preferExistingMeta: false,
        keepHoverPreview: false,
      });
    } else {
      el = document.createElement('div');
      el.className = 'item thumb';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'checkbox';
      checkbox.name = 'delete[]';
      checkbox.value = id;
      const link = document.createElement('a');
      link.className = 'th';
      link.setAttribute('href', detailUrl);
      link.href = detailUrl;
      link.title = title;
      replaceCompactCardImg(link, { thumbUrl, title });
      const preview = normalizeThumbUrl(video.previewUrl);
      if (preview) {
        el.dataset.hxyrulePreview = preview;
        disarmCompactSiteHoverAttrs(el, preview);
      }
      applyCompactCardDuration(link, video, { preferExisting: false });
      const titleEl = document.createElement('strong');
      titleEl.className = 'thumb_title title';
      titleEl.textContent = title;
      link.appendChild(titleEl);
      el.appendChild(checkbox);
      el.appendChild(link);
      fillCompactThumbInfo(el, video, { preferExisting: false });
    }

    el.classList.add('item', 'thumb');
    el.dataset.hxyruleCompact = '1';
    el.dataset.hxyruleFavoritePage = String(favPage);
    el.dataset.hxyruleCardIndex = String(cardIndex);
    delete el.dataset.hxyruleCheckBound;
    el.classList.remove('selected', `${NS}-compact-native-hidden`);
    applyCompactCardMetrics(el, metrics);
    return el;
  }

  /** Drop site hover attrs so KT delegated previews cannot fight our overlay. */
  function disarmCompactSiteHoverAttrs(root, previewUrl) {
    if (!root) return;
    if (previewUrl) root.dataset.hxyrulePreview = previewUrl;
    const attrs = [
      'data-preview',
      'data-trailer',
      'data-video',
      'data-mp4',
      'data-webm',
      'data-mid',
    ];
    const nodes = [root, ...qsa(root, 'a.th, a, img, video, source')];
    nodes.forEach((node) => {
      attrs.forEach((attr) => node.removeAttribute?.(attr));
    });
  }

  /**
   * Site hover-preview is bound via data-preview on the native list; compact
   * clones need our own overlay. Keep one <video>, pause/hide on leave — do
   * not remove it (DOM churn under the cursor retriggers leave/enter twitch).
   */
  function bindCompactHoverPreview(el) {
    if (!el || el.dataset.hxyrulePreviewBound === '1') return;
    const link = qs(el, 'a.th.js-open-popup, a.th') || qs(el, 'a[href*="/video/"]');
    if (!link) return;
    const preview =
      normalizeThumbUrl(el.dataset.hxyrulePreview) ||
      readCompactHoverPreviewUrl(el) ||
      '';
    if (!preview) return;
    el.dataset.hxyrulePreviewBound = '1';
    el.dataset.hxyrulePreview = preview;
    disarmCompactSiteHoverAttrs(el, preview);

    let videoEl = null;
    let stopTimer = null;
    let inside = false;

    const ensureVideo = () => {
      videoEl = qs(link, `video.${NS}-compact-preview`);
      if (videoEl) return videoEl;
      videoEl = document.createElement('video');
      videoEl.className = `${NS}-compact-preview`;
      videoEl.src = preview;
      videoEl.muted = true;
      videoEl.loop = true;
      videoEl.playsInline = true;
      videoEl.setAttribute('playsinline', '');
      videoEl.preload = 'metadata';
      // Inline pin in case site CSS races our stylesheet.
      videoEl.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;pointer-events:none;background:#000;';
      link.appendChild(videoEl);
      return videoEl;
    };

    const start = () => {
      if (document.documentElement.classList.contains(`${NS}-online-playing`)) return;
      inside = true;
      if (stopTimer) {
        clearTimeout(stopTimer);
        stopTimer = null;
      }
      const v = ensureVideo();
      v.hidden = false;
      v.style.visibility = 'visible';
      const play = v.play();
      if (play?.catch) play.catch(() => {});
    };

    const stop = ({ remove = false } = {}) => {
      inside = false;
      if (stopTimer) clearTimeout(stopTimer);
      const finish = () => {
        if (inside && !remove) return;
        const v = videoEl || qs(link, `video.${NS}-compact-preview`);
        if (!v) return;
        try {
          v.pause();
        } catch (_) {
          /* ignore */
        }
        try {
          v.currentTime = 0;
        } catch (_) {
          /* ignore */
        }
        if (remove) {
          v.remove();
          videoEl = null;
        } else {
          v.hidden = true;
        }
      };
      if (remove) finish();
      else stopTimer = setTimeout(finish, 80);
    };

    // Thumb link only — pick-rail enter/leave used to strand or thrash the preview.
    link.addEventListener('pointerenter', start);
    link.addEventListener('pointerleave', () => stop());
    link.addEventListener('click', () => stop({ remove: true }), true);
  }

  function decorateCompactCardEl(el) {
    const checkbox =
      qs(el, 'input.checkbox[name="delete[]"]') ||
      qs(el, 'input[name="delete[]"]') ||
      qs(el, 'input[type="checkbox"]');
    const link = qs(el, 'a.th.js-open-popup, a.th') || qs(el, 'a[href*="/video/"]');
    const videoId =
      checkbox?.value ||
      (link?.getAttribute('href') || '').match(/\/video\/(\d+)\//)?.[1];
    if (!videoId || !link) return null;
    const indexed = compactMatchedItems.find((v) => String(v?.videoId) === String(videoId));
    if (indexed) {
      const preview =
        normalizeThumbUrl(indexed.previewUrl) ||
        normalizeThumbUrl(el.dataset.hxyrulePreview) ||
        readCompactHoverPreviewUrl(el);
      if (preview) {
        el.dataset.hxyrulePreview = preview;
        disarmCompactSiteHoverAttrs(el, preview);
      }
    }
    const card = {
      el,
      videoId: String(videoId),
      detailUrl: detailUrlForVideoId(videoId, link.getAttribute('href') || link.href),
      title: String(
        qs(el, '.thumb_title')?.textContent || link.getAttribute('title') || videoId,
      ).trim(),
      favoritePage: Number(el.dataset.hxyruleFavoritePage) || currentPageNumber(),
      cardIndex: Number(el.dataset.hxyruleCardIndex) || 0,
      durationSec: cardDurationSec(el),
      checkbox,
      link,
    };
    // Keep Open-link / contextmenu href aligned with the card id (sample clones).
    const safeHref = card.detailUrl;
    if (safeHref && (link.getAttribute('href') || '') !== safeHref) {
      link.setAttribute('href', safeHref);
      link.href = safeHref;
    }
    ensurePickRail(card);
    if (indexed) {
      // After pick rail exists so meta lands in the visible rail, not under a.th.
      fillCompactThumbInfo(el, indexed, { preferExisting: true });
      applyCompactCardDuration(link, indexed, { preferExisting: true });
    }
    // Paint path from scan/lookup cache immediately (off-page cards often only
    // exist in lastScanMatches; refreshLookup refreshes after mount).
    if (scanned) {
      const cached = lastMatches[card.videoId] || lastScanMatches[card.videoId];
      if (hasLocalPathInfo(cached)) {
        renderStatus(card, { ...cached, exists: true }, true);
      } else if (cached) {
        renderStatus(card, cached, true);
      }
    }
    bindCompactHoverPreview(el);
    return card;
  }

  function ensureCompactHost(list) {
    let host = qs(document, `.${NS}-compact-thumbs`);
    if (host && host.isConnected) {
      host.classList.remove(`${NS}-native-thumbs-hidden`, `${NS}-compact-native-hidden`);
      return host;
    }
    host = document.createElement('div');
    // Copy layout classes from the native list, but never its hidden flag.
    host.className = list.className || 'thumbs';
    host.classList.remove(
      `${NS}-native-thumbs-hidden`,
      `${NS}-compact-native-hidden`,
    );
    host.classList.add('thumbs', `${NS}-compact-thumbs`, `${NS}-thumbs-clear`);
    host.dataset.hxyrule = '1';
    host.setAttribute('aria-label', 'Compact matches');
    // Occupy the native list's place under the toolbar — never append after it.
    list.insertAdjacentElement('beforebegin', host);
    return host;
  }

  function removeCompactDom() {
    qsa(document, `.${NS}-compact-pager`).forEach((el) => el.remove());
    qs(document, `.${NS}-compact-thumbs`)?.remove();
    qsa(document, `.item.thumb[data-hxyrule-compact="1"]`).forEach((el) => el.remove());
    qsa(document, `.${NS}-compact-native-hidden`).forEach((el) => {
      el.classList.remove(`${NS}-compact-native-hidden`);
    });
    qsa(document, '[data-hxyrule-compact-host="1"]').forEach((el) => {
      el.classList.remove(`${NS}-native-thumbs-hidden`);
      delete el.dataset.hxyruleCompactHost;
    });
    const list = favoritesListEl();
    if (list) {
      list.classList.remove(`${NS}-native-thumbs-hidden`);
      delete list.dataset.hxyruleCompactHost;
    }
  }

  /** Mount compact match pager into toolbar Pages (replaces native pager UI). */
  function ensureCompactPagerMounted() {
    if (!compactViewActive) return null;
    ensurePagesStep();
    const pagesHost = qs(document, `[data-role="pages-host"]`);
    if (!pagesHost?.isConnected) return null;

    // Drop leftover under-grid pagers from older mounts.
    qsa(document, `.${NS}-compact-pager`).forEach((el) => {
      if (el.parentElement !== pagesHost) el.remove();
    });

    parkNativePaginationForCompact(pagesHost);

    const pages = compactPageCount();
    const page = Math.min(Math.max(1, compactPage), pages);
    compactPage = page;

    // Reuse the live pager when page/pages are unchanged. pageWatch and
    // layoutTopControls call this often; replacing nodes under the cursor
    // clears :hover every tick and makes the page buttons flicker.
    const prev = qs(pagesHost, `.${NS}-compact-pager`);
    if (
      prev &&
      prev.isConnected &&
      prev.dataset.hxyruleCompactPage === String(page) &&
      prev.dataset.hxyruleCompactPages === String(pages)
    ) {
      prev.classList.remove('hxyrule-hide-native');
      prev.style.removeProperty('display');
      return prev;
    }

    const next = buildCompactPagerEl();
    next.classList.remove('hxyrule-hide-native');
    next.style.removeProperty('display');
    if (prev) prev.replaceWith(next);
    else pagesHost.appendChild(next);
    return next;
  }

  function buildCompactPagerEl() {
    const pages = compactPageCount();
    const page = Math.min(Math.max(1, compactPage), pages);
    compactPage = page;

    const wrap = document.createElement('div');
    wrap.className = `${NS}-compact-pager`;
    wrap.dataset.hxyrule = '1';
    wrap.dataset.hxyruleCompactPage = String(page);
    wrap.dataset.hxyruleCompactPages = String(pages);
    wrap.setAttribute('role', 'navigation');
    wrap.setAttribute('aria-label', 'Compact matches pages');

    const nav = document.createElement('div');
    nav.className = `${NS}-compact-pager-nav`;

    const addBtn = (label, targetPage, { disabled = false, current = false } = {}) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${NS}-btn ${NS}-compact-page-btn`;
      if (current) {
        btn.classList.add('is-current');
        btn.setAttribute('aria-current', 'page');
      }
      btn.textContent = label;
      btn.disabled = !!disabled;
      if (!disabled && !current) {
        btn.addEventListener('click', () => {
          goCompactPage(targetPage).catch((err) => {
            setError(`Compact page failed: ${err.message || String(err)}`);
          });
        });
      }
      nav.appendChild(btn);
    };

    const addGap = () => {
      const dots = document.createElement('span');
      dots.className = `${NS}-compact-pager-gap`;
      dots.textContent = '…';
      nav.appendChild(dots);
    };

    addBtn('Prev', page - 1, { disabled: page <= 1 });

    const nums = [];
    const push = (p) => {
      if (p >= 1 && p <= pages && !nums.includes(p)) nums.push(p);
    };
    push(1);
    for (let p = page - 2; p <= page + 2; p += 1) push(p);
    push(pages);
    nums.sort((a, b) => a - b);
    let prev = 0;
    nums.forEach((p) => {
      if (prev && p - prev > 1) addGap();
      addBtn(String(p), p, { current: p === page });
      prev = p;
    });

    addBtn('Next', page + 1, { disabled: page >= pages });

    wrap.appendChild(nav);
    return wrap;
  }

  function renderCompactPage() {
    const list = favoritesListEl();
    if (!list || !list.parentElement) {
      throw new Error('Could not find the video list container');
    }
    const liveThumbs = liveThumbUrlMap();
    // Capture size/template while native cards are still laid out.
    const tpl = captureCompactCardTemplate();
    const sample = tpl?.clone || sampleNativeCardEl();
    const metrics = tpl?.metrics || null;
    ignoreMutationsUntil = Date.now() + 1200;

    // Build the host before hiding the native list so we do not copy the
    // hidden class onto the compact grid (that made the whole view vanish).
    const host = ensureCompactHost(list);
    host.classList.remove(`${NS}-native-thumbs-hidden`, `${NS}-compact-native-hidden`);
    list.classList.add(`${NS}-native-thumbs-hidden`);
    list.dataset.hxyruleCompactHost = '1';
    // Prefer CSS hide once Compact host exists (clears any pending inline hide).
    list.style.removeProperty('display');
    document.documentElement.classList.add(`${NS}-compact-active`);
    host.replaceChildren();

    const per = compactPerPage();
    const pages = compactPageCount();
    compactPage = Math.min(Math.max(1, compactPage), pages);
    const slice = compactMatchedItems.slice(
      (compactPage - 1) * per,
      compactPage * per,
    );
    const frag = document.createDocumentFragment();
    slice.forEach((v) => {
      const id = String(v.videoId);
      const thumb = normalizeThumbUrl(v.thumbUrl) || liveThumbs.get(id) || '';
      frag.appendChild(buildCompactCardEl(v, thumb, sample, metrics));
    });
    host.appendChild(frag);

    // Mount full pick-rail cards immediately (title + meta + select).
    qsa(host, `.item.thumb[data-hxyrule-compact="1"]`).forEach((el) => {
      decorateCompactCardEl(el);
    });

    // Must be true before Pages mount — ensureCompactPagerMounted gates on it.
    compactViewActive = true;
    ensureCompactPagerMounted();
    // Compact cards are clones — bind MAIN-world fancybox onclick so any
    // leftover native click path can still open popups after refresh.
    // Retry: hard refresh often reaches Compact before site Fancybox exists.
    const rebindCompactPopups = (attempt = 0) => {
      send('PAGE_REBIND_POPUPS', {})
        .then((result) => {
          if (result?.ok) return;
          if (attempt >= 12) return;
          setTimeout(() => rebindCompactPopups(attempt + 1), 250);
        })
        .catch(() => {
          if (attempt >= 12) return;
          setTimeout(() => rebindCompactPopups(attempt + 1), 250);
        });
    };
    rebindCompactPopups();

    enrichUploadedTextForCompactSlice(slice).catch(() => {});

    try {
      bindListObserver();
    } catch (_) {
      /* ignore */
    }
    pageFinger = pageFingerprint();
  }

  async function goCompactPage(page) {
    if (!compactViewActive) return;
    const target = Number(page);
    if (!Number.isInteger(target) || target < 1) return;
    const pages = compactPageCount();
    if (target > pages || target === compactPage) return;
    await captureNativeSelection().catch(() => {});
    compactPage = target;
    renderCompactPage();
    wireCardClicks();
    await refreshLookup();
    await restoreSelectionToPage(parseCards());
    applyFilterToCurrentPage();
    updateFilterBarLabels();
    updateToolbarLabels();
  }

  function exitCompactView({ restorePages = true } = {}) {
    const hadDom =
      compactViewActive ||
      !!qs(document, `.${NS}-compact-thumbs`) ||
      !!qs(document, `.${NS}-compact-pager`) ||
      !!qs(document, `.item.thumb[data-hxyrule-compact="1"]`);
    if (!hadDom) {
      compactMatchedItems = [];
      compactPage = 1;
      compactCardTemplate = null;
      // Boot may have hidden the native list before Compact cards exist.
      // Keep that hide across enterCompactView → exitCompactView → render.
      const keepPendingHide =
        viewRestorePending ||
        (filterRunning &&
          (normalizeViewMode(viewMode) === 'compact' ||
            normalizeViewMode(viewMode) === 'selected'));
      if (keepPendingHide) {
        hideNativeListForPendingCompact();
      } else {
        document.documentElement.classList.remove(`${NS}-compact-active`);
        clearPendingNativeListHide();
        if (restorePages) {
          try {
            revealNativePaginationInPages(qs(document, `[data-role="pages-host"]`));
          } catch (_) {
            /* ignore */
          }
        }
        kickNativeThumbLazyloadAfterReveal();
      }
      syncCompactSortControls();
      return;
    }
    ignoreMutationsUntil = Date.now() + 600;
    compactViewActive = false;
    compactMatchedItems = [];
    compactPage = 1;
    compactCardTemplate = null;
    document.documentElement.classList.remove(`${NS}-compact-active`);
    removeCompactDom();
    clearPendingNativeListHide();
    // Put native Pages pager back immediately (do not wait for pageWatch).
    // Skip when re-entering Compact — renderCompactPage parks it again.
    if (restorePages) {
      try {
        revealNativePaginationInPages(qs(document, `[data-role="pages-host"]`));
        layoutTopControls();
      } catch (_) {
        /* ignore */
      }
    }
    try {
      bindListObserver();
    } catch (_) {
      /* ignore */
    }
    pageFinger = pageFingerprint();
    syncCompactSortControls();
    // Native grid was hidden during Compact; refill may have left grey.gif.
    kickNativeThumbLazyloadAfterReveal();
  }
  function enrichMatchMetaFromLiveDom(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return list;
    const byId = new Map();
    qsa(document, '.item.thumb').forEach((el) => {
      if (el.dataset?.hxyruleCompact === '1') return;
      if (el.closest(`.${NS}-compact-thumbs`)) return;
      const checkbox =
        qs(el, 'input.checkbox[name="delete[]"]') ||
        qs(el, 'input[name="delete[]"]') ||
        qs(el, 'input[type="checkbox"]');
      const link = qs(el, 'a.th.js-open-popup, a.th, a[href*="/video/"]');
      const id =
        checkbox?.value ||
        (link?.getAttribute('href') || '').match(/\/video\/(\d+)\//)?.[1];
      if (!id) return;
      const meta = cardMetaFromEl(el);
      const previewUrl = cardPreviewUrl(el);
      const durationSec = cardDurationSec(el);
      if (meta.viewsText || meta.ratingText || meta.addedText || previewUrl || durationSec != null) {
        byId.set(String(id), { ...meta, previewUrl, durationSec });
      }
    });
    if (!byId.size) return list;
    return list.map((v) => {
      const id = String(v?.videoId || '');
      const live = byId.get(id);
      if (!live) return v;
      return {
        ...v,
        viewsText: normalizeMetaText(v.viewsText) || live.viewsText,
        ratingText: normalizeMetaText(v.ratingText) || live.ratingText,
        // Keep indexed uploadedText; live `.added` is list-import time.
        addedText: normalizeMetaText(v.addedText),
        uploadedText: uploadedTextForItem(v),
        previewUrl: normalizeThumbUrl(v.previewUrl) || live.previewUrl || '',
        // Prefer live card clock when present — index crawl can be stale/missing.
        durationSec:
          coerceDurationSec(live.durationSec) ?? coerceDurationSec(v.durationSec),
      };
    });
  }

  /**
   * Write live/DOM durations into the list index when rows still lack durationSec.
   * Duration Match used to drop unknown lengths, so heart-added rows with null
   * clocks never matched until a full Rebuild.
   */
  async function persistDurationBackfills(items) {
    const scope = indexScopeKey();
    const indexed = favIndexCache?.videos;
    if (!Array.isArray(indexed) || !indexed.length) return 0;
    const fill = new Map();
    (Array.isArray(items) ? items : []).forEach((v) => {
      const id = String(v?.videoId || '').trim();
      const d = coerceDurationSec(v?.durationSec);
      if (!id || d == null || d <= 0) return;
      fill.set(id, d);
    });
    if (!fill.size) return 0;
    let changed = 0;
    const videos = indexed.map((v) => {
      const id = String(v?.videoId || '').trim();
      const next = fill.get(id);
      if (next == null) return v;
      const prev = coerceDurationSec(v?.durationSec);
      if (prev != null && prev > 0) return v;
      changed += 1;
      return { ...v, durationSec: next };
    });
    if (!changed) return 0;
    try {
      await persistIndex(scope, videos);
    } catch (_) {
      return 0;
    }
    return changed;
  }

  async function enterCompactView(matched) {
    let list = favoritesListEl();
    if (!list || !list.parentElement) {
      // Playlist shells sometimes mount .thumbs a tick after boot restore.
      layoutTopControls();
      list = favoritesListEl();
    }
    if (!list || !list.parentElement) {
      // One short retry — boot restore used to fail here and fall through to
      // Show matches (active match set without Compact DOM).
      await new Promise((r) => setTimeout(r, 50));
      layoutTopControls();
      list = favoritesListEl();
    }
    if (!list || !list.parentElement) {
      throw new Error('Could not find the video list container');
    }
    // Lock page size from the native list / title total BEFORE we swap DOM.
    // Refresh on a short last page used to poison Compact into 6-per-page.
    cardsPerPageEstimate();
    ignoreMutationsUntil = Date.now() + 1200;
    exitCompactView({ restorePages: false });
    let items = enrichMatchMetaFromLiveDom(matched || []);
    if (parseCompactSortKey(compactSortKey).field === 'seq') {
      items = await ensureCompactItemOrdinals(items);
    }
    compactMatchedItems = sortCompactItems(items);
    compactPage = 1;
    renderCompactPage();
    syncCompactSortControls();
  }

  async function applyCompactMatchesView({
    ensureIndex = true,
    quiet = false,
    /** When true, always rebuild even if Compact is already showing (Match rule edits). */
    force = false,
  } = {}) {
    // Wait out an in-flight View apply instead of no-op — boot restore used to
    // race pageWatch / nested restore and silently skip Compact.
    if (filterRunning) {
      for (let i = 0; i < 600 && filterRunning; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!force && compactViewActive && normalizeViewMode(viewMode) === 'compact') return;
      if (filterRunning) return;
    }
    filterRunning = true;
    viewMode = 'compact';
    setError('');
    updateFilterBarLabels();
    // Keep Matches label stable (Loading… via updateFilterBarLabels). Scan /
    // index refresh progress goes to status + Index / Tag sex — not this button.
    try {
      // Default Match (all chips on, no Duration/Name) still lists the full index — like All matches.
      const { matched, emptyRules } = await collectMatchItems({
        ensureIndex,
        allowUnfiltered: true,
      });
      if (emptyRules) {
        exitCompactView();
        filterState.active = false;
        filterState.matchedIds = null;
        filterState.matchCount = null;
        viewDeps = null;
        applyFilterToCurrentPage();
        updateFilterBarLabels();
        return;
      }
      // Mount Compact first — only then stamp an active match set. Setting
      // filterState.active before enterCompactView left Show-matches UI when
      // mount failed on boot (active + !compactViewActive → uiViewMode matches).
      await enterCompactView(matched);
      filterState.matchedIds = new Set(matched.map((v) => String(v.videoId)));
      filterState.matchCount = matched.length;
      filterState.active = true;
      stampViewDeps();
      viewMode = 'compact';
      wireCardClicks();
      // Boot paints before HELPER_SCAN — skip lookup until disk marks exist.
      if (!(bootInProgress && !scanned)) {
        await refreshLookup();
      }
      await restoreSelectionToPage(parseCards());
      applyFilterToCurrentPage();
      updateFilterBarLabels();
      updateToolbarLabels();
      await saveFilterState();
      const pages = compactPageCount();
      if (!quiet) {
        if (!matched.length) setFlash('Filter matched 0 videos');
        else {
          setFlash(
            pages > 1
              ? `Compact view · ${formatFavCount(matched.length)} matches · ${pages} pages`
              : `Compact view · ${formatFavCount(matched.length)} matches`,
          );
        }
      }
    } catch (err) {
      // Never leave a half-applied Show-matches highlight after a Compact failure.
      if (!compactViewActive) {
        filterState.active = false;
        filterState.matchedIds = null;
        filterState.matchCount = null;
        viewDeps = null;
        viewMode = 'compact';
      }
      setError(`Matches view failed: ${err.message || String(err)}`);
      throw err;
    } finally {
      filterRunning = false;
      updateFilterBarLabels();
    }
  }

  /** Resolve current Match rules to a video list (does not change View / selection). */
  async function collectMatchItems({
    ensureIndex = true,
    /** When true, both dual-toggles on + no Duration/Name still selects the full list index. */
    allowUnfiltered = false,
  } = {}) {
    // Lazy freshness: only refresh disk/index when this Match needs them and they are missing/dirty/drifted.
    // Never rewrite Compact / Show matches for scan/refresh — status + Index/Scan own that.
    if (!diskFilterIsAll() && (!scanned || !localIdSet.size || diskIndexDirty)) {
      setLiveStatus('Scanning…');
    }
    await ensureFreshDiskForMatch();

    await loadFavIndexCache();
    if (!collectionFilterIsAll()) {
      if (isPlaylistDetailPage()) {
        try {
          await ensureFreshFavoritesIndexForMatch();
        } catch (err) {
          throw new Error(
            'Favorited/Unfavorited needs a Favorites index — ' +
              (err?.message || String(err)),
          );
        }
        if (!(myFavIdSet && myFavIdSet.size)) {
          throw new Error(
            'Favorited/Unfavorited needs a Favorites index — Build on My Favorites, or retry List (match) / Matches.',
          );
        }
      } else {
        await ensurePlaylistMembershipSet({ force: !bootInProgress });
        let playlists = [];
        try {
          // Prefer the already-warming Libraries prefetch on boot.
          if (bootInProgress && libraryCountPrefetchP) {
            const cached = await libraryCountPrefetchP.catch(() => null);
            if (Array.isArray(cached)) playlists = cached;
          }
          if (!playlists.length) {
            const listed = await send('SITE_PLAYLIST_LIST');
            playlists = (listed?.playlists || []).filter((p) => {
              const id = String(p?.id || '').trim();
              return /^[1-9]\d*$/.test(id);
            });
          } else {
            playlists = playlists.filter((p) => {
              const id = String(p?.id || '').trim();
              return /^[1-9]\d*$/.test(id);
            });
          }
        } catch (err) {
          throw new Error(
            'In playlist / Not in playlist needs your playlist list — ' +
              (err?.message || String(err)),
          );
        }
        if (!playlists.length) {
          if (bootInProgress) {
            // Soft: paint Compact without membership gate; user can re-click Match later.
            playlists = [];
          } else {
            throw new Error(
              'In playlist / Not in playlist: no site playlists found. Open /my/playlists/ and retry.',
            );
          }
        }
        if (playlists.length) {
          const have = new Set(playlistMembershipScopes || []);
          const missing = playlists.filter((p) => !have.has(`playlist:${String(p.id)}`));
          if (missing.length && !bootInProgress) {
            const labels = missing.map((p) => {
              try {
                return formatPlaylistOptionLabel(p);
              } catch (_) {
                return 'Playlist';
              }
            });
            const shown = labels.slice(0, 8).join('; ');
            const more = labels.length > 8 ? ` (+${labels.length - 8} more)` : '';
            throw new Error(
              `In playlist / Not in playlist needs every playlist indexed (${have.size}/${playlists.length}). ` +
                `Still missing: ${shown}${more}. Open each and Build index.`,
            );
          }
          // Content may be dirty after Edit when a patch could not run — refuse rather than silent stale.
          if (playlistIndexesDirty && !bootInProgress) {
            throw new Error(
              'Playlist indexes changed and need Rebuild. Open each edited playlist and Rebuild index, then retry.',
            );
          }
        }
      }
    }
    const needsDur = readDurationFilterInputs();
    const titleQuery = readTitleQueryFilter();
    const wantsDur = needsDur.minSec != null || needsDur.maxSec != null;
    const wantsTitle = !!titleQuery;
    const wantsDisk = !diskFilterIsAll();
    const wantsColl = !collectionFilterIsAll();
    const wantsSex = !sexFilterIsAll();
    if (!wantsDur && !wantsTitle && !wantsDisk && !wantsColl && !wantsSex && !allowUnfiltered) {
      return { matched: [], emptyRules: true };
    }
    if (ensureIndex) {
      const liveTotal = liveLibraryTotalForDrift();
      const indexed = favIndexCache?.videos?.length || 0;
      if (!bootInProgress) {
        if (listIndexDirty || !indexed) {
          setLiveStatus(listIndexDirty ? 'Refreshing index…' : 'Indexing…');
        } else if (indexCountDrifted(liveTotal, indexed)) {
          setLiveStatus('Refreshing index…');
        }
      }
      await ensureFreshListIndexForMatch();
    }
    // Futa/Straight-only Match needs sexGroup. Full Tag when no baseline;
    // sex-delta when some rows are still untagged after auto sync.
    // Boot must not wait on Tag sex — paint with whatever labels exist; incomplete
    // rows simply fail Futa/Straight until a later Retag / Match click.
    if (wantsSex && !bootInProgress) {
      const tagged = countSexTagged(favIndexCache?.videos);
      const untagged = countSexUntagged(favIndexCache?.videos);
      const corrupt = sexLabelsLookCorrupt(favIndexCache?.videos);
      if (tagged === 0 || untagged > 0 || corrupt) {
        await ensureSexGroupsInListIndex();
      }
    }
    let videos = favIndexCache?.videos || [];
    if (!videos.length) {
      throw new Error(
        'No list index — click Build index first. ' +
          'Scan marks Local vs Not local; Index lists every video so filters can select across pages.',
      );
    }
    if (wantsSex && !bootInProgress) {
      const tagged = countSexTagged(videos);
      const untagged = countSexUntagged(videos);
      if (!tagged) {
        throw new Error(
          'Futa/Straight Match needs sex tags on the list index. ' +
            'Click Tag sex (or Rebuild index), wait for it to finish, then retry.',
        );
      }
      if (untagged > 0) {
        throw new Error(
          `Futa/Straight tags incomplete (${formatFavCount(untagged)} untagged). ` +
            'Click Retag sex to rebuild sex labels, then retry.',
        );
      }
    }
    // Name may match seq prefixes — attach Helper/title ordinals before filtering.
    if (wantsTitle) {
      videos = await ensureCompactItemOrdinals(videos);
    }
    // Duration Match excludes null clocks. Fill from the visible list before
    // filtering, then persist so later pages / next Match keep the values.
    if (wantsDur) {
      videos = enrichMatchMetaFromLiveDom(videos);
      await persistDurationBackfills(videos);
      const pageCap = Math.max(cardsPerPageEstimate(), nativeListCardCount(), 1);
      const newestMissing = videos
        .slice(0, pageCap)
        .filter((v) => coerceDurationSec(v.durationSec) == null).length;
      // Newest page still unknown after live fill → crawl page 1 for .time.
      if (newestMissing > 0 && !bootInProgress && ensureIndex) {
        try {
          setLiveStatus('Filling durations…');
          await buildFavIndex({
            force: true,
            mode: 'incremental',
            fromPage: 1,
            toPage: 1,
          });
          await loadFavIndexCache();
          videos = enrichMatchMetaFromLiveDom(favIndexCache?.videos || []);
          await persistDurationBackfills(videos);
        } catch (_) {
          /* keep whatever clocks we already have */
        }
      }
    }
    const bounds = { ...readDurationFilterInputs(), titleQuery: readTitleQueryFilter() };
    const matched = [];
    videos.forEach((v) => {
      if (videoMatchesFilters(v, bounds)) matched.push(v);
    });
    return { matched, emptyRules: false };
  }

  async function applyLibraryFilter({
    ensureIndex = true,
    quiet = false,
    /** When true, always rebuild even if Show matches is already active (Match rule edits). */
    force = false,
  } = {}) {
    if (filterRunning) {
      for (let i = 0; i < 600 && filterRunning; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (
        !force &&
        filterState.active &&
        normalizeViewMode(viewMode) === 'matches' &&
        !compactViewActive
      ) {
        return;
      }
      if (filterRunning) return;
    }
    filterRunning = true;
    viewMode = 'matches';
    setError('');
    exitCompactView();
    updateFilterBarLabels();
    try {
      layoutTopControls();
      revealNativePaginationInPages(qs(document, `[data-role="pages-host"]`));
    } catch (_) {
      /* ignore */
    }
    // Filtering… / Loading… come from updateFilterBarLabels while filterRunning —
    // do not overwrite with Scanning / Refreshing index on List (match) / Matches.
    try {
      const { matched, emptyRules } = await collectMatchItems({
        ensureIndex,
      });
      if (emptyRules) {
        filterState.active = false;
        filterState.matchedIds = null;
        filterState.matchCount = null;
        viewDeps = null;
        applyFilterToCurrentPage();
        updateFilterBarLabels();
        return;
      }
      filterState.matchedIds = new Set(matched.map((v) => String(v.videoId)));
      filterState.matchCount = matched.length;
      filterState.active = true;
      stampViewDeps();
      viewMode = 'matches';
      applyFilterToCurrentPage();
      updateFilterBarLabels();
      await saveFilterState();
      if (!matched.length && !quiet) setFlash('Filter matched 0 videos');
    } catch (err) {
      setError(`Filter failed: ${err.message || String(err)}`);
      throw err;
    } finally {
      filterRunning = false;
      updateFilterBarLabels();
    }
  }

  /**
   * Build Compact-ready rows from the persisted selection bag.
   * Prefer list-index meta (thumbs / duration / sex); fall back to bag fields
   * from This page / Page range.
   */
  async function collectSelectedViewItems() {
    const sel = await send('SELECTION_GET');
    const itemsMap = sel?.items && typeof sel.items === 'object' ? sel.items : {};
    const ids = Object.keys(itemsMap);
    if (!ids.length) return [];
    await loadFavIndexCache();
    const byId = new Map(
      (favIndexCache?.videos || []).map((v) => [String(v.videoId), v]),
    );
    return ids.map((id) => {
      const key = String(id);
      const bag = itemsMap[key] || {};
      const hit = byId.get(key);
      if (hit) {
        return {
          ...hit,
          title: hit.title || bag.title || key,
          detailUrl:
            hit.detailUrl ||
            bag.detailUrl ||
            `https://rule34video.com/video/${key}/v/`,
          favoritePage:
            Number(hit.favoritePage) || Number(bag.favoritePage) || 0,
          cardIndex: Number.isInteger(hit.cardIndex)
            ? hit.cardIndex
            : Number.isInteger(bag.cardIndex)
              ? bag.cardIndex
              : 0,
          durationSec:
            coerceDurationSec(hit.durationSec) ??
            coerceDurationSec(bag.durationSec),
          thumbUrl:
            normalizeThumbUrl(hit.thumbUrl) ||
            normalizeThumbUrl(bag.thumbUrl) ||
            '',
          previewUrl:
            normalizeThumbUrl(hit.previewUrl) ||
            normalizeThumbUrl(bag.previewUrl) ||
            '',
        };
      }
      return {
        videoId: key,
        title: bag.title || key,
        detailUrl: bag.detailUrl || `https://rule34video.com/video/${key}/v/`,
        favoritePage: Number(bag.favoritePage) || 0,
        cardIndex: Number.isInteger(bag.cardIndex) ? bag.cardIndex : 0,
        durationSec: coerceDurationSec(bag.durationSec),
        thumbUrl: normalizeThumbUrl(bag.thumbUrl),
        previewUrl: normalizeThumbUrl(bag.previewUrl),
        viewsText: normalizeMetaText(bag.viewsText),
        ratingText: normalizeMetaText(bag.ratingText),
        addedText: normalizeMetaText(bag.addedText),
        uploadedText: normalizeMetaText(bag.uploadedText),
        sexGroup: String(bag.sexGroup || '').trim(),
      };
    });
  }

  /** Compact View of the current selection (does not change the selection bag). */
  async function applySelectedCompactView({ quiet = false } = {}) {
    if (filterRunning) {
      for (let i = 0; i < 600 && filterRunning; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (filterRunning) return;
    }
    filterRunning = true;
    viewMode = 'selected';
    setError('');
    updateFilterBarLabels();
    updateToolbarLabels();
    try {
      const matched = await collectSelectedViewItems();
      if (!matched.length) {
        setError(
          'No videos selected. Click the info panel under a thumb, or use This page / Page range / All matches.',
        );
        return;
      }
      await enterCompactView(matched);
      filterState.matchedIds = new Set(matched.map((v) => String(v.videoId)));
      filterState.matchCount = matched.length;
      filterState.active = true;
      // Selection View does not depend on Match chips / disk filters.
      viewDeps = { disk: false, list: false, fav: false, playlist: false };
      viewMode = 'selected';
      wireCardClicks();
      if (!(bootInProgress && !scanned)) {
        await refreshLookup();
      }
      await restoreSelectionToPage(parseCards());
      applyFilterToCurrentPage();
      updateFilterBarLabels();
      updateToolbarLabels();
      await saveFilterState();
      const pages = compactPageCount();
      if (!quiet) {
        setFlash(
          pages > 1
            ? `Selected · ${formatFavCount(matched.length)} · ${pages} pages`
            : `Selected · ${formatFavCount(matched.length)}`,
        );
      }
    } catch (err) {
      if (!compactViewActive) {
        filterState.active = false;
        filterState.matchedIds = null;
        filterState.matchCount = null;
        viewDeps = null;
        viewMode = 'compact';
      }
      setError(`Selected view failed: ${err.message || String(err)}`);
    } finally {
      filterRunning = false;
      updateFilterBarLabels();
      updateToolbarLabels();
    }
  }

  /** Select every video matching the frozen View, or current Match rules if View is off. */
  async function selectAllMatches() {
    setError('');
    try {
      let matched = [];
      // Stale stores that this View depended on → drop View and re-collect.
      if (frozenViewStoresDirty()) {
        invalidateFrozenView();
        updateFilterBarLabels();
      }
      if (filterState.active && filterState.matchedIds) {
        // Keep Select aligned with the active View (chip edits refresh View in place).
        await loadFavIndexCache();
        const byId = new Map(
          (favIndexCache?.videos || []).map((v) => [String(v.videoId), v]),
        );
        matched = [...filterState.matchedIds].map((id) => {
          const hit = byId.get(String(id));
          if (hit) return hit;
          return {
            videoId: String(id),
            title: String(id),
            detailUrl: `https://rule34video.com/video/${id}/v/`,
          };
        });
      } else {
        // Default Match (both dual-toggles on, no Duration/Name) = entire list index.
        const result = await collectMatchItems({
          ensureIndex: true,
          allowUnfiltered: true,
        });
        matched = result.matched;
      }
      if (!matched.length) {
        setError(
          filterState.active
            ? 'View has 0 matches — adjust Match rules and try List (match) / Matches'
            : 'No videos match current rules',
        );
        return;
      }
      const items = {};
      matched.forEach((v) => {
        items[String(v.videoId)] = {
          videoId: String(v.videoId),
          title: v.title,
          detailUrl: v.detailUrl,
          favoritePage: v.favoritePage,
          cardIndex: v.cardIndex,
        };
      });
      await send('SELECTION_SET', { selection: selectionRecord(items) });
      await refreshSelectionCount(items);
      ignoreMutationsUntil = Date.now() + 400;
      parseCards().forEach((card) => {
        setCardChecked(card, !!items[String(card.videoId)]);
      });
      setFlash(`Selected ${formatFavCount(matched.length)} matches`);
    } catch (err) {
      setError(`Select matches failed: ${err.message || String(err)}`);
    }
  }

  /** Release filtered view without resetting Match rules. */
  async function showAllView() {
    exitCompactView();
    filterState.active = false;
    filterState.matchedIds = null;
    filterState.matchCount = null;
    viewDeps = null;
    viewMode = 'all';
    document.documentElement.classList.remove(`${NS}-compact-active`);
    applyFilterToCurrentPage();
    updateFilterBarLabels();
    // Native list pager must sit in toolbar Pages (not under the card grid).
    try {
      layoutTopControls();
      const host = qs(document, `[data-role="pages-host"]`);
      const pag = revealNativePaginationInPages(host);
      // If mount failed, unhide any list pager so Show-all is never pager-less.
      if (!pag || !pagerHasPageControls(pag)) {
        findNativeListPaginationNodes().forEach((el) => {
          el.classList.remove('hxyrule-hide-native');
          if (el.style.getPropertyValue('display') === 'none') el.style.removeProperty('display');
          if (host && el.parentElement !== host && pagerHasPageControls(el)) {
            el.classList.add(`${NS}-pagination-slot`);
            host.appendChild(el);
            el.style.setProperty('display', 'flex', 'important');
            compactNativePagination(el);
            suppressStrayNativePagination(host, el);
          }
        });
      }
    } catch (_) {
      /* ignore */
    }
    // Compact boot only decorated compact cards — native Show-all titles need a pass.
    try {
      await refreshLookup();
      await restoreSelectionToPage(parseCards());
    } catch (_) {
      scheduleOrdinalRepaint();
    }
    // Matches→List after unfavorite: hidden-grid reload left unloaded thumbs.
    kickNativeThumbLazyloadAfterReveal();
    await saveFilterState();
    setError('');
  }

  /** Reset Match chips/duration/name only; keep current View and refresh it. */
  async function resetMatchRules({ persist = true, reapplyView = true } = {}) {
    // Capture live View before touching rules (do not force Show all).
    const keepMode = uiViewMode();
    filterState.localOn = true;
    filterState.cloudOn = true;
    filterState.favoriteOn = true;
    filterState.playlistOn = true;
    filterState.futaOn = true;
    filterState.straightOn = true;
    filterState.durMinMin = '';
    filterState.durMaxMin = '';
    filterState.titleQuery = '';
    const bar = qs(document, `.${NS}-controls`) || qs(document, `.${NS}-filterbar`);
    const minIn = bar && qs(bar, '[data-role="dur-min"]');
    const maxIn = bar && qs(bar, '[data-role="dur-max"]');
    const titleIn = bar && qs(bar, '[data-role="title-query"]');
    if (minIn) minIn.value = '';
    if (maxIn) maxIn.value = '';
    if (titleIn) titleIn.value = '';
    setError('');
    if (matchViewReapplyTimer) {
      clearTimeout(matchViewReapplyTimer);
      matchViewReapplyTimer = null;
    }
    matchViewReapplyGen += 1;
    if (!reapplyView) {
      updateFilterBarLabels();
      if (persist) await saveFilterState();
      return;
    }
    if (keepMode === 'selected') {
      viewMode = 'selected';
      updateFilterBarLabels();
      if (persist) await saveFilterState();
      return;
    }
    if (keepMode === 'compact' || keepMode === 'matches') {
      viewMode = keepMode;
      updateFilterBarLabels();
      try {
        await reapplyCurrentMatchView({ quiet: true });
      } catch (_) {
        /* index may be unavailable */
      }
      if (persist) await saveFilterState();
      return;
    }
    // Show all: clear any leftover frozen match set; leave View on Show all.
    exitCompactView();
    filterState.active = false;
    filterState.matchedIds = null;
    filterState.matchCount = null;
    viewDeps = null;
    viewMode = 'all';
    applyFilterToCurrentPage();
    updateFilterBarLabels();
    if (persist) await saveFilterState();
  }

  /** Reset Match + View + Select (and clear selection); keep command rail as-is. */
  async function resetToolbars() {
    await resetMatchRules({ persist: false, reapplyView: false });
    compactSortKey = defaultCompactSortKey();
    toolbarMiddleCollapsed = false;
    viewMode = 'compact';
    const bar = qs(document, `.${NS}-controls`);
    selectStartSaved = '';
    selectEndSaved = '';
    selectSeqStartSaved = '';
    selectSeqEndSaved = '';
    const startIn = bar && qs(bar, '[data-role="select-start"]');
    const endIn = bar && qs(bar, '[data-role="select-end"]');
    if (startIn) startIn.value = '';
    if (endIn) endIn.value = '';
    const seqStartIn = bar && qs(bar, '[data-role="select-seq-start"]');
    const seqEndIn = bar && qs(bar, '[data-role="select-seq-end"]');
    if (seqStartIn) seqStartIn.value = '';
    if (seqEndIn) seqEndIn.value = '';
    syncPageRangePlaceholders();
    selCollectCancel = true;
    selProgress = null;
    await send('SELECTION_CLEAR');
    ignoreMutationsUntil = Date.now() + 800;
    clearAllNativeSelectionOnPage();
    selCountCached = 0;
    syncToolbarMiddleCollapsed(bar);
    syncCompactSortControls();
    updateToolbarLabels();
    await refreshSelectionCount({});
    try {
      await applyCompactMatchesView({ ensureIndex: true, quiet: true });
    } catch (_) {
      /* index may be unavailable */
    }
    await saveFilterState();
    setFlash('Match / View / Select reset');
  }

  async function selectPageRangeFromInputs() {
    const bar = qs(document, `.${NS}-controls`) || document;
    const startIn = qs(bar, '[data-role="select-start"]');
    const endIn = qs(bar, '[data-role="select-end"]');
    syncPageRangePlaceholders();
    const startRaw = String(startIn?.value || '').trim();
    const endRaw = String(endIn?.value || '').trim();
    // Empty side uses gray placeholder suggestion (a+10 / b-10).
    const startN = startRaw !== '' ? Number(startRaw) : Number(startIn?.placeholder);
    const endN = endRaw !== '' ? Number(endRaw) : Number(endIn?.placeholder);
    const maxPage = selectRangeMaxPage();
    if (!Number.isFinite(startN) || !Number.isFinite(endN)) {
      setError('Enter a valid page range (from–to)');
      return;
    }
    let start = clampPageNum(startN, maxPage);
    let end = clampPageNum(endN, maxPage);
    if (start == null || end == null) {
      setError('Enter a valid page range (from–to)');
      return;
    }
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    setError('');
    await collectPages(start, end);
  }

  /**
   * Select videos whose title seq (N——…) / Helper ordinal is in [from, to].
   * One side empty → that end equals the other (single-seq select).
   */
  async function selectSeqRangeFromInputs() {
    const bar = qs(document, `.${NS}-controls`) || document;
    const startIn = qs(bar, '[data-role="select-seq-start"]');
    const endIn = qs(bar, '[data-role="select-seq-end"]');
    const startRaw = String(startIn?.value || '').trim();
    const endRaw = String(endIn?.value || '').trim();
    if (startRaw === '' && endRaw === '') {
      setError('Enter a seq range (from–to); one side alone selects that seq');
      return;
    }
    const startN = startRaw !== '' ? Number(startRaw) : Number(endRaw);
    const endN = endRaw !== '' ? Number(endRaw) : Number(startRaw);
    if (!Number.isFinite(startN) || !Number.isFinite(endN)) {
      setError('Enter a valid seq range (from–to)');
      return;
    }
    const maxSeq = selectRangeMaxSeq();
    let start = clampSeqNum(startN, maxSeq);
    let end = clampSeqNum(endN, maxSeq);
    if (start == null || end == null) {
      setError('Enter a valid seq range (from–to)');
      return;
    }
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    // Mirror filled side / clamped values so the UI matches the action.
    if (startIn) startIn.value = String(start);
    if (endIn) endIn.value = String(end);
    selectSeqStartSaved = String(start);
    selectSeqEndSaved = String(end);
    saveFilterState().catch(() => {});

    setError('');
    try {
      // Prefer library index + ordinals; fill holes via Helper by-seq.
      await loadFavIndexCache();
      let videos = Array.isArray(favIndexCache?.videos) ? [...favIndexCache.videos] : [];
      if (!videos.length) {
        try {
          const result = await collectMatchItems({
            ensureIndex: true,
            allowUnfiltered: true,
          });
          videos = Array.isArray(result?.matched) ? [...result.matched] : [];
        } catch (err) {
          throw new Error(
            err?.message ||
              'Seq range needs an index — Build / Compact first, or run Renumber',
          );
        }
      }
      await ensureCompactItemOrdinals(videos);
      const bySeq = new Map();
      videos.forEach((v) => {
        const seq = seqOrderKey(v);
        if (seq == null || seq < start || seq > end) return;
        bySeq.set(seq, v);
      });
      // Fill missing seqs from Helper when the span is modest (titles may lack N——).
      const span = end - start + 1;
      if (bySeq.size < span && span <= 300) {
        for (let seq = start; seq <= end; seq += 1) {
          if (bySeq.has(seq)) continue;
          try {
            const info = await send('HELPER_ORDINALS_BY_SEQ', { seq });
            if (!info?.found || !info.videoId) continue;
            const videoId = String(info.videoId);
            const hit = videos.find((v) => String(v.videoId) === videoId);
            bySeq.set(
              seq,
              hit || {
                videoId,
                title: titledWithOrdinal(seq, videoId),
                detailUrl: `https://rule34video.com/video/${videoId}/v/`,
              },
            );
          } catch (_) {
            /* Helper optional */
          }
        }
      }
      if (!bySeq.size) {
        setError(
          start === end
            ? `Seq ${start} not found — run Renumber or Build index first`
            : `No videos with seq ${start}–${end} — run Renumber or Build index first`,
        );
        return;
      }
      const items = {};
      [...bySeq.entries()]
        .sort((a, b) => a[0] - b[0])
        .forEach(([, v]) => {
          const id = String(v.videoId);
          items[id] = {
            videoId: id,
            title: v.title,
            detailUrl: v.detailUrl || `https://rule34video.com/video/${id}/v/`,
            favoritePage: v.favoritePage,
            cardIndex: v.cardIndex,
          };
        });
      await send('SELECTION_SET', { selection: selectionRecord(items) });
      await refreshSelectionCount(items);
      ignoreMutationsUntil = Date.now() + 400;
      parseCards().forEach((card) => {
        setCardChecked(card, !!items[String(card.videoId)]);
      });
      const n = Object.keys(items).length;
      const label = start === end ? `seq ${start}` : `seq ${start}–${end}`;
      setFlash(
        n === end - start + 1
          ? `Selected ${formatFavCount(n)} · ${label}`
          : `Selected ${formatFavCount(n)} of ${end - start + 1} · ${label}`,
      );
    } catch (err) {
      setError(`Seq range failed: ${err.message || String(err)}`);
    }
  }

  const PAGE_RANGE_SPAN = 10;

  /** Keep empty from/to placeholders as gray a+10 / b-10 suggestions (clamped 1..max). */
  function syncPageRangePlaceholders() {
    const bar = qs(document, `.${NS}-controls`) || document;
    const startIn = qs(bar, '[data-role="select-start"]');
    const endIn = qs(bar, '[data-role="select-end"]');
    if (!startIn || !endIn) return;
    clampPageRangeInputs(startIn, endIn);
    const maxPage = selectRangeMaxPage();
    const startRaw = String(startIn.value || '').trim();
    const endRaw = String(endIn.value || '').trim();
    const startN = Number(startRaw);
    const endN = Number(endRaw);

    if (startRaw === '') {
      if (endRaw !== '' && Number.isFinite(endN)) {
        const sug = clampPageNum(endN - PAGE_RANGE_SPAN, maxPage);
        startIn.placeholder = sug != null ? String(sug) : 'from';
      } else {
        startIn.placeholder = 'from';
      }
    } else {
      startIn.placeholder = 'from';
    }

    if (endRaw === '') {
      if (startRaw !== '' && Number.isFinite(startN)) {
        const sug = clampPageNum(startN + PAGE_RANGE_SPAN, maxPage);
        endIn.placeholder = sug != null ? String(sug) : 'to';
      } else {
        endIn.placeholder = 'to';
      }
    } else {
      endIn.placeholder = 'to';
    }
    selectStartSaved = startRaw;
    selectEndSaved = endRaw;
  }

  function wirePageRangeInputs(bar) {
    const startIn = qs(bar, '[data-role="select-start"]');
    const endIn = qs(bar, '[data-role="select-end"]');
    if (!startIn || !endIn || startIn.dataset.rangeWired === '1') return;
    startIn.dataset.rangeWired = '1';
    endIn.dataset.rangeWired = '1';
    const onInput = () => {
      clampPageRangeInputs(startIn, endIn);
      selectStartSaved = String(startIn.value || '').trim();
      selectEndSaved = String(endIn.value || '').trim();
      syncPageRangePlaceholders();
      saveFilterState().catch(() => {});
    };
    startIn.addEventListener('input', onInput);
    endIn.addEventListener('input', onInput);
    startIn.addEventListener('change', onInput);
    endIn.addEventListener('change', onInput);
    syncPageRangePlaceholders();
  }

  function wireSeqRangeInputs(bar) {
    const startIn = qs(bar, '[data-role="select-seq-start"]');
    const endIn = qs(bar, '[data-role="select-seq-end"]');
    if (!startIn || !endIn || startIn.dataset.seqRangeWired === '1') return;
    startIn.dataset.seqRangeWired = '1';
    endIn.dataset.seqRangeWired = '1';
    const onInput = () => {
      clampSeqRangeInputs(startIn, endIn);
      selectSeqStartSaved = String(startIn.value || '').trim();
      selectSeqEndSaved = String(endIn.value || '').trim();
      saveFilterState().catch(() => {});
    };
    startIn.addEventListener('input', onInput);
    endIn.addEventListener('input', onInput);
    startIn.addEventListener('change', onInput);
    endIn.addEventListener('change', onInput);
    syncSeqRangeClamp();
  }

  /** Reclamp Seq range from/to when library total / max ordinal becomes known. */
  function syncSeqRangeClamp() {
    const bar = qs(document, `.${NS}-controls`) || document;
    const startIn = qs(bar, '[data-role="select-seq-start"]');
    const endIn = qs(bar, '[data-role="select-seq-end"]');
    if (!startIn || !endIn) return;
    clampSeqRangeInputs(startIn, endIn);
    selectSeqStartSaved = String(startIn.value || '').trim();
    selectSeqEndSaved = String(endIn.value || '').trim();
  }

  function wireDurationFilterInputs(bar) {
    const minIn = qs(bar, '[data-role="dur-min"]');
    const maxIn = qs(bar, '[data-role="dur-max"]');
    if (!minIn || !maxIn || minIn.dataset.durWired === '1') return;
    minIn.dataset.durWired = '1';
    maxIn.dataset.durWired = '1';
    const onEdit = () => {
      filterState.durMinMin = String(minIn.value || '').trim();
      filterState.durMaxMin = String(maxIn.value || '').trim();
      onMatchRuleEdited();
    };
    minIn.addEventListener('input', onEdit);
    maxIn.addEventListener('input', onEdit);
    minIn.addEventListener('change', onEdit);
    maxIn.addEventListener('change', onEdit);
  }

  function wireTitleQueryFilterInput(bar) {
    const titleIn = qs(bar, '[data-role="title-query"]');
    if (!titleIn || titleIn.dataset.titleQueryWired === '1') return;
    titleIn.dataset.titleQueryWired = '1';
    const onEdit = () => {
      filterState.titleQuery = String(titleIn.value || '').trim();
      onMatchRuleEdited();
    };
    titleIn.addEventListener('input', onEdit);
    titleIn.addEventListener('change', onEdit);
    titleIn.addEventListener('search', onEdit);
  }

  /** KVS treats playlist_id 0 as "create new"; never a real target. */
  function isValidPlaylistId(id) {
    return /^[1-9]\d*$/.test(String(id || '').trim());
  }

  function normalizePlaylistId(raw) {
    const s = String(raw || '').trim();
    if (isValidPlaylistId(s)) return s;
    const fromUrl =
      s.match(/\/(?:my\/)?playlists\/([1-9]\d*)(?:\/|$|\?|#)/i) ||
      s.match(/[?&]playlist_id=([1-9]\d*)/i) ||
      s.match(/edit-playlist\/([1-9]\d*)/i);
    return fromUrl && isValidPlaylistId(fromUrl[1]) ? fromUrl[1] : null;
  }

  function cleanPlaylistTitleText(raw, pid) {
    let t = String(raw || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/[-_/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return '';
    t = t
      .replace(/^my\s*playlists?\s*[:\-–]?\s*/i, '')
      .replace(/^playlists?\s*[:\-–]?\s*/i, '')
      .replace(/\b(public|private)\b/gi, ' ')
      .replace(/\b\d[\d\s,]*\s*videos?\b/gi, ' ')
      .replace(/\(\s*[\d,\s.]+\s*(videos?)?\s*\)/gi, ' ')
      .replace(/\bpage\s*\d+\b/gi, ' ')
      .replace(new RegExp(`^#?${pid}\\s*[·•\\-:]?\\s*`, 'i'), '')
      .replace(new RegExp(`\\s*[#(]?${pid}[)]?\\s*$`, 'i'), '')
      .replace(/^\(\s*\)\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^(create|new|edit|delete|remove|view)/i.test(t)) return '';
    if (t === pid || t === `Playlist ${pid}`) return '';
    return t;
  }

  function playlistTitleScore(title, pid) {
    const t = String(title || '').trim();
    if (!t) return 0;
    if (t === pid || t === `Playlist ${pid}` || t === `#${pid}`) return 1;
    if (/^\d+$/.test(t)) return 1;
    if (/^playlist\s+\d+$/i.test(t)) return 2;
    return 10 + Math.min(t.length, 48);
  }

  function formatPlaylistOptionLabel(p) {
    const id = String(p.id);
    let title = cleanPlaylistTitleText(p.title, id) || String(p.title || '').trim();
    title = cleanPlaylistTitleText(title, id);
    if (!title || title === id || title === `Playlist ${id}` || title === `#${id}` || /^playlist$/i.test(title)) {
      title = 'Playlist';
    }
    return `${title}: ${formatPlaylistCountPart(p.videoCount)}`;
  }

  const FAVOURITES_NAV_URL = 'https://rule34video.com/my/favourites/videos/';
  const CREATE_PLAYLIST_URL = 'https://rule34video.com/create-playlist/';
  let librarySwitcherOpen = false;
  let librarySwitcherCache = null;
  let librarySwitcherCacheAt = 0;
  let librarySwitcherDeleteMode = false;
  /** In-flight / resolved promise for early Libraries-source count prefetch. */
  let libraryCountPrefetchP = null;

  function isSiteMyFavoritesNavLink(_el) {
    // Libraries owns the switcher. Native `a.button_fav.fav` next to Tags must
    // keep site navigation to /my/favourites/videos/ — never hijack it.
    return false;
  }

  function libraryNavLabel(p) {
    const id = String(p.id);
    let title = cleanPlaylistTitleText(p.title, id) || String(p.title || '').trim();
    title = cleanPlaylistTitleText(title, id);
    if (!title || title === id || title === `Playlist ${id}` || title === `#${id}` || /^playlist$/i.test(title)) {
      title = 'Playlist';
    }
    if (p.videoCount != null && Number.isFinite(Number(p.videoCount))) {
      return formatPlaylistJumpLabel(title, id, p.videoCount);
    }
    return title;
  }

  function closeLibrarySwitcherModal(backdrop, { resetDeleteMode = true } = {}) {
    librarySwitcherOpen = false;
    if (resetDeleteMode) librarySwitcherDeleteMode = false;
    document.removeEventListener('keydown', backdrop?.__hxyruleEsc, true);
    backdrop?.remove?.();
  }

  function navigateLibraryTarget(url, { newTab = false } = {}) {
    const next = String(url || '').trim();
    if (!next) return;
    if (newTab) {
      window.open(next, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const cur = new URL(location.href);
      const dest = new URL(next, location.origin);
      if (cur.pathname.replace(/\/+$/, '') === dest.pathname.replace(/\/+$/, '') && !dest.search) {
        return;
      }
    } catch (_) {
      /* fall through */
    }
    location.assign(next);
  }

  async function loadPlaylistsForLibrarySwitcher({ force = false } = {}) {
    const now = Date.now();
    if (!force && librarySwitcherCache?.length && now - librarySwitcherCacheAt < 60000) {
      return librarySwitcherCache;
    }
    const listed = await loadSitePlaylists();
    const list = (listed?.playlists || []).filter((p) => isValidPlaylistId(p.id));
    librarySwitcherCache = list;
    librarySwitcherCacheAt = now;
    return list;
  }

  /**
   * Apply select-playlist / my/playlists videoCount (Libraries list source) to the
   * brand chip lock when the on-page headline has not yielded a count yet.
   */
  function applySitePlaylistCountToBrand(playlists) {
    if (!isPlaylistDetailPage()) return false;
    const pid = currentPlaylistIdFromPath();
    if (!pid) return false;
    const cur = (playlists || []).find((p) => String(p.id) === String(pid));
    const n = optionalNonNegInt(cur?.videoCount);
    if (n == null || n < 0) return false;
    const headline =
      qs(document, `.${NS}-playlist-native-title`) ||
      qs(document, `.${NS}-hide-native-headline`) ||
      findFavoritesHeadline();
    if (n > 0 && siteNativeTitleCount == null) {
      siteNativeTitleCount = n;
      if (headline) {
        headline.dataset.hxyruleSiteNativeVideoCount = String(n);
        if (!headline.dataset.hxyrulePlaylistVideoCount) {
          headline.dataset.hxyrulePlaylistVideoCount = String(n);
        }
      }
      return true;
    }
    if (n === 0 && siteNativeTitleCount == null) {
      const cards = Math.max(nativeListCardCount(), parseCards().length, 0);
      if (cards === 0) {
        siteNativeTitleCount = 0;
        if (headline) headline.dataset.hxyruleSiteNativeVideoCount = '0';
        return true;
      }
    }
    return false;
  }

  /**
   * Start (or reuse) the same playlist-list fetch Libraries uses — at document_start
   * when possible — so the brand chip does not wait for a Libraries click.
   */
  function ensureLibraryCountPrefetch({ force = false } = {}) {
    if (force) libraryCountPrefetchP = null;
    if (!libraryCountPrefetchP) {
      libraryCountPrefetchP = loadPlaylistsForLibrarySwitcher({ force })
        .then((list) => {
          applySitePlaylistCountToBrand(list);
          updateFavCountBar();
          refreshOpenLibrarySwitcherFromLabel();
          return list;
        })
        .catch(() => {
          updateFavCountBar();
          return null;
        });
    }
    return libraryCountPrefetchP;
  }

  /** Keep brand chip in sync with Libraries "From:" (prefetch site playlist counts). */
  /**
   * Brand chip must not wait solely on the playlist-list network call: Favorites
   * counts come from the site headline, which may appear slightly after first paint.
   */
  function scheduleBrandChipCountRefresh() {
    if (!isFavoritesPage() && !isPlaylistDetailPage()) return;
    [0, 80, 200, 500, 1200, 2500].forEach((ms) => {
      setTimeout(() => {
        try {
          captureDocumentTitleCount();
          siteNativeVideoTotal();
          detectLibraryTotalFromDom();
          if (librarySwitcherCache?.length) applySitePlaylistCountToBrand(librarySwitcherCache);
          updateFavCountBar();
        } catch (_) {
          /* ignore */
        }
      }, ms);
    });
  }

  function currentLibrarySwitcherFromLabel(playlists) {
    const pathNow = String(location.pathname || '');
    // Brand / From: — site headline / DOM, else Libraries list source (never index).
    const chipTotal = brandChipVideoTotal();
    if (FAV_PATH_RE.test(pathNow)) {
      return chipTotal != null && chipTotal > 0
        ? `My Favorites : ${chipTotal} videos`
        : 'My Favorites';
    }
    const currentPidMatch = pathNow.match(PLAYLIST_PATH_RE);
    const currentPid =
      currentPidMatch && /^[1-9]\d*$/.test(currentPidMatch[1]) ? currentPidMatch[1] : null;
    if (!currentPid) return '';
    let name = detectPlaylistTitle();
    const cur = (playlists || []).find((p) => String(p.id) === currentPid);
    if (!name || isJunkPlaylistTitle(name) || name === 'Playlist') {
      if (cur) {
        let title = cleanPlaylistTitleText(cur.title, currentPid) || String(cur.title || '').trim();
        title = cleanPlaylistTitleText(title, currentPid);
        if (title && title !== currentPid && title !== `Playlist ${currentPid}` && !/^playlist$/i.test(title)) {
          name = title;
        }
      }
    }
    name = String(name || '').trim() || 'Playlist';
    const siteCount = optionalNonNegInt(cur?.videoCount);
    const cards = Math.max(nativeListCardCount(), parseCards().length, 0);
    const maxP = playlistPaginationMax();
    if (chipTotal != null && chipTotal > 0) {
      return formatPlaylistJumpLabel(name, currentPid, chipTotal);
    }
    // Same source as Libraries row counts — do not wait for the modal to open.
    if (siteCount != null && siteCount > 0) {
      return formatPlaylistJumpLabel(name, currentPid, siteCount);
    }
    // Whole list on one page — visible cards are the full total.
    if (cards > 0 && maxP <= 1) {
      return formatPlaylistJumpLabel(name, currentPid, cards);
    }
    // Empty list confirmed by site list (0) + no cards.
    if (siteCount === 0 && cards === 0) {
      return formatPlaylistJumpLabel(name, currentPid, 0);
    }
    // Unknown — show "? videos", never flash a speculative 0.
    return formatPlaylistJumpLabel(name, currentPid, null);
  }

  function collectFormFields(form) {
    const data = new URLSearchParams();
    if (!form) return data;
    qsa(form, 'input, select, textarea').forEach((el) => {
      const name = el.getAttribute('name');
      if (!name || el.disabled) return;
      const type = String(el.type || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'file') return;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) return;
      data.append(name, el.value == null ? '' : String(el.value));
    });
    return data;
  }

  async function openSiteCreatePlaylistFancybox() {
    try {
      const result = await send('PAGE_OPEN_AJAX', { href: CREATE_PLAYLIST_URL });
      if (result && result.ok === false) {
        throw new Error(result.reason || 'fancybox missing');
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  function promptPlaylistNameModal({
    title = 'New playlist',
    hint = 'Creates a site playlist (same as My Playlists → New Playlist).',
    okLabel = 'Create',
    initial = '',
  } = {}) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = `${NS}-modal-backdrop ${NS}-modal-backdrop--stack`;
      backdrop.dataset.hxyrule = '1';
      const modal = document.createElement('div');
      modal.className = `${NS}-modal ${NS}-modal--confirm`;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', title);
      const h3 = document.createElement('h3');
      h3.textContent = title;
      const hintEl = document.createElement('p');
      hintEl.className = `${NS}-modal-hint`;
      hintEl.textContent = hint;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = `${NS}-library-create-input`;
      input.placeholder = 'Playlist name';
      input.maxLength = 120;
      input.autocomplete = 'off';
      input.value = String(initial || '');
      const actions = document.createElement('div');
      actions.className = `${NS}-modal__actions`;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = `${NS}-btn`;
      cancel.dataset.act = 'cancel';
      cancel.textContent = 'Cancel';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = `${NS}-btn ${NS}-btn--primary`;
      ok.dataset.act = 'ok';
      ok.textContent = okLabel;
      actions.appendChild(cancel);
      actions.appendChild(ok);
      modal.appendChild(h3);
      modal.appendChild(hintEl);
      modal.appendChild(input);
      modal.appendChild(actions);
      backdrop.appendChild(modal);
      const close = (val) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const next = String(input.value || '').trim();
          if (next) close(next);
        }
      };
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop || e.target?.dataset?.act === 'cancel') close(null);
        else if (e.target?.dataset?.act === 'ok') {
          const next = String(input.value || '').trim();
          if (next) close(next);
          else input.focus();
        }
      });
      document.body.appendChild(backdrop);
      requestAnimationFrame(() => {
        input.focus();
        input.select?.();
      });
    });
  }

  function promptCreatePlaylistModal() {
    return promptPlaylistNameModal();
  }

  function promptRenamePlaylistModal(currentTitle) {
    return promptPlaylistNameModal({
      title: 'Rename playlist',
      hint: 'Updates the site playlist name (same as Edit Playlist).',
      okLabel: 'Rename',
      initial: String(currentTitle || '').trim(),
    });
  }

  async function createSitePlaylist(title) {
    const name = String(title || '').trim();
    if (!name) throw new Error('Playlist name required');
    const getRes = await fetch(CREATE_PLAYLIST_URL, {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/html, */*;q=0.1',
      },
    });
    const html = await getRes.text();
    if (!getRes.ok) throw new Error(`HTTP ${getRes.status} loading create form`);
    if (/login-required|\/login\//i.test(html) && html.length < 8000) {
      throw new Error('Not logged in');
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form =
      qs(doc, 'form[action*="create-playlist"]') ||
      qs(doc, 'form') ||
      null;
    const action = form?.getAttribute('action') || CREATE_PLAYLIST_URL;
    const postUrl = new URL(action, 'https://rule34video.com/').href;
    const params = collectFormFields(form);
    if (params.has('title')) params.set('title', name);
    else params.append('title', name);
    if (!params.has('action')) params.append('action', 'add');
    // Common KVS create-playlist fields.
    if (!params.has('is_private') && qs(form, 'input[name="is_private"]')) {
      /* leave unchecked = public */
    }
    const postRes = await fetch(postUrl, {
      method: 'POST',
      credentials: 'include',
      redirect: 'follow',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/html, application/json, */*;q=0.1',
      },
      body: params.toString(),
    });
    const postText = await postRes.text();
    if (!postRes.ok && postRes.status >= 400) {
      throw new Error(`Create failed (HTTP ${postRes.status})`);
    }
    // Fancybox forms sometimes return JSON status.
    try {
      const json = JSON.parse(postText.trim());
      if (String(json?.status) === 'failure') {
        throw new Error(
          json?.errors?.[0]?.message || json?.errors?.[0]?.code || json?.message || 'create failed',
        );
      }
    } catch (err) {
      if (err && /create failed|Create failed/i.test(String(err.message || err))) throw err;
      /* HTML response is fine */
    }
    librarySwitcherCache = null;
    librarySwitcherCacheAt = 0;
    libraryCountPrefetchP = null;
    return { ok: true };
  }

  async function renameSitePlaylist(playlistId, title) {
    const pid = String(playlistId || '').trim();
    const name = String(title || '').trim();
    if (!isValidPlaylistId(pid)) throw new Error('Invalid playlist id');
    if (!name) throw new Error('Playlist name required');
    const editUrl = `https://rule34video.com/edit-playlist/${pid}/`;
    const getRes = await fetch(editUrl, {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/html, */*;q=0.1',
      },
    });
    const html = await getRes.text();
    if (!getRes.ok) throw new Error(`HTTP ${getRes.status} loading edit form`);
    if (/login-required|\/login\//i.test(html) && html.length < 8000) {
      throw new Error('Not logged in');
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form =
      qs(doc, 'form[action*="edit-playlist"]') ||
      qs(doc, 'form') ||
      null;
    if (!form) throw new Error('Edit playlist form not found');
    const action = form.getAttribute('action') || editUrl;
    const postUrl = new URL(action, 'https://rule34video.com/').href;
    const params = collectFormFields(form);
    if (params.has('title')) params.set('title', name);
    else params.append('title', name);
    // Never send delete flags when renaming.
    params.delete('delete');
    params.delete('confirm_delete');
    if (!params.has('action') || /delete/i.test(String(params.get('action') || ''))) {
      params.set('action', 'change');
    }
    qsa(form, 'input[type="submit"], button[type="submit"]').forEach((el) => {
      const submitName = el.getAttribute('name');
      if (!submitName || params.has(submitName)) return;
      const val = el.value == null || el.value === '' ? '1' : String(el.value);
      if (/delete/i.test(submitName) || /delete/i.test(val)) return;
      params.append(submitName, val);
    });
    const postRes = await fetch(postUrl, {
      method: 'POST',
      credentials: 'include',
      redirect: 'follow',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'text/html, application/json, */*;q=0.1',
        Referer: editUrl,
      },
      body: params.toString(),
    });
    const postText = await postRes.text();
    if (!postRes.ok && postRes.status >= 400) {
      throw new Error(`Rename failed (HTTP ${postRes.status})`);
    }
    try {
      const json = JSON.parse(postText.trim());
      if (String(json?.status) === 'failure') {
        throw new Error(
          json?.errors?.[0]?.message || json?.errors?.[0]?.code || json?.message || 'rename failed',
        );
      }
    } catch (err) {
      if (err && /rename failed|Rename failed/i.test(String(err.message || err))) throw err;
      /* HTML response is fine */
    }
    librarySwitcherCache = null;
    librarySwitcherCacheAt = 0;
    libraryCountPrefetchP = null;
    return { ok: true, title: name, id: pid };
  }

  async function fetchPlaylistExists(playlistId) {
    const pid = String(playlistId || '').trim();
    if (!isValidPlaylistId(pid)) return false;
    try {
      const listed = await loadSitePlaylists();
      return (listed?.playlists || []).some((p) => String(p.id) === pid);
    } catch (_) {
      return true;
    }
  }

  async function postEditPlaylistDelete(pid, html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const forms = [
      ...qsa(doc, 'form[action*="edit-playlist"]'),
      ...qsa(doc, 'form'),
    ];
    const seen = new Set();
    let lastDetail = '';
    for (const form of forms) {
      if (!form || seen.has(form)) continue;
      seen.add(form);
      const action = form.getAttribute('action') || `https://rule34video.com/edit-playlist/${pid}/`;
      const postUrl = new URL(action, 'https://rule34video.com/').href;
      if (!/edit-playlist|playlist/i.test(postUrl) && forms.length > 1) continue;
      const params = collectFormFields(form);
      // Include submit button names KVS often requires.
      qsa(form, 'input[type="submit"], button[type="submit"]').forEach((el) => {
        const name = el.getAttribute('name');
        if (!name || params.has(name)) return;
        params.append(name, el.value == null || el.value === '' ? '1' : String(el.value));
      });
      params.set('delete', '1');
      params.set('confirm_delete', '1');
      if (!params.has('action')) params.set('action', 'delete');
      try {
        const postRes = await fetch(postUrl, {
          method: 'POST',
          credentials: 'include',
          redirect: 'follow',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'text/html, application/json, */*;q=0.1',
            Referer: `https://rule34video.com/edit-playlist/${pid}/`,
          },
          body: params.toString(),
        });
        const postText = await postRes.text();
        try {
          const json = JSON.parse(postText.trim());
          if (String(json?.status) === 'success') return { ok: true, method: 'edit-form-json' };
          if (String(json?.status) === 'failure') {
            lastDetail =
              json?.errors?.[0]?.message || json?.errors?.[0]?.code || json?.message || 'failure';
            continue;
          }
        } catch (_) {
          /* HTML */
        }
        if (/login-required|\/login\//i.test(postText) && postText.length < 8000) {
          lastDetail = 'not logged in';
          continue;
        }
        // Soft signal only — caller verifies playlist is gone.
        if (postRes.ok || /my\/playlists/i.test(postRes.url)) {
          return { ok: true, method: 'edit-form', soft: true };
        }
        lastDetail = `HTTP ${postRes.status}`;
      } catch (err) {
        lastDetail = String(err?.message || err);
      }
    }
    return { ok: false, detail: lastDetail || 'no edit form' };
  }

  async function tryAsyncPlaylistDelete(pid) {
    const variants = [
      { action: 'delete_playlist', playlist_id: pid },
      { action: 'delete_playlist', playlist_id: pid, delete: '1' },
      { action: 'delete_playlists', playlist_id: pid },
      { action: 'delete_playlists', 'delete[]': pid },
    ];
    const bases = [
      `https://rule34video.com/edit-playlist/${pid}/`,
      'https://rule34video.com/my/playlists/',
      'https://rule34video.com/',
    ];
    for (const params of variants) {
      for (const base of bases) {
        const q = new URLSearchParams({ mode: 'async', format: 'json' });
        Object.entries(params).forEach(([k, v]) => {
          if (v == null) return;
          q.set(k, String(v));
        });
        const url = `${base}${base.includes('?') ? '&' : '?'}${q.toString()}`;
        try {
          const res = await fetch(url, {
            credentials: 'include',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              Accept: 'application/json, text/javascript, */*;q=0.1',
            },
          });
          const raw = (await res.text()).trim();
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {
            continue;
          }
          if (String(json?.status) === 'success') {
            return { ok: true, method: 'async-action' };
          }
        } catch (_) {
          /* next */
        }
      }
    }

    const blockAttempts = [
      {
        base: 'https://rule34video.com/my/playlists/',
        block: 'list_playlists_my_created_playlists',
      },
      {
        base: 'https://rule34video.com/',
        block: 'list_playlists_my_created_playlists',
      },
    ];
    for (const attempt of blockAttempts) {
      for (const enc of ['brackets', 'plain']) {
        for (const extra of [{}, { action: 'delete' }, { action: 'delete_multi' }]) {
          const q = new URLSearchParams({
            mode: 'async',
            format: 'json',
            function: 'get_block',
            block_id: attempt.block,
            ...extra,
          });
          if (enc === 'brackets') q.append('delete[]', pid);
          else q.append('delete', pid);
          const url = `${attempt.base}${attempt.base.includes('?') ? '&' : '?'}${q.toString()}`;
          try {
            const res = await fetch(url, {
              credentials: 'include',
              headers: {
                'X-Requested-With': 'XMLHttpRequest',
                Accept: 'application/json, text/javascript, */*;q=0.1',
              },
            });
            const raw = (await res.text()).trim();
            let json = null;
            try {
              json = JSON.parse(raw);
            } catch (_) {
              continue;
            }
            if (String(json?.status) === 'success') {
              return { ok: true, method: `block-delete-${enc}` };
            }
          } catch (_) {
            /* next */
          }
        }
      }
    }
    return { ok: false, detail: 'async delete failed' };
  }

  async function deleteSitePlaylist(playlistId) {
    const pid = String(playlistId || '').trim();
    if (!isValidPlaylistId(pid)) throw new Error('Invalid playlist id');
    const editUrl = `https://rule34video.com/edit-playlist/${pid}/`;
    let lastDetail = '';

    try {
      const getRes = await fetch(editUrl, {
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html, */*;q=0.1',
        },
      });
      const html = await getRes.text();
      if (!getRes.ok) lastDetail = `HTTP ${getRes.status} loading edit form`;
      else if (/login-required|\/login\//i.test(html) && html.length < 8000) {
        throw new Error('Not logged in');
      } else {
        const edited = await postEditPlaylistDelete(pid, html);
        if (edited.ok) {
          if (!(await fetchPlaylistExists(pid))) return { ok: true, method: edited.method };
          lastDetail = 'edit form did not remove playlist';
        } else {
          lastDetail = edited.detail || lastDetail;
        }
      }
    } catch (err) {
      if (/not logged in/i.test(String(err?.message || err))) throw err;
      lastDetail = String(err?.message || err);
    }

    const asyncTry = await tryAsyncPlaylistDelete(pid);
    if (asyncTry.ok) {
      if (!(await fetchPlaylistExists(pid))) return { ok: true, method: asyncTry.method };
      lastDetail = 'async delete did not remove playlist';
    } else {
      lastDetail = asyncTry.detail || lastDetail;
    }

    // Final verification — maybe an earlier soft success already worked.
    if (!(await fetchPlaylistExists(pid))) return { ok: true, method: 'verified-absent' };
    throw new Error(lastDetail || 'Could not delete playlist via site forms');
  }

  async function deleteSitePlaylists(playlistIds) {
    const ids = [...new Set((playlistIds || []).map(String).filter((id) => isValidPlaylistId(id)))];
    if (!ids.length) throw new Error('No playlists selected');
    const errors = [];
    let ok = 0;
    for (const id of ids) {
      try {
        await deleteSitePlaylist(id);
        ok += 1;
      } catch (err) {
        errors.push(`${id}: ${err?.message || err}`);
      }
      await new Promise((r) => setTimeout(r, 160));
    }
    librarySwitcherCache = null;
    librarySwitcherCacheAt = 0;
    libraryCountPrefetchP = null;
    if (ok === 0) throw new Error(errors[0] || 'Delete failed');
    return { ok, failed: ids.length - ok, errors, ids };
  }

  function selectedLibraryDeleteIds(backdrop) {
    if (backdrop?.__selectedIds instanceof Set) {
      return [...backdrop.__selectedIds].filter((id) => isValidPlaylistId(id));
    }
    return qsa(backdrop, `.${NS}-library-select-item.is-selected`)
      .map((el) => String(el.dataset.playlistId || el.querySelector?.('input')?.value || '').trim())
      .filter((id) => isValidPlaylistId(id));
  }

  function toLabelFlash(backdrop, message) {
    const el = qs(backdrop, `.${NS}-library-to-label`);
    if (!el) {
      setError(message);
      return;
    }
    const prev = el.textContent;
    el.textContent = message;
    el.classList.add(`${NS}-library-to-label--warn`);
    clearTimeout(el.__hxyruleFlash);
    el.__hxyruleFlash = setTimeout(() => {
      el.textContent = prev || 'To:';
      el.classList.remove(`${NS}-library-to-label--warn`);
    }, 1800);
  }

  function showLibrarySwitcherModal(
    playlists,
    { loading = false, error = '', deleteMode = librarySwitcherDeleteMode } = {},
  ) {
    const prev = qs(document, `.${NS}-library-switcher`)?.closest(`.${NS}-modal-backdrop`);
    const prevSelected = prev ? selectedLibraryDeleteIds(prev) : [];
    if (prev) closeLibrarySwitcherModal(prev, { resetDeleteMode: false });
    librarySwitcherDeleteMode = !!deleteMode;
    const backdrop = document.createElement('div');
    backdrop.className = `${NS}-modal-backdrop`;
    backdrop.dataset.hxyrule = '1';
    backdrop.__selectedIds = new Set(prevSelected.map(String));
    if (librarySwitcherDeleteMode) backdrop.dataset.deleteMode = '1';
    const modal = document.createElement('div');
    modal.className = `${NS}-modal ${NS}-library-switcher`;
    if (librarySwitcherDeleteMode) modal.classList.add(`${NS}-library-switcher--delete`);
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'My libraries');
    const pathNow = String(location.pathname || '');
    const onFavorites = FAV_PATH_RE.test(pathNow);
    const currentPidMatch = pathNow.match(PLAYLIST_PATH_RE);
    const currentPid =
      currentPidMatch && /^[1-9]\d*$/.test(currentPidMatch[1]) ? currentPidMatch[1] : null;
    const fromLabel = currentLibrarySwitcherFromLabel(playlists);
    const h3 = document.createElement('h3');
    h3.textContent = fromLabel ? `From: ${fromLabel}` : 'My libraries';
    const toLabel = document.createElement('p');
    toLabel.className = `${NS}-modal-hint ${NS}-library-to-label`;
    toLabel.textContent = 'To:';
    const list = document.createElement('div');
    list.className = `${NS}-playlist-list ${NS}-library-nav-list`;

    const addNavBtn = (label, href, { playlistId = '', renameTitle = '' } = {}) => {
      const row = document.createElement('div');
      row.className = `${NS}-library-nav-row`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${NS}-playlist-option ${NS}-library-nav-item`;
      btn.dataset.href = href;
      btn.textContent = label;
      row.appendChild(btn);
      if (playlistId && isValidPlaylistId(playlistId)) {
        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = `${NS}-btn ${NS}-btn--ghost ${NS}-library-rename-btn`;
        renameBtn.dataset.act = 'rename-playlist';
        renameBtn.dataset.playlistId = String(playlistId);
        renameBtn.dataset.playlistTitle = String(renameTitle || '');
        renameBtn.textContent = 'Rename';
        renameBtn.title = 'Rename playlist';
        renameBtn.setAttribute('aria-label', `Rename ${renameTitle || label}`);
        row.appendChild(renameBtn);
      }
      list.appendChild(row);
    };

    const addSelectItem = (label, id, { checked = false } = {}) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${NS}-playlist-option ${NS}-library-nav-item ${NS}-library-select-item`;
      btn.dataset.playlistId = String(id);
      btn.setAttribute('aria-pressed', checked ? 'true' : 'false');
      if (checked) {
        btn.classList.add('is-selected');
        backdrop.__selectedIds.add(String(id));
      }
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const on = !btn.classList.contains('is-selected');
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) backdrop.__selectedIds.add(String(id));
        else backdrop.__selectedIds.delete(String(id));
      });
      list.appendChild(btn);
    };

    if (loading) {
      const status = document.createElement('p');
      status.className = `${NS}-modal-hint`;
      status.textContent = 'Loading playlists…';
      list.appendChild(status);
    } else if (error) {
      const status = document.createElement('p');
      status.className = `${NS}-modal-hint`;
      status.textContent = error;
      list.appendChild(status);
    } else if (librarySwitcherDeleteMode) {
      const valid = (playlists || []).filter((p) => isValidPlaylistId(p.id));
      const selectedSet = new Set(prevSelected);
      // Playlist page: pin current list at top (same slot as "My Favorites" in nav mode).
      if (currentPid) {
        const cur = valid.find((p) => String(p.id) === currentPid);
        const label = cur
          ? libraryNavLabel(cur)
          : fromLabel || `Playlist`;
        addSelectItem(label, currentPid, { checked: selectedSet.has(currentPid) });
      }
      const others = valid.filter((p) => String(p.id) !== currentPid);
      if (!others.length && !currentPid) {
        const empty = document.createElement('p');
        empty.className = `${NS}-modal-hint`;
        empty.textContent = 'No playlists to delete.';
        list.appendChild(empty);
      } else {
        others.forEach((p) => {
          const id = String(p.id);
          addSelectItem(libraryNavLabel(p), id, { checked: selectedSet.has(id) });
        });
      }
    } else {
      // Current library is shown in the from: line only (not selectable).
      if (!onFavorites) {
        addNavBtn('My Favorites', FAVOURITES_NAV_URL);
      }
      const valid = (playlists || []).filter((p) => isValidPlaylistId(p.id));
      const others = valid.filter((p) => String(p.id) !== currentPid);
      if (!others.length && !currentPid) {
        const empty = document.createElement('p');
        empty.className = `${NS}-modal-hint`;
        empty.textContent = 'No playlists found.';
        list.appendChild(empty);
      } else {
        others.forEach((p) => {
          const id = String(p.id);
          const title = cleanPlaylistTitleText(p.title, id) || String(p.title || '').trim() || id;
          addNavBtn(libraryNavLabel(p), `https://rule34video.com/my/playlists/${id}/`, {
            playlistId: id,
            renameTitle: title,
          });
        });
      }
    }

    const actions = document.createElement('div');
    actions.className = `${NS}-modal__actions ${NS}-library-actions`;
    const left = document.createElement('div');
    left.className = `${NS}-library-actions-left`;
    const right = document.createElement('div');
    right.className = `${NS}-library-actions-right`;

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = `${NS}-btn ${NS}-btn--primary`;
    newBtn.dataset.act = 'new-playlist';
    newBtn.textContent = 'New';
    newBtn.disabled = !!loading;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = `${NS}-btn ${NS}-btn--danger`;
    deleteBtn.dataset.act = 'delete-playlists';
    deleteBtn.textContent = 'Delete';
    deleteBtn.disabled = !!loading;

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = `${NS}-btn`;
    doneBtn.dataset.act = 'exit-delete';
    doneBtn.textContent = 'Exit delete';
    doneBtn.hidden = !librarySwitcherDeleteMode;

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = `${NS}-btn`;
    cancel.dataset.act = 'cancel';
    cancel.textContent = 'Close';

    left.appendChild(newBtn);
    left.appendChild(deleteBtn);
    left.appendChild(doneBtn);
    right.appendChild(cancel);
    actions.appendChild(left);
    actions.appendChild(right);

    modal.appendChild(h3);
    modal.appendChild(toLabel);
    modal.appendChild(list);
    modal.appendChild(actions);
    backdrop.appendChild(modal);

    const rerender = (opts = {}) => {
      showLibrarySwitcherModal(playlists, {
        loading,
        error,
        deleteMode: librarySwitcherDeleteMode,
        ...opts,
      });
    };

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (librarySwitcherDeleteMode) {
        librarySwitcherDeleteMode = false;
        showLibrarySwitcherModal(playlists, { loading, error, deleteMode: false });
        return;
      }
      closeLibrarySwitcherModal(backdrop);
    };
    backdrop.__hxyruleEsc = onKey;
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (e.target === backdrop || act === 'cancel') {
        closeLibrarySwitcherModal(backdrop);
        return;
      }
      if (act === 'exit-delete') {
        librarySwitcherDeleteMode = false;
        showLibrarySwitcherModal(playlists, { loading, error, deleteMode: false });
        return;
      }
      if (act === 'rename-playlist') {
        e.preventDefault();
        const pid = e.target?.dataset?.playlistId || '';
        const title = e.target?.dataset?.playlistTitle || '';
        handleLibraryRenamePlaylist(backdrop, pid, title).catch((err) => {
          setError(`Rename playlist failed: ${err?.message || err}`);
        });
        return;
      }
      if (act === 'new-playlist') {
        e.preventDefault();
        handleLibraryNewPlaylist(backdrop).catch((err) => {
          setError(`New playlist failed: ${err?.message || err}`);
        });
        return;
      }
      if (act === 'delete-playlists') {
        e.preventDefault();
        handleLibraryDeletePlaylists(backdrop, playlists).catch((err) => {
          setError(`Delete playlist failed: ${err?.message || err}`);
        });
        return;
      }
      if (librarySwitcherDeleteMode) return;
      const item = e.target?.closest?.(`.${NS}-library-nav-item`);
      if (!item || !backdrop.contains(item)) return;
      const href = item.dataset.href || '';
      if (!href) return;
      // Cmd/Ctrl+click → new tab; keep the switcher open to open more lists.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        navigateLibraryTarget(href, { newTab: true });
        return;
      }
      closeLibrarySwitcherModal(backdrop);
      navigateLibraryTarget(href);
    });
    backdrop.addEventListener('auxclick', (e) => {
      if (librarySwitcherDeleteMode) return;
      if (e.button !== 1) return;
      const item = e.target?.closest?.(`.${NS}-library-nav-item`);
      if (!item || !backdrop.contains(item)) return;
      const href = item.dataset.href || '';
      if (!href) return;
      e.preventDefault();
      navigateLibraryTarget(href, { newTab: true });
    });
    document.body.appendChild(backdrop);
    librarySwitcherOpen = true;
    requestAnimationFrame(() => {
      if (librarySwitcherDeleteMode) deleteBtn.focus?.();
      else cancel.focus?.();
    });
    return backdrop;
  }

  async function handleLibraryNewPlaylist(backdrop) {
    // Prefer our title prompt; fall back to site fancybox create form.
    const title = await promptCreatePlaylistModal();
    if (title == null) return;
    try {
      await createSitePlaylist(title);
      const playlists = await loadPlaylistsForLibrarySwitcher({ force: true });
      if (!document.body.contains(backdrop)) {
        showLibrarySwitcherModal(playlists, { deleteMode: false });
      } else {
        showLibrarySwitcherModal(playlists, { deleteMode: librarySwitcherDeleteMode });
      }
      updateFavCountBar();
      setError('');
    } catch (err) {
      closeLibrarySwitcherModal(backdrop);
      const opened = await openSiteCreatePlaylistFancybox();
      if (!opened) {
        location.assign(CREATE_PLAYLIST_URL);
        throw err;
      }
    }
  }

  async function handleLibraryRenamePlaylist(backdrop, playlistId, currentTitle) {
    const pid = String(playlistId || '').trim();
    if (!isValidPlaylistId(pid)) return;
    const nextTitle = await promptRenamePlaylistModal(currentTitle);
    if (nextTitle == null) return;
    if (String(nextTitle).trim() === String(currentTitle || '').trim()) return;
    await renameSitePlaylist(pid, nextTitle);
    // If we renamed the open playlist, refresh the center NAME pill immediately.
    if (String(currentPlaylistIdFromPath() || '') === pid) {
      const hl = qs(document, `.${NS}-playlist-native-title`);
      if (hl) {
        hl.dataset.hxyrulePlaylistName = String(nextTitle).trim();
        const label = qs(hl, `.${NS}-playlist-title-label`);
        if (label) label.textContent = String(nextTitle).trim();
        const raw = String(hl.dataset.hxyruleOrigTitleText || hl.dataset.hxyruleSiteNativeTitleText || '');
        if (raw) {
          const patched = raw.replace(
            /My\s+Playlist\s+.+?(\s*\([\d,]+\s*(?:videos?)?\s*\))?$/i,
            `My Playlist ${String(nextTitle).trim()}$1`,
          );
          if (patched && patched !== raw) {
            hl.dataset.hxyruleOrigTitleText = patched;
            hl.dataset.hxyruleSiteNativeTitleText = patched;
          }
        }
      }
      updateFavCountBar();
    }
    const playlists = await loadPlaylistsForLibrarySwitcher({ force: true });
    if (!document.body.contains(backdrop)) {
      showLibrarySwitcherModal(playlists, { deleteMode: false });
    } else {
      showLibrarySwitcherModal(playlists, { deleteMode: false });
    }
    setError('');
  }


  async function handleLibraryDeletePlaylists(backdrop, playlists) {
    if (!librarySwitcherDeleteMode) {
      librarySwitcherDeleteMode = true;
      showLibrarySwitcherModal(playlists || librarySwitcherCache || [], { deleteMode: true });
      return;
    }
    const ids = selectedLibraryDeleteIds(backdrop);
    if (!ids.length) {
      toLabelFlash(backdrop, 'Select a playlist first.');
      return;
    }
    const labels = ids.map((id) => {
      const p = (playlists || librarySwitcherCache || []).find((x) => String(x.id) === id);
      return p ? libraryNavLabel(p) : 'Playlist';
    });
    const ok = await confirmModal({
      title: ids.length === 1 ? 'Delete playlist?' : `Delete ${ids.length} playlists?`,
      body:
        ids.length === 1
          ? `Permanently delete “${labels[0]}” from the site.\nThis cannot be undone.`
          : `Permanently delete these playlists from the site:\n${labels
              .slice(0, 8)
              .map((t) => `• ${t}`)
              .join('\n')}${labels.length > 8 ? `\n…and ${labels.length - 8} more` : ''}\nThis cannot be undone.`,
      okLabel: ids.length === 1 ? 'Delete playlist' : 'Delete playlists',
      cancelLabel: 'Cancel',
      danger: true,
      modern: true,
    });
    if (!ok) return;
    const result = await deleteSitePlaylists(ids);
    const deletedCurrent =
      isPlaylistDetailPage() && ids.includes(String(currentPlaylistIdFromPath() || ''));
    librarySwitcherDeleteMode = false;
    if (deletedCurrent) {
      closeLibrarySwitcherModal(backdrop);
      navigateLibraryTarget(FAVOURITES_NAV_URL);
      return;
    }
    const next = await loadPlaylistsForLibrarySwitcher({ force: true });
    showLibrarySwitcherModal(next, { deleteMode: false });
    updateFavCountBar();
    if (result.failed) {
      setError(`Deleted ${result.ok}, failed ${result.failed}: ${result.errors.slice(0, 2).join('; ')}`);
    } else {
      setError('');
    }
  }

  async function openLibrarySwitcher() {
    if (librarySwitcherOpen && qs(document, `.${NS}-library-switcher`)) return;
    librarySwitcherDeleteMode = false;
    // Always re-fetch site playlist HTML so From / To counts stay current.
    const backdrop = showLibrarySwitcherModal(librarySwitcherCache || [], {
      loading: true,
      deleteMode: false,
    });
    try {
      const playlists = await loadPlaylistsForLibrarySwitcher({ force: true });
      if (!document.body.contains(backdrop)) return;
      showLibrarySwitcherModal(playlists, { deleteMode: false });
      updateFavCountBar();
    } catch (err) {
      if (!document.body.contains(backdrop)) return;
      showLibrarySwitcherModal(librarySwitcherCache || [], {
        error: `Could not load playlists: ${err?.message || err}`,
        deleteMode: false,
      });
      updateFavCountBar();
    }
  }

  function confirmModal({
    title,
    body,
    okLabel = 'OK',
    cancelLabel = 'Cancel',
    danger = false,
    modern = false,
  }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = `${NS}-modal-backdrop ${NS}-modal-backdrop--stack`;
      backdrop.dataset.hxyrule = '1';
      const modalClass = [
        `${NS}-modal`,
        modern ? `${NS}-modal--confirm` : '',
        danger ? `${NS}-modal--danger` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const okClass = [
        `${NS}-btn`,
        danger ? `${NS}-btn--danger` : `${NS}-btn--primary`,
      ].join(' ');
      backdrop.innerHTML = `
        <div class="${modalClass}">
          <h3></h3>
          <div data-role="body" class="${NS}-confirm-body"></div>
          <div class="${NS}-modal__actions">
            <button type="button" class="${NS}-btn" data-act="cancel"></button>
            <button type="button" class="${okClass}" data-act="ok"></button>
          </div>
        </div>
      `;
      qs(backdrop, 'h3').textContent = title;
      qs(backdrop, '[data-act="cancel"]').textContent = cancelLabel;
      qs(backdrop, '[data-act="ok"]').textContent = okLabel;
      const bodyHost = qs(backdrop, '[data-role="body"]');
      String(body || '')
        .split('\n')
        .forEach((line) => {
          const p = document.createElement('p');
          p.className = `${NS}-confirm-line`;
          p.textContent = line || ' ';
          bodyHost.appendChild(p);
        });
      const close = (val) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
      };
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop || e.target.dataset.act === 'cancel') close(false);
        else if (e.target.dataset.act === 'ok') close(true);
      });
      document.body.appendChild(backdrop);
      qs(backdrop, '[data-act="ok"]')?.focus();
    });
  }

  function installLibrarySwitcher() {
    if (window !== window.top) return;
    if (document.documentElement?.dataset?.hxyruleLibSwitcher === '1') return;
    document.documentElement.dataset.hxyruleLibSwitcher = '1';
    document.addEventListener(
      'click',
      (e) => {
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (!isSiteMyFavoritesNavLink(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        openLibrarySwitcher().catch(() => {});
      },
      true,
    );
  }

  function nativeFavItemFromPage(videoId) {
    const id = String(videoId || '').trim();
    let title = id;
    let thumbUrl = '';
    let previewUrl = '';
    let durationSec = null;
    try {
      if (id && location.pathname.includes(`/video/${id}/`)) {
        const h1 = qs(document, 'h1')?.textContent?.trim();
        const og = qs(document, 'meta[property="og:title"]')?.getAttribute('content');
        const docTitle = String(document.title || '')
          .replace(/\s*[|\-–—].*$/, '')
          .trim();
        title = h1 || og || docTitle || id;
        thumbUrl =
          normalizeThumbUrl(qs(document, 'meta[property="og:image"]')?.getAttribute('content')) ||
          '';
        durationSec = detailPageDurationSec();
      } else if (id) {
        const link =
          qs(document, `a[href*="/video/${id}/"]`) ||
          qs(document, `[data-video-id="${id}"] a[href*="/video/"]`);
        const card = link?.closest?.('.item.thumb, .thumb, [class*="item"]') || link?.parentElement;
        const t =
          card?.querySelector?.('.thumb_title')?.textContent ||
          link?.getAttribute?.('title') ||
          link?.textContent ||
          card?.querySelector?.('.title')?.textContent ||
          '';
        if (String(t).trim()) title = String(t).replace(/\s+/g, ' ').trim();
        const img = card?.querySelector?.('img');
        thumbUrl = normalizeThumbUrl(img?.getAttribute?.('data-original') || img?.src) || '';
        previewUrl =
          normalizeThumbUrl(img?.getAttribute?.('data-preview')) ||
          (card ? cardPreviewUrl(card) : '') ||
          '';
        durationSec = card ? cardDurationSec(card) : null;
      }
    } catch (_) {
      /* ignore DOM probes */
    }
    return {
      videoId: id,
      title: title || id,
      detailUrl: `https://rule34video.com/video/${id}/v/`,
      favoritePage: 1,
      cardIndex: 0,
      durationSec: coerceDurationSec(durationSec),
      thumbUrl,
      previewUrl,
      viewsText: '',
      ratingText: '',
      addedText: '',
      uploadedText: '',
      sexGroup: '',
    };
  }

  let nativeFavBridgeWired = false;
  const nativeFavRecent = new Map();

  function nativeFavDedupeKey(op, videoId, scope) {
    return `${op}|${scope}|${videoId}`;
  }

  async function applyNativeFavouriteMutation(msg) {
    const op = String(msg?.op || '').toLowerCase();
    const videoId = String(msg?.videoId || '').trim();
    if (!/^\d+$/.test(videoId)) return;
    if (op !== 'add' && op !== 'remove') return;
    const favType = String(msg?.favType || '0').trim() || '0';
    const playlistId = String(msg?.playlistId || '0').trim() || '0';
    const isPlaylist = favType === '10' && /^[1-9]\d*$/.test(playlistId);
    const scope = isPlaylist ? `playlist:${playlistId}` : 'favorites';
    const key = nativeFavDedupeKey(op, videoId, scope);
    const now = Date.now();
    const prevAt = nativeFavRecent.get(key) || 0;
    if (now - prevAt < 800) return;
    nativeFavRecent.set(key, now);
    if (nativeFavRecent.size > 80) {
      for (const [k, at] of nativeFavRecent) {
        if (now - at > 10000) nativeFavRecent.delete(k);
      }
    }

    const onLibraryUi = isFavoritesPage() || isPlaylistDetailPage();
    const touchingCurrent =
      onLibraryUi &&
      (scope === indexScopeKey() || (scope === 'favorites' && isFavoritesPage()));

    if (op === 'add') {
      const item = nativeFavItemFromPage(videoId);
      await patchIndexAddItems(scope, [item]);
      if (scope === 'favorites') {
        if (myFavIdSet) myFavIdSet.add(videoId);
        favoritesIndexDirty = false;
        // Refavorite must not keep a mid-range seq on page 1 — claim max+1.
        await claimNewestOrdinals([videoId]);
        if (isFavoritesPage()) scheduleOrdinalRepaint([0, 300]);
      }
      if (touchingCurrent) {
        const before = currentDisplayedLibraryTotal();
        if (before != null) raiseDisplayedLibraryTotal(before + 1);
        refreshScanLabelCounts();
        updateToolbarLabels?.();
        updateFilterBarLabels?.();
        refreshOpenLibrarySwitcherFromLabel();
      }
      return;
    }

    await patchIndexRemoveIds(scope, [videoId]);
    if (scope === 'favorites' && myFavIdSet) myFavIdSet.delete(videoId);
    if (touchingCurrent) {
      const before = currentDisplayedLibraryTotal();
      if (before != null) lowerDisplayedLibraryTotal(Math.max(0, before - 1));
      refreshScanLabelCounts();
      updateToolbarLabels?.();
      updateFilterBarLabels?.();
      refreshOpenLibrarySwitcherFromLabel();
      // Native unfavorite on Favorites may leave the card until AJAX redraw.
      if (isFavoritesPage() && scope === 'favorites') {
        removeListCardsByIds([videoId]);
      }
      // Refill native thumbs from site so deleted slots close (also keeps List
      // under Compact full when switching views).
      try {
        await reloadCurrentListPageForced();
      } catch (_) {
        /* keep surgically removed cards */
      }
      // Full card-area repaint (Compact / Show matches refill; Show all marks).
      await refreshActiveCardArea({ quiet: true, ensureIndex: false });
    }
  }

  /** Listen for MAIN-world native heart AJAX (content/native-fav-hook.js). */
  function installNativeFavouritesBridge() {
    if (nativeFavBridgeWired) return;
    nativeFavBridgeWired = true;
    window.addEventListener('message', (ev) => {
      if (ev.source !== window) return;
      const data = ev.data;
      if (!data || data.type !== 'hxyrule-native-fav') return;
      applyNativeFavouriteMutation(data).catch(() => {});
    });
  }

  async function recoverFailedQueueOnPageLoad() {
    try {
      return await send('QUEUE_RECOVER_FAILED');
    } catch (_) {
      // Keep page boot usable when Helper is offline; normal status refresh will
      // surface queue state again after Helper becomes available.
      return null;
    }
  }

  async function doScan() {
    setError('');
    const scanBtn =
      qs(document, `.${NS}-controls [data-act="scan"]`) ||
      qs(document, `.${NS}-toolbar [data-act="scan"]`);
    if (scanBtn) scanBtn.textContent = 'Scan local (…)';
    try {
      try {
        const health = await send('HELPER_HEALTH');
        applyVideoRootHealth(health);
      } catch (_) {
        /* Helper down — SCAN below surfaces the real error. */
      }
      if (videoRootExists === false) {
        updateToolbarLabels();
        throw new Error('Video root not mounted or missing');
      }
      const result = await send('HELPER_SCAN');
      videoRootExists = true;
      scanned = true;
      diskIndexDirty = false;
      lastDiskScanAt = Date.now();
      const matches = result.matches || {};
      localIdSet = new Set(Object.keys(matches).map(String));
      lastScanMatches = matches;
      // Keep full scan map; page lookup only overlays the visible cards.
      lastMatches = { ...matches };
      // List local ∩ total — not Helper matchedCount (whole disk).
      refreshScanLabelCounts();
      // Restore stable label before nearby page checks (no per-page flicker).
      updateToolbarLabels();
      const cards = parseCards();
      // Scan matches lack `exists`; normalize so path UI renders before lookup.
      cards.forEach((card) => {
        const m = matches[card.videoId];
        renderStatus(card, m ? { ...m, exists: true } : { exists: false }, true);
      });
      const lookup = await send('HELPER_LOOKUP', { videoIds: cards.map((c) => c.videoId) });
      lastMatches = { ...lastScanMatches, ...lastMatches, ...(lookup.results || {}) };
      cards.forEach((card) => renderStatus(card, lastMatches[card.videoId], true));
      syncCurrentPageLocalMark(cards, lastMatches);
      await applyOrdinalsToCards(cards);
      await evaluateVisibleLocalPages(localIdSet);
      // Match chips only edit rules. Re-apply after scan only when View already
      // has an active filtered result AND Local/Not local depends on disk.
      // Prefer persisted viewMode so a failed Compact mount cannot fall through
      // to Show matches (active + !compactViewActive used to do that).
      if (filterState.active && !filterRunning && !diskFilterIsAll()) {
        if (normalizeViewMode(viewMode) === 'compact' || compactViewActive) {
          await applyCompactMatchesView({ ensureIndex: false, quiet: true });
        } else {
          await applyLibraryFilter({ ensureIndex: false, quiet: true });
        }
      }
      refreshScanLabelCounts();
      updateToolbarLabels();
    } catch (err) {
      if (/not mounted or missing/i.test(String(err?.message || err || ''))) {
        videoRootExists = false;
      }
      setError(`Scan failed: ${err.message}`);
      updateToolbarLabels();
    }
  }

  async function refreshLookup() {
    const cards = parseCards();
    if (!cards.length) {
      paintPaginationLocalMarks();
      return;
    }
    try {
      const data = await send('HELPER_LOOKUP', { videoIds: cards.map((c) => c.videoId) });
      const results = data.results || {};
      // Merge so Compact off-page cards keep scan paths when lookup is sparse.
      lastMatches = { ...lastScanMatches, ...lastMatches, ...results };
      if (data.lastScan && data.lastScan.scannedAt) scanned = true;
      ignoreMutationsUntil = Date.now() + 400;
      cards.forEach((card) => {
        const info = results[card.videoId] || lastMatches[card.videoId] || lastScanMatches[card.videoId];
        renderStatus(card, info, scanned);
      });
      if (scanned) {
        Object.entries(lastMatches).forEach(([id, info]) => {
          if (hasLocalPathInfo(info)) localIdSet.add(String(id));
        });
        syncCurrentPageLocalMark(cards, lastMatches);
      } else {
        paintPaginationLocalMarks();
      }
      await applyOrdinalsToCards(cards);
      await refreshSelectionCount();
    } catch (err) {
      // Compact still paints from scan cache when Helper lookup fails briefly.
      if (scanned) {
        cards.forEach((card) => {
          const cached = lastMatches[card.videoId] || lastScanMatches[card.videoId];
          if (hasLocalPathInfo(cached)) renderStatus(card, { ...cached, exists: true }, true);
        });
      } else {
        cards.forEach((card) => renderStatus(card, null, false));
      }
      setError(`Helper unavailable: ${err.message}`);
    }
  }

  async function refreshQueue() {
    try {
      const st = await send('QUEUE_STATUS');
      applyDownloadProgress(st);
      const failed = (st.items || []).find(
        (x) => x.status === 'failed' && x.error && !/cancelled|interrupted/i.test(x.error),
      );
      if (failed) {
        setError(`Failed: ${failed.title || failed.videoId} — ${failed.error || ''}`);
      }
      // Completed/exists imports update Helper media; merge into localIdSet without a full Scan.
      let grewLocal = false;
      (st.items || []).forEach((x) => {
        const status = String(x?.status || '');
        if (!/^(completed|skipped|exists)$/.test(status)) return;
        const id = String(x.videoId || '').trim();
        if (!id) return;
        if (!localIdSet.has(id)) grewLocal = true;
        localIdSet.add(id);
      });
      if (grewLocal) {
        scanned = true;
        invalidateFrozenViewIfDiskChanged();
      }
      await healQueueAtLowWater(st);
      await refreshSelectionCount();
    } catch (err) {
      downloadProgressLabel = 'idle';
      updateToolbarLabels();
      setLiveStatus('Helper offline');
    }
  }

  async function refreshSelectionCount(itemsMap) {
    let count;
    if (itemsMap) {
      count = Object.keys(itemsMap).length;
    } else {
      const sel = await send('SELECTION_GET');
      count = Object.keys(sel.items || {}).length;
    }
    selCountCached = count;
    const bar = qs(document, `.${NS}-toolbar`);
    if (bar) bar.dataset.selectedCount = String(count);
    updateToolbarLabels();
    return count;
  }

  function ensureToolbar() {
    const bar = ensureControls();
    // ensureControls may recreate the bar; always (re)wire so clicks never die.
    wireControls();
    return bar;
  }

  function wireFilterBar() {
    return wireControls();
  }

  function wireControls() {
    const bar = ensureControls();
    if (bar.dataset.wired === '1') {
      wirePageRangeInputs(bar);
      wireSeqRangeInputs(bar);
      wireDurationFilterInputs(bar);
      return bar;
    }
    bar.dataset.wired = '1';
    wirePageRangeInputs(bar);
    wireSeqRangeInputs(bar);
    wireDurationFilterInputs(bar);
    bar.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !bar.contains(btn)) return;
      const act = btn.dataset.act;
      if (act === 'filter-local') {
        filterState.localOn = !filterState.localOn;
        if (!filterState.localOn && !filterState.cloudOn) filterState.cloudOn = true;
        onMatchRuleEdited({ immediate: true });
      } else if (act === 'filter-cloud') {
        filterState.cloudOn = !filterState.cloudOn;
        if (!filterState.localOn && !filterState.cloudOn) filterState.localOn = true;
        onMatchRuleEdited({ immediate: true });
      } else if (act === 'filter-favorite') {
        filterState.favoriteOn = !filterState.favoriteOn;
        if (!filterState.favoriteOn && !filterState.playlistOn) filterState.playlistOn = true;
        onMatchRuleEdited({ immediate: true });
      } else if (act === 'filter-playlist') {
        filterState.playlistOn = !filterState.playlistOn;
        if (!filterState.favoriteOn && !filterState.playlistOn) filterState.favoriteOn = true;
        onMatchRuleEdited({ immediate: true });
      } else if (act === 'filter-futa') {
        filterState.futaOn = !filterState.futaOn;
        if (!filterState.futaOn && !filterState.straightOn) filterState.straightOn = true;
        onMatchRuleEdited({ immediate: true });
      } else if (act === 'filter-straight') {
        filterState.straightOn = !filterState.straightOn;
        if (!filterState.futaOn && !filterState.straightOn) filterState.futaOn = true;
        onMatchRuleEdited({ immediate: true });
      } else if (act === 'filter-apply') {
        if (viewButtonsLocked()) return;
        await applyLibraryFilter({ ensureIndex: true });
      } else if (act === 'filter-compact') {
        if (viewButtonsLocked()) return;
        await applyCompactMatchesView({ ensureIndex: true });
      } else if (act === 'filter-show-all') {
        if (viewButtonsLocked()) return;
        await showAllView();
      } else if (act === 'reset-toolbars') {
        await resetToolbars();
      } else if (act === 'compact-sort-field') {
        await applyCompactSortField(
          btn.dataset.sortField || defaultCompactSortKey().replace(/-asc$|-desc$/, ''),
        );
      } else if (act === 'toggle-toolbar-middle') {
        toggleToolbarMiddle();
      } else if (act === 'index-build') {
        try {
          await loadFavIndexCache();
          if (favIndexCache?.videos?.length) {
            await confirmRebuildIndex();
          } else {
            await buildFavIndex({ force: true, mode: 'full' });
          }
        } catch (err) {
          setError(`Index failed: ${err.message || String(err)}`);
        }
      } else if (act === 'index-sex') {
        await buildSexGroupsIndex();
      } else if (act === 'index-stop' || act === 'index-sex-stop') {
        await doStopIndexJob();
      } else if (act === 'renumber-stop') {
        await doStopRenumberJob();
      } else if (act === 'playlist-add') {
        await doAddToPlaylist();
      } else if (act === 'playlist-stop') {
        await doStopPlaylistAdd();
      } else if (act === 'scan') {
        await doScan();
      } else if (act === 'select-page') {
        await selectAllOnPage();
      } else if (act === 'select-pages') {
        await selectPageRangeFromInputs();
      } else if (act === 'select-seqs') {
        await selectSeqRangeFromInputs();
      } else if (act === 'select-matches') {
        await selectAllMatches();
      } else if (act === 'view-selected') {
        if (viewButtonsLocked()) return;
        await applySelectedCompactView();
      } else if (act === 'download') {
        await doDownloadSelected();
      } else if (act === 'rebuild-ordinals') {
        await doRebuildOrdinals();
      } else if (act === 'clear') {
        // Abort in-flight Page range before wiping store (loop checks this flag).
        selCollectCancel = true;
        selProgress = null;
        await send('SELECTION_CLEAR');
        ignoreMutationsUntil = Date.now() + 800;
        clearAllNativeSelectionOnPage();
        setError('');
        selCountCached = 0;
        updateToolbarLabels();
        await refreshSelectionCount({});
        await refreshQueue();
      } else if (act === 'stop') {
        await doStopDownloads();
      } else if (act === 'wake-queue') {
        await doWakeQueue();
      } else if (act === 'open-tasks') {
        openTaskQueueDialog();
      } else if (act === 'delete-favs') {
        await doDeleteSelected();
      } else if (act === 'prune-local') {
        await doPruneOrphanLocals();
      } else if (act === 'fav-add') {
        await doAddSelectedToFavorites();
      } else if (act === 'fav-add-stop') {
        await doStopFavAdd();
      }
    });
    if (!toolbarDocWired) {
      toolbarDocWired = true;
      document.addEventListener(
        'change',
        (e) => {
          const t = e.target;
          if (!(t instanceof HTMLInputElement)) return;
          if (
            t.matches(
              'input[data-action="select_all"], input.checkbox[name="delete[]"], input[name="delete[]"]',
            )
          ) {
            scheduleCaptureSelection();
          }
        },
        true,
      );
      document.addEventListener(
        'click',
        (e) => {
          const t = e.target;
          if (!(t instanceof Element)) return;
          if (
            t.closest(
              'input[data-action="select_all"], input.checkbox[name="delete[]"], input[name="delete[]"], .item.thumb .checkbox',
            )
          ) {
            scheduleCaptureSelection();
          }
        },
        true,
      );
    }
    return bar;
  }


  function wireCardClicks() {
    parseCards().forEach((card) => {
      ensurePickRail(card);
      if (card.el.dataset.hxyruleCheckBound) return;
      card.el.dataset.hxyruleCheckBound = '1';
      card.checkbox?.addEventListener('change', () => {
        syncPickVisual(card, isCardChecked(card));
        scheduleCaptureSelection();
      });
      card.checkbox?.addEventListener('click', scheduleCaptureSelection);
    });

    // Document-level capture survives AJAX / goToFavoritesPage innerHTML replaces.
    if (cardClickDelegateWired) return;
    cardClickDelegateWired = true;
    // Matches/Compact clones: fix donor href before Chrome reads linkUrl for
    // "Open link in new tab" / extension context menus.
    document.addEventListener(
      'contextmenu',
      (e) => {
        if (!compactViewActive) return;
        if (!(e.target instanceof Element)) return;
        const item = e.target.closest(
          `.item.thumb[data-hxyrule-compact="1"], .${NS}-compact-thumbs .item.thumb`,
        );
        if (!item) return;
        const id = thumbVideoIdFromEl(item);
        if (!/^\d+$/.test(id)) return;
        const detailUrl = detailUrlForVideoId(id);
        const popupUrl = popupUrlForVideoId(id);
        const link =
          e.target.closest('a[href]') ||
          qs(item, 'a.th.js-open-popup, a.th') ||
          qs(item, 'a[href*="/video/"]');
        if (link && item.contains(link)) {
          const href = link.getAttribute('href') || '';
          if (hrefVideoIdMismatch(href, id) || !href.includes(`/video/${id}/`)) {
            if (/\/popup-video\//i.test(href)) {
              link.setAttribute('href', popupUrl);
              link.href = popupUrl;
            } else {
              link.setAttribute('href', detailUrl);
              link.href = detailUrl;
            }
          }
        }
        qsa(item, 'a[href]').forEach((node) => {
          const href = node.getAttribute('href') || '';
          if (!hrefVideoIdMismatch(href, id)) return;
          if (/\/popup-video\//i.test(href)) {
            node.setAttribute('href', popupUrl);
            node.href = popupUrl;
          } else {
            node.setAttribute('href', detailUrl);
            node.href = detailUrl;
          }
        });
      },
      true,
    );
    document.addEventListener(
      'click',
      (e) => {
        // Online popup open: never start another card action through the shield.
        if (document.documentElement.classList.contains(`${NS}-online-playing`)) return;
        // Synthetic plain click from forceNativeOnlinePopup — let the site handle it.
        if (Date.now() < ignoreCardClickUntil) return;
        const card = cardFromClickTarget(e.target);
        if (!card) return;

        // Cmd/Ctrl+click: online play for local and non-local (hide toolbar + native popup).
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          beginOnlineFullscreen();
          forceNativeOnlinePopup(card);
          return;
        }

        const info = lastMatches[card.videoId];
        const knownLocal = !!(info?.exists || localIdSet.has(String(card.videoId)));
        if (!knownLocal) {
          // Compact clones never get live site fancybox handlers (cloneNode).
          // After list HTML replace, native handlers are also dead. In both
          // cases open via MAIN-world PAGE_OPEN_POPUP. On a fresh native
          // (non-compact) list, leave the click alone so KVS can handle it.
          beginOnlineFullscreen();
          if (compactViewActive || extensionOwnsPagination) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            forceNativeOnlinePopup(card);
          }
          return;
        }
        if (!(e.target instanceof Element) || !e.target.closest('.img, img, .wrap_image')) return;
        if (!config.localPreferPlayback) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        send('HELPER_OPEN', { videoId: card.videoId }).catch((err) => {
          setError(`Cannot open local video: ${err.message}`);
        });
      },
      true,
    );
  }

  function bindListObserver() {
    const list = listRoot();
    if (!list) return;
    if (list === observedList && listObserver) return;
    if (listObserver) {
      try { listObserver.disconnect(); } catch (_) {}
    }
    observedList = list;
    listObserver = new MutationObserver((mutations) => {
      const meaningful = mutations.some((m) => {
        if (m.type !== 'childList') return false;
        const nodes = [...m.addedNodes, ...m.removedNodes];
        return nodes.some((n) => {
          if (!(n instanceof Element)) return false;
          if (n.dataset?.hxyrule || n.classList?.contains(`${NS}-status`) || n.classList?.contains(`${NS}-toolbar`) || n.classList?.contains(`${NS}-filterbar`)) {
            return false;
          }
          return n.classList?.contains('item') || n.querySelector?.('.item.thumb');
        });
      });
      if (!meaningful) return;
      // Do not drop list replaces that happen inside ignoreMutationsUntil — that
      // left Show-all cards without seq prefixes after a full refresh (same
      // videoIds → pageWatch fingerprint unchanged, so no second decorate).
      const wait = Math.max(0, ignoreMutationsUntil - Date.now());
      clearTimeout(listObserver._t);
      listObserver._t = setTimeout(() => {
        onListChanged({ force: true, light: true }).catch(() => {});
      }, Math.max(250, wait + 50));
    });
    listObserver.observe(list, { childList: true, subtree: false });
  }

  function bindPaginationClicks() {
    // Document capture survives goToFavoritesPage innerHTML replaces.
    if (paginationDelegateWired) return;
    paginationDelegateWired = true;
    document.addEventListener(
      'click',
      (e) => {
        if (!(e.target instanceof Element)) return;
        if (!isFavoritesPage() && !isPlaylistDetailPage()) return;
        if (e.target.closest(`.${NS}-jumpbar, .jump_to, .${NS}-hide-native-jump`)) return;
        // Prefer the visible slot (moved into the toolbar) over a stale id query.
        const pag =
          e.target.closest(
            `.${NS}-pagination-slot, #list_videos_my_favourite_videos_pagination, [id$="_pagination"]`,
          ) ||
          listPaginationEl() ||
          qs(document, '#list_videos_my_favourite_videos_pagination');
        if (!pag || !pag.contains(e.target)) return;
        const item =
          e.target.closest('[data-hxyrule-page]') ||
          e.target.closest(
            '.pagination .item, .pagination .pager, .item, .pager, a[data-parameters], button[data-parameters]',
          );
        if (!item || !pag.contains(item)) return;
        const page = resolvePaginationClickPage(item);
        if (!page) return;

        // Always own navigation once the toolbar hosts pagination. Native
        // handlers die after Jump/seq HTML replaces; mixing both was flaky.
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        navigateOwnedPagination(page);
      },
      true,
    );
  }

  function startPageWatch() {
    if (pageWatchTimer) return;
    pageFinger = pageFingerprint();
    let pathFinger = `${activeLibraryPathname()}|${indexScopeKey()}`;
    pageWatchTimer = setInterval(() => {
      ensureToolbar();
      if (Date.now() < ignoreMutationsUntil) return;
      // Online play temporarily pushStates to /video/{id}/ — do not treat as navigation.
      if (document.documentElement.classList.contains(`${NS}-online-playing`)) {
        if (compactViewActive) ensureCompactPagerMounted();
        return;
      }
      if (isPlaylistDetailPage()) {
        const list = favoritesListEl();
        if (list) moveLargeNativePanelBelowCards(list);
      }
      if (compactViewActive) ensureCompactPagerMounted();
      const pathNext = `${activeLibraryPathname()}|${indexScopeKey()}`;
      if (pathNext !== pathFinger) {
        pathFinger = pathNext;
        clearSelectionIfLibraryChanged()
          .then(() => onListChanged({ force: true, light: true }))
          .then(() => resumeBackgroundJobsUi())
          .catch(() => {});
        return;
      }
      const next = pageFingerprint();
      if (next !== pageFinger) {
        pageFinger = next;
        onListChanged().catch(() => {});
      }
    }, 1000);
  }

  function pageFingerprint() {
    const cards = parseCards();
    const ids = cards.slice(0, 8).map((c) => c.videoId).join(',');
    return `${currentPageNumber()}|${cards.length}|${ids}`;
  }

  function listRoot() {
    if (compactViewActive) {
      return (
        qs(document, `.${NS}-compact-thumbs`) ||
        favoritesListEl() ||
        qs(document, '#list_videos_my_favourite_videos_items') ||
        qs(document, '.thumbs')
      );
    }
    return (
      favoritesListEl() ||
      qs(document, '#list_videos_my_favourite_videos_items') ||
      qs(document, '.thumbs')
    );
  }

  async function onListChanged({ force = false, light = false } = {}) {
    if (!force && Date.now() < ignoreMutationsUntil) return;
    await clearSelectionIfLibraryChanged();
    ensureToolbar();
    wireToolbar();
    wireFilterBar();
    bindListObserver();
    bindPaginationClicks();
    ensureJumpBar();
    layoutTopControls();
    wireCardClicks();
    paintPaginationLocalMarks();
    await refreshLookup();
    await restoreSelectionToPage(parseCards());
    applyFilterToCurrentPage();
    pageFinger = pageFingerprint();
    if (light) return;
    await refreshQueue();
    // Re-check only pagination-visible page numbers (not all 200+).
    if (scanned || localIdSet.size) scheduleEvaluateVisiblePages();
  }

  function bindPickToggle(rail, card) {
    if (rail.dataset.pickBound === '1') return;
    rail.dataset.pickBound = '1';
    rail.addEventListener('click', (e) => {
      if (e.target.closest(`.${NS}-path`)) return;
      if (card.el.classList.contains(`${NS}-filtered-out`)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const next = !isCardChecked(card);
      setCardChecked(card, next);
      scheduleCaptureSelection();
    });
    rail.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (card.el.classList.contains(`${NS}-filtered-out`)) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      rail.click();
    });
  }

  function placePickAndStatus(card) {
    const pick = qs(card.el, `.${NS}-pick`);
    const link = card.link;
    if (!pick || !link) return;
    // Title/meta may live under the link or as card siblings after prior moves.
    const title =
      qs(link, '.thumb_title') ||
      qs(card.el, `.${NS}-pick .thumb_title`) ||
      qs(card.el, '.thumb_title');
    const info =
      qs(link, '.thumb_info') ||
      qs(card.el, `.${NS}-pick .thumb_info`) ||
      qs(card.el, '.thumb_info');
    if (title && title.parentElement !== pick) pick.appendChild(title);
    if (info && info.parentElement !== pick) pick.appendChild(info);
    const status = qs(card.el, `.${NS}-status`) || qs(pick, `.${NS}-status`);
    if (status && status.parentElement !== pick) pick.appendChild(status);
    if (link.nextElementSibling !== pick) {
      link.insertAdjacentElement('afterend', pick);
    }
  }

  function syncPickVisual(card, on) {
    const picked = !!on;
    card.el.classList.toggle(`${NS}-picked`, picked);
    // Never toggle site `.selected` on the card — that CSS blows up thumb size.
    card.el.classList.remove('selected');
    const rail = qs(card.el, `.${NS}-pick`);
    if (rail) rail.classList.toggle('is-on', picked);
  }

  function setCardChecked(card, on) {
    if (on && card.el.classList.contains(`${NS}-filtered-out`)) return;
    if (!card.checkbox) {
      syncPickVisual(card, on);
      return;
    }
    card.checkbox.checked = !!on;
    if (on) card.checkbox.setAttribute('checked', 'checked');
    else card.checkbox.removeAttribute('checked');
    // Do not add site class `selected` on `.item.thumb` (causes giant cards).
    card.el.classList.remove('selected');
    syncPickVisual(card, on);
  }

  function isCardChecked(card) {
    const box = card.checkbox;
    if (box) {
      if (box.checked || box.matches(':checked')) return true;
      // Some skins mirror state on attributes/classes instead of .checked.
      if (box.getAttribute('checked') !== null && box.getAttribute('checked') !== 'false') return true;
      if (box.classList.contains('checked') || box.classList.contains('selected')) return true;
    }
    const el = card.el;
    if (!el) return false;
    if (el.classList.contains('selected') || el.classList.contains('checked') || el.classList.contains('active')) {
      return true;
    }
    if (el.getAttribute('data-selected') === 'true' || el.getAttribute('data-checked') === '1') return true;
    // Red custom checkbox widgets often mark a parent label/span.
    if (qs(el, '.checkbox.checked, .checkbox.selected, label.checked, .custom-checkbox.checked')) return true;
    return false;
  }

  async function captureNativeSelection() {
    const cards = parseCards();
    const page = currentPageNumber();
    const sel = await send('SELECTION_GET');
    const items = { ...(sel.items || {}) };
    const onPageIds = new Set(cards.map((c) => c.videoId));

    cards.forEach((card) => {
      if (isCardChecked(card)) {
        const entry = selectionBagEntryFromVideo(card, page);
        if (entry) items[card.videoId] = entry;
      }
    });

    // Remove only current-page ids that are no longer checked.
    for (const id of onPageIds) {
      const card = cards.find((c) => c.videoId === id);
      if (card && !isCardChecked(card)) {
        delete items[id];
      }
    }

    // Drop stale entries marked for this page but missing from DOM (page changed).
    Object.keys(items).forEach((id) => {
      if (items[id].favoritePage === page && !onPageIds.has(id) && cards.length > 0) {
        // Keep them: AJAX may briefly empty the list. Do not delete.
      }
    });

    await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
    await refreshSelectionCount(items);
    return items;
  }

  function clearNativeCardSelection(card) {
    const box = card.checkbox;
    if (box && (box.checked || box.matches(':checked'))) {
      try {
        box.click();
      } catch (_) {
        /* ignore */
      }
    }
    setCardChecked(card, false);
    const el = card.el;
    if (!el) return;
    el.classList.remove('selected', 'checked', 'active', `${NS}-picked`);
    el.removeAttribute('data-selected');
    el.removeAttribute('data-checked');
    qsa(el, 'label, .checkbox, .checkbox-container, .checkmark, .custom-checkbox, .custom-checkbox__label, .custom-checkbox__field').forEach((n) => {
      n.classList.remove('checked', 'selected', 'active');
    });
    syncPickVisual(card, false);
  }

  function clearAllNativeSelectionOnPage() {
    parseCards().forEach(clearNativeCardSelection);
    qsa(document, 'input[data-action="select_all"]').forEach((all) => {
      all.checked = false;
      all.removeAttribute('checked');
    });
  }

  async function selectAllOnPage() {
    setError('');
    const cards = parseCards().filter(
      (card) => !card.el.classList.contains(`${NS}-filtered-out`),
    );
    if (!cards.length) return;
    const allOn = cards.every((c) => isCardChecked(c));
    ignoreMutationsUntil = Date.now() + 400;
    cards.forEach((card) => setCardChecked(card, !allOn));
    await captureNativeSelection();
    updateToolbarLabels();
  }

  function navigateOwnedPagination(page) {
    const target = Number(page);
    if (!Number.isInteger(target) || target < 1) return;
    if (paginationNavBusy) {
      paginationNavQueued = target;
      return;
    }
    paginationNavBusy = true;
    paginationNavQueued = null;
    goToFavoritesPage(target)
      .catch((err) => setError(err?.message || String(err)))
      .finally(() => {
        paginationNavBusy = false;
        const queued = paginationNavQueued;
        paginationNavQueued = null;
        if (queued && queued !== currentPageNumber()) {
          navigateOwnedPagination(queued);
        }
      });
  }

  function resolvePaginationClickPage(item) {
    if (!item) return null;
    if (item.classList?.contains('jump_to') || item.closest?.('.jump_to')) return null;
    const markedHost = item.closest?.('[data-hxyrule-page]') || item;
    const marked = Number(markedHost?.dataset?.hxyrulePage || '');
    if (Number.isInteger(marked) && marked > 0) return marked;
    const shell = item.closest?.('.item, .pager') || item;
    // Next/prev data-parameters often overshoot (last+1). Prefer relative targets.
    if (isNextPrevControl(shell) || isNextPrevControl(item)) {
      const cur = currentPageNumber();
      const btn = resolvePageButton(shell);
      const identity = `${shell.className || ''} ${btn?.className || ''} ${shell.textContent || ''}`;
      if (/\bprev|previous|«|‹|←/i.test(identity)) return Math.max(1, cur - 1);
      if (/\bnext|»|›|→/i.test(identity)) return Math.min(maxPageNumber(), cur + 1);
    }
    const direct = pageNumberFromPagItem(shell) || pageNumberFromPagItem(item);
    if (direct) return direct;
    const raw =
      shell.getAttribute?.('data-parameters') ||
      item.getAttribute?.('data-parameters') ||
      qs(shell, '[data-parameters]')?.getAttribute('data-parameters') ||
      '';
    return parsePageFromParams(raw);
  }

  function selectionBagEntryFromVideo(v, fallbackPage = 0) {
    const id = String(v?.videoId || '');
    if (!id) return null;
    return {
      videoId: id,
      title: v.title || id,
      detailUrl: v.detailUrl || `https://rule34video.com/video/${id}/v/`,
      favoritePage: Number(v.favoritePage) || fallbackPage || 0,
      cardIndex: Number.isInteger(v.cardIndex) ? v.cardIndex : Number(v.cardIndex) || 0,
      durationSec: coerceDurationSec(v.durationSec),
      thumbUrl: normalizeThumbUrl(v.thumbUrl) || '',
      previewUrl: normalizeThumbUrl(v.previewUrl) || '',
    };
  }

  /**
   * Page range against Compact / Selected list (same paging as Jump / This page).
   * No network — slices compactMatchedItems in the current sort order.
   */
  async function collectCompactViewPages(start, end, items, baseCount) {
    const per = Math.max(1, compactPerPage());
    const pageCount = Math.max(1, end - start + 1);
    let expectedTotal = pageCount * per;
    let fetched = 0;
    selProgress = { base: baseCount, fetched: 0, total: expectedTotal };
    updateToolbarLabels();
    for (let page = start; page <= end; page += 1) {
      if (selCollectCancel) break;
      const batch = compactMatchedItems.slice((page - 1) * per, page * per);
      fetched += batch.length;
      if (page === start && batch.length > 0) {
        expectedTotal = pageCount * Math.max(per, batch.length);
      }
      batch.forEach((v) => {
        const entry = selectionBagEntryFromVideo(v, page);
        if (entry) items[entry.videoId] = entry;
      });
      selCountCached = Object.keys(items).length;
      selProgress = { base: baseCount, fetched, total: expectedTotal };
      updateToolbarLabels();
      await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
      if (selCollectCancel) {
        await send('SELECTION_CLEAR');
        clearAllNativeSelectionOnPage();
        break;
      }
      await restoreSelectionToPage(parseCards());
      if (selCollectCancel) {
        clearAllNativeSelectionOnPage();
        break;
      }
    }
    return { fetched, items };
  }

  /**
   * Page range against native list pages (All / Matches).
   * Matches view keeps only ids in the active matched set — same as This page
   * skipping filtered-out cards.
   */
  async function collectNativeViewPages(start, end, items, baseCount) {
    const matchOnly =
      filterState.active &&
      filterState.matchedIds instanceof Set &&
      filterState.matchedIds.size > 0;
    const pageCount = Math.max(1, end - start + 1);
    const perPage = Math.max(1, cardsPerPageEstimate());
    let expectedTotal = pageCount * perPage;
    let fetched = 0;
    selProgress = { base: baseCount, fetched: 0, total: expectedTotal };
    updateToolbarLabels();
    for (let page = start; page <= end; page += 1) {
      if (selCollectCancel) break;
      try {
        const data = await fetchListPage(page);
        if (selCollectCancel) break;
        const batch = data.items || [];
        let kept = 0;
        if (page === start && batch.length > 0) {
          stablePerPage = Math.max(stablePerPage || 0, batch.length);
          expectedTotal = pageCount * Math.max(stablePerPage, batch.length);
        }
        batch.forEach((it) => {
          const id = String(it?.videoId || '');
          if (!id) return;
          if (matchOnly && !filterState.matchedIds.has(id)) return;
          items[id] = it;
          kept += 1;
        });
        fetched += matchOnly ? kept : batch.length;
      } catch (err) {
        if (selCollectCancel) break;
        setError(`Select pages paused: ${err.message}`);
        await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
        await restoreSelectionToPage(parseCards());
        selProgress = null;
        await refreshSelectionCount(items);
        return { fetched, items, paused: true };
      }
      if (selCollectCancel) break;
      selCountCached = Object.keys(items).length;
      selProgress = { base: baseCount, fetched, total: expectedTotal };
      updateToolbarLabels();
      // Persist incrementally so selection survives if the tab is interrupted.
      await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
      // Clear may have raced during SET; wipe again so the loop cannot resurrect picks.
      if (selCollectCancel) {
        await send('SELECTION_CLEAR');
        clearAllNativeSelectionOnPage();
        break;
      }
      await restoreSelectionToPage(parseCards());
      if (selCollectCancel) {
        clearAllNativeSelectionOnPage();
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    return { fetched, items, paused: false };
  }

  async function collectPages(start, end) {
    if (selCollectRunning) {
      setError('Page range already running — click Clear to stop it first.');
      return;
    }
    setError('');
    selCollectRunning = true;
    selCollectCancel = false;
    try {
      const sel = await send('SELECTION_GET');
      if (selCollectCancel) {
        selProgress = null;
        updateToolbarLabels();
        return;
      }
      const items = { ...(sel.items || {}) };
      const baseCount = Object.keys(items).length;
      selCountCached = baseCount;
      // N + (a/b) = selection before range · videos fetched so far / expected in range.
      const result = compactViewActive
        ? await collectCompactViewPages(start, end, items, baseCount)
        : await collectNativeViewPages(start, end, items, baseCount);
      if (result?.paused) return;
      if (selCollectCancel) {
        selProgress = null;
        selCountCached = 0;
        updateToolbarLabels();
        await refreshSelectionCount({});
        return;
      }
      const n = Object.keys(items).length;
      const fetched = Number(result?.fetched) || 0;
      selProgress = null;
      await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
      if (selCollectCancel) {
        await send('SELECTION_CLEAR');
        clearAllNativeSelectionOnPage();
        selCountCached = 0;
        updateToolbarLabels();
        await refreshSelectionCount({});
        return;
      }
      await restoreSelectionToPage(parseCards());
      await refreshSelectionCount(items);
      if (!n) {
        setError(
          compactViewActive
            ? 'Select pages found 0 videos in the current View.'
            : 'Select pages found 0 videos. Reload the extension and retry; login or site AJAX params may have changed.',
        );
      } else if (fetched === 0) {
        const matchesView =
          !compactViewActive &&
          filterState.active &&
          filterState.matchedIds instanceof Set &&
          filterState.matchedIds.size > 0;
        setError(
          compactViewActive || matchesView
            ? 'Select pages matched 0 videos in that range for the current View.'
            : 'Select pages request succeeded but parsed 0 videos.',
        );
      }
    } finally {
      selCollectRunning = false;
      if (selCollectCancel) {
        selProgress = null;
        updateToolbarLabels();
      }
    }
  }

  function setFlash(msg) {
    if (statusFlashTimer) {
      clearTimeout(statusFlashTimer);
      statusFlashTimer = null;
    }
    statusFlash = String(msg || '').trim();
    statusFlashIsError = false;
    paintStatus();
    if (!statusFlash) return;
    statusFlashTimer = setTimeout(() => {
      statusFlashTimer = null;
      if (statusFlashIsError || !statusFlash) return;
      statusFlash = '';
      paintStatus();
    }, 2200);
  }

  function applyDownloadProgress(st) {
    if (!st || typeof st !== 'object') return;
    if (st.downloadSession && typeof st.downloadSession === 'object') {
      dlSession = {
        active: !!st.downloadSession.active,
        total: Math.max(0, Number(st.downloadSession.total) || 0),
        baselineCompleted: Math.max(0, Number(st.downloadSession.baselineCompleted) || 0),
      };
    }
    const active = Number(st.activeCount || 0);
    const progress = String(st.downloadProgress || '').trim();
    if (progress && progress !== 'idle') {
      downloadProgressLabel = progress;
    } else if (active > 0) {
      // Legacy SW without downloadProgress: exclude cancelled rows.
      const completed = Number(st.completed || 0);
      const cancelled = Number(st.cancelled || 0);
      const totalRows = Number(st.total || 0);
      const denom = Math.max(1, totalRows > 0 ? totalRows - cancelled : active + completed);
      downloadProgressLabel = `${Math.max(0, Math.min(completed, denom))}/${denom}`;
    } else {
      downloadProgressLabel = 'idle';
      dlSession = { active: false, total: 0, baselineCompleted: 0 };
    }
    updateToolbarLabels();
    if (downloadProgressLabel && downloadProgressLabel !== 'idle') {
      setLiveStatus(`Downloading (${downloadProgressLabel})`);
    } else if (active > 0) {
      setLiveStatus(`Queue active · ${active}`);
    } else {
      setLiveStatus('Ready');
    }
  }

  async function healQueueAtLowWater(st) {
    const counts = st.counts || {};
    const downloading = Number(counts.downloading || 0);
    const pending = Number(counts.pending || 0) + Number(counts.waiting || 0);
    const hasRemaining = pending > 0;

    if (!hasRemaining || downloading >= QUEUE_REFILL_TARGET) {
      queueLowWaterPolls = 0;
      return;
    }
    queueLowWaterPolls += 1;
    if (queueLowWaterPolls < QUEUE_WATCHDOG_POLLS || queueWatchdogInFlight) return;

    const now = Date.now();
    if (now - queueWatchdogLastRecoveryAt < QUEUE_WATCHDOG_COOLDOWN_MS) return;
    queueLowWaterPolls = 0;
    queueWatchdogLastRecoveryAt = now;
    queueWatchdogInFlight = true;
    try {
      if (pending > 0 && !st.paused) {
        await send('START_QUEUE_WORKER');
      }
    } finally {
      queueWatchdogInFlight = false;
    }
  }

  function hasLocalPathInfo(info) {
    if (!info || info.exists === false) return false;
    // Scan cache omits `exists`; relative/absolute/display path is enough.
    return !!(info.exists || info.relativePath || info.absolutePath || info.displayPath);
  }

  async function doStopDownloads() {
    setError('');
    try {
      const st = await send('QUEUE_STOP');
      applyDownloadProgress(st || { activeCount: 0, downloadProgress: 'idle' });
      await refreshQueue();
    } catch (err) {
      setError(`Stop failed: ${err.message}`);
    }
  }

  async function doWakeQueue() {
    const btn = qs(document, `.${NS}-controls [data-act="wake-queue"]`);
    setError('');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Waking…';
    }
    try {
      const st = await send('QUEUE_WAKE');
      queueLowWaterPolls = 0;
      queueWatchdogLastRecoveryAt = Date.now();
      await refreshQueue();
      setFlash('Queue wake succeeded');
    } catch (err) {
      setError(`Wake queue failed: ${err.message || String(err)}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Wake queue';
      }
    }
  }

  async function doStopFavAdd() {
    if (!favAddRunning) return;
    favAddCancel = true;
    updateToolbarLabels();
    try {
      await send('FAV_ADD_JOB_STOP');
      setLiveStatus('Stopping Add to Favorites…');
      startFavAddStatusPoll();
      await waitForFavAddJob();
    } catch (err) {
      setError(`Stop Add to Favorites failed: ${err.message || String(err)}`);
    } finally {
      favAddRunning = false;
      favAddCancel = false;
      favAddProgressLabel = '';
      updateToolbarLabels();
    }
  }

  async function doAddSelectedToFavorites() {
    if (favAddRunning) return;
    favAddRunning = true;
    favAddCancel = false;
    favAddProgressLabel = '';
    setError('');
    updateToolbarLabels();
    try {
      const existing = await send('FAV_ADD_JOB_STATUS');
      if (existing && (existing.status === 'running' || existing.status === 'stopping')) {
        applyFavAddJobProgress(existing);
        startFavAddStatusPoll();
        await waitForFavAddJob();
        return;
      }

      const itemsMap = await captureNativeSelection();
      if (favAddCancel) {
        setFlash('Add to Favorites stopped');
        return;
      }
      const ids = Object.keys(itemsMap || {});
      if (!ids.length) throw new Error('Select videos first (pick rail / This page).');
      const selItems = selectionItemsForIds(itemsMap, ids);
      const items = {};
      selItems.forEach((it) => {
        items[String(it.videoId)] = it;
      });
      const st = await send('FAV_ADD_JOB_START', {
        videoIds: ids,
        items,
        sourceScope: indexScopeKey(),
      });
      applyFavAddJobProgress(st);
      startFavAddStatusPoll();
      await waitForFavAddJob();
    } catch (err) {
      setError(`Favorites failed: ${err.message || String(err)}`);
    } finally {
      try {
        const st = await send('FAV_ADD_JOB_STATUS');
        if (st && (st.status === 'running' || st.status === 'stopping')) {
          favAddRunning = true;
          applyFavAddJobProgress(st);
          startFavAddStatusPoll();
        } else {
          favAddRunning = false;
          favAddCancel = false;
          favAddProgressLabel = '';
        }
      } catch (_) {
        favAddRunning = false;
        favAddCancel = false;
        favAddProgressLabel = '';
      }
      updateToolbarLabels();
    }
  }


  async function doRebuildOrdinals() {
    // One global ordinals table: only Favorites order may replace it.
    if (!isFavoritesPage()) {
      setError('Renumber is only available on Favorites (global sequence).');
      return;
    }
    try {
      let st = await send('RENUMBER_JOB_STATUS');
      if (st?.status === 'running' || st?.status === 'stopping') {
        rebuildRunning = true;
        applyRenumberJobProgress(st);
        updateToolbarLabels();
        startRenumberStatusPoll();
        await waitForRenumberJob();
        return;
      }
      const maxPage = maxPageNumber();
      setError('');
      try {
        const health = await send('HELPER_HEALTH');
        applyVideoRootHealth(health);
      } catch (_) {
        /* RENUMBER_JOB_START / Helper surfaces the real error. */
      }
      st = await send('RENUMBER_JOB_START', { maxPage });
      rebuildRunning = true;
      applyRenumberJobProgress(st);
      updateToolbarLabels();
      startRenumberStatusPoll();
      const finalSt = await waitForRenumberJob();
      stopRenumberPoll();
      if (finalSt?.status === 'error') {
        throw new Error(finalSt.error || 'renumber failed');
      }
      if (finalSt?.status === 'stopped') {
        lastRenumberStats = null;
      }
    } catch (err) {
      setError(`Renumber failed: ${err.message || String(err)}`);
    } finally {
      rebuildRunning = false;
      renumberProgressLabel = '';
      stopRenumberPoll();
      updateToolbarLabels();
      resumeRenumberJobUiIfNeeded().catch(() => {});
    }
  }

  async function doPruneOrphanLocals() {
    if (pruneRunning) return;
    if (!isFavoritesPage()) {
      setError('Prune local is only available on Favorites (compares disk to Favorites index).');
      return;
    }
    pruneRunning = true;
    setError('');
    const btn = qs(document, `.${NS}-controls [data-act="prune-local"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Checking index…';
    }
    try {
      const items = await collectOrphanLocalItems();
      if (btn) btn.textContent = 'Scanning…';
      updateToolbarLabels();
      if (!items.length) {
        setError('');
        if (btn) {
          btn.textContent = 'No orphans';
          await new Promise((r) => setTimeout(r, 1000));
        }
        return;
      }
      if (btn) btn.textContent = 'Prune local';
      const selected = await showOrphanLocalModal(items);
      if (!selected || !selected.length) return;
      const ok = await confirmModal({
        title: 'Delete local items?',
        body: [
          `Permanently delete ${selected.length} item(s) from the local root?`,
          'Only complete favorites-matched videos are excluded from this list.',
          'Folders are deleted recursively (may include kept videos inside). This cannot be undone.',
        ].join('\n'),
        okLabel: 'Delete',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      if (btn) btn.textContent = `Deleting ${selected.length}…`;
      // Helper accepts up to 500 paths per call.
      const deleted = [];
      const failed = [];
      for (let i = 0; i < selected.length; i += 500) {
        const chunk = selected.slice(i, i + 500);
        const result = await send('HELPER_DELETE_PATHS', { relativePaths: chunk });
        if (Array.isArray(result?.deleted)) deleted.push(...result.deleted);
        if (Array.isArray(result?.failed)) failed.push(...result.failed);
      }
      const deletedIds = new Set(
        deleted.map((d) => (d.videoId != null ? String(d.videoId) : '')).filter(Boolean),
      );
      deletedIds.forEach((id) => {
        localIdSet.delete(id);
        if (lastScanMatches && lastScanMatches[id]) delete lastScanMatches[id];
        if (lastMatches && lastMatches[id]) delete lastMatches[id];
      });
      scanMatched = localIdSet.size;
      parseCards().forEach((card) => {
        if (deletedIds.has(String(card.videoId))) {
          renderStatus(card, { exists: false }, true);
        }
      });
      if (failed.length && !deleted.length) {
        throw new Error(failed.slice(0, 3).map((f) => f.error || 'failed').join('; '));
      }
      if (failed.length) {
        setError(`Deleted ${deleted.length}, failed ${failed.length}`);
      } else {
        setError('');
        if (btn) {
          btn.textContent = `Deleted ${deleted.length}`;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch (err) {
      setError(`Prune local failed: ${err.message || String(err)}`);
    } finally {
      pruneRunning = false;
      updateToolbarLabels();
    }
  }

  function selectPlaylistUrl() {
    const btn = findNativeMoveButton();
    const href =
      btn?.getAttribute?.('data-href') ||
      btn?.getAttribute?.('href') ||
      qs(document, '[data-href*="select-playlist"]')?.getAttribute('data-href') ||
      'https://rule34video.com/select-playlist/';
    if (href.startsWith('/')) return `https://rule34video.com${href}`;
    if (href.startsWith('http')) return href;
    return 'https://rule34video.com/select-playlist/';
  }

  function showPlaylistModal(playlists) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = `${NS}-modal-backdrop`;
      backdrop.dataset.hxyrule = '1';
      const modal = document.createElement('div');
      modal.className = `${NS}-modal`;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const h3 = document.createElement('h3');
      h3.textContent = 'Add to site playlist';
      const list = document.createElement('div');
      list.className = `${NS}-playlist-list`;
      const valid = (playlists || []).filter((p) => isValidPlaylistId(p.id));
      if (!valid.length) {
        const empty = document.createElement('p');
        empty.style.cssText = 'margin:0;font-size:12px;color:#cfd6dd';
        empty.textContent = 'No playlists auto-detected.';
        list.appendChild(empty);
      } else {
        valid.forEach((p, i) => {
          const lab = document.createElement('label');
          lab.className = `${NS}-playlist-option`;
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.name = `${NS}-playlist`;
          input.value = String(p.id);
          if (i === 0) {
            input.checked = true;
            lab.classList.add('is-selected');
          }
          const span = document.createElement('span');
          span.textContent = formatPlaylistOptionLabel(p);
          lab.appendChild(input);
          lab.appendChild(span);
          input.addEventListener('change', () => {
            lab.classList.toggle('is-selected', input.checked);
          });
          list.appendChild(lab);
        });
      }
      const actions = document.createElement('div');
      actions.className = `${NS}-modal__actions`;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = `${NS}-btn`;
      cancel.dataset.act = 'cancel';
      cancel.textContent = 'Cancel';
      const moveBtn = document.createElement('button');
      moveBtn.type = 'button';
      moveBtn.className = `${NS}-btn`;
      moveBtn.dataset.act = 'move';
      moveBtn.textContent = 'Move (remove from favorites)';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = `${NS}-btn ${NS}-btn--pink`;
      saveBtn.dataset.act = 'save';
      saveBtn.textContent = 'Move (keep favorites)';
      actions.appendChild(cancel);
      actions.appendChild(moveBtn);
      actions.appendChild(saveBtn);
      modal.appendChild(h3);
      modal.appendChild(list);
      modal.appendChild(actions);
      backdrop.appendChild(modal);
      const pickIds = () => {
        const ids = [];
        const seen = new Set();
        const add = (raw) => {
          const id = normalizePlaylistId(raw);
          if (!id || seen.has(id)) return;
          seen.add(id);
          ids.push(id);
        };
        qsa(backdrop, `input[name="${NS}-playlist"]:checked`).forEach((inp) => add(inp.value));
        return ids;
      };
      const close = (val) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(val);
      };
      const finish = (mode) => {
        const playlistIds = pickIds();
        if (!playlistIds.length) {
          setError('Select a playlist first');
          return null;
        }
        return { playlistIds, playlistId: playlistIds[0], mode };
      };
      const confirmRemoveFromFav = async () => {
        const picked = finish('move');
        if (!picked) return;
        const ok = await confirmModal({
          title: 'Remove from favorites?',
          body:
            'Add selected videos to the playlist and remove them from favorites.\nThis cannot be undone here.',
          okLabel: 'Remove from favorites',
          cancelLabel: 'Cancel',
          danger: true,
        });
        if (!ok) return;
        close(picked);
      };
      const onKey = (e) => {
        // Stacked confirm (remove-from-fav) owns Escape/Enter while open.
        if (qs(document, `.${NS}-modal-backdrop--stack`)) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const picked = finish('save');
          if (picked) close(picked);
        }
      };
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', (e) => {
        const act = e.target?.dataset?.act;
        if (e.target === backdrop || act === 'cancel') close(null);
        else if (act === 'save') {
          const picked = finish('save');
          if (picked) close(picked);
        } else if (act === 'move') {
          void confirmRemoveFromFav();
        }
      });
      document.body.appendChild(backdrop);
      if (valid.length) saveBtn.focus();
      else cancel.focus();
    });
  }

  function showOrphanLocalModal(items) {
    return new Promise((resolve) => {
      const { roots, nodes } = buildOrphanForest(items);
      const expanded = new Set();
      const backdrop = document.createElement('div');
      backdrop.className = `${NS}-modal-backdrop`;
      backdrop.dataset.hxyrule = '1';
      const modal = document.createElement('div');
      modal.className = `${NS}-modal ${NS}-modal--orphan`;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const h3 = document.createElement('h3');
      h3.textContent = 'Not in favorites';
      const list = document.createElement('div');
      list.className = `${NS}-playlist-list ${NS}-orphan-list`;

      const syncSelected = (lab, input) => {
        lab.classList.toggle('is-selected', !!input.checked);
      };

      const isRowVisible = (rel) => {
        let p = rel;
        while (true) {
          const i = p.lastIndexOf('/');
          if (i < 0) return true;
          const parent = p.slice(0, i);
          if (!expanded.has(parent)) return false;
          p = parent;
        }
      };

      const syncVisibility = () => {
        qsa(list, `.${NS}-orphan-row`).forEach((row) => {
          const rel = row.dataset.path || '';
          row.hidden = !isRowVisible(rel);
          const expandBtn = qs(row, `[data-act="expand-path"]`);
          if (!expandBtn) return;
          setOrphanExpandLabel(expandBtn, expanded.has(rel));
        });
      };

      const makeRow = (node, depth) => {
        const labelText = orphanItemLabel(node);
        const row = document.createElement('div');
        row.className = `${NS}-orphan-row`;
        row.dataset.path = node.relativePath;
        row.dataset.depth = String(depth);
        row.style.setProperty('--orphan-depth', String(depth));
        const lab = document.createElement('label');
        lab.className = `${NS}-playlist-option`;
        if (node.kind === 'dir') lab.classList.add(`${NS}-orphan-dir`);
        lab.title = node.relativePath + (node.kind === 'dir' ? '/' : '');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = `${NS}-orphan`;
        input.value = node.relativePath;
        const span = document.createElement('span');
        span.textContent = labelText;
        lab.appendChild(input);
        lab.appendChild(span);
        input.addEventListener('change', () => syncSelected(lab, input));
        const revealBtn = document.createElement('button');
        revealBtn.type = 'button';
        revealBtn.className = `${NS}-btn ${NS}-btn--ghost ${NS}-orphan-open`;
        revealBtn.dataset.act = 'reveal-path';
        revealBtn.dataset.path = node.relativePath;
        revealBtn.textContent = 'Open';
        revealBtn.title = 'Reveal in Finder (highlighted)';
        row.appendChild(lab);
        row.appendChild(revealBtn);
        if (node.kind === 'dir' && node.children.length) {
          const expandBtn = document.createElement('button');
          expandBtn.type = 'button';
          expandBtn.className = `${NS}-btn ${NS}-btn--ghost ${NS}-orphan-open`;
          expandBtn.dataset.act = 'expand-path';
          expandBtn.dataset.path = node.relativePath;
          setOrphanExpandLabel(expandBtn, false);
          row.appendChild(expandBtn);
        }
        return row;
      };

      const walkAppend = (node, depth) => {
        list.appendChild(makeRow(node, depth));
        node.children.forEach((child) => walkAppend(child, depth + 1));
      };
      roots.forEach((r) => walkAppend(r, 0));
      syncVisibility();

      const actions = document.createElement('div');
      actions.className = `${NS}-modal__actions ${NS}-orphan-actions`;
      const selectAll = document.createElement('button');
      selectAll.type = 'button';
      selectAll.className = `${NS}-btn ${NS}-btn--ghost`;
      selectAll.dataset.act = 'select-all';
      selectAll.textContent = 'Select all';
      const selectNone = document.createElement('button');
      selectNone.type = 'button';
      selectNone.className = `${NS}-btn ${NS}-btn--ghost`;
      selectNone.dataset.act = 'select-none';
      selectNone.textContent = 'Select none';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = `${NS}-btn`;
      cancel.dataset.act = 'cancel';
      cancel.textContent = 'Cancel';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = `${NS}-btn ${NS}-btn--danger`;
      delBtn.dataset.act = 'delete';
      delBtn.textContent = 'Delete selected';
      actions.appendChild(selectAll);
      actions.appendChild(selectNone);
      actions.appendChild(delBtn);
      actions.appendChild(cancel);
      modal.appendChild(h3);
      modal.appendChild(list);
      modal.appendChild(actions);
      backdrop.appendChild(modal);

      const pickedPaths = () =>
        qsa(backdrop, `input[name="${NS}-orphan"]:checked`).map((inp) => String(inp.value));
      const setAll = (on) => {
        qsa(backdrop, `input[name="${NS}-orphan"]`).forEach((inp) => {
          inp.checked = !!on;
          syncSelected(inp.closest('label'), inp);
        });
      };
      const close = (val) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
        }
      };
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', async (e) => {
        if (e.target === backdrop) {
          close(null);
          return;
        }
        const actEl = e.target?.closest?.('[data-act]');
        if (!actEl || !backdrop.contains(actEl)) return;
        const act = actEl.dataset.act;
        if (act === 'cancel') close(null);
        else if (act === 'select-all') setAll(true);
        else if (act === 'select-none') setAll(false);
        else if (act === 'expand-path') {
          e.preventDefault();
          e.stopPropagation();
          const rel = String(actEl.dataset.path || '');
          if (!rel) return;
          if (expanded.has(rel)) expanded.delete(rel);
          else expanded.add(rel);
          syncVisibility();
        } else if (act === 'reveal-path') {
          e.preventDefault();
          e.stopPropagation();
          const rel = String(actEl.dataset.path || '');
          if (!rel) return;
          try {
            await send('HELPER_REVEAL_PATH', { relativePath: rel });
          } catch (err) {
            setError(`Open failed: ${err.message || String(err)}`);
          }
        } else if (act === 'delete') {
          const paths = pickedPaths();
          if (!paths.length) {
            setError('Select at least one item to delete');
            return;
          }
          close(paths);
        }
      });
      document.body.appendChild(backdrop);
      delBtn.focus();
    });
  }

  async function collectOrphanLocalItems() {
    // Destructive: same freshness gate as Show matches for the Favorites index.
    const liveTotal = detectFavoritesTotal();
    await loadFavIndexCache();
    const indexed = favIndexCache?.videos?.length || 0;
    if (!indexed || favoritesIndexDirty || listIndexDirty || indexCountDrifted(liveTotal, indexed)) {
      await buildFavIndex({ force: true });
      favoritesIndexDirty = false;
      listIndexDirty = false;
    }
    const favSet = await ensureMyFavIdSet({ force: true });
    if (!favSet.size) {
      throw new Error('Build index for My Favorites first (Act → Build index on Favorites).');
    }
    try {
      const health = await send('HELPER_HEALTH');
      applyVideoRootHealth(health);
    } catch (_) {
      /* LIST_ORPHANS surfaces Helper errors. */
    }
    const result = await send('HELPER_LIST_ORPHANS', {
      keepVideoIds: Array.from(favSet),
    });
    const items = Array.isArray(result?.items) ? result.items : [];
    return items.map((it) => ({
      relativePath: String(it.relativePath || ''),
      kind: it.kind === 'dir' ? 'dir' : 'file',
      videoId: it.videoId ? String(it.videoId) : null,
      label: orphanItemLabel(it),
    })).filter((it) => it.relativePath);
  }

  function buildOrphanForest(items) {
    const nodes = new Map();
    (items || []).forEach((it) => {
      const rel = String(it?.relativePath || '').trim().replace(/\/+$/, '');
      if (!rel) return;
      nodes.set(rel, {
        relativePath: rel,
        kind: it.kind === 'dir' ? 'dir' : 'file',
        videoId: it.videoId ? String(it.videoId) : null,
        children: [],
      });
    });
    const roots = [];
    nodes.forEach((node) => {
      const idx = node.relativePath.lastIndexOf('/');
      const parent = idx >= 0 ? node.relativePath.slice(0, idx) : '';
      if (parent && nodes.has(parent)) nodes.get(parent).children.push(node);
      else roots.push(node);
    });
    const sortRec = (arr) => {
      arr.forEach((n) => sortRec(n.children));
      arr.sort((a, b) => {
        // Files → empty folders → non-empty folders.
        const rank = (n) => {
          if (n.kind !== 'dir') return 0;
          return n.children.length ? 2 : 1;
        };
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' });
      });
    };
    sortRec(roots);
    return { roots, nodes };
  }

  function orphanItemLabel(item) {
    const rel = String(item?.relativePath || item?.label || '')
      .trim()
      .replace(/\/+$/, '');
    if (!rel) return String(item?.videoId || '');
    const base = rel.split('/').pop() || rel;
    return item?.kind === 'dir' ? `${base}/` : base;
  }

  function setOrphanExpandLabel(btn, open) {
    if (!btn) return;
    btn.textContent = '';
    btn.appendChild(document.createTextNode('Open '));
    const mark = document.createElement('span');
    mark.className = `${NS}-orphan-caret`;
    mark.textContent = open ? '<' : '>';
    btn.appendChild(mark);
    btn.title = open ? 'Collapse in list' : 'Expand next level in list';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  async function deleteOneFromFavourites(videoId) {
    const id = String(videoId);
    const pid = isPlaylistDetailPage() ? currentPlaylistIdFromPath() : null;
    const variants = pid
      ? [
          { action: 'delete_from_favourites', video_id: id, fav_type: '10', playlist_id: pid },
          { action: 'delete_from_favourites', video_id: id, playlist_id: pid, fav_type: '10' },
        ]
      : [
          { action: 'delete_from_favourites', video_id: id, fav_type: '0', playlist_id: '0' },
          { action: 'delete_from_favourites', video_id: id, video_ids: [id], fav_type: '0' },
          { action: 'delete_from_favourites', video_id: id },
        ];
    const bases = [
      `https://rule34video.com/video/${id}/v/`,
      'https://rule34video.com/',
      String(location.href).split('#')[0],
    ];
    let lastDetail = '';
    for (const params of variants) {
      for (const base of bases) {
        const q = new URLSearchParams({ mode: 'async', format: 'json' });
        Object.entries(params).forEach(([k, v]) => {
          if (v == null) return;
          if (Array.isArray(v)) v.forEach((item) => q.append(`${k}[]`, String(item)));
          else q.set(k, String(v));
        });
        const url = `${base}${base.includes('?') ? '&' : '?'}${q.toString()}`;
        try {
          const res = await fetch(url, {
            credentials: 'include',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              Accept: 'application/json, text/javascript, */*;q=0.1',
            },
          });
          const raw = (await res.text()).trim();
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {
            lastDetail = `non-JSON HTTP ${res.status}`;
            continue;
          }
          if (String(json?.status) === 'success') return { ok: true };
          lastDetail =
            json?.errors?.[0]?.code ||
            json?.errors?.[0]?.message ||
            json?.message ||
            json?.status ||
            'unknown';
          if (String(lastDetail) === 'invalid_params') continue;
          if (String(json?.status) === 'failure') break;
        } catch (err) {
          lastDetail = String(err.message || err);
        }
      }
    }
    return { ok: false, detail: lastDetail || 'failed' };
  }

  async function contentAjaxDelete(videoIds) {
    const form = findMoveControlForm();
    const blockId =
      form?.getAttribute('data-block-id') ||
      (isPlaylistDetailPage()
        ? playlistBlockId()
        : 'list_videos_my_favourite_videos');
    const params = favoritesFormDataParameters();
    const href = String(location.href).split('#')[0];
    const encodings = ['brackets', 'plain'];
    let last = { ok: false, detail: 'no attempt', deleteCount: videoIds.length };
    for (const enc of encodings) {
      const q = new URLSearchParams();
      q.set('mode', 'async');
      q.set('format', 'json');
      q.set('function', 'get_block');
      q.set('block_id', blockId);
      Object.entries(params).forEach(([k, v]) => {
        if (v == null || v === '') return;
        q.set(k, String(v));
      });
      videoIds.forEach((id) => {
        if (enc === 'brackets') q.append('delete[]', String(id));
        else q.append('delete', String(id));
      });
      const url = `${href}${href.includes('?') ? '&' : '?'}${q.toString()}`;
      try {
        const res = await fetch(url, {
          credentials: 'include',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json, text/javascript, */*;q=0.1',
          },
        });
        const rawText = (await res.text()).trim();
        let json = null;
        try {
          json = JSON.parse(rawText);
        } catch (_) {
          last = { ok: false, detail: `non-JSON HTTP ${res.status}`, deleteCount: videoIds.length };
          continue;
        }
        last = {
          ok: String(json?.status) === 'success',
          detail: json?.errors?.[0]?.code || json?.status || 'unknown',
          deleteCount: videoIds.length,
          enc,
        };
        if (last.ok) return last;
      } catch (err) {
        last = { ok: false, detail: String(err.message || err), deleteCount: videoIds.length };
      }
    }
    return last;
  }

  function favoritesFormDataParameters() {
    const form = findFavoritesControlForm();
    const box = listBoxEl();
    const raw =
      form?.getAttribute('data-parameters') ||
      box?.getAttribute('data-parameters') ||
      qs(document, '#list_videos_my_favourite_videos')?.getAttribute('data-parameters') ||
      '';
    const params = {};
    String(raw)
      .split(';')
      .forEach((pair) => {
        const parts = pair.split(':');
        if (parts.length === 2) {
          try {
            params[parts[0]] = decodeURIComponent(parts[1]).replace(/\+/g, ' ');
          } catch (_) {
            params[parts[0]] = parts[1];
          }
        }
      });
    return params;
  }

  function findFavoritesControlForm() {
    const box = listBoxEl();
    return (
      (box && qs(box, 'form[data-controls]')) ||
      qs(document, '#list_videos_my_favourite_videos form[data-controls]') ||
      qs(document, 'form[data-controls][data-block-id]') ||
      (box && qs(box, 'form')) ||
      qs(document, '#list_videos_my_favourite_videos form') ||
      qs(document, 'form[data-block-id="list_videos_my_favourite_videos"]') ||
      box ||
      qs(document, '#list_videos_my_favourite_videos')
    );
  }

  function findMoveControlForm() {
    const btn = findNativeMoveButton();
    const box = listBoxEl();
    return (
      (btn && (btn.closest('form[data-controls]') || btn.closest('form'))) ||
      (box && qs(box, 'form[data-controls]')) ||
      qs(document, '#list_videos_my_favourite_videos form[data-controls]') ||
      qs(document, 'form[data-controls]') ||
      findFavoritesControlForm() ||
      box ||
      qs(document, '#list_videos_my_favourite_videos')
    );
  }

  function findNativeMoveButton() {
    const scope = listBoxEl() || qs(document, '#list_videos_my_favourite_videos') || document;
    return (
      qs(scope, '[data-action="move_multi"]') ||
      qs(scope, 'form[data-controls] [data-action="move_multi"]') ||
      qs(document, '[data-action="move_multi"]') ||
      qs(scope, '[data-action="move_to_playlist"]') ||
      qs(scope, '[data-action="add_to_playlist"]') ||
      qs(scope, 'input[value="Move to playlist"], input[value="Move to Playlist"], button[value="Move to playlist"]') ||
      qsa(scope, 'a[href*="select-playlist"], [data-href*="select-playlist"]').find(Boolean) ||
      null
    );
  }

  function injectDeleteIdsIntoControlForm(videoIds) {
    const form = findMoveControlForm();
    if (!form) throw new Error('favorites control form not found');
    clearInjectedDeletes(form);
    const ids = [...new Set((videoIds || []).map(String).filter((id) => /^\d+$/.test(id)))];
    ids.forEach((id) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'delete[]';
      input.value = id;
      input.checked = true;
      input.setAttribute('checked', 'checked');
      input.setAttribute(`data-${NS}-delete`, '1');
      input.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;';
      input.tabIndex = -1;
      form.appendChild(input);
    });
    try {
      form.setAttribute('data-selected-cnt', String(ids.length));
    } catch (_) {
      /* ignore */
    }
    return { form, ids };
  }

  function stopAllCompactPreviews() {
    qsa(document, `video.${NS}-compact-preview`).forEach((node) => {
      try {
        node.pause();
      } catch (_) {
        /* ignore */
      }
      node.remove();
    });
  }

  function isCompactPreviewVideo(video) {
    if (!video) return false;
    if (video.classList?.contains(`${NS}-compact-preview`)) return true;
    // Native/site trailers also live under .item.thumb; real player is in the popup.
    if (video.closest?.('.item.thumb, .hxyrule-compact-thumbs')) return true;
    return false;
  }

  function forceNativeOnlinePopup(card) {
    const videoId = String(card?.videoId || '');
    const href =
      detailUrlForVideoId(
        videoId,
        card?.link?.getAttribute('href') || card?.link?.href || card?.detailUrl || '',
      ) || '';
    if (!href && !videoId) return;
    ignoreCardClickUntil = Date.now() + 2500;
    send('PAGE_OPEN_POPUP', {
      href,
      videoId,
    })
      .then((result) => {
        if (result && result.ok === false) {
          setError(`Online play failed: ${result.reason || 'popup missing'}`);
        }
      })
      .catch((err) => {
        setError(`Online play failed: ${err.message || err}`);
      });
  }

  function finishOnlineFullscreen(session = onlinePlaybackSession, { keepFullscreen = false } = {}) {
    if (!session || session.finished) return;
    session.finished = true;
    if (session.timer) clearInterval(session.timer);
    session.observer?.disconnect();
    if (session.closeHandler) {
      document.removeEventListener('click', session.closeHandler, true);
    }
    if (session.escapeHandler) {
      document.removeEventListener('keydown', session.escapeHandler, true);
    }
    if (session.fullscreenWatch) {
      document.removeEventListener('fullscreenchange', session.fullscreenWatch, true);
      document.removeEventListener('webkitfullscreenchange', session.fullscreenWatch, true);
    }
    silenceOnlineMedia(session);
    clearOnlinePlayerMarks();
    if (!keepFullscreen) {
      removeOnlineBlocker();
      document.documentElement.classList.remove(`${NS}-online-playing`);
      // Close Fancybox in page world so a detached player cannot keep decoding audio.
      send('PAGE_CLOSE_POPUP', {}).catch(() => {});
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitFullscreenElement) {
          document.webkitExitFullscreen?.();
        }
      } catch (_) {
        /* window-state restoration below remains the fallback */
      }
    }
    if (onlinePlaybackSession === session) onlinePlaybackSession = null;
  }

  function bindFullscreenExitWatch(session) {
    if (session.fullscreenWatch) return;
    session.fullscreenWatch = () => {
      if (session.finished) return;
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fs && session.surfaceFullscreenPromoted) {
        // User (or player control) left fullscreen — do not auto-promote again.
        session.userExitedFullscreen = true;
        syncPlayerFullscreenUi(session.surface, false);
        const exitBtn = session.surface && qs(session.surface, `.${NS}-fs-exit`);
        if (exitBtn) exitBtn.hidden = true;
        return;
      }
      if (fs && session.surface && (fs === session.surface || session.surface.contains(fs) || fs.contains(session.surface))) {
        syncPlayerFullscreenUi(session.surface, true);
        ensureFsExitButton(session, session.surface);
      }
    };
    document.addEventListener('fullscreenchange', session.fullscreenWatch, true);
    document.addEventListener('webkitfullscreenchange', session.fullscreenWatch, true);
  }

  function ensureFsExitButton(session, surface) {
    if (!session || !surface?.isConnected) return null;
    let btn = qs(surface, `.${NS}-fs-exit`);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${NS}-fs-exit`;
      btn.dataset.hxyrule = '1';
      btn.setAttribute('aria-label', 'Exit fullscreen');
      btn.setAttribute('title', 'Exit fullscreen');
      btn.innerHTML =
        '<svg class="' +
        NS +
        '-fs-exit__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
        'stroke-linejoin="round" d="M12 3.2v8.6"/>' +
        '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
        'stroke-linejoin="round" d="M7.05 5.85a7.2 7.2 0 1 0 9.9 0"/>' +
        '</svg>';
      btn.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (session.finished) return;
          session.userExitedFullscreen = true;
          syncPlayerFullscreenUi(surface, false);
          btn.hidden = true;
          try {
            if (document.fullscreenElement) {
              document.exitFullscreen().catch(() => {});
            } else if (document.webkitFullscreenElement) {
              document.webkitExitFullscreen?.();
            }
          } catch (_) {
            /* stay in small window */
          }
        },
        true,
      );
    }
    // Only mount while actually fullscreen — never add a close control on the small popup.
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const inFs =
      !!fs && (fs === surface || surface.contains(fs) || fs.contains?.(surface));
    if (!inFs || session.userExitedFullscreen) {
      btn.hidden = true;
      if (btn.parentElement) btn.remove();
      return null;
    }
    if (btn.parentElement !== surface) surface.appendChild(btn);
    btn.hidden = false;
    return btn;
  }

  function isOnlinePopupPresent() {
    // Only well-known open modal shells. Do not match dormant .popup-holder /
    // .js-popup templates that stay in the page and would trap the toolbar.
    return qsa(
      document,
      '.fancybox-container, .fancybox-wrap, .fancybox-overlay, .fancybox-bg, ' +
        '.mfp-wrap, .mfp-bg, .mfp-container, .fancybox-slide--current',
    ).some((el) => {
      if (!el?.isConnected) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40;
    });
  }

  function visibleOnlineVideo() {
    const videos = qsa(document, 'video').filter((video) => isOnlineVideoVisible(video));
    if (!videos.length) return null;
    // Prefer the Fancybox/popup player when both a leftover thumb and popup exist.
    const inPopup = videos.find((video) =>
      video.closest(
        '.fancybox-wrap, .fancybox-container, .fancybox-inner, .mfp-wrap, .mfp-content, .popup-holder, .js-popup',
      ),
    );
    return inPopup || videos[0];
  }

  function onlineFullscreenTarget(surface, video) {
    if (!video) return surface;
    const host = video.closest(
      '.video-js, .flowplayer, .fp-player, .jwplayer, .plyr, .kt-player, .kt_player',
    );
    if (!host) return surface;
    const videoRect = video.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    if (
      hostRect.width - videoRect.width <= 200 &&
      hostRect.height - videoRect.height <= 220 &&
      hostRect.width * hostRect.height / Math.max(1, videoRect.width * videoRect.height) <= 2.2
    ) {
      return host;
    }
    return surface || host;
  }

  function onlineVideoReadyForFullscreen(video) {
    if (!video?.isConnected) return false;
    const src =
      video.currentSrc ||
      video.src ||
      qs(video, 'source[src]')?.getAttribute('src') ||
      '';
    if (!src) return false;
    // Allow blob: streams; reject obvious poster / thumb URLs.
    if (!/^blob:/i.test(src) && /placeholder|thumb|poster|blank|\.gif(\?|$)/i.test(src)) {
      return false;
    }
    const rect = video.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 110) return false;
    // HAVE_CURRENT_DATA or better, or already playing / enough buffered.
    return video.readyState >= 2 || !video.paused || (video.buffered?.length > 0);
  }

  function promoteSurfaceFullscreen(session, surface) {
    if (!session || session.finished || !surface?.isConnected) return;
    if (session.surfaceFullscreenPromoted || session.userExitedFullscreen) return;
    const request = surface.requestFullscreen || surface.webkitRequestFullscreen;
    if (!request) return;
    session.surfaceFullscreenPromoted = true;
    session.documentFullscreenRequested = true;
    const markUi = () => {
      if (session.finished || session.userExitedFullscreen) return;
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs && (fs === surface || surface.contains(fs) || fs.contains(surface))) {
        syncPlayerFullscreenUi(surface, true);
        ensureFsExitButton(session, surface);
      }
    };
    try {
      const pending = request.call(surface, { navigationUI: 'hide' });
      if (pending && typeof pending.then === 'function') {
        pending.then(markUi).catch(() => {
          /* Keep promoted=true so we do not retry in a loop against the user. */
        });
      } else {
        markUi();
      }
    } catch (_) {
      /* leave documentElement FS as the bridge */
    }
  }

  /** User F during online play: exit FS → small window, or re-enter from small window. */
  function toggleOnlineSurfaceFullscreen(session) {
    if (!session || session.finished) return;
    const surface = session.surface;
    if (!surface?.isConnected) return;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const inFs =
      !!fs && (fs === surface || surface.contains(fs) || fs.contains?.(surface));
    if (inFs) {
      session.userExitedFullscreen = true;
      syncPlayerFullscreenUi(surface, false);
      const exitBtn = qs(surface, `.${NS}-fs-exit`);
      if (exitBtn) {
        exitBtn.hidden = true;
        exitBtn.remove();
      }
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitFullscreenElement) {
          document.webkitExitFullscreen?.();
        }
      } catch (_) {
        /* stay in small window */
      }
      return;
    }
    // Explicit re-enter (auto-promote refuses after userExitedFullscreen).
    session.userExitedFullscreen = false;
    session.surfaceFullscreenPromoted = true;
    session.documentFullscreenRequested = true;
    const request = surface.requestFullscreen || surface.webkitRequestFullscreen;
    if (!request) return;
    const markUi = () => {
      if (session.finished || session.userExitedFullscreen) return;
      const cur = document.fullscreenElement || document.webkitFullscreenElement;
      if (cur && (cur === surface || surface.contains(cur) || cur.contains(surface))) {
        syncPlayerFullscreenUi(surface, true);
        ensureFsExitButton(session, surface);
      }
    };
    try {
      const pending = request.call(surface, { navigationUI: 'hide' });
      if (pending && typeof pending.then === 'function') {
        pending.then(markUi).catch(() => {});
      } else {
        markUi();
      }
    } catch (_) {
      /* ignore */
    }
  }

  function clearInjectedDeletes(form) {
    const root = form || document;
    qsa(root, `input[data-${NS}-delete="1"]`).forEach((el) => el.remove());
  }

  /**
   * KVS move_multi reads checked boxes from form[data-controls], but thumb
   * checkboxes live elsewhere — so inject hidden checked delete[] here.
   */

  function scrapePlaylistRadiosFromHtml(html) {
    const byId = new Map();
    const push = (id, title, videoCount) => {
      const pid = String(id || '').trim();
      if (!isValidPlaylistId(pid)) return;
      const clean = cleanPlaylistTitleText(title, pid);
      const nextTitle = clean || `Playlist ${pid}`;
      const countRaw = Number(videoCount);
      const nextCount = Number.isFinite(countRaw) && countRaw >= 0 ? countRaw : null;
      const prev = byId.get(pid);
      const betterTitle = !prev || playlistTitleScore(nextTitle, pid) > playlistTitleScore(prev.title, pid);
      const betterCount =
        nextCount != null && (prev?.videoCount == null || nextCount > Number(prev.videoCount || -1));
      if (!prev) {
        byId.set(pid, { id: pid, title: nextTitle, videoCount: nextCount });
      } else {
        byId.set(pid, {
          id: pid,
          title: betterTitle ? nextTitle : prev.title,
          videoCount: betterCount ? nextCount : prev.videoCount ?? nextCount,
        });
      }
    };
    const countFromText = (text) => {
      const m = String(text || '').match(/(\d[\d\s,]*)\s*videos?/i);
      if (!m) return null;
      const n = Number(String(m[1]).replace(/[\s,]/g, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
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
          item &&
          (item.querySelector('.title a, a.title, strong.title, .title, .playlist-title, .name') ||
            null);
        if (titleEl) title = titleEl.textContent || title;
        const count = countFromText(item?.textContent || label?.textContent || '');
        push(pid, title, count);
      });
      doc.querySelectorAll('[data-playlist-id]').forEach((el) => {
        const item = el.closest('.item, li, .playlist, tr') || el;
        push(
          el.getAttribute('data-playlist-id'),
          el.getAttribute('data-playlist-title') || el.textContent,
          countFromText(item.textContent),
        );
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
          (item && item.querySelector('.title a, a.title, strong.title, .title, .playlist-title, .name')) ||
          a;
        let title = (titleEl && titleEl.textContent) || '';
        if (!cleanPlaylistTitleText(title, pid) && m[2]) title = m[2];
        push(pid, title, countFromText(item?.textContent || a.parentElement?.textContent || ''));
      });
    } catch (_) {
      /* fall through to regex */
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
      push(m[1], m[0], countFromText(m[0]));
    }
    for (const m of src.matchAll(
      /name=["']playlist_id["'][^>]*value=["']([1-9]\d*)["'][^>]*>[\s\S]{0,120}?<\/label>/gi,
    )) {
      push(m[1], m[0], countFromText(m[0]));
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
    // "NAME ... 215 videos" near playlist id links
    for (const m of src.matchAll(
      /\/my\/playlists\/([1-9]\d*)\/[\s\S]{0,500}?(\d[\d\s,]*)\s*videos?/gi,
    )) {
      push(m[1], '', countFromText(`${m[2]} videos`));
    }
    return [...byId.values()];
  }

  async function loadSitePlaylists() {
    const attempts = [
      selectPlaylistUrl(),
      'https://rule34video.com/select-playlist/',
      'https://rule34video.com/my/playlists/',
      'https://rule34video.com/?mode=async&function=get_block&block_id=list_playlists_my_created_playlists',
      'https://rule34video.com/?mode=async&function=get_block&block_id=list_playlists_my_created_playlists&global=true',
    ];
    let lastErr = '';
    for (const u of attempts) {
      try {
        const res = await fetch(u, {
          credentials: 'include',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'text/html, */*;q=0.1',
          },
        });
        const html = await res.text();
        if (!res.ok || !html) {
          lastErr = `HTTP ${res.status} for ${u}`;
          continue;
        }
        if (/login-required|\/login\//i.test(html) && html.length < 8000) {
          lastErr = 'not logged in — open favorites while signed in';
          continue;
        }
        const list = scrapePlaylistRadiosFromHtml(html);
        if (list.length) return { playlists: list, sourceUrl: u };
        lastErr = `0 playlists in ${u}`;
      } catch (err) {
        lastErr = String(err.message || err);
      }
    }
    try {
      const listed = await send('SITE_PLAYLIST_LIST');
      if (listed.playlists?.length) return listed;
      if (listed.error) lastErr = String(listed.error);
    } catch (err) {
      lastErr = String(err.message || err);
    }
    throw new Error(lastErr || 'Could not load playlists');
  }

  /**
   * 1) Load playlists
   * 2) User picks Save (keep fav) or Move (leave fav); playlists are multi-select
   * 3) Hand work to background PLAYLIST_ADD job (survives refresh; Stop to cancel)
   */
  async function doStopPlaylistAdd() {
    if (!playlistRunning && !playlistModalAbort) return;
    playlistCancel = true;
    if (typeof playlistModalAbort === 'function') {
      try {
        playlistModalAbort();
      } catch (_) {
        /* ignore */
      }
    }
    try {
      const st = await send('PLAYLIST_ADD_JOB_STATUS');
      if (st && (st.status === 'running' || st.status === 'stopping')) {
        await send('PLAYLIST_ADD_JOB_STOP');
        setLiveStatus('Stopping playlist add…');
        playlistRunning = true;
        updateFilterBarLabels();
        startPlaylistAddStatusPoll();
        await waitForPlaylistAddJob();
      } else {
        setFlash('Playlist add stopped');
      }
    } catch (err) {
      setError(`Stop playlist add failed: ${err.message || String(err)}`);
    } finally {
      playlistCancel = false;
      if (!playlistModalAbort) {
        playlistRunning = false;
        playlistProgressLabel = '';
      }
      updateFilterBarLabels();
    }
  }

  async function doAddToPlaylist() {
    if (playlistRunning) return;
    playlistRunning = true;
    playlistCancel = false;
    playlistProgressLabel = '';
    setError('');
    updateFilterBarLabels();
    try {
      const existing = await send('PLAYLIST_ADD_JOB_STATUS');
      if (existing && (existing.status === 'running' || existing.status === 'stopping')) {
        applyPlaylistAddJobProgress(existing);
        startPlaylistAddStatusPoll();
        await waitForPlaylistAddJob();
        return;
      }

      const itemsMap = await captureNativeSelection();
      if (playlistCancel) {
        setFlash('Playlist add stopped');
        return;
      }
      const ids = Object.keys(itemsMap || {});
      if (!ids.length) {
        throw new Error('Nothing to add. Select videos first (This page / Page range / Seq range / All matches).');
      }

      playlistProgressLabel = 'loading…';
      updateFilterBarLabels();
      let playlists = [];
      try {
        const listed = await loadSitePlaylists();
        playlists = (listed.playlists || []).filter((p) => isValidPlaylistId(p.id));
      } catch (_) {
        playlists = [];
      }
      if (playlistCancel) {
        setFlash('Playlist add stopped');
        return;
      }

      const picked = await showPlaylistModal(playlists);
      if (playlistCancel || !picked) {
        if (playlistCancel) setFlash('Playlist add stopped');
        return;
      }
      const playlistIds = [
        ...new Set(
          (picked.playlistIds || [picked.playlistId])
            .map((x) => normalizePlaylistId(x))
            .filter((x) => isValidPlaylistId(x)),
        ),
      ];
      const mode = picked.mode === 'move' ? 'move' : 'save';
      if (!playlistIds.length) {
        throw new Error(
          'Invalid playlist id. Open /my/playlists/ and select a playlist from the list.',
        );
      }

      ignoreMutationsUntil = Date.now() + 3000;
      const want = new Set(ids.map(String));
      parseCards().forEach((card) => {
        if (want.has(String(card.videoId))) setCardChecked(card, true);
      });

      const selItems = selectionItemsForIds(itemsMap, ids);
      const items = {};
      selItems.forEach((it) => {
        items[String(it.videoId)] = it;
      });

      const st = await send('PLAYLIST_ADD_JOB_START', {
        playlistIds,
        videoIds: ids,
        mode,
        items,
        sourceScope: indexScopeKey(),
      });
      applyPlaylistAddJobProgress(st);
      startPlaylistAddStatusPoll();
      await waitForPlaylistAddJob();
    } catch (err) {
      clearInjectedDeletes();
      setError(`Playlist failed: ${err.message || String(err)}`);
    } finally {
      invalidatePlaylistMembershipCache();
      playlistModalAbort = null;
      if (!playlistRunning) {
        playlistCancel = false;
        playlistProgressLabel = '';
      }
      // If a job is still active (refresh-safe), keep Stop visible via poll.
      try {
        const st = await send('PLAYLIST_ADD_JOB_STATUS');
        if (st && (st.status === 'running' || st.status === 'stopping')) {
          playlistRunning = true;
          applyPlaylistAddJobProgress(st);
          startPlaylistAddStatusPoll();
        } else {
          playlistRunning = false;
          playlistCancel = false;
          playlistProgressLabel = '';
        }
      } catch (_) {
        playlistRunning = false;
        playlistCancel = false;
        playlistProgressLabel = '';
      }
      updateFilterBarLabels();
      hideNativeControls();
    }
  }


  /** My Favorites bucket: fav_type=0, playlist_id=0 (video page heart). */




  function setError(msg) {
    if (statusFlashTimer) {
      clearTimeout(statusFlashTimer);
      statusFlashTimer = null;
    }
    statusFlash = String(msg || '').trim();
    statusFlashIsError = !!statusFlash;
    paintStatus();
  }

  /** Non-error status chip flash (success / info). Auto-clears so live queue status returns. */



  function renderStatus(card, info, scannedState) {
    card.el.classList.add(`${NS}-card`);
    ensurePickRail(card);
    const pick = qs(card.el, `.${NS}-pick`);
    let box = qs(card.el, `.${NS}-status`) || (pick && qs(pick, `.${NS}-status`));

    // Only show a status line when the file exists on Mac (path only).
    if (!scannedState || !hasLocalPathInfo(info)) {
      if (box) box.remove();
      return;
    }

    if (!box) {
      box = document.createElement('div');
      box.className = `${NS}-status`;
      box.dataset.hxyrule = '1';
    }
    if (pick && box.parentElement !== pick) pick.appendChild(box);

    box.className = `${NS}-status ${NS}-status--local`;
    box.innerHTML = '';
    const a = document.createElement('a');
    a.className = `${NS}-path`;
    a.href = '#';
    const full = info.displayPath || info.relativePath || '';
    a.textContent = shortPathLabel(info);
    a.title = full || 'Reveal in Finder';
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await send('HELPER_REVEAL', { videoId: card.videoId });
      } catch (err) {
        setError(String(err.message || err));
      }
    });
    box.appendChild(a);
  }

  let lastMatches = {};
  let lastScanMatches = {};
  let scanned = false;
  let localIdSet = new Set();
  let fullLocalPages = new Set();
  let pageMissingCounts = new Map();
  let config = { localPreferPlayback: true };
  let ignoreMutationsUntil = 0;
  let selectionCaptureTimer = null;




  async function restoreSelectionToPage(cards) {
    // Only CHECK boxes that are in our cross-page set. Never uncheck native boxes
    // here — that was wiping the site's red checkmarks via MutationObserver races.
    const sel = await send('SELECTION_GET');
    const map = sel.items || {};
    ignoreMutationsUntil = Date.now() + 400;
    cards.forEach((card) => {
      ensurePickRail(card);
      if (!card.checkbox) return;
      if (map[card.videoId]) {
        setCardChecked(card, true);
      } else {
        syncPickVisual(card, isCardChecked(card));
      }
    });
    await refreshSelectionCount(map);
  }


  function scheduleCaptureSelection() {
    clearTimeout(selectionCaptureTimer);
    // Wait for the site's own checkbox handlers to finish first.
    selectionCaptureTimer = setTimeout(() => {
      captureNativeSelection().catch(() => {});
    }, 50);
  }





  function ensurePickRail(card) {
    card.el.classList.add(`${NS}-card`);
    if (card.checkbox) {
      card.checkbox.classList.add('hxyrule-hide-native');
      const wrap = card.checkbox.closest('label, .checkbox-container, .custom-checkbox');
      if (wrap && wrap !== card.el) wrap.classList.add('hxyrule-hide-native');
    }
    let rail = qs(card.el, `.${NS}-pick`);
    if (rail && rail.tagName === 'BUTTON') {
      const div = document.createElement('div');
      div.className = `${NS}-pick`;
      div.dataset.hxyrule = '1';
      while (rail.firstChild) div.appendChild(rail.firstChild);
      rail.replaceWith(div);
      rail = div;
    }
    if (!rail) {
      rail = document.createElement('div');
      rail.className = `${NS}-pick`;
      rail.dataset.hxyrule = '1';
    }
    rail.removeAttribute('title');
    rail.setAttribute('role', 'button');
    const filteredOut = card.el.classList.contains(`${NS}-filtered-out`);
    if (filteredOut) rail.setAttribute('aria-disabled', 'true');
    else rail.removeAttribute('aria-disabled');
    rail.tabIndex = filteredOut ? -1 : 0;
    if (card.checkbox) card.checkbox.disabled = filteredOut;
    bindPickToggle(rail, card);
    if (!rail.parentElement) {
      const link = card.link;
      if (link && link.parentElement === card.el) link.insertAdjacentElement('afterend', rail);
      else card.el.appendChild(rail);
    }
    placePickAndStatus(card);
    syncPickVisual(card, isCardChecked(card));
    return rail;
  }

  let onlinePlaybackSession = null;
  let cardClickDelegateWired = false;
  let ignoreCardClickUntil = 0;
  let paginationDelegateWired = false;
  let paginationNavBusy = false;
  let paginationNavQueued = null;
  /** True after we replace list/pagination HTML (site page handlers are dead). */
  let extensionOwnsPagination = false;

  /** Thumb hover previews — never treat these as the Fancybox online player. */



  function isOnlineVideoVisible(video) {
    if (!video?.isConnected) return false;
    if (isCompactPreviewVideo(video)) return false;
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return (
      rect.width > 80 && rect.height > 45 &&
      style.display !== 'none' && style.visibility !== 'hidden'
    );
  }

  /** Native online popup shell still mounted (video may be briefly swapping). */

  function onlinePlayerSurface(video) {
    if (!video) return null;
    const videoRect = video.getBoundingClientRect();
    const videoArea = Math.max(1, videoRect.width * videoRect.height);
    const isTightPlayerBox = (node) => {
      if (!node || node === document.body || node === document.documentElement) return false;
      const rect = node.getBoundingClientRect();
      const areaRatio = Math.max(1, rect.width * rect.height) / videoArea;
      return (
        areaRatio <= 1.55 &&
        rect.width - videoRect.width <= 140 &&
        rect.height - videoRect.height <= 120
      );
    };
    const known = video.closest(
      '.video-js, .flowplayer, .fp-player, .jwplayer, .plyr, .kt-player, ' +
      '.kt_player, .video-player, .video_player, .player-holder, .player_holder, ' +
      '.player-container, .player_container, [class~="player"]',
    );
    if (isTightPlayerBox(known)) return known;

    // Site skins sometimes use generated class names. Keep only ancestors
    // whose rendered box is still essentially the video/player box. The old
    // `contains a button` fallback climbed into the whole details modal and
    // pulled Info/Favorites/Comments/tags into fullscreen.
    let best = video;
    let node = video.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      if (!isTightPlayerBox(node)) break;
      best = node;
    }
    return best;
  }

  /**
   * Prefer the skin root for requestFullscreen so Flowplayer/VJS fullscreen
   * buttons share the same fullscreenElement (icon shows shrink, one click exits).
   * Still reject oversized detail modals.
   */

  function hidePopupWindowToggle() {
    const maxLeft = Math.max(0, window.innerWidth - 120);
    // Always hide Fancybox / popup close (X) while we own the online session.
    qsa(
      document,
      '[data-fancybox-close], .fancybox-close-small, .fancybox-close, .fancybox-button--close, ' +
        '.popup-close, .js-close-popup, [data-action="close-popup"]',
    ).forEach((el) => {
      el.classList.add(`${NS}-hide-window-toggle`);
    });
    const candidates = qsa(
      document,
      'button, a, [role="button"], [onclick], [data-action], ' +
        '[class*="resize" i], [class*="small" i], [class*="mini" i], ' +
        '[class*="window" i], [class*="popup" i], [class*="close" i]',
    );
    candidates.forEach((el) => {
      if (el.closest(`.${NS}-topstack`)) return;
      if (el.classList.contains(`${NS}-fs-exit`)) return;
      const rect = el.getBoundingClientRect();
      if (
        rect.width < 14 || rect.width > 120 ||
        rect.height < 14 || rect.height > 120 ||
        rect.top < 0 || rect.top > 160
      ) return;
      const identity = `${el.className || ''} ${el.id || ''} ${el.getAttribute('title') || ''} ` +
        `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`;
      const isClose = /close|dismiss|\u00d7|^\s*x\s*$/i.test(identity);
      const topRight = rect.left >= maxLeft;
      // Hide close X and window-size toggles in the popup chrome.
      if (isClose || topRight) {
        el.classList.add(`${NS}-hide-window-toggle`);
      }
    });
  }

  /** True when the popup video is a real player surface (not a poster/thumb flash). */

  function clearOnlinePlayerMarks() {
    qsa(document, `.${NS}-online-player`).forEach((el) => {
      el.classList.remove(`${NS}-online-player`);
    });
    qsa(document, `.${NS}-hide-window-toggle`).forEach((el) => {
      el.classList.remove(`${NS}-hide-window-toggle`);
    });
    qsa(document, `.${NS}-fs-exit`).forEach((el) => el.remove());
  }

  /** Power-icon control — exit fullscreen only; keep small-window online playback. */

  function removeOnlineBlocker() {
    qsa(document, `.${NS}-online-blocker`).forEach((el) => el.remove());
  }

  /** Cover the page immediately so background thumbs cannot be clicked. */
  function ensureOnlineBlocker(session) {
    let el = qs(document, `.${NS}-online-blocker`);
    if (!el) {
      el = document.createElement('div');
      el.className = `${NS}-online-blocker`;
      el.dataset.hxyrule = '1';
      el.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          // Same as native Fancybox backdrop: dismiss, do not open another video.
          // Always target the live session (keepFullscreen replace reuses this node).
          finishOnlineFullscreen(onlinePlaybackSession || session);
        },
        true,
      );
      (document.body || document.documentElement).appendChild(el);
    }
    session.blocker = el;
    return el;
  }

  /** Pause/mute popup media so toolbar restore cannot leave ghost audio. */
  function silenceOnlineMedia(session) {
    const medias = new Set();
    if (session?.video) medias.add(session.video);
    const roots = [
      session?.surface,
      ...qsa(
        document,
        '.fancybox-wrap, .fancybox-container, .fancybox-inner, .mfp-wrap, .mfp-content',
      ),
    ].filter(Boolean);
    roots.forEach((root) => {
      if (root instanceof HTMLVideoElement || root instanceof HTMLAudioElement) {
        medias.add(root);
        return;
      }
      qsa(root, 'video, audio').forEach((media) => medias.add(media));
    });
    medias.forEach((media) => {
      try {
        media.pause();
        media.muted = true;
        media.volume = 0;
      } catch (_) {
        /* ignore */
      }
    });
  }

  /** Match Flowplayer / Video.js / JW / Plyr fullscreen chrome to the real FS element. */
  function syncPlayerFullscreenUi(surface, on) {
    if (!surface) return;
    const roots = new Set([surface]);
    const host = surface.closest(
      '.video-js, .flowplayer, .fp-player, .jwplayer, .plyr, .kt-player, .kt_player',
    );
    if (host) roots.add(host);
    roots.forEach((el) => {
      el.classList.toggle('is-fullscreen', on);
      el.classList.toggle('is-fullscreened', on);
      el.classList.toggle('vjs-fullscreen', on);
      el.classList.toggle('jw-flag-fullscreen', on);
      el.classList.toggle('plyr--fullscreen', on);
      if (on) el.setAttribute('data-fullscreen', 'true');
      else el.removeAttribute('data-fullscreen');
    });
  }

  /** Unmute at full volume — site / autoplay policy often starts muted at 0. */
  function applyOnlinePlaybackAudio(video) {
    if (!video) return;
    try {
      video.defaultMuted = false;
      video.muted = false;
      video.volume = 1;
    } catch (_) {
      /* ignore */
    }
    const host = video.closest(
      '.video-js, .flowplayer, .fp-player, .jwplayer, .plyr, .kt-player, .kt_player',
    );
    host?.classList?.remove('is-muted', 'vjs-muted', 'muted');
  }

  /**
   * Swap documentElement FS onto the player surface once. Never re-enter after
   * the user exits — that fought the shrink button (exit → attach → FS again).
   */



  function beginOnlineFullscreen() {
    // Replace an active session without dropping document fullscreen — an async
    // exitFullscreen from the previous session would otherwise cancel the new
    // user-gesture request and make the player flicker in/out.
    if (onlinePlaybackSession) {
      finishOnlineFullscreen(onlinePlaybackSession, { keepFullscreen: true });
    }
    // Compact hover leaves a playing <video> on the thumb; without removing it,
    // attach() fullscreened that preview mp4 instead of the Fancybox player.
    stopAllCompactPreviews();

    const session = {
      startedAt: Date.now(),
      video: null,
      surface: null,
      seenVideo: false,
      disconnectedSince: 0,
      finished: false,
      observer: null,
      timer: null,
      documentFullscreenRequested: false,
      surfaceFullscreenPromoted: false,
      userExitedFullscreen: false,
      fullscreenWatch: null,
      blocker: null,
      playBoundVideo: null,
      playbackStarted: false,
      playRequestInFlight: false,
      closeHandler: null,
      escapeHandler: null,
      escapeAt: 0,
      absentSince: 0,
    };
    onlinePlaybackSession = session;
    // Hide the toolbar immediately and keep it completely unavailable until
    // the native popup closes or its video/popup shell is actually gone.
    document.documentElement.classList.add(`${NS}-online-playing`);
    // Block background thumbs before Fancybox mounts (native overlay is delayed).
    // Do NOT request documentElement fullscreen here — that fullscreened the
    // favorites thumbnail grid before Fancybox mounted and often froze the tab.
    // promoteSurfaceFullscreen runs only after a real <video> is ready.
    ensureOnlineBlocker(session);
    bindFullscreenExitWatch(session);

    session.closeHandler = (event) => {
      if (event.target?.closest?.(`.${NS}-online-blocker`)) return;
      if (event.target?.closest?.(`.${NS}-fs-exit`)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const control = target.closest(
        'button, a, [role="button"], [onclick], [data-action], ' +
          '[data-fancybox-close], .fancybox-close-small, .fancybox-close, ' +
          '.popup-close, .js-close-popup',
      );
      const identity = `${control?.className || target.className || ''} ` +
        `${control?.id || target.id || ''} ${control?.getAttribute?.('title') || ''} ` +
        `${control?.getAttribute?.('aria-label') || ''} ${control?.textContent || target.textContent || ''}`;
      const rect = (control || target).getBoundingClientRect();
      const compactTopControl =
        rect.width > 0 && rect.width <= 180 && rect.height > 0 && rect.height <= 100 && rect.top <= 220;
      const explicitExit =
        !!target.closest(
          '[data-fancybox-close], .fancybox-close-small, .fancybox-close, ' +
            '.popup-close, .js-close-popup, [data-action="close-popup"]',
        ) ||
        (compactTopControl && /close|back|dismiss|\u00d7/i.test(identity));
      const backdropExit =
        target === event.target &&
        /fancybox-bg|fancybox-overlay|popup-overlay|modal-backdrop|overlay-bg/i.test(identity);
      if (explicitExit || backdropExit) finishOnlineFullscreen(session);
    };
    document.addEventListener('click', session.closeHandler, true);
    session.escapeHandler = (event) => {
      if (event.key !== 'Escape' || session.finished) return;
      session.escapeAt = Date.now();
      session.absentSince = 0;
    };
    document.addEventListener('keydown', session.escapeHandler, true);
    // Do not treat fullscreenchange as dismiss. Chrome exits document FS during
    // popup ajax / UI chrome; that was aborting Cmd+click sessions as a flash.

    const attach = () => {
      if (session.finished) return;
      const video = visibleOnlineVideo();
      if (!video) return;
      const surface = onlineFullscreenTarget(onlinePlayerSurface(video), video);
      if (session.surface && session.surface !== surface) {
        session.surface?.classList.remove(`${NS}-online-player`);
        // Do not clear surfaceFullscreenPromoted — re-promoting fights the
        // player's shrink control after a mid-session surface swap.
      }
      session.video = video;
      session.surface = surface;
      session.seenVideo = true;
      session.disconnectedSince = 0;
      session.absentSince = 0;
      document.documentElement.classList.add(`${NS}-online-playing`);
      ensureOnlineBlocker(session);
      session.surface?.classList.add(`${NS}-online-player`);
      releasePlayerFont(session.surface);
      hidePopupWindowToggle();
      // Only FS once the real player has pixels — never promote an empty shell.
      if (onlineVideoReadyForFullscreen(video)) {
        promoteSurfaceFullscreen(session, surface);
      }
      // If promote already landed (or FS was reused), keep the shrink icon in sync.
      if (session.surfaceFullscreenPromoted && !session.userExitedFullscreen) {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        if (fs && (fs === surface || surface.contains(fs) || fs.contains(surface))) {
          syncPlayerFullscreenUi(surface, true);
          ensureFsExitButton(session, surface);
        }
      }
      video.autoplay = true;
      video.playsInline = false;
      const tryPlay = () => {
        // attach() polls every 200ms — calling play() every tick fights the
        // pause control and makes mute/FS clicks feel dead.
        if (
          session.finished ||
          !video.isConnected ||
          session.playbackStarted ||
          session.playRequestInFlight
        ) {
          return;
        }
        if (!video.paused) {
          session.playbackStarted = true;
          applyOnlinePlaybackAudio(video);
          return;
        }
        applyOnlinePlaybackAudio(video);
        const onPlaying = () => {
          session.playRequestInFlight = false;
          session.playbackStarted = true;
          applyOnlinePlaybackAudio(video);
          if (onlineVideoReadyForFullscreen(video) && session.surface) {
            promoteSurfaceFullscreen(session, session.surface);
          }
        };
        session.playRequestInFlight = true;
        try {
          const pending = video.play();
          if (pending && typeof pending.then === 'function') {
            pending
              .then(() => {
                onPlaying();
              })
              .catch(() => {
                // Autoplay-with-sound can fail after the gesture expires; play
                // muted then immediately restore max volume.
                try {
                  video.muted = true;
                  const retry = video.play();
                  retry
                    ?.then?.(() => {
                      applyOnlinePlaybackAudio(video);
                      onPlaying();
                    })
                    ?.catch?.(() => {
                      session.playRequestInFlight = false;
                      const playControl = qs(
                        session.surface || document,
                        '.vjs-big-play-button, .fp-ui, .jw-icon-playback, ' +
                          '.plyr__control[data-plyr="play"], [class*="play-button"], [class*="play_button"]',
                      );
                      playControl?.click();
                      applyOnlinePlaybackAudio(video);
                    });
                } catch (_) {
                  session.playRequestInFlight = false;
                }
              });
          } else if (!video.paused) {
            onPlaying();
          } else {
            session.playRequestInFlight = false;
          }
        } catch (_) {
          session.playRequestInFlight = false;
        }
      };
      if (session.playBoundVideo !== video) {
        session.playBoundVideo = video;
        session.playbackStarted = false;
        session.playRequestInFlight = false;
        video.addEventListener(
          'playing',
          () => {
            if (!session.playbackStarted) {
              session.playbackStarted = true;
              applyOnlinePlaybackAudio(video);
            }
            if (onlineVideoReadyForFullscreen(video) && session.surface) {
              promoteSurfaceFullscreen(session, session.surface);
            }
          },
          true,
        );
        video.addEventListener('loadedmetadata', tryPlay, { once: true });
        video.addEventListener('canplay', tryPlay, { once: true });
      }
      tryPlay();
    };
    // Player skins often replace <video> during setup/quality changes. Never
    // finish on the first disconnect — re-attach, and only close when both the
    // video and popup shell stay gone past the grace period.
    session.observer = new MutationObserver(() => {
      attach();
    });
    session.observer.observe(document.documentElement, { childList: true, subtree: true });
    attach();
    session.timer = setInterval(() => {
      if (session.finished) return;
      attach();
      const liveVideo = visibleOnlineVideo();
      const popupOpen = isOnlinePopupPresent();
      if (liveVideo || popupOpen) {
        session.absentSince = 0;
        session.disconnectedSince = 0;
        if (liveVideo) session.seenVideo = true;
        // Esc / fullscreen chrome alone must not restore while popup remains.
        return;
      }

      // Fancybox is already gone — drop the click-shield / toolbar hide now so
      // favorites is not left dimmed or chrome-less for the disconnect grace.
      removeOnlineBlocker();
      document.documentElement.classList.remove(`${NS}-online-playing`);

      // Popup dismissed before the player mounted (common with immediate Esc /
      // Cmd+click when the native popup fails to open).
      if (!session.seenVideo) {
        if (session.escapeAt && Date.now() - session.escapeAt >= 200) {
          finishOnlineFullscreen(session);
        } else if (!popupOpen && Date.now() - session.startedAt > 5000) {
          // No shell and no video — restore toolbar instead of staying blank.
          finishOnlineFullscreen(session);
        }
        return;
      }

      if (!session.absentSince) session.absentSince = Date.now();
      else if (Date.now() - session.absentSince > 500) {
        finishOnlineFullscreen(session);
      }
    }, 200);
  }

  function cardFromClickTarget(target) {
    if (!(target instanceof Element)) return null;
    if (target.closest(`.${NS}-pick, .${NS}-status, .${NS}-path, input, button, label, .checkbox`)) {
      return null;
    }
    const item = target.closest('.item.thumb');
    if (!item) return null;
    const list = listRoot();
    if (list && !list.contains(item)) return null;
    const link = target.closest('a.th.js-open-popup, a.th');
    if (!link || !item.contains(link)) return null;
    const videoId =
      qs(item, 'input.checkbox[name="delete[]"], input[name="delete[]"], input[type="checkbox"]')
        ?.value ||
      (link.href.match(/\/video\/(\d+)\//) || [])[1];
    if (!videoId) return null;
    return { el: item, videoId: String(videoId), link };
  }

  /**
   * Cmd/Ctrl+click must not open a new tab. Open Fancybox ajax popup from the
   * page MAIN world using .js-click[data-href] (site handlers die after our
   * list HTML replace, so a plain el.click() is not enough).
   */














  async function doDownloadSelected() {
    setError('');
    const itemsMap = await captureNativeSelection();
    const items = Object.values(itemsMap);
    if (!items.length) {
      setError('No videos selected. Click the info panel under a thumb, or use This page / Page range.');
      await refreshSelectionCount(itemsMap);
      return;
    }
    // Ensure ordinals + decorate titles so filenames get `{seq}——` even when
    // selection came from Select pages / index (bare titles, never displayed).
    try {
      const total = scanFavTotal || detectFavoritesTotal() || items.length;
      const perPage = cardsPerPageEstimate();
      await send('HELPER_ORDINALS_ENSURE', {
        items: items.map((it) => ({
          videoId: String(it.videoId),
          preferredSeq: preferredSeqForCard(it, total, perPage),
        })),
      });
      const looked = await send('HELPER_ORDINALS_LOOKUP', {
        videoIds: items.map((it) => String(it.videoId)),
      });
      const map = looked.ordinals || {};
      items.forEach((it) => {
        const seq = map[String(it.videoId)];
        if (seq == null) return;
        it.title = titledWithOrdinal(Number(seq), it.title);
      });
    } catch (_) {
      /* Helper optional; suggested_filename also injects when ordinal exists */
    }
    const payload = items.map((it) => ({
      videoId: it.videoId,
      title: it.title,
      detailUrl: it.detailUrl,
      favoritePage: it.favoritePage,
      cardIndex: it.cardIndex,
      sortKey: -(Number(it.favoritePage) * 100000 + Number(it.cardIndex)),
    }));
    try {
      const result = await send('QUEUE_ENQUEUE', { items: payload });
      const added = Number(result.added || 0);
      if (added > 0) applyDownloadProgress(result);
      // Keep selection checked so user can re-queue leftovers or act on the same set.
      await refreshSelectionCount(itemsMap);
      // Merge Helper exists for this selection so Local filter tracks skips/imports.
      try {
        const lookup = await send('HELPER_LOOKUP', { videoIds: Object.keys(itemsMap) });
        let grew = false;
        Object.entries(lookup?.results || {}).forEach(([id, info]) => {
          if (info && info.exists) {
            const key = String(id);
            if (!localIdSet.has(key)) grew = true;
            localIdSet.add(key);
            lastMatches[key] = info;
          }
        });
        if (grew) {
          scanned = true;
          invalidateFrozenViewIfDiskChanged();
        }
      } catch (_) {
        /* lookup optional */
      }
      await refreshQueue();
      await send('START_QUEUE_WORKER');
      if (!added && (result.skippedExisting || result.skippedQueued)) {
        // Do not clear an in-flight session just because this click added nothing.
        if (!dlSession.active) {
          downloadProgressLabel = 'idle';
          updateToolbarLabels();
        }
        setError(
          `Nothing queued (already local: ${result.skippedExisting || 0}, already queued: ${result.skippedQueued || 0})`,
        );
      }
    } catch (err) {
      setError(`Queue failed: ${err.message}`);
    }
  }

  // Normal worker refill is immediate; this watchdog intervenes when it still
  // has not reached the full six slots after several status polls.
  const QUEUE_REFILL_TARGET = 6;
  const QUEUE_WATCHDOG_POLLS = 3;
  const QUEUE_WATCHDOG_COOLDOWN_MS = 30_000;
  let queueLowWaterPolls = 0;
  let queueWatchdogLastRecoveryAt = 0;
  let queueWatchdogInFlight = false;












  async function doDeleteSelected() {
    if (deleteRunning) return;
    deleteRunning = true;
    setError('');
    const onPlaylist = isPlaylistDetailPage();
    const verbDone = onPlaylist ? 'Removed' : 'Unfavorited';
    const verbFail = onPlaylist ? 'Remove from list' : 'Unfavorite';
    const btn = qs(document, `.${NS}-controls [data-act="delete-favs"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = onPlaylist ? 'Removing…' : 'Unfavoriting…';
    }
    try {
      const itemsMap = await captureNativeSelection();
      const ids = Object.keys(itemsMap || {});
      if (!ids.length) throw new Error('Select videos first.');
      const where = onPlaylist ? 'this playlist' : 'My Favorites';
      const ok = await confirmModal({
        title: onPlaylist ? 'Remove from list' : 'Unfavorite on site',
        body: `Remove ${ids.length} selected video(s) from ${where}? This cannot be undone here.`,
        okLabel: onPlaylist ? 'Remove from list' : 'Unfavorite',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;

      injectDeleteIdsIntoControlForm(ids);
      let bulk = await contentAjaxDelete(ids);
      clearInjectedDeletes();
      let deleted = bulk.ok ? ids.length : 0;
      let failed = bulk.ok ? 0 : ids.length;
      const errors = [];
      let succeededIds = bulk.ok ? ids.map(String) : [];
      if (!bulk.ok) {
        deleted = 0;
        failed = 0;
        succeededIds = [];
        for (let i = 0; i < ids.length; i += 1) {
          if (btn) {
            btn.textContent = onPlaylist
              ? `Removing ${i}/${ids.length}`
              : `Unfavoriting ${i}/${ids.length}`;
          }
          const one = await deleteOneFromFavourites(ids[i]);
          if (one.ok) {
            deleted += 1;
            succeededIds.push(String(ids[i]));
          } else {
            failed += 1;
            if (errors.length < 5) errors.push(`${ids[i]}: ${one.detail || 'failed'}`);
          }
          if (i + 1 < ids.length) await new Promise((r) => setTimeout(r, 120));
        }
      }
      removeListCardsByIds(succeededIds);
      if (succeededIds.length) {
        const scope = onPlaylist ? indexScopeKey() : 'favorites';
        // What the user sees on brand / Libraries "From:" — never index/known
        // (stale-high index caused 134 → 139 after deleting one).
        const before =
          optionalNonNegInt(parseDisplayedLibraryFromCount()) ??
          optionalNonNegInt(brandChipVideoTotal()) ??
          optionalNonNegInt(siteNativeTitleCount);
        const beforeIndexed = Array.isArray(favIndexCache?.videos)
          ? favIndexCache.videos.length
          : null;
        const patched = await patchIndexRemoveIds(scope, succeededIds);
        // Always lower Scan + brand / Libraries "From:" after a confirmed remove.
        let next = before != null ? Math.max(0, before - succeededIds.length) : null;
        if (
          patched?.videos &&
          beforeIndexed != null &&
          patched.videos.length < beforeIndexed
        ) {
          const indexed = patched.videos.length;
          if (next == null || indexed < next) next = indexed;
        }
        if (next != null) lowerDisplayedLibraryTotal(next);
        librarySwitcherCache = null;
        librarySwitcherCacheAt = 0;
        refreshScanLabelCounts();
        updateToolbarLabels();
        refreshOpenLibrarySwitcherFromLabel();
      }
      await send('SELECTION_CLEAR');
      await refreshSelectionCount({});
      if (succeededIds.length) {
        // Refill native thumbs from the site so List / List (match) close the
        // holes left by removeListCardsByIds (pull next videos onto this page).
        // Compact already re-sliced in pruneIdsFromActiveMatchView; this keeps
        // the hidden native grid full for a later List switch.
        try {
          await reloadCurrentListPageForced();
        } catch (_) {
          /* keep surgically removed cards */
        }
        // After selection clear: refill Compact / Show matches from the patched
        // index (patchIndexRemoveIds already dropped the ids).
        await refreshActiveCardArea({ quiet: true, ensureIndex: false });
      }
      if (failed && !deleted) {
        throw new Error(
          `${verbFail} failed` +
            (errors.length ? `: ${errors.slice(0, 3).join('; ')}` : ` (${bulk.detail || ''})`),
        );
      }
      if (failed) setError(`${verbDone} ${deleted}, failed ${failed}`);
      else {
        setError('');
        if (btn) {
          btn.textContent = `${verbDone} ${deleted}`;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch (err) {
      clearInjectedDeletes();
      setError(`${verbFail} failed: ${err.message || String(err)}`);
    } finally {
      deleteRunning = false;
      updateToolbarLabels();
      hideNativeControls();
    }
  }

  let toolbarDocWired = false;



  function wireToolbar() {
    wireControls();
  }

  let listObserver = null;
  let observedList = null;
  let pageFinger = '';
  let pageWatchTimer = null;







  async function bootFavorites() {
    bootInProgress = true;
    try {
      // Establish the complete visible geometry before the first await. Without
      // this, GET_CONFIG/Helper latency exposes the site's original layout for
      // one frame and then visibly jumps to the fixed toolbar layout.
      ensureJumpBar();
      ensureFilterBar();
      layoutTopControls();
      revealFirstLayout();
      try {
        config = await send('GET_CONFIG');
      } catch (_) {
        config = { localPreferPlayback: true };
      }
      await recoverFailedQueueOnPageLoad();
      // Page refresh keeps the bag when it belongs to this list; switching lists clears.
      await adoptSelectionForCurrentLibrary();
      await loadFavIndexCache();
      // Full reload must restore Match chips + Compact/Show matches (library
      // switch already does this in clearSelectionIfLibraryChanged).
      await loadToolbarFilters();
      // Do not pre-hide the native list here — that left a blank page for the
      // whole Scan when restore was slow. restoreToolbarView hides only while
      // Compact DOM is actually building (now a cached-index paint).
      if (
        normalizeViewMode(viewMode) === 'compact' ||
        normalizeViewMode(viewMode) === 'selected' ||
        normalizeViewMode(viewMode) === 'matches'
      ) {
        viewRestorePending = true;
      }
      wireToolbar();
      wireFilterBar();
      bindListObserver();
      bindPaginationClicks();
      ensureJumpBar();
      ensureFilterBar();
      layoutTopControls();
      startPageWatch();
      ignoreMutationsUntil = Date.now() + 500;
      parseCards().forEach((card) => renderStatus(card, null, false));
      wireCardClicks();
      // Reattach Index/Renumber progress before Compact restore / Scan.
      await resumeBackgroundJobsUi();
      // Instant Compact from stored index — same cost as clicking Compact after
      // Show all (no nested Scan / index crawl / Tag sex on the boot path).
      await restoreToolbarView({ ensureIndex: false });
      await restoreSelectionToPage(parseCards());
      // Disk scan can be slow on large roots; Compact is already on screen.
      // Local/Not-local Views re-apply inside doScan after marks land.
      await doScan();
      if (compactViewActive && diskFilterIsAll()) {
        await refreshLookup().catch(() => {});
      }
      await refreshQueue();
      await refreshSelectionCount();
      await resumeBackgroundJobsUi();
      // Fallback if early restore failed (empty index) — still skip crawl.
      {
        const mode = normalizeViewMode(viewMode);
        if (
          (mode === 'compact' && !compactViewActive) ||
          (mode === 'matches' && !filterState.active)
        ) {
          await restoreToolbarView({ ensureIndex: false });
        }
      }
      ensureJumpBar();
      layoutTopControls();
      pageFinger = pageFingerprint();
      // Show-all: site may replace the native list after scan; re-paint seq titles.
      if (!compactViewActive) {
        scheduleOrdinalRepaint([0, 500, 1500]);
      }

      setInterval(() => {
        refreshQueue().catch(() => {});
        refreshSelectionCount().catch(() => {});
        refreshIndexJobUi().catch(() => {});
        refreshRenumberJobUi().catch(() => {});
        refreshPlaylistAddJobUi().catch(() => {});
        refreshFavAddJobUi().catch(() => {});
      }, 4000);
    } finally {
      bootInProgress = false;
    }
  }

  async function bootPlaylistPage() {
    bootInProgress = true;
    try {
      // Same control surface as favorites; Delete removes from this playlist.
      ensureJumpBar();
      ensureControls();
      ensureFilterBar();
      layoutTopControls();
      forcePlaylistHeaderToBottom();
      revealFirstLayout();
      try {
        config = await send('GET_CONFIG');
      } catch (_) {
        config = { localPreferPlayback: true };
      }
      await recoverFailedQueueOnPageLoad();
      // Page refresh keeps the bag when it belongs to this list; switching lists clears.
      await adoptSelectionForCurrentLibrary();
      await loadFavIndexCache();
      // Full reload must restore Match chips + Compact/Show matches (library
      // switch already does this in clearSelectionIfLibraryChanged).
      await loadToolbarFilters();
      // Do not pre-hide the native list for the whole Scan (see bootFavorites).
      if (
        normalizeViewMode(viewMode) === 'compact' ||
        normalizeViewMode(viewMode) === 'selected' ||
        normalizeViewMode(viewMode) === 'matches'
      ) {
        viewRestorePending = true;
      }
      wireToolbar();
      wireFilterBar();
      bindListObserver();
      bindPaginationClicks();
      ensureJumpBar();
      ensureControls();
      layoutTopControls();
      startPageWatch();
      ignoreMutationsUntil = Date.now() + 500;
      parseCards().forEach((card) => {
        ensurePickRail(card);
        renderStatus(card, null, false);
      });
      wireCardClicks();
      await resumeBackgroundJobsUi();
      // Instant Compact from stored index — no nested Scan / index crawl / Tag sex.
      await restoreToolbarView({ ensureIndex: false });
      await restoreSelectionToPage(parseCards());
      await doScan();
      if (compactViewActive && diskFilterIsAll()) {
        await refreshLookup().catch(() => {});
      }
      await refreshQueue().catch(() => {});
      await refreshSelectionCount();
      await resumeBackgroundJobsUi();
      {
        const mode = normalizeViewMode(viewMode);
        if (
          (mode === 'compact' && !compactViewActive) ||
          (mode === 'matches' && !filterState.active)
        ) {
          await restoreToolbarView({ ensureIndex: false });
        }
      }
      layoutTopControls();
      pageFinger = pageFingerprint();
      if (!compactViewActive) {
        scheduleOrdinalRepaint([0, 500, 1500]);
      }

      setInterval(() => {
        refreshQueue().catch(() => {});
        refreshSelectionCount().catch(() => {});
        refreshIndexJobUi().catch(() => {});
        refreshRenumberJobUi().catch(() => {});
        refreshPlaylistAddJobUi().catch(() => {});
        refreshFavAddJobUi().catch(() => {});
      }, 4000);
    } finally {
      bootInProgress = false;
    }
  }

  async function boot() {
    try {
      if (isFavoritesPage()) await bootFavorites();
      else if (isPlaylistDetailPage()) await bootPlaylistPage();
    } finally {
      revealFirstLayout();
    }
  }

  installNativeFavouritesBridge();
  if (typeof installLibrarySwitcher === 'function') installLibrarySwitcher();

  // document_start: kick off Libraries-source count fetch while the DOM loads so
  // the brand chip can resolve without waiting for a Libraries click / late boot.
  if (initialTargetPage) {
    try {
      ensureLibraryCountPrefetch({ force: false });
      scheduleBrandChipCountRefresh();
    } catch (_) {
      /* helpers may still be wiring; boot will retry */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
