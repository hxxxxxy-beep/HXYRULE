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
  }
  const firstLayoutWatchdog = initialTargetPage
    ? setTimeout(() => {
        document.documentElement?.removeAttribute('data-hxyrule-booting');
        firstLayoutRevealed = true;
      }, 3000)
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

  function isFavoritesPage() {
    return FAV_PATH_RE.test(location.pathname);
  }

  function isPlaylistDetailPage() {
    return PLAYLIST_PATH_RE.test(location.pathname);
  }

  function currentPlaylistIdFromPath() {
    const m = String(location.pathname || '').match(PLAYLIST_PATH_RE);
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

  function send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
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

  function detectLibraryTotalFromDom() {
    const candidates = [
      qs(document, `.${NS}-hide-native-headline`),
      qs(document, `.${NS}-hide-native-headline .title`),
      qs(document, '.headline .title'),
      qs(document, '.headline h1'),
      qs(document, '.headline h2'),
      qs(document, '#list_videos_my_favourite_videos .headline'),
      qs(document, '.box .title'),
    ].filter(Boolean);
    for (const el of candidates) {
      if (el.closest?.(`.${NS}-favcount`)) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ');
      const nums = [...text.matchAll(/(\d[\d\s,]{2,})/g)].map((m) =>
        Number(String(m[1]).replace(/[\s,]/g, '')),
      );
      const hit = nums.find((n) => Number.isInteger(n) && n >= 20);
      if (hit) return hit;
    }
    return null;
  }

  function maxPageNumber() {
    let max = currentPageNumber();
    const pag = listPaginationEl() || document;
    qsa(pag, '[data-parameters]').forEach((el) => {
      if (isNextPrevControl(el)) return;
      const n = parsePageFromParams(el.getAttribute('data-parameters'));
      if (n) max = Math.max(max, n);
    });
    paginationItemEls(pag).forEach((el) => {
      const n = pageNumberFromPagItem(el);
      if (n) max = Math.max(max, n);
    });
    // Cap classic next-arrow overshoot (e.g. 219 when library is exactly 218 pages).
    const total = scanFavTotal || detectLibraryTotalFromDom();
    if (total > 0) {
      const per =
        (stablePerPage && stablePerPage > 0 ? stablePerPage : 0) ||
        Math.max(parseCards().length, 1);
      const byTotal = Math.ceil(total / per);
      if (byTotal >= 1 && max > byTotal) max = byTotal;
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
      btn.style.setProperty('background', '#6fae8f', 'important');
      btn.style.setProperty('background-color', '#6fae8f', 'important');
    } else {
      // Match toolbar small-tile gray (including current — kill site active red fill).
      btn.style.setProperty('background', '#4d5b68', 'important');
      btn.style.setProperty('background-color', '#4d5b68', 'important');
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
      miss.style.setProperty('font-size', '10px', 'important');
      miss.style.setProperty('line-height', '1.1', 'important');
      miss.style.setProperty('margin', '0', 'important');
      if (show) {
        if (allLocal || isCurrent) miss.style.setProperty('color', '#fff', 'important');
        else miss.style.removeProperty('color');
      }
    }
  }

  function paintPaginationLocalMarks() {
    const root = qs(document, '#list_videos_my_favourite_videos_pagination');
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
    const root = qs(document, '#list_videos_my_favourite_videos_pagination');
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
    const parts = raw.split(':').map((p) => Number(p));
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

  function parseCards() {
    const page = currentPageNumber();
    const cards = qsa(document, '.item.thumb');
    return cards.map((el, index) => {
      const checkbox =
        qs(el, 'input.checkbox[name="delete[]"]') ||
        qs(el, 'input[name="delete[]"]') ||
        qs(el, 'input[type="checkbox"]');
      const link = qs(el, 'a.th.js-open-popup, a.th');
      const videoId = checkbox?.value || (link?.href.match(/\/video\/(\d+)\//) || [])[1];
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
      return {
        el,
        videoId: String(videoId),
        detailUrl: link?.href || `https://rule34video.com/video/${videoId}/`,
        title: String(rawTitle).trim(),
        favoritePage: page,
        cardIndex: index,
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

  function cardsPerPageEstimate() {
    const maxP = maxPageNumber();
    const total = scanFavTotal || detectFavoritesTotal() || 0;
    const cur = qsa(document, '.item.thumb').length;
    const curPage = currentPageNumber();
    // A non-last page is always full — lock that as the page size.
    if (Number.isInteger(curPage) && maxP > 1 && curPage < maxP && cur > 0) {
      stablePerPage = cur;
      return cur;
    }
    if (stablePerPage && stablePerPage > 0) return stablePerPage;
    // Infer from total/maxPage so last-page short counts never poison preferredSeq.
    if (total > 0 && maxP > 1) {
      const inferred = Math.ceil(total / maxP);
      if (inferred > 0) {
        stablePerPage = inferred;
        return inferred;
      }
    }
    return cur > 0 ? cur : 10;
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
    const pick = qs(card.el, `.${NS}-pick`);
    const titleEl =
      (pick && qs(pick, '.thumb_title')) ||
      qs(card.el, '.thumb_title') ||
      (card.link && qs(card.link, '.thumb_title'));
    let bare = bareTitle(card.title);
    if (titleEl) {
      bare = titleEl.dataset.hxyruleOrigTitle || bareTitle(titleEl.textContent) || bare;
      titleEl.dataset.hxyruleOrigTitle = bare;
      titleEl.textContent = titledWithOrdinal(seq, bare);
    }
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

  async function applyOrdinalsToCards(cards) {
    if (!cards.length) return;
    const total = scanFavTotal || detectFavoritesTotal() || cards.length;
    const perPage = cardsPerPageEstimate();
    const items = cards.map((c) => ({
      videoId: c.videoId,
      preferredSeq: preferredSeqForCard(c, total, perPage),
    }));
    try {
      const data = await send('HELPER_ORDINALS_ENSURE', { items });
      const map = data.ordinals || {};
      cards.forEach((card) => {
        const seq = map[card.videoId];
        if (seq == null) return;
        applyOrdinalDisplay(card, Number(seq));
      });
    } catch (_) {
      /* Helper optional for titles */
    }
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

  function hideNativeControls() {
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

  /** Keep the native playlist title in page flow, immediately above the fixed toolbar anchor. */
  function placePlaylistNativeTitle() {
    // Drop plain-text clone from earlier builds — it broke click-to-navigate.
    qs(document, `.${NS}-playlist-page-title`)?.remove();
    if (!isPlaylistDetailPage()) return null;
    const stack = ensureControlStack();
    let hl =
      qs(stack, `.headline.${NS}-playlist-native-title`) ||
      [...qsa(stack, '.headline')].find((el) => isPlaylistHeadlineEl(el)) ||
      findFavoritesHeadline();
    if (!hl) return null;
    restoreHeadlineStyles(hl);
    hl.classList.add(`${NS}-playlist-native-title`);
    hl.classList.remove(`${NS}-hide-native-headline`);
    hl.removeAttribute('hidden');
    hl.style.removeProperty('display');
    // Keep title inside the fixed stack so it stays above Match/Select.
    if (hl.parentElement !== stack || stack.firstElementChild !== hl) {
      stack.insertBefore(hl, stack.firstChild);
    }
    // Any leftover native title below Jump / above cards → hide (duplicate).
    qsa(document, '.headline').forEach((el) => {
      if (el === hl) return;
      if (!isPlaylistHeadlineEl(el)) return;
      el.classList.add(`${NS}-hide-native-headline`);
      el.setAttribute('hidden', 'true');
      el.style.setProperty('display', 'none', 'important');
    });
    return hl;
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
    headline.classList.remove(`${NS}-playlist-native-title`);
    headline.classList.add(`${NS}-hide-native-headline`);
    headline.style.removeProperty('display');
  }

  function favoritesListEl() {
    const box = listBoxEl();
    return qs(box || document, '[id$="_items"], #list_videos_my_favourite_videos_items, .thumbs');
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

  /** Jump / collection chip: SHORT A (2773069) : 2402 videos */
  function formatPlaylistJumpLabel(name, pid, total) {
    const n = String(name || '').trim() || 'Playlist';
    const id = String(pid || '').trim();
    const num = Number(total);
    const count =
      Number.isFinite(num) && num >= 0 ? `${Math.round(num)} videos` : '? videos';
    return id ? `${n} (${id}) : ${count}` : `${n} : ${count}`;
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
    const myPl = s.match(/my\s+playlist\s+(.+?)\s*[\(（]/i);
    if (myPl) {
      const direct = cleanPlaylistTitleText(myPl[1], pid);
      if (direct && !isJunkPlaylistTitle(direct)) return direct;
    }
    const stripped = s
      .replace(/\(\s*[\d,\s.]+\s*(videos?)?\s*\)/gi, ' ')
      .replace(/（\s*[\d,\s.]+\s*(videos?)?\s*）/gi, ' ')
      .replace(/\|\s*Rule34.*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanPlaylistTitleText(stripped, pid) || cleanPlaylistTitleText(s, pid) || '';
  }

  function detectPlaylistTitle() {
    const pid = currentPlaylistIdFromPath() || '';
    const box = listBoxEl();
    const candidates = [];
    const push = (el) => {
      if (el && !candidates.includes(el)) candidates.push(el);
    };
    push(qs(document, `.${NS}-playlist-native-title`));
    push(qs(document, `.${NS}-playlist-page-title`));
    if (box) {
      push(qs(box, `.${NS}-hide-native-headline`));
      push(qs(box, '.headline .title'));
      push(qs(box, '.headline'));
    }
    push(findFavoritesHeadline());
    // Native title may sit outside the list box.
    qsa(document, '.headline .title, .headline').forEach((el) => {
      const t = String(el.textContent || '');
      if (/my\s+playlist\b/i.test(t)) push(el);
    });
    let best = '';
    let bestScore = 0;
    for (const el of candidates) {
      if (!el) continue;
      const raw = String(el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw) continue;
      // Don't parse our own jump chip format as a title source.
      if (el.classList?.contains(`${NS}-favcount`)) continue;
      if (/^\s*.+\(\d+\)\s*[:：]/.test(raw) && !/my\s+playlist/i.test(raw)) {
        const m = raw.match(/^(.+?)\s*\(\d+\)\s*[:：]/);
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

  function updateFavCountBar() {
    const el = qs(document, `.${NS}-favcount`);
    if (!el) return;
    const total = scanFavTotal || detectFavoritesTotal();
    if (isPlaylistDetailPage()) {
      const pid = currentPlaylistIdFromPath() || '';
      const name = detectPlaylistTitle() || 'Playlist';
      el.textContent = formatPlaylistJumpLabel(name, pid, total);
      return;
    }
    el.textContent = total
      ? `My Favorites (${formatFavCount(total)})`
      : 'My Favorites';
  }

  function indexScopeKey() {
    if (isPlaylistDetailPage()) {
      const pid = currentPlaylistIdFromPath();
      return pid ? `playlist:${pid}` : 'playlist';
    }
    return 'favorites';
  }

  // Selection bag is per library entry: Favorites, or one playlist id.
  // Survives pagination inside that entry; cleared when entering A/B or switching lists.
  let selectionLibraryKey = null;

  async function resetSelectionForLibraryEntry() {
    selectionLibraryKey = indexScopeKey();
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
  }

  async function clearSelectionIfLibraryChanged() {
    const key = indexScopeKey();
    if (selectionLibraryKey != null && selectionLibraryKey !== key) {
      selectionLibraryKey = key;
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
      // Collection chip labels flip meaning across Favorites ↔ playlist; never
      // carry filterState / frozen View into the other library entry.
      myFavIdSet = null;
      listIndexDirty = false; // dirty flag is per current list scope
      invalidatePlaylistMembershipCache();
      await resetMatchRules();
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

  /** Row 3: Jump left · Pages center · status right. */
  function ensureJumpRow() {
    let row = qs(document, `.${NS}-jumprow`);
    if (!row) {
      row = document.createElement('div');
      row.className = `${NS}-jumprow`;
      row.dataset.hxyrule = '1';
    }
    const stack = ensureControlStack();
    if (row.parentElement !== stack) stack.appendChild(row);
    return row;
  }

  let statusFlash = '';
  let statusFlashIsError = false;
  let statusLive = 'Ready';
  const STATUS_LOG_LIMIT = 200;
  const statusLog = [];

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
    const el = ensureStatusBar();
    el.hidden = false;
    el.removeAttribute('hidden');
    const text = (statusFlash || statusLive || 'Ready').trim() || 'Ready';
    const isError = !!statusFlash && statusFlashIsError;
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
    statusLive = String(text || '').trim() || 'Ready';
    paintStatus();
  }

  /** Status chip on row 3, always visible (flash message or live queue state). */
  function ensureStatusBar() {
    const row = ensureJumpRow();
    let status =
      qs(document, `.${NS}-msgbar[data-role="status"]`) ||
      qs(document, `.${NS}-error[data-role="error"]`) ||
      qs(document, `.${NS}-error[data-role="status"]`);
    if (!status) {
      status = document.createElement('div');
      status.className = `${NS}-msgbar ${NS}-error`;
      status.dataset.role = 'status';
      status.dataset.hxyrule = '1';
      status.setAttribute('aria-live', 'polite');
      const inner = document.createElement('span');
      inner.className = `${NS}-message-text`;
      inner.textContent = statusFlash || statusLive || 'Ready';
      status.appendChild(inner);
    } else {
      status.classList.add(`${NS}-msgbar`, `${NS}-error`);
      status.classList.remove(`${NS}-status`);
      status.dataset.role = 'status';
      if (!qs(status, `.${NS}-message-text`)) {
        // Migrate older plain-text status chip.
        const prev = String(status.textContent || '').trim();
        const inner = document.createElement('span');
        inner.className = `${NS}-message-text`;
        inner.textContent = prev || statusFlash || statusLive || 'Ready';
        status.replaceChildren(inner);
        status.dataset.logBound = '';
      }
    }
    if (status.parentElement !== row) row.appendChild(status);
    status.hidden = false;
    status.removeAttribute('hidden');
    ensureStatusLogDialog();
    bindStatusLogUi(status);
    return status;
  }

  /** Collection chip on Act row (row 2), flush left. */
  function ensureFavCountBar() {
    hideNativeHeadline();
    const controls = ensureControls();
    const row =
      qs(controls, `.${NS}-act-row`) ||
      qs(controls, `.${NS}-pipeline`) ||
      qs(controls, `.${NS}-row`);
    let chip = qs(document, `.${NS}-favcount`);
    if (!chip) {
      chip = document.createElement('div');
      chip.className = `${NS}-favcount`;
      chip.dataset.hxyrule = '1';
    }
    if (row && chip.parentElement !== row) row.insertBefore(chip, row.firstChild);
    updateFavCountBar();
    return chip;
  }

  /** Pages step on row 3 (center). */
  function ensurePagesStep() {
    const row = ensureJumpRow();
    let step = qs(document, `.${NS}-pages-step`);
    if (!step || !qs(step, '[data-role="pages-host"]') || !qs(step, `.${NS}-sep`)) {
      step?.remove();
      step = document.createElement('section');
      step.className = `${NS}-step ${NS}-pages-step`;
      step.dataset.hxyrule = '1';
      step.innerHTML = `
        <strong class="${NS}-step-name">Pages</strong>
        <span class="${NS}-sep" aria-hidden="true"></span>
        <div class="${NS}-pages-host" data-role="pages-host"></div>
      `;
    }
    step.setAttribute(
      'aria-label',
      isPlaylistDetailPage() ? 'Playlist pages' : 'Favorites pages',
    );
    if (step.parentElement !== row) row.appendChild(step);
    return step;
  }

  /**
   * Control stack: fixed to the viewport top via CSS. DOM is parked next to
   * the card list so SPA reflows keep a stable anchor; visual position is fixed.
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
    if (list) {
      list.classList.add(`${NS}-thumbs-clear`);
      // Keep stack after the list in DOM; fixed CSS pins it to the viewport top.
      if (list.nextElementSibling !== stack) {
        list.insertAdjacentElement('afterend', stack);
      }
    } else if (box) {
      if (!box.contains(stack)) box.appendChild(stack);
    } else if (!document.body.contains(stack)) {
      document.body.appendChild(stack);
    }
    return stack;
  }

  function listBoxEl() {
    if (isFavoritesPage()) return qs(document, '#list_videos_my_favourite_videos');
    if (isPlaylistDetailPage()) {
      return (
        qs(document, '[id^="list_videos"][id*="playlist"]') ||
        qs(document, '#list_videos_common_videos_list') ||
        qs(document, '.thumbs')?.closest('[id^="list_videos"]') ||
        qs(document, '[id^="list_videos"]') ||
        qs(document, '.box .thumbs')?.closest('.box') ||
        null
      );
    }
    return qs(document, '#list_videos_my_favourite_videos');
  }

  function listPaginationEl() {
    if (isFavoritesPage()) {
      return qs(document, '#list_videos_my_favourite_videos_pagination');
    }
    const box = listBoxEl();
    return (
      qs(box || document, '[id$="_pagination"]') ||
      qs(document, '[id^="list_videos"][id$="_pagination"]') ||
      null
    );
  }

  /** Real KVS block id for the current list (avoid bare .box without id). */
  function playlistBlockId() {
    const box = listBoxEl();
    if (box?.id && /^list_videos/i.test(box.id)) return box.id;
    const form = findFavoritesControlForm();
    const fromForm = form?.getAttribute('data-block-id');
    if (fromForm) return fromForm;
    const el =
      qs(document, '[id^="list_videos"][id*="playlist"]') ||
      qs(document, '#list_videos_common_videos_list') ||
      qs(document, '[id^="list_videos"]');
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
          return {
            videoId: String(videoId),
            detailUrl: href.startsWith('http')
              ? href
              : href
                ? `https://rule34video.com${href}`
                : `https://rule34video.com/video/${videoId}/`,
            title: String(rawTitle).trim(),
            favoritePage: pageNum,
            cardIndex: index,
            durationSec: cardDurationSec(el),
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
        detailUrl: `https://rule34video.com/video/${id}/`,
        title: id,
        favoritePage: pageNum,
        cardIndex: index,
        durationSec: null,
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
    if (el.classList?.contains('thumbs')) return true;
    if (el.id === 'list_videos_my_favourite_videos_pagination') return true;
    if (el.id?.endsWith?.('_pagination')) return true;
    if (el.id === 'list_videos_my_favourite_videos_items') return true;
    if (el.id?.endsWith?.('_items')) return true;
    if (el.classList?.contains('pagination')) return true;
    if (el.querySelector?.(
      '.item.thumb, .pagination, .thumbs, .hxyrule-topstack, #list_videos_my_favourite_videos_pagination',
    )) {
      return true;
    }
    return false;
  }

  function trimBelowControls(stack) {
    if (!stack) return;
    // Playlist stack sits above cards — do not walk/hide siblings under it.
    if (stack.classList?.contains(`${NS}-topstack--playlist`)) {
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
      return;
    }
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
    // Site footer / ad spots are the large blank under Jump on this skin.
    qsa(document, '.footer, .page__footer, .footer_spots, .footer_holder, .columns_spots').forEach(
      (el) => {
        if (!isProtectedBottomEl(el)) el.classList.add('hxyrule-hide-native');
      },
    );
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
  }

  /**
   * Fixed top toolbar (compact 3 rows):
   * - Row 1: Match · View · Select
   * - Row 2: collection chip (left) · Sync · Queue · Index · Edit
   * - Row 3: Jump · Pages · status
   * Playlist: native title sits above row 1 (~1px).
   */
  function layoutTopControls() {
    hideNativeControls();
    hideNativeJumpControls();
    hideNativeHeadline();
    const stack = ensureControlStack();
    const controls = ensureControls();
    const pag = listPaginationEl() || qs(document, '#list_videos_my_favourite_videos_pagination');
    ensureFavCountBar();
    const jump = ensureJumpBar();
    const pagesStep = ensurePagesStep();
    const status = ensureStatusBar();
    const row = ensureJumpRow();
    paintStatus();

    const pagesHost = qs(pagesStep, '[data-role="pages-host"]');
    if (pag) {
      pag.classList.add(`${NS}-pagination-slot`);
      pag.classList.remove('hxyrule-hide-native');
      pag.style.removeProperty('display');
      qsa(pag, '.pagination, .item').forEach((el) => {
        if (!el.classList.contains('jump_to') && !el.classList.contains(`${NS}-hide-native-jump`)) {
          el.classList.remove('hxyrule-hide-native');
        }
      });
      compactNativePagination(pag);
      if (pagesHost && pag.parentElement !== pagesHost) pagesHost.appendChild(pag);
    }

    // Row 3 DOM order: Jump → Pages → status (CSS grid also pins columns).
    if (jump.parentElement !== row || row.firstElementChild !== jump) {
      row.insertBefore(jump, row.firstChild);
    }
    if (pagesStep.parentElement !== row || jump.nextElementSibling !== pagesStep) {
      jump.insertAdjacentElement('afterend', pagesStep);
    }
    if (status.parentElement !== row || pagesStep.nextElementSibling !== status) {
      pagesStep.insertAdjacentElement('afterend', status);
    }

    const list = favoritesListEl();
    if (list) list.classList.add(`${NS}-thumbs-clear`);
    if (list) moveLargeNativePanelBelowCards(list);

    const title = isPlaylistDetailPage() ? placePlaylistNativeTitle() : null;
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
    if (list && list.nextElementSibling !== stack) {
      list.insertAdjacentElement('afterend', stack);
    }
    // Drop legacy playlist spacer if an older build left one behind.
    qs(stack, `.${NS}-gap-pag-jump`)?.remove();
    trimBelowControls(stack);
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
    const TILE = '#4d5b68';
    const set = (el, prop, value) => el.style.setProperty(prop, value, 'important');
    [pag, ...qsa(pag, '.pagination')].forEach((el) => {
      set(el, 'height', '30px');
      set(el, 'min-height', '30px');
      set(el, 'max-height', '30px');
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
      set(el, 'min-width', '30px');
      set(el, 'height', '30px');
      set(el, 'min-height', '30px');
      set(el, 'max-height', '30px');
      set(el, 'margin', '0 2px');
      set(el, 'padding', '0');
      set(el, 'font-size', '11px');
      set(el, 'line-height', '20px');
      set(el, 'box-sizing', 'border-box');
      set(el, 'border-radius', '4px');
      const inner = qsa(el, ':scope > a, :scope > button, :scope > span');
      if (!inner.length) set(el, 'padding', '5px 10px');
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
        set(child, 'min-width', '30px');
        set(child, 'height', '30px');
        set(child, 'min-height', '30px');
        set(child, 'max-height', '30px');
        set(child, 'margin', '0');
        set(child, 'padding', '5px 10px');
        set(child, 'font-size', '11px');
        set(child, 'line-height', '20px');
        set(child, 'box-sizing', 'border-box');
        set(child, 'border-radius', '4px');
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

  function placeToolbar(_bar) {
    hideNativeControls();
    ensureControls();
    layoutTopControls();
  }

  function findNativeJumpControls() {
    const pag =
      listPaginationEl() || qs(document, '#list_videos_my_favourite_videos_pagination');
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

    const curItems = listRoot();
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

    const curPag = listPaginationEl() || qs(document, '#list_videos_my_favourite_videos_pagination');
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
    const root = qs(document, '#list_videos_my_favourite_videos_pagination');
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
    // Recreate if older pill / nested-field layout is still around.
    if (
      bar &&
      (!qs(bar, `.${NS}-step-name`) ||
        !qs(bar, `.${NS}-paren`) ||
        !qs(bar, `.${NS}-sep`) ||
        qs(bar, `.${NS}-field`) ||
        qs(bar, `.${NS}-jump-field`) ||
        qs(bar, `.${NS}-jumpbar__slash`))
    ) {
      bar.remove();
      bar = null;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = `${NS}-jumpbar`;
      bar.dataset.hxyrule = '1';
      bar.setAttribute('aria-label', 'Jump');
      bar.innerHTML = `
        <strong class="${NS}-step-name">Jump</strong>
        <span class="${NS}-sep" aria-hidden="true"></span>
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
    if (bar.parentElement !== row) row.insertBefore(bar, row.firstChild);

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
  /** Full-page card count (never last-page short count). */
  let stablePerPage = null;
  let selCountCached = 0;
  /** While Page range is collecting: { current, total } for Clear · (a/b) page tasks. */
  let selProgress = null;
  let stopLabelCached = 'idle';
  let dlSession = { active: false, total: 0, baselineCompleted: 0 };
  let rebuildRunning = false;
  let lastRenumberStats = null; // { done, total } pages after last successful renumber
  let indexRunning = false;
  let lastIndexStats = null; // { done, total } pages after last successful index build
  let filterRunning = false;
  let playlistRunning = false;
  let favAddRunning = false;
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
    durMinMin: '',
    durMaxMin: '',
    matchedIds: null, // Set | null (null = filter inactive)
    matchCount: null,
    active: false,
  };
  /**
   * Dirty flags: set when stores may lag behind site/disk; cleared by Scan,
   * Build/Refresh, or successful index patches. Show matches refreshes only
   * what is dirty/missing — no background auto-sync on every favorite change.
   */
  let diskIndexDirty = false;
  let listIndexDirty = false;
  let favoritesIndexDirty = false;
  let playlistIndexesDirty = false;
  let lastDiskScanAt = 0;
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

  function filterIsAll() {
    return diskFilterIsAll() && collectionFilterIsAll();
  }

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
   * Match chips / duration only edit pending rules. If a frozen View is showing,
   * drop it so the page is not still filtered by the previous Show matches result.
   */
  function invalidateFrozenView() {
    if (!filterState.active && !filterState.matchedIds) return;
    filterState.active = false;
    filterState.matchedIds = null;
    filterState.matchCount = null;
    viewDeps = null;
    applyFilterToCurrentPage();
  }

  /** Drop frozen View when a store it depended on changed (Edit, download, dirty). */
  function invalidateFrozenViewForStoreChange() {
    if (!filterState.active && !filterState.matchedIds) return;
    // Edit patches always clear View (selection set changed). Dirty-only paths
    // use frozenViewStoresDirty via All matches; downloads pass forceDisk below.
    invalidateFrozenView();
    updateFilterBarLabels();
  }

  function invalidateFrozenViewIfDiskChanged() {
    if (!filterState.active && !filterState.matchedIds) return;
    if (viewDeps && !viewDeps.disk) return;
    invalidateFrozenView();
    updateFilterBarLabels();
  }

  function onMatchRuleEdited() {
    invalidateFrozenView();
    updateFilterBarLabels();
  }

  function indexCountDrifted(liveTotal, indexed) {
    const live = Number(liveTotal) || 0;
    const n = Number(indexed) || 0;
    if (!live || !n) return false;
    return Math.abs(live - n) > Math.max(5, Math.floor(live * 0.02));
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
          detailUrl: hit.detailUrl || `https://rule34video.com/video/${key}/`,
          favoritePage: Number(hit.favoritePage) || 0,
          cardIndex: Number.isInteger(hit.cardIndex) ? hit.cardIndex : 0,
          durationSec: coerceDurationSec(hit.durationSec),
        };
      }
      return {
        videoId: key,
        title: key,
        detailUrl: `https://rule34video.com/video/${key}/`,
        favoritePage: 0,
        cardIndex: 0,
        durationSec: null,
      };
    });
  }

  async function persistIndex(scope, videos) {
    const list = Array.isArray(videos) ? videos : [];
    const next = {
      builtAt: Date.now(),
      favTotal: list.length,
      videos: list,
      scope: scope || 'favorites',
    };
    await send('FAV_INDEX_SET', { index: next, scope: scope || 'favorites' });
    if (scope === indexScopeKey()) {
      favIndexCache = next;
      listIndexDirty = false;
      lastIndexStats = lastIndexStats || null;
      scanFavTotal = list.length;
    }
    if (scope === 'favorites') {
      myFavIdSet = new Set(list.map((v) => String(v.videoId)));
      favoritesIndexDirty = false;
      if (!isPlaylistDetailPage()) {
        favIndexCache = next;
        listIndexDirty = false;
        scanFavTotal = list.length;
      }
    }
    if (String(scope || '').startsWith('playlist:')) {
      invalidatePlaylistMembershipCache();
      playlistIndexesDirty = false;
    }
    updateFilterBarLabels();
    return next;
  }

  /** Remove ids from a stored list index. Never writes a brand-new partial index. */
  async function patchIndexRemoveIds(scope, ids) {
    const want = new Set((ids || []).map(String).filter(Boolean));
    if (!want.size) return null;
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
      invalidateFrozenViewForStoreChange();
      return null;
    }
    const videos = idx.videos.filter((v) => !want.has(String(v.videoId)));
    if (videos.length === idx.videos.length) return idx;
    const next = await persistIndex(scope, videos);
    invalidateFrozenViewForStoreChange();
    return next;
  }

  /**
   * Add items to an existing list index. If no index exists yet, mark dirty
   * instead of writing a tiny partial index that would break Show matches.
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
    const videos = [...idx.videos];
    const seen = new Set(videos.map((v) => String(v.videoId)));
    let added = 0;
    batch.forEach((it) => {
      const id = String(it?.videoId || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      added += 1;
      videos.push({
        videoId: id,
        title: it.title || id,
        detailUrl: it.detailUrl || `https://rule34video.com/video/${id}/`,
        favoritePage: Number(it.favoritePage) || 0,
        cardIndex: Number.isInteger(it.cardIndex) ? it.cardIndex : 0,
        durationSec: coerceDurationSec(it.durationSec),
      });
    });
    if (!added) {
      if (scope === 'favorites') {
        myFavIdSet = new Set(videos.map((v) => String(v.videoId)));
        favoritesIndexDirty = false;
      }
      return idx;
    }
    const next = await persistIndex(scope, videos);
    invalidateFrozenViewForStoreChange();
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
    if (!scanned || !localIdSet.size || diskIndexDirty) {
      await doScan();
    }
  }

  /**
   * Current list index for Show matches / Duration / cross-page Local.
   * Empty → Build; dirty or count drift → Refresh; otherwise reuse.
   */
  async function ensureFreshListIndexForMatch() {
    await loadFavIndexCache();
    const liveTotal = detectFavoritesTotal();
    const indexed = favIndexCache?.videos?.length || 0;
    if (!indexed) {
      await buildFavIndex({ force: true });
      listIndexDirty = false;
      return;
    }
    if (listIndexDirty || indexCountDrifted(liveTotal, indexed)) {
      await buildFavIndex({ force: true });
      listIndexDirty = false;
    }
  }

  /** Favorites index used by Favorited/Unfavorited (and Prune keep-set). */
  async function ensureFreshFavoritesIndexForMatch({ progressEl = null, forceRebuild = false } = {}) {
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
    const applyBtn =
      progressEl ||
      qs(document, `.${NS}-controls [data-act="filter-apply"]`) ||
      qs(document, `.${NS}-filterbar [data-act="filter-apply"]`);
    await buildFavoritesIndexRemote({ progressEl: applyBtn });
    favoritesIndexDirty = false;
    return myFavIdSet;
  }

  function detectFavoritesTotal() {
    const hit = detectLibraryTotalFromDom();
    if (hit) return hit;
    const maxP = maxPageNumber();
    const per = Math.max(parseCards().length, 1);
    if (maxP > 1) return maxP * per;
    return per;
  }

  function updateToolbarLabels() {
    updateFavCountBar();
    const root = qs(document, `.${NS}-controls`) || document;
    const scanBtn = qs(root, `[data-act="scan"]`);
    if (scanBtn) {
      scanBtn.textContent =
        scanMatched != null && scanFavTotal != null
          ? `Scan local (${scanMatched}/${scanFavTotal})`
          : 'Scan local';
    }
    const clearBtn = qs(root, `[data-act="clear"]`);
    if (clearBtn) {
      if (selProgress) {
        // (a/b) = ath page among b pages being collected.
        clearBtn.textContent = `Clear · (${selProgress.current}/${selProgress.total})`;
      } else {
        clearBtn.textContent = `Clear · ${selCountCached}`;
      }
    }
    const stopBtn = qs(root, `[data-act="stop"]`);
    if (stopBtn) {
      const downloading = !!(stopLabelCached && stopLabelCached !== 'idle');
      stopBtn.hidden = !downloading;
      stopBtn.disabled = !downloading;
      stopBtn.textContent = downloading ? `Stop (${stopLabelCached})` : 'Stop';
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
    if (rebuildBtn && !rebuildRunning) {
      rebuildBtn.textContent =
        lastRenumberStats != null
          ? `Renumber (${lastRenumberStats.done}/${lastRenumberStats.total})`
          : 'Renumber';
      rebuildBtn.disabled = false;
    }
    const favAddBtn = qs(root, `[data-act="fav-add"]`);
    if (favAddBtn && !favAddRunning) {
      favAddBtn.disabled = false;
      favAddBtn.textContent = 'Add to Favorites';
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
    ];
    toggles.forEach(([act, on, label]) => {
      const btn = qs(bar, `[data-act="${act}"]`);
      if (!btn) return;
      btn.classList.toggle('is-active', !!on);
      if (label) btn.textContent = label;
      btn.removeAttribute('title');
    });
    const idxBtn = qs(bar, '[data-act="index-build"]');
    if (idxBtn && !indexRunning) {
      if (lastIndexStats != null) {
        const verb = favIndexCache?.videos?.length ? 'Refresh index' : 'Build index';
        idxBtn.textContent = `${verb} (${lastIndexStats.done}/${lastIndexStats.total})`;
      } else {
        idxBtn.textContent = favIndexCache?.videos?.length ? 'Refresh index' : 'Build index';
      }
      idxBtn.disabled = false;
      if (isPlaylistDetailPage()) {
        idxBtn.title =
          'Indexes this playlist. Favorited/Unfavorited uses the Favorites index (built on Show matches if missing, or via Build index on My Favorites).';
      } else {
        idxBtn.title =
          'Indexes My Favorites. In playlist / Not in playlist needs every playlist indexed separately.';
      }
    }
    const applyBtn = qs(bar, '[data-act="filter-apply"]');
    const showAllBtn = qs(bar, '[data-act="filter-show-all"]');
    if (applyBtn && !filterRunning) {
      applyBtn.disabled = false;
      if (filterState.active && filterState.matchCount != null) {
        applyBtn.textContent = `Show matches (${formatFavCount(filterState.matchCount)})`;
      } else {
        applyBtn.textContent = 'Show matches';
      }
      applyBtn.classList.toggle('is-active-view', !!filterState.active);
    }
    if (showAllBtn && !filterRunning) {
      showAllBtn.disabled = false;
      showAllBtn.classList.toggle('is-active-view', !filterState.active);
    }
    const plBtn = qs(bar, '[data-act="playlist-add"]');
    if (plBtn && !playlistRunning) {
      plBtn.disabled = false;
      plBtn.textContent = 'Add to playlist';
    }
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
      qs(box, '[data-act="filter-local"]') &&
      qs(box, '[data-act="filter-cloud"]') &&
      qs(box, '[data-act="filter-favorite"]') &&
      qs(box, '[data-act="filter-playlist"]') &&
      qs(box, '[data-act="filter-show-all"]') &&
      qs(box, `.${NS}-view-seg`) &&
      qs(box, '[data-act="filter-reset"]') &&
      qs(box, '[data-act="delete-favs"]') &&
      qs(box, '[data-act="index-build"]') &&
      qs(box, '[data-act="select-page"]') &&
      qs(box, '[data-act="select-pages"]') &&
      qs(box, '[data-act="select-matches"]') &&
      qs(box, '[data-act="scan"]') &&
      qs(box, '[data-act="wake-queue"]') &&
      qs(box, '[data-act="playlist-add"]') &&
      qs(box, `.${NS}-act-row`) &&
      qs(box, `[data-role="act-sync"]`) &&
      qs(box, `[data-role="act-queue"]`) &&
      qs(box, `[data-role="act-index"]`) &&
      qs(box, `[data-role="act-edit"]`) &&
      qs(box, `.${NS}-act-pipeline`) &&
      qs(box, `.${NS}-sep`) &&
      !qs(box, `.${NS}-chip-set`) &&
      !qs(box, `.${NS}-act-pages-row`) &&
      !qs(box, `.${NS}-pages-step`) &&
      !qs(box, `.${NS}-filter-dur`) &&
      !qs(box, `.${NS}-field-label`) &&
      qs(box, `.${NS}-dur`) &&
      qs(box, '[data-act="filter-local"]')?.nextElementSibling?.getAttribute('data-act') ===
        'filter-cloud' &&
      !!(
        qs(box, '[data-act="scan"]').compareDocumentPosition(qs(box, '[data-act="download"]')) &
        Node.DOCUMENT_POSITION_FOLLOWING
      ) &&
      qs(box, '[data-role="act-sync"]')?.contains(qs(box, '[data-act="scan"]')) &&
      qs(box, '[data-role="act-queue"]')?.contains(qs(box, '[data-act="download"]'));
    if (ok) {
      // Playlist page gets Add to Favorites between playlist-add and Unfavorite.
      // Favorites-only Renumber (global ordinals) and Prune local; playlist must not show them.
      const hasFavAdd = !!qs(box, '[data-act="fav-add"]');
      const hasRenumber = !!qs(box, '[data-act="rebuild-ordinals"]');
      const hasPrune = !!qs(box, '[data-act="prune-local"]');
      const favBtn = qs(box, '[data-act="fav-add"]');
      const delBtn = qs(box, '[data-act="delete-favs"]');
      const favBeforeDel =
        !favBtn ||
        !delBtn ||
        !!(favBtn.compareDocumentPosition(delBtn) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (
        wantFavAdd !== hasFavAdd ||
        wantRenumber !== hasRenumber ||
        wantPrune !== hasPrune ||
        (hasFavAdd && !favBeforeDel)
      ) {
        box.remove();
        box = null;
      } else {
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
            <span class="${NS}-sep" aria-hidden="true"></span>
            <button type="button" class="${NS}-btn" data-act="fav-add">Add to Favorites</button>`
      : '';
    const renumberBtn = wantRenumber
      ? `
          <span class="${NS}-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-btn" data-act="rebuild-ordinals">Renumber</button>`
      : '';
    const pruneBtn = wantPrune
      ? `
            <span class="${NS}-sep" aria-hidden="true"></span>
            <button type="button" class="${NS}-btn ${NS}-btn--danger" data-act="prune-local">Prune local</button>`
      : '';
    const deleteLabel = wantFavAdd ? 'Remove from list' : 'Unfavorite';
    box.innerHTML = `
      <div class="${NS}-pipeline" aria-label="Filter pipeline">
        <section class="${NS}-step" aria-label="Match rules">
          <strong class="${NS}-step-name">Match</strong>
          <span class="${NS}-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-chip is-active" data-act="filter-local">Local</button>
          <button type="button" class="${NS}-chip is-active" data-act="filter-cloud">Not local</button>
          <span class="${NS}-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-chip is-active" data-act="filter-favorite">${coll.member}</button>
          <button type="button" class="${NS}-chip is-active" data-act="filter-playlist">${coll.nonMember}</button>
          <span class="${NS}-sep" aria-hidden="true"></span>
          <label class="${NS}-dur">
            <span class="${NS}-dur__label">Duration</span>
            <span class="${NS}-paren">(</span>
            <input type="number" min="0" step="1" inputmode="numeric" placeholder="min" data-role="dur-min" aria-label="Duration min" />
            <span class="${NS}-paren-sep">–</span>
            <input type="number" min="0" step="1" inputmode="numeric" placeholder="max" data-role="dur-max" aria-label="Duration max" />
            <span class="${NS}-paren">)</span>
          </label>
          <span class="${NS}-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-btn ${NS}-btn--ghost" data-act="filter-reset">Reset match</button>
        </section>
        <section class="${NS}-step" aria-label="Apply to view">
          <strong class="${NS}-step-name">View</strong>
          <span class="${NS}-sep" aria-hidden="true"></span>
          <div class="${NS}-btn-pair ${NS}-view-seg" role="group" aria-label="View mode">
            <button type="button" class="${NS}-btn" data-act="filter-apply">Show matches</button>
            <button type="button" class="${NS}-btn" data-act="filter-show-all">Show all</button>
          </div>
        </section>
        <section class="${NS}-step" aria-label="Select videos">
          <strong class="${NS}-step-name">Select</strong>
          <span class="${NS}-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-btn" data-act="select-page">This page</button>
          <span class="${NS}-sep" aria-hidden="true"></span>
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
          <span class="${NS}-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-btn ${NS}-btn--accent" data-act="select-matches">All matches</button>
          <span class="${NS}-sep" aria-hidden="true"></span>
          <button type="button" class="${NS}-btn ${NS}-btn--muted" data-act="clear">Clear · 0</button>
        </section>
      </div>
      <div class="${NS}-act-row" aria-label="Action pipeline">
        <div class="${NS}-pipeline ${NS}-act-pipeline">
          <section class="${NS}-step" data-role="act-sync" aria-label="Sync local library">
            <strong class="${NS}-step-name">Sync</strong>
            <span class="${NS}-sep" aria-hidden="true"></span>
            <button type="button" class="${NS}-btn" data-act="scan">Scan local</button>
          </section>
          <section class="${NS}-step" data-role="act-queue" aria-label="Download queue">
            <strong class="${NS}-step-name">Queue</strong>
            <span class="${NS}-sep" aria-hidden="true"></span>
            <div class="${NS}-btn-pair" role="group" aria-label="Download controls">
              <button type="button" class="${NS}-btn ${NS}-btn--primary" data-act="download">Download</button>
              <button type="button" class="${NS}-btn" data-act="stop" hidden>Stop</button>
            </div>
            <span class="${NS}-sep" aria-hidden="true"></span>
            <button type="button" class="${NS}-btn" data-act="wake-queue">Wake queue</button>
          </section>
          <section class="${NS}-step" data-role="act-index" aria-label="Build indexes">
            <strong class="${NS}-step-name">Index</strong>
            <span class="${NS}-sep" aria-hidden="true"></span>
            <button type="button" class="${NS}-btn" data-act="index-build">Build index</button>${renumberBtn}
          </section>
          <section class="${NS}-step" data-role="act-edit" aria-label="Edit library">
            <strong class="${NS}-step-name">Edit</strong>
            <span class="${NS}-sep" aria-hidden="true"></span>
            <button type="button" class="${NS}-btn" data-act="playlist-add">Add to playlist</button>${favAdd}
            <span class="${NS}-sep" aria-hidden="true"></span>
            <button type="button" class="${NS}-btn ${NS}-btn--danger" data-act="delete-favs">${deleteLabel}</button>${pruneBtn}
          </section>
        </div>
      </div>
    `;
    const minIn = qs(box, '[data-role="dur-min"]');
    const maxIn = qs(box, '[data-role="dur-max"]');
    if (minIn) minIn.value = filterState.durMinMin;
    if (maxIn) maxIn.value = filterState.durMaxMin;
    placeControls(box);
    updateToolbarLabels();
    wirePageRangeInputs(box);
    wireDurationFilterInputs(box);
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

  function placeFilterBar(bar) {
    placeControls(bar);
  }

  async function buildFavIndex({ force = true } = {}) {
    if (indexRunning) return favIndexCache;
    if (!force && favIndexCache?.videos?.length) return favIndexCache;
    indexRunning = true;
    setError('');
    const btn = qs(document, `.${NS}-controls [data-act="index-build"]`) ||
      qs(document, `.${NS}-filterbar [data-act="index-build"]`);
    const maxPage = maxPageNumber();
    if (btn) {
      btn.disabled = true;
      btn.textContent = `Indexing 0/${maxPage}`;
    }
    const videos = [];
    const seen = new Set();
    try {
      for (let page = 1; page <= maxPage; page += 1) {
        if (btn) btn.textContent = `Indexing ${page - 1}/${maxPage}`;
        const data = await fetchListPage(page);
        const batch = data.items || [];
        if (page === 1 && batch.length) stablePerPage = batch.length;
        batch.forEach((it, idx) => {
          const id = String(it.videoId || '');
          if (!id || seen.has(id)) return;
          seen.add(id);
          videos.push({
            videoId: id,
            title: it.title || id,
            detailUrl: it.detailUrl || `https://rule34video.com/video/${id}/`,
            favoritePage: Number(it.favoritePage) || page,
            cardIndex: Number.isInteger(it.cardIndex) ? it.cardIndex : idx,
            durationSec: coerceDurationSec(it.durationSec),
          });
        });
        if (data.maxPage && data.maxPage > maxPage) {
          // grow if site reports higher
        }
        if (btn) btn.textContent = `Indexing ${page}/${maxPage}`;
        if (page < maxPage) await new Promise((r) => setTimeout(r, 800));
      }
      if (!videos.length) throw new Error('indexed 0 videos — check login / page parse');
      scanFavTotal = videos.length;
      lastIndexStats = { done: maxPage, total: maxPage };
      const index = {
        builtAt: Date.now(),
        favTotal: videos.length,
        videos,
        scope: indexScopeKey(),
      };
      favIndexCache = index;
      await send('FAV_INDEX_SET', { index, scope: indexScopeKey() });
      listIndexDirty = false;
      if (!isPlaylistDetailPage()) {
        myFavIdSet = new Set(videos.map((v) => String(v.videoId)));
        favoritesIndexDirty = false;
      } else {
        invalidatePlaylistMembershipCache();
        playlistIndexesDirty = false;
      }
      updateFavCountBar();
      if (btn) btn.textContent = `Refresh index (${maxPage}/${maxPage})`;
      updateFilterBarLabels();
      return favIndexCache;
    } catch (err) {
      setError(`Index failed: ${err.message || String(err)}`);
      return favIndexCache;
    } finally {
      indexRunning = false;
      updateFilterBarLabels();
    }
  }

  /**
   * Build/refresh the Favorites index via background fetches (works on playlist pages).
   * Does not replace favIndexCache when the current page is a playlist.
   */
  async function buildFavoritesIndexRemote({ progressEl } = {}) {
    if (favoritesRemoteIndexRunning) {
      // Wait briefly for an in-flight build rather than starting a second crawl.
      for (let i = 0; i < 600 && favoritesRemoteIndexRunning; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
      await ensureMyFavIdSet({ force: true });
      return myFavIdSet;
    }
    favoritesRemoteIndexRunning = true;
    const label = (text) => {
      if (progressEl) progressEl.textContent = text;
    };
    try {
      label('Indexing Favorites 0/…');
      const videos = [];
      const seen = new Set();
      let maxPage = 1;
      for (let page = 1; page <= maxPage; page += 1) {
        label(`Indexing Favorites ${page - 1}/${maxPage}`);
        const data = await send('FETCH_FAVORITES_PAGE', { page });
        const batch = data?.items || [];
        if (page === 1) {
          maxPage = Math.max(1, Number(data?.maxPage) || 1);
          label(`Indexing Favorites 0/${maxPage}`);
        } else if (data?.maxPage && Number(data.maxPage) > maxPage) {
          maxPage = Number(data.maxPage);
        }
        batch.forEach((it, idx) => {
          const id = String(it.videoId || '');
          if (!id || seen.has(id)) return;
          seen.add(id);
          videos.push({
            videoId: id,
            title: it.title || id,
            detailUrl: it.detailUrl || `https://rule34video.com/video/${id}/`,
            favoritePage: Number(it.favoritePage) || page,
            cardIndex: Number.isInteger(it.cardIndex) ? it.cardIndex : idx,
            durationSec: coerceDurationSec(it.durationSec),
          });
        });
        label(`Indexing Favorites ${page}/${maxPage}`);
        if (page < maxPage) await new Promise((r) => setTimeout(r, 800));
      }
      if (!videos.length) {
        throw new Error('Favorites index returned 0 videos — check login');
      }
      const index = {
        builtAt: Date.now(),
        favTotal: videos.length,
        videos,
        scope: 'favorites',
      };
      await send('FAV_INDEX_SET', { index, scope: 'favorites' });
      myFavIdSet = new Set(videos.map((v) => String(v.videoId)));
      favoritesIndexDirty = false;
      // On Favorites page, remote build is the list index too.
      if (!isPlaylistDetailPage()) {
        favIndexCache = index;
        lastIndexStats = { done: maxPage, total: maxPage };
        scanFavTotal = videos.length;
        listIndexDirty = false;
      }
      return myFavIdSet;
    } finally {
      favoritesRemoteIndexRunning = false;
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

  function videoMatchesFilters(video, { minSec, maxSec }) {
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
    if (minSec != null || maxSec != null) {
      const dur = coerceDurationSec(video.durationSec);
      if (dur == null) return false;
      if (minSec != null && dur < minSec) return false;
      if (maxSec != null && dur > maxSec) return false;
    }
    return true;
  }

  function applyFilterToCurrentPage() {
    const cards = parseCards();
    const matched = filterState.active && filterState.matchedIds ? filterState.matchedIds : null;
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

  /** Resolve current Match rules to a video list (does not change View / selection). */
  async function collectMatchItems({ ensureIndex = true, progressEl = null } = {}) {
    // Lazy freshness: only refresh disk/index when this Match needs them and they are missing/dirty/drifted.
    if (progressEl && !diskFilterIsAll() && (!scanned || !localIdSet.size || diskIndexDirty)) {
      progressEl.textContent = 'Scanning…';
    }
    await ensureFreshDiskForMatch();

    await loadFavIndexCache();
    if (!collectionFilterIsAll()) {
      if (isPlaylistDetailPage()) {
        try {
          await ensureFreshFavoritesIndexForMatch({ progressEl });
        } catch (err) {
          throw new Error(
            'Favorited/Unfavorited needs a Favorites index — ' +
              (err?.message || String(err)),
          );
        }
        if (!(myFavIdSet && myFavIdSet.size)) {
          throw new Error(
            'Favorited/Unfavorited needs a Favorites index — Build/Refresh on My Favorites, or retry Show matches.',
          );
        }
      } else {
        await ensurePlaylistMembershipSet({ force: true });
        let playlists = [];
        try {
          const listed = await send('SITE_PLAYLIST_LIST');
          playlists = (listed?.playlists || []).filter((p) => {
            const id = String(p?.id || '').trim();
            return /^[1-9]\d*$/.test(id);
          });
        } catch (err) {
          throw new Error(
            'In playlist / Not in playlist needs your playlist list — ' +
              (err?.message || String(err)),
          );
        }
        if (!playlists.length) {
          throw new Error(
            'In playlist / Not in playlist: no site playlists found. Open /my/playlists/ and retry.',
          );
        }
        const have = new Set(playlistMembershipScopes || []);
        const missing = playlists.filter((p) => !have.has(`playlist:${String(p.id)}`));
        if (missing.length) {
          const labels = missing.map((p) => {
            try {
              return formatPlaylistOptionLabel(p);
            } catch (_) {
              return `Playlist (${p.id})`;
            }
          });
          const shown = labels.slice(0, 8).join('; ');
          const more = labels.length > 8 ? ` (+${labels.length - 8} more)` : '';
          throw new Error(
            `In playlist / Not in playlist needs every playlist indexed (${have.size}/${playlists.length}). ` +
              `Still missing: ${shown}${more}. Open each and Build/Refresh index.`,
          );
        }
        // Content may be dirty after Edit when a patch could not run — refuse rather than silent stale.
        if (playlistIndexesDirty) {
          throw new Error(
            'Playlist indexes changed and need Refresh. Open each edited playlist and Build/Refresh index, then retry.',
          );
        }
      }
    }
    const needsDur = readDurationFilterInputs();
    const wantsDur = needsDur.minSec != null || needsDur.maxSec != null;
    const wantsDisk = !diskFilterIsAll();
    const wantsColl = !collectionFilterIsAll();
    if (!wantsDur && !wantsDisk && !wantsColl) {
      return { matched: [], emptyRules: true };
    }
    if (ensureIndex) {
      if (progressEl && (listIndexDirty || !(favIndexCache?.videos?.length))) {
        progressEl.textContent = listIndexDirty ? 'Refreshing index…' : 'Indexing…';
      } else if (progressEl) {
        const liveTotal = detectFavoritesTotal();
        const indexed = favIndexCache?.videos?.length || 0;
        if (indexCountDrifted(liveTotal, indexed)) progressEl.textContent = 'Refreshing index…';
      }
      await ensureFreshListIndexForMatch();
    }
    const videos = favIndexCache?.videos || [];
    if (!videos.length) {
      throw new Error(
        'No list index — click Build/Refresh index first. ' +
          'Scan marks Local vs Not local; Index lists every video so filters can select across pages.',
      );
    }
    const bounds = readDurationFilterInputs();
    const matched = [];
    videos.forEach((v) => {
      if (videoMatchesFilters(v, bounds)) matched.push(v);
    });
    return { matched, emptyRules: false };
  }

  async function applyLibraryFilter({ ensureIndex = true } = {}) {
    if (filterRunning) return;
    filterRunning = true;
    setError('');
    const applyBtn =
      qs(document, `.${NS}-controls [data-act="filter-apply"]`) ||
      qs(document, `.${NS}-filterbar [data-act="filter-apply"]`);
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Showing…';
    }
    try {
      const { matched, emptyRules } = await collectMatchItems({
        ensureIndex,
        progressEl: applyBtn,
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
      applyFilterToCurrentPage();
      updateFilterBarLabels();
      if (!matched.length) setFlash('Filter matched 0 videos');
    } catch (err) {
      setError(`Filter failed: ${err.message || String(err)}`);
    } finally {
      filterRunning = false;
      updateFilterBarLabels();
    }
  }

  /** Select every video matching the frozen View, or current Match rules if View is off. */
  async function selectAllMatches() {
    setError('');
    try {
      let matched = [];
      let emptyRules = false;
      // Stale stores that this View depended on → drop View and re-collect.
      if (frozenViewStoresDirty()) {
        invalidateFrozenView();
        updateFilterBarLabels();
      }
      if (filterState.active && filterState.matchedIds) {
        // Keep Select aligned with the frozen View (not live chip toggles).
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
            detailUrl: `https://rule34video.com/video/${id}/`,
          };
        });
      } else {
        const result = await collectMatchItems({ ensureIndex: true });
        matched = result.matched;
        emptyRules = result.emptyRules;
      }
      if (emptyRules) {
        setError('Set Match rules first (or use This page / Page range)');
        return;
      }
      if (!matched.length) {
        setError(
          filterState.active
            ? 'View has 0 matches — adjust Match rules and Show matches'
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
      await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
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
    filterState.active = false;
    filterState.matchedIds = null;
    filterState.matchCount = null;
    viewDeps = null;
    applyFilterToCurrentPage();
    updateFilterBarLabels();
    setError('');
  }

  /** Reset Match rules and release the filtered view. */
  async function resetMatchRules() {
    filterState.active = false;
    filterState.matchedIds = null;
    filterState.matchCount = null;
    viewDeps = null;
    filterState.localOn = true;
    filterState.cloudOn = true;
    filterState.favoriteOn = true;
    filterState.playlistOn = true;
    filterState.durMinMin = '';
    filterState.durMaxMin = '';
    const bar = qs(document, `.${NS}-controls`) || qs(document, `.${NS}-filterbar`);
    const minIn = bar && qs(bar, '[data-role="dur-min"]');
    const maxIn = bar && qs(bar, '[data-role="dur-max"]');
    if (minIn) minIn.value = '';
    if (maxIn) maxIn.value = '';
    applyFilterToCurrentPage();
    updateFilterBarLabels();
    setError('');
  }

  /** @deprecated name kept for older call sites — clears visual filter only. */
  async function clearLibraryFilterVisual() {
    return showAllView();
  }

  async function selectPageRangeFromInputs() {
    const bar = qs(document, `.${NS}-controls`) || document;
    const startIn = qs(bar, '[data-role="select-start"]');
    const endIn = qs(bar, '[data-role="select-end"]');
    syncPageRangePlaceholders();
    const startRaw = String(startIn?.value || '').trim();
    const endRaw = String(endIn?.value || '').trim();
    // Empty side uses gray placeholder suggestion (a+10 / b-10).
    const start = startRaw !== '' ? Number(startRaw) : Number(startIn?.placeholder);
    const end = endRaw !== '' ? Number(endRaw) : Number(endIn?.placeholder);
    const maxPage = maxPageNumber();
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      setError('Enter a valid page range (from–to)');
      return;
    }
    if (end > maxPage) {
      setError(`End page ${end} is past max page ${maxPage}`);
      return;
    }
    setError('');
    await collectPages(start, end);
  }

  const PAGE_RANGE_SPAN = 10;

  /** Keep empty from/to placeholders as gray a+10 / b-10 suggestions. */
  function syncPageRangePlaceholders() {
    const bar = qs(document, `.${NS}-controls`) || document;
    const startIn = qs(bar, '[data-role="select-start"]');
    const endIn = qs(bar, '[data-role="select-end"]');
    if (!startIn || !endIn) return;
    const maxPage = maxPageNumber();
    const startRaw = String(startIn.value || '').trim();
    const endRaw = String(endIn.value || '').trim();
    const startN = Number(startRaw);
    const endN = Number(endRaw);

    if (startRaw === '') {
      if (endRaw !== '' && Number.isInteger(endN) && endN >= 1) {
        startIn.placeholder = String(Math.max(1, endN - PAGE_RANGE_SPAN));
      } else {
        startIn.placeholder = 'from';
      }
    } else {
      startIn.placeholder = 'from';
    }

    if (endRaw === '') {
      if (startRaw !== '' && Number.isInteger(startN) && startN >= 1) {
        const sug = startN + PAGE_RANGE_SPAN;
        endIn.placeholder = String(maxPage >= 1 ? Math.min(maxPage, sug) : sug);
      } else {
        endIn.placeholder = 'to';
      }
    } else {
      endIn.placeholder = 'to';
    }
  }

  function wirePageRangeInputs(bar) {
    const startIn = qs(bar, '[data-role="select-start"]');
    const endIn = qs(bar, '[data-role="select-end"]');
    if (!startIn || !endIn || startIn.dataset.rangeWired === '1') return;
    startIn.dataset.rangeWired = '1';
    endIn.dataset.rangeWired = '1';
    const onInput = () => syncPageRangePlaceholders();
    startIn.addEventListener('input', onInput);
    endIn.addEventListener('input', onInput);
    syncPageRangePlaceholders();
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
      .replace(/^my\s*playlists?\s*[:：\-–]?\s*/i, '')
      .replace(/^playlists?\s*[:：\-–]?\s*/i, '')
      .replace(/\b(public|private)\b/gi, ' ')
      .replace(/\b\d[\d\s,]*\s*videos?\b/gi, ' ')
      .replace(/\(\s*[\d,\s.]+\s*(videos?)?\s*\)/gi, ' ')
      .replace(/（\s*[\d,\s.]+\s*(videos?)?\s*）/gi, ' ')
      .replace(/\bpage\s*\d+\b/gi, ' ')
      .replace(new RegExp(`^#?${pid}\\s*[·•\\-:]?\\s*`, 'i'), '')
      .replace(new RegExp(`\\s*[#(]?${pid}[)]?\\s*$`, 'i'), '')
      .replace(/^\(\s*\)\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^(create|new|新建|edit|delete|remove|view)/i.test(t)) return '';
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
    return `${title} (${id}): ${formatPlaylistCountPart(p.videoCount)}`;
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
        empty.textContent = 'No playlists auto-detected — paste a playlist URL or ID below.';
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
      const manualWrap = document.createElement('div');
      manualWrap.style.cssText = 'margin:8px 0 0;';
      const manualLab = document.createElement('label');
      manualLab.style.cssText = 'display:block;font-size:12px;color:#cfd6dd;margin-bottom:4px;';
      manualLab.textContent = 'Or playlist URL / ID';
      const manual = document.createElement('input');
      manual.type = 'text';
      manual.className = `${NS}-playlist-manual`;
      manual.placeholder = 'https://rule34video.com/my/playlists/123456/';
      manual.style.cssText =
        'width:100%;box-sizing:border-box;padding:7px 10px;border-radius:6px;border:1px solid #3a4550;background:#1a222a;color:#e8eef4;';
      manualWrap.appendChild(manualLab);
      manualWrap.appendChild(manual);
      const actions = document.createElement('div');
      actions.className = `${NS}-modal__actions`;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = `${NS}-btn`;
      cancel.dataset.act = 'cancel';
      cancel.textContent = 'Cancel';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = `${NS}-btn`;
      saveBtn.dataset.act = 'save';
      saveBtn.textContent = 'Move (keep favorites)';
      const moveBtn = document.createElement('button');
      moveBtn.type = 'button';
      moveBtn.className = `${NS}-btn ${NS}-btn--danger`;
      moveBtn.dataset.act = 'move';
      moveBtn.textContent = 'Move (remove from favorites)';
      actions.appendChild(cancel);
      actions.appendChild(saveBtn);
      actions.appendChild(moveBtn);
      modal.appendChild(h3);
      modal.appendChild(list);
      modal.appendChild(manualWrap);
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
        add(manual.value);
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
          setError('Select or paste a valid playlist URL / ID first');
          return;
        }
        close({ playlistIds, playlistId: playlistIds[0], mode });
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          finish('save');
        }
      };
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', (e) => {
        const act = e.target?.dataset?.act;
        if (e.target === backdrop || act === 'cancel') close(null);
        else if (act === 'save') finish('save');
        else if (act === 'move') finish('move');
      });
      document.body.appendChild(backdrop);
      if (valid.length) saveBtn.focus();
      else manual.focus();
    });
  }

  function favoritesBlockId() {
    const form = findFavoritesControlForm();
    return (
      form?.getAttribute('data-block-id') ||
      qs(document, '#list_videos_my_favourite_videos')?.getAttribute('data-block-id') ||
      'list_videos_my_favourite_videos'
    );
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

  function clearInjectedDeletes(form) {
    const root = form || document;
    qsa(root, `input[data-${NS}-delete="1"]`).forEach((el) => el.remove());
  }

  /**
   * KVS move_multi reads checked boxes from form[data-controls], but thumb
   * checkboxes live elsewhere — so inject hidden checked delete[] here.
   */
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

  /** Page-world KVS move using explicit delete ids + control form data-parameters. */
  function kvsAjaxMove(playlistId, videoIds) {
    const pid = String(playlistId);
    const ids = videoIds.map(String);
    const msgType = `${NS}-kvs-move-result`;
    return new Promise((resolve) => {
      let done = false;
      const finish = (data) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(data);
      };
      const onMsg = (ev) => {
        if (ev.source !== window) return;
        if (!ev.data || ev.data.type !== msgType) return;
        finish(ev.data);
      };
      window.addEventListener('message', onMsg);
      const payload = { msgType, pid, ids };
      try {
        const script = document.createElement('script');
        script.textContent = `(${function (p) {
          function send(msg) {
            window.postMessage(Object.assign({ type: p.msgType }, msg), '*');
          }
          try {
            var $ = window.jQuery;
            if (!$ || !$.ajax || !$.param) {
              send({ ok: false, detail: 'jQuery missing' });
              return;
            }
            var btn =
              document.querySelector('[data-action="move_multi"]') ||
              document.querySelector('[data-action="move_to_playlist"]');
            var form =
              (btn && (btn.closest('form[data-controls]') || btn.closest('form'))) ||
              document.querySelector('#list_videos_my_favourite_videos form[data-controls]') ||
              document.querySelector('form[data-controls]') ||
              document.querySelector('#list_videos_my_favourite_videos');
            if (!form) {
              send({ ok: false, detail: 'control form missing' });
              return;
            }
            var blockId =
              form.getAttribute('data-block-id') ||
              'list_videos_my_favourite_videos';
            var raw = form.getAttribute('data-parameters') || '';
            var params = {};
            String(raw)
              .split(';')
              .forEach(function (pair) {
                var parts = pair.split(':');
                if (parts.length === 2) {
                  try {
                    params[parts[0]] = decodeURIComponent(parts[1]).replace(/\+/g, ' ');
                  } catch (e) {
                    params[parts[0]] = parts[1];
                  }
                }
              });
            params.function = 'get_block';
            params.block_id = blockId;
            params.move_to_playlist_id = p.pid;
            params.delete = p.ids.slice();
            var href = String(window.location.href).split('#')[0];
            var url = href + (href.indexOf('?') >= 0 ? '&' : '?') + 'mode=async&format=json&' + $.param(params);
            $.ajax({
              url: url,
              type: 'GET',
              success: function (t) {
                if (typeof t !== 'object') {
                  try {
                    t = JSON.parse(t);
                  } catch (e) {
                    send({ ok: false, detail: 'non-JSON', url: url });
                    return;
                  }
                }
                send({
                  ok: !!(t && t.status === 'success'),
                  detail:
                    (t && t.errors && t.errors[0] && (t.errors[0].code || t.errors[0].message)) ||
                    (t && t.status) ||
                    'unknown',
                  url: url,
                  deleteCount: p.ids.length,
                });
              },
              error: function (xhr) {
                send({ ok: false, detail: 'HTTP ' + (xhr && xhr.status), url: url });
              },
            });
          } catch (err) {
            send({ ok: false, detail: String(err && err.message ? err.message : err) });
          }
        }})(${JSON.stringify(payload)});`;
        (document.documentElement || document.head).appendChild(script);
        script.remove();
      } catch (err) {
        finish({ ok: false, detail: String(err.message || err) });
        return;
      }
      setTimeout(() => finish({ ok: false, detail: 'ajax timeout/CSP' }), 12000);
    });
  }

  async function contentAjaxMove(playlistId, videoIds) {
    const form = findMoveControlForm();
    const blockId = form?.getAttribute('data-block-id') || favoritesBlockId();
    const params = { ...favoritesFormDataParameters() };
    const raw = form?.getAttribute('data-parameters') || '';
    if (raw) {
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
    }
    const href = String(location.href).split('#')[0];
    const base = {
      ...params,
      function: 'get_block',
      block_id: blockId,
      move_to_playlist_id: String(playlistId),
    };
    // Match jQuery.param array style (delete[]) then plain repeated delete=.
    const encodings = ['brackets', 'plain'];
    let last = { ok: false, detail: 'no attempt', url: '', deleteCount: videoIds.length };
    for (const enc of encodings) {
      const q = new URLSearchParams({ mode: 'async', format: 'json' });
      Object.entries(base).forEach(([k, v]) => {
        if (v == null || v === '') return;
        q.set(k, String(v));
      });
      videoIds.forEach((id) => {
        if (enc === 'brackets') q.append('delete[]', String(id));
        else q.append('delete', String(id));
      });
      const url = `${href}${href.includes('?') ? '&' : '?'}${q.toString()}`;
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
        last = { ok: false, detail: `non-JSON HTTP ${res.status}`, url, deleteCount: videoIds.length };
        continue;
      }
      last = {
        ok: String(json?.status) === 'success',
        detail: json?.errors?.[0]?.code || json?.status || 'unknown',
        url,
        deleteCount: videoIds.length,
        enc,
      };
      if (last.ok) return last;
    }
    return last;
  }

  async function verifyVideosInPlaylist(playlistId, videoIds) {
    const pid = String(playlistId);
    const ids = videoIds.map(String);
    const urls = [
      `https://rule34video.com/my/playlists/${pid}/`,
      `https://rule34video.com/playlists/${pid}/`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        const html = await res.text();
        if (!html || html.length < 80) continue;
        if (/login-required|\/login\//i.test(html) && html.length < 8000) continue;
        const found = ids.filter(
          (id) => html.includes(`/video/${id}/`) || html.includes(`value="${id}"`),
        );
        return { checked: true, found, missing: ids.filter((id) => !found.includes(id)), url };
      } catch (_) {
        /* next */
      }
    }
    return { checked: false, found: [], missing: ids, url: '' };
  }

  /** Video-page style add: keeps My Favorites (fav_type=10 = playlist bucket). */
  async function addOneKeepFavorites(playlistId, videoId) {
    const pid = String(playlistId);
    const id = String(videoId);
    const variants = [
      { action: 'add_to_favourites', video_id: id, fav_type: '10', playlist_id: pid },
      { action: 'add_to_favourites', video_id: id, video_ids: [id], fav_type: '10', playlist_id: pid },
      { action: 'add_to_favourites', video_id: id, album_id: '', fav_type: '10', playlist_id: pid },
    ];
    const bases = [
      `https://rule34video.com/video/${id}/`,
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
          lastDetail = json?.errors?.[0]?.code || json?.status || 'unknown';
          if (lastDetail === 'invalid_params') continue;
        } catch (err) {
          lastDetail = String(err.message || err);
        }
      }
    }
    return { ok: false, detail: lastDetail || 'invalid_params' };
  }

  async function saveVideosToPlaylist(playlistId, videoIds) {
    const ids = videoIds.map(String);
    let ok = 0;
    let failed = 0;
    const errors = [];
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      let added = await addOneKeepFavorites(playlistId, id);
      if (!added.ok) {
        try {
          const bg = await send('SITE_PLAYLIST_ADD', {
            playlistId,
            videoIds: [id],
            mode: 'save',
          });
          if (bg?.ok > 0 || (bg?.ok === 1 && !bg?.failed)) {
            added = { ok: true };
          } else if (bg?.errors?.[0]) {
            added = { ok: false, detail: bg.errors[0] };
          }
        } catch (err) {
          added = { ok: false, detail: String(err.message || err) };
        }
      }
      if (added.ok) ok += 1;
      else {
        failed += 1;
        if (errors.length < 6) errors.push(`${id}: ${added.detail || 'failed'}`);
      }
      if (i + 1 < ids.length) await new Promise((r) => setTimeout(r, 140));
    }
    return { ok, failed, errors, total: ids.length };
  }

  async function moveVideosToPlaylist(playlistId, videoIds) {
    injectDeleteIdsIntoControlForm(videoIds);
    let moved = await kvsAjaxMove(playlistId, videoIds);
    if (!moved.ok) moved = await contentAjaxMove(playlistId, videoIds);
    return moved;
  }

  /**
   * 1) Load playlists / paste ID
   * 2) User picks Save (keep fav) or Move (leave fav); playlists are multi-select
   * 3) Run the matching site API, then verify on playlist page
   */
  async function doAddToPlaylist() {
    if (playlistRunning) return;
    playlistRunning = true;
    setError('');
    const btn =
      qs(document, `.${NS}-controls [data-act="playlist-add"]`) ||
      qs(document, `.${NS}-filterbar [data-act="playlist-add"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Playlist…';
    }
    try {
      let ids = [];
      const itemsMap = await captureNativeSelection();
      ids = Object.keys(itemsMap || {});
      if (!ids.length) {
        throw new Error('Nothing to add. Select videos first (This page / Page range / All matches).');
      }

      if (btn) btn.textContent = 'Loading playlists…';
      let playlists = [];
      try {
        const listed = await loadSitePlaylists();
        playlists = (listed.playlists || []).filter((p) => isValidPlaylistId(p.id));
      } catch (_) {
        playlists = [];
      }

      const picked = await showPlaylistModal(playlists);
      if (!picked) return;
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
          'Invalid playlist id. Open /my/playlists/, copy the playlist URL, and paste it in the dialog.',
        );
      }

      ignoreMutationsUntil = Date.now() + 3000;
      const want = new Set(ids.map(String));
      parseCards().forEach((card) => {
        if (want.has(String(card.videoId))) setCardChecked(card, true);
      });

      const selItems = selectionItemsForIds(itemsMap, ids);

      if (mode === 'move') {
        const moveTarget = playlistIds[playlistIds.length - 1];
        const saveFirst = playlistIds.slice(0, -1);
        for (let i = 0; i < saveFirst.length; i += 1) {
          if (btn) btn.textContent = `Saving extra ${i + 1}/${saveFirst.length}`;
          await saveVideosToPlaylist(saveFirst[i], ids);
        }
        if (btn) btn.textContent = `Moving 0/${ids.length}`;
        const moved = await moveVideosToPlaylist(moveTarget, ids);
        if (!moved.ok) {
          throw new Error(`Move failed: ${moved.detail || 'unknown'} (delete=${ids.length})`);
        }
        await new Promise((r) => setTimeout(r, 900));
        const verify = await verifyVideosInPlaylist(moveTarget, ids);
        clearInjectedDeletes();
        if (!verify.checked) {
          setError(
            `Move API success for ${ids.length}, but could not open playlist #${moveTarget} to verify.`,
          );
          return;
        }
        if (!verify.found.length) {
          throw new Error(
            `Move returned success but 0/${ids.length} in playlist #${moveTarget}. Check the playlist URL.`,
          );
        }
        const foundItems = selectionItemsForIds(itemsMap, verify.found);
        for (let i = 0; i < saveFirst.length; i += 1) {
          await patchIndexAddItems(`playlist:${saveFirst[i]}`, selItems);
        }
        await patchIndexAddItems(`playlist:${moveTarget}`, foundItems);
        // Move leaves My Favorites — patch Favorites index for verified ids.
        await patchIndexRemoveIds('favorites', verify.found);
        if (!isPlaylistDetailPage()) {
          ignoreMutationsUntil = Date.now() + 1200;
          const gone = new Set(verify.found.map(String));
          parseCards().forEach((card) => {
            if (gone.has(String(card.videoId))) {
              try {
                card.el.remove();
              } catch (_) {
                /* ignore */
              }
            }
          });
        }
        if (verify.missing.length) {
          setError(
            `Moved ${verify.found.length}, missing ${verify.missing.length} (${verify.missing.slice(0, 3).join(', ')}) — already left Favorites for moved ones.`,
          );
        } else {
          setError('');
          if (btn) {
            const extra =
              saveFirst.length > 0 ? ` (+${saveFirst.length} playlist${saveFirst.length > 1 ? 's' : ''})` : '';
            btn.textContent = `Moved ${verify.found.length}${extra}`;
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
        return;
      }

      // Save: add_to_favourites fav_type=10 — keeps My Favorites
      let savedOk = 0;
      let savedFail = 0;
      const savedErrors = [];
      let verifiedFound = 0;
      const patchedPlaylistIds = [];
      for (let i = 0; i < playlistIds.length; i += 1) {
        const playlistId = playlistIds[i];
        if (btn) btn.textContent = `Saving ${i + 1}/${playlistIds.length}`;
        const saved = await saveVideosToPlaylist(playlistId, ids);
        savedOk += saved.ok;
        savedFail += saved.failed;
        saved.errors.forEach((e) => {
          if (savedErrors.length < 6) savedErrors.push(e);
        });
        await new Promise((r) => setTimeout(r, 500));
        const verify = await verifyVideosInPlaylist(playlistId, ids);
        if (verify.checked) {
          verifiedFound = Math.max(verifiedFound, verify.found.length);
          if (verify.found.length) {
            await patchIndexAddItems(
              `playlist:${playlistId}`,
              selectionItemsForIds(itemsMap, verify.found),
            );
            patchedPlaylistIds.push(playlistId);
          }
        }
      }
      if (savedOk === 0) {
        throw new Error(
          `Save failed for all targets` +
            (savedErrors.length ? `: ${savedErrors.slice(0, 3).join('; ')}` : ''),
        );
      }
      if (!verifiedFound) {
        throw new Error(
          `Save API ran but 0 videos appeared in playlist page(s). ` +
            (savedErrors[0] || 'Try Move if Save keeps failing, or paste the exact playlist URL.'),
        );
      }
      if (!patchedPlaylistIds.length) {
        // Verified on page but could not patch indexes (none built yet) — mark dirty.
        playlistIndexesDirty = true;
        invalidatePlaylistMembershipCache();
        invalidateFrozenViewForStoreChange();
      }
      const parts = [`Saved ~${verifiedFound} → ${playlistIds.length} playlist(s) (Favorites kept)`];
      if (savedFail) parts.push(`${savedFail} API fail`);
      if (savedFail) setError(parts.join(' · '));
      else {
        setError('');
        if (btn) {
          btn.textContent = `Saved ${verifiedFound}`;
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    } catch (err) {
      clearInjectedDeletes();
      setError(`Playlist failed: ${err.message || String(err)}`);
    } finally {
      invalidatePlaylistMembershipCache();
      playlistRunning = false;
      updateFilterBarLabels();
      hideNativeControls();
    }
  }

  /** My Favorites bucket: fav_type=0, playlist_id=0 (video page heart). */
  async function addOneToMyFavorites(videoId) {
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
    try {
      const bg = await send('SITE_FAVOURITES_ADD', { videoIds: [id] });
      if (bg?.ok > 0) return { ok: true };
      if (bg?.errors?.[0]) lastDetail = bg.errors[0];
    } catch (err) {
      lastDetail = String(err.message || err);
    }
    return { ok: false, detail: lastDetail || 'invalid_params' };
  }

  async function saveVideosToMyFavorites(videoIds) {
    const ids = [...new Set((videoIds || []).map(String).filter((id) => /^\d+$/.test(id)))];
    let ok = 0;
    let failed = 0;
    const errors = [];
    const okIds = [];
    for (let i = 0; i < ids.length; i += 1) {
      const added = await addOneToMyFavorites(ids[i]);
      if (added.ok) {
        ok += 1;
        okIds.push(ids[i]);
      } else {
        failed += 1;
        if (errors.length < 6) errors.push(`${ids[i]}: ${added.detail || 'failed'}`);
      }
      if (i + 1 < ids.length) await new Promise((r) => setTimeout(r, 140));
    }
    return { ok, failed, errors, total: ids.length, okIds };
  }

  async function doAddSelectedToFavorites() {
    if (favAddRunning) return;
    favAddRunning = true;
    setError('');
    const btn =
      qs(document, `.${NS}-controls [data-act="fav-add"]`) ||
      qs(document, `.${NS}-toolbar [data-act="fav-add"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Adding…';
    }
    try {
      const itemsMap = await captureNativeSelection();
      const ids = Object.keys(itemsMap || {});
      if (!ids.length) throw new Error('Select videos first (pick rail / This page).');
      if (btn) btn.textContent = `Adding 0/${ids.length}`;
      const saved = await saveVideosToMyFavorites(ids);
      if (btn) btn.textContent = `Adding ${saved.ok}/${ids.length}`;
      if (saved.ok === 0) {
        throw new Error(
          `Add to Favorites failed for all ${saved.failed}` +
            (saved.errors.length ? `: ${saved.errors.slice(0, 3).join('; ')}` : ''),
        );
      }
      if (saved.okIds?.length) {
        await patchIndexAddItems('favorites', selectionItemsForIds(itemsMap, saved.okIds));
      }
      if (saved.failed) {
        setError(`Added ${saved.ok}/${saved.total} · ${saved.failed} failed (${saved.errors.slice(0, 2).join('; ')})`);
      } else {
        setError('');
        if (btn) {
          btn.textContent = `Added ${saved.ok}`;
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    } catch (err) {
      setError(`Favorites failed: ${err.message || String(err)}`);
    } finally {
      favAddRunning = false;
      if (btn && !favAddRunning) {
        btn.disabled = false;
        btn.textContent = 'Add to Favorites';
      }
      updateToolbarLabels();
    }
  }

  function ensureToolbar() {
    const bar = ensureControls();
    // ensureControls may recreate the bar; always (re)wire so clicks never die.
    wireControls();
    return bar;
  }

  function setError(msg) {
    statusFlash = String(msg || '').trim();
    statusFlashIsError = !!statusFlash;
    paintStatus();
  }

  /** Non-error status chip flash (success / info). Cleared by setError(''). */
  function setFlash(msg) {
    statusFlash = String(msg || '').trim();
    statusFlashIsError = false;
    paintStatus();
  }

  function setMeta(_text) {
    // Status lives in the row-3 status chip (ensureStatusBar / paintStatus).
  }

  function renderStatus(card, info, scannedState) {
    card.el.classList.add(`${NS}-card`);
    ensurePickRail(card);
    const pick = qs(card.el, `.${NS}-pick`);
    let box = qs(card.el, `.${NS}-status`) || (pick && qs(pick, `.${NS}-status`));

    // Only show a status line when the file exists on Mac (path only).
    if (!scannedState || !(info && info.exists)) {
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

  async function refreshLookup() {
    const cards = parseCards();
    if (!cards.length) {
      paintPaginationLocalMarks();
      return;
    }
    try {
      const data = await send('HELPER_LOOKUP', { videoIds: cards.map((c) => c.videoId) });
      lastMatches = data.results || {};
      if (data.lastScan && data.lastScan.scannedAt) scanned = true;
      ignoreMutationsUntil = Date.now() + 400;
      cards.forEach((card) => renderStatus(card, lastMatches[card.videoId], scanned));
      if (scanned) {
        Object.entries(lastMatches).forEach(([id, info]) => {
          if (info && info.exists) localIdSet.add(String(id));
        });
        syncCurrentPageLocalMark(cards, lastMatches);
      } else {
        paintPaginationLocalMarks();
      }
      await applyOrdinalsToCards(cards);
      await refreshSelectionCount();
    } catch (err) {
      cards.forEach((card) => {
        if (!scanned) renderStatus(card, null, false);
      });
      setError(`Helper unavailable: ${err.message}`);
    }
  }

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

  async function captureNativeSelection() {
    const cards = parseCards();
    const page = currentPageNumber();
    const sel = await send('SELECTION_GET');
    const items = { ...(sel.items || {}) };
    const onPageIds = new Set(cards.map((c) => c.videoId));

    cards.forEach((card) => {
      if (isCardChecked(card)) {
        items[card.videoId] = {
          videoId: card.videoId,
          title: card.title,
          detailUrl: card.detailUrl,
          favoritePage: card.favoritePage,
          cardIndex: card.cardIndex,
        };
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

  function scheduleCaptureSelection() {
    clearTimeout(selectionCaptureTimer);
    // Wait for the site's own checkbox handlers to finish first.
    selectionCaptureTimer = setTimeout(() => {
      captureNativeSelection().catch(() => {});
    }, 50);
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

  function placePickAndStatus(card) {
    const pick = qs(card.el, `.${NS}-pick`);
    const link = card.link;
    if (!pick || !link) return;
    const title = qs(link, '.thumb_title');
    const info = qs(link, '.thumb_info');
    if (title && title.parentElement !== pick) pick.appendChild(title);
    if (info && info.parentElement !== pick) pick.appendChild(info);
    const status = qs(card.el, `.${NS}-status`) || qs(pick, `.${NS}-status`);
    if (status && status.parentElement !== pick) pick.appendChild(status);
    if (link.nextElementSibling !== pick) {
      link.insertAdjacentElement('afterend', pick);
    }
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

  function visibleOnlineVideo() {
    return qsa(document, 'video').find((video) => {
      return isOnlineVideoVisible(video);
    }) || null;
  }

  function isOnlineVideoVisible(video) {
    if (!video?.isConnected) return false;
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    return (
      rect.width > 80 && rect.height > 45 &&
      style.display !== 'none' && style.visibility !== 'hidden'
    );
  }

  /** Native online popup shell still mounted (video may be briefly swapping). */
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
      const isClose = /close|关闭|dismiss|\u00d7|^\s*x\s*$/i.test(identity);
      const topRight = rect.left >= maxLeft;
      // Hide close X and window-size toggles in the popup chrome.
      if (isClose || topRight) {
        el.classList.add(`${NS}-hide-window-toggle`);
      }
    });
  }

  /** True when the popup video is a real player surface (not a poster/thumb flash). */
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

  function beginOnlineFullscreen() {
    // Replace an active session without dropping document fullscreen — an async
    // exitFullscreen from the previous session would otherwise cancel the new
    // user-gesture request and make the player flicker in/out.
    if (onlinePlaybackSession) {
      finishOnlineFullscreen(onlinePlaybackSession, { keepFullscreen: true });
    }

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
        (compactTopControl && /close|back|dismiss|关闭|返回|\u00d7/i.test(identity));
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
  function forceNativeOnlinePopup(card) {
    const href = card?.link?.getAttribute('href') || '';
    const absHref = card?.link?.href || '';
    const videoId = String(card?.videoId || '');
    if (!href && !absHref && !videoId) return;
    ignoreCardClickUntil = Date.now() + 2500;
    send('PAGE_OPEN_POPUP', {
      href: absHref || href,
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
          // After our HTML replace, site .js-click fancybox handlers may be dead.
          // Prefer MAIN-world Fancybox open; fall back to the native click path.
          beginOnlineFullscreen();
          if (extensionOwnsPagination) {
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

  async function doScan() {
    setError('');
    const scanBtn =
      qs(document, `.${NS}-controls [data-act="scan"]`) ||
      qs(document, `.${NS}-toolbar [data-act="scan"]`);
    if (scanBtn) scanBtn.textContent = 'Scan local (…)';
    try {
      await send('HELPER_HEALTH');
      const result = await send('HELPER_SCAN');
      scanned = true;
      diskIndexDirty = false;
      lastDiskScanAt = Date.now();
      const matches = result.matches || {};
      localIdSet = new Set(Object.keys(matches).map(String));
      lastScanMatches = matches;
      lastMatches = matches;
      scanFavTotal = detectFavoritesTotal();
      scanMatched = Number(result.matchedCount || 0);
      // Restore stable label before nearby page checks (no per-page flicker).
      updateToolbarLabels();
      const cards = parseCards();
      // Scan matches lack `exists`; normalize so path UI renders before lookup.
      cards.forEach((card) => {
        const m = matches[card.videoId];
        renderStatus(card, m ? { ...m, exists: true } : { exists: false }, true);
      });
      const lookup = await send('HELPER_LOOKUP', { videoIds: cards.map((c) => c.videoId) });
      lastMatches = lookup.results || {};
      cards.forEach((card) => renderStatus(card, lastMatches[card.videoId], true));
      syncCurrentPageLocalMark(cards, lastMatches);
      await applyOrdinalsToCards(cards);
      await evaluateVisibleLocalPages(localIdSet);
      // Match chips only edit rules. Re-apply after scan only when View already
      // has an active filtered result (Show matches), never just because chips changed.
      // Skip while applyLibraryFilter is already running (collectMatchItems may scan).
      if (filterState.active && !filterRunning) {
        await applyLibraryFilter({ ensureIndex: false });
      }
    } catch (err) {
      setError(`Scan failed: ${err.message}`);
      updateToolbarLabels();
    }
  }

  function confirmModal({ title, body, okLabel = 'OK', cancelLabel = 'Cancel' }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = `${NS}-modal-backdrop`;
      backdrop.dataset.hxyrule = '1';
      backdrop.innerHTML = `
        <div class="${NS}-modal">
          <h3></h3>
          <div data-role="body"></div>
          <div class="${NS}-modal__actions">
            <button type="button" class="${NS}-btn" data-act="cancel"></button>
            <button type="button" class="${NS}-btn" data-act="ok"></button>
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
          p.style.cssText = 'margin:0 0 8px;font-size:13px;color:#cfd6dd;line-height:1.45';
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
          close(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
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

  function orphanItemLabel(item) {
    const rel = String(item?.relativePath || item?.label || '')
      .trim()
      .replace(/\/+$/, '');
    if (!rel) return String(item?.videoId || '');
    const base = rel.split('/').pop() || rel;
    return item?.kind === 'dir' ? `${base}/` : base;
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
    await send('HELPER_HEALTH');
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

  async function doRebuildOrdinals() {
    if (rebuildRunning) return;
    // One global ordinals table: only Favorites order may replace it.
    if (!isFavoritesPage()) {
      setError('Renumber is only available on Favorites (global sequence).');
      return;
    }
    const maxPage = maxPageNumber();
    const est = detectFavoritesTotal();
    const ok = await confirmModal({
      title: 'Renumber favorites?',
      okLabel: 'Renumber',
      cancelLabel: 'Cancel',
      body: [
        `Crawl pages 1–${maxPage}` + (est ? ` (~${est} videos)` : '') + '.',
        'Oldest favorite (last page, last card) becomes 1.',
        'This replaces the global sequence used everywhere (Jump, filenames).',
        'Local files are renamed to match list-page titles. Nothing is deleted.',
        'Wrong old numbers and abbreviated names are replaced. Slow (one request per page).',
      ].join('\n'),
    });
    if (!ok) return;

    rebuildRunning = true;
    setError('');
    const btn =
      qs(document, `.${NS}-controls [data-act="rebuild-ordinals"]`) ||
      qs(document, `.${NS}-toolbar [data-act="rebuild-ordinals"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = `Renumber (0/${maxPage})`;
    }

    const ordered = []; // newest-first
    const titles = {}; // videoId -> bare list-page title
    try {
      await send('HELPER_HEALTH');
      for (let page = 1; page <= maxPage; page += 1) {
        if (btn) btn.textContent = `Renumber (${page - 1}/${maxPage})`;
        const data = await fetchListPage(page);
        const batch = data.items || [];
        if (page === 1 && batch.length) {
          stablePerPage = batch.length;
        }
        batch.forEach((it) => {
          const id = String(it.videoId || '');
          if (!id) return;
          ordered.push(id);
          const bare = bareTitle(it.title || '');
          if (bare && bare !== id) titles[id] = bare;
        });
        if (btn) btn.textContent = `Renumber (${page}/${maxPage})`;
        if (page < maxPage) {
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      if (!ordered.length) {
        throw new Error('crawled 0 videos — check login / page parse');
      }
      scanFavTotal = ordered.length;
      if (btn) btn.textContent = 'Renumber (renaming…)';
      const result = await send('HELPER_ORDINALS_REBUILD', {
        videoIds: ordered,
        titles,
        renameFiles: true,
      });
      const renamed = (result.rename && result.rename.renamed) || 0;
      const errCount = (result.rename && result.rename.errorCount) || 0;
      const total = result.count || ordered.length;
      lastRenumberStats = { done: maxPage, total: maxPage };
      try {
        const scan = await send('HELPER_SCAN');
        scanned = true;
        const matches = scan.matches || {};
        localIdSet = new Set(Object.keys(matches).map(String));
        lastMatches = matches;
        scanMatched = Number(scan.matchedCount || 0);
      } catch (_) {
        /* rename already applied; scan optional */
      }
      const cards = parseCards();
      await applyOrdinalsToCards(cards);
      cards.forEach((card) => renderStatus(card, lastMatches[card.videoId], scanned));
      syncCurrentPageLocalMark(cards, lastMatches);
      scheduleEvaluateVisiblePages();
      const msg =
        `Renumbered ${total}` +
        (renamed ? `, renamed ${renamed} file(s)` : ', no files needed rename') +
        (errCount ? ` (${errCount} rename error(s))` : '') +
        '.';
      if (errCount) setError(msg);
      else setError('');
      if (btn) {
        btn.textContent = `Renumber (${maxPage}/${maxPage})`;
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch (err) {
      setError(`Renumber failed: ${err.message || String(err)}`);
    } finally {
      rebuildRunning = false;
      updateToolbarLabels();
    }
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
      const before = await send('QUEUE_STATUS');
      const result = await send('QUEUE_ENQUEUE', { items: payload });
      const added = Number(result.added || 0);
      const sessionTotal = added > 0 ? added : payload.length;
      dlSession = {
        active: sessionTotal > 0,
        total: sessionTotal,
        baselineCompleted: Number(before.completed || 0),
      };
      if (dlSession.active) {
        // (a/b) = completed / session total.
        stopLabelCached = `0/${dlSession.total}`;
        updateToolbarLabels();
      }
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
        dlSession = { active: false, total: 0, baselineCompleted: 0 };
        stopLabelCached = 'idle';
        updateToolbarLabels();
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

  async function refreshQueue() {
    try {
      const st = await send('QUEUE_STATUS');
      const active = Number(st.activeCount || 0);
      const completed = Number(st.completed || 0);
      if (dlSession.active) {
        const done = Math.max(0, Math.min(dlSession.total, completed - dlSession.baselineCompleted));
        if (active > 0) {
          // (a/b) = completed count / session total.
          stopLabelCached = `${done}/${dlSession.total}`;
        } else {
          dlSession = { active: false, total: 0, baselineCompleted: 0 };
          stopLabelCached = 'idle';
        }
      } else if (active > 0) {
        const total = Math.max(1, Number(st.total || 0) || completed || 1);
        const done = Math.max(0, Math.min(completed, total));
        stopLabelCached = `${done}/${total}`;
      } else {
        stopLabelCached = 'idle';
      }
      updateToolbarLabels();
      if (stopLabelCached && stopLabelCached !== 'idle') {
        setLiveStatus(`Downloading (${stopLabelCached})`);
      } else if (active > 0) {
        setLiveStatus(`Queue active · ${active}`);
      } else {
        setLiveStatus('Ready');
      }
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
      stopLabelCached = 'idle';
      updateToolbarLabels();
      setLiveStatus('Helper offline');
    }
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

  async function doStopDownloads() {
    setError('');
    try {
      await send('QUEUE_STOP');
      dlSession = { active: false, total: 0, baselineCompleted: 0 };
      stopLabelCached = 'idle';
      updateToolbarLabels();
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

  async function collectPages(start, end) {
    setError('');
    const sel = await send('SELECTION_GET');
    const items = { ...(sel.items || {}) };
    const pageCount = Math.max(1, end - start + 1);
    let fetched = 0;
    // (a/b) = ath page among b pages in the range (1-based).
    selProgress = { current: 1, total: pageCount };
    updateToolbarLabels();
    for (let page = start; page <= end; page += 1) {
      const pageIndex = page - start + 1;
      selProgress = { current: pageIndex, total: pageCount };
      updateToolbarLabels();
      try {
        const data = await fetchListPage(page);
        const batch = data.items || [];
        fetched += batch.length;
        if (page === start && batch.length > 0) {
          stablePerPage = Math.max(stablePerPage || 0, batch.length);
        }
        batch.forEach((it) => {
          items[it.videoId] = it;
        });
      } catch (err) {
        setError(`Select pages paused: ${err.message}`);
        await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
        await restoreSelectionToPage(parseCards());
        selProgress = null;
        await refreshSelectionCount(items);
        return;
      }
      // Persist incrementally so selection survives if the tab is interrupted.
      await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
      await restoreSelectionToPage(parseCards());
      await new Promise((r) => setTimeout(r, 800));
    }
    const n = Object.keys(items).length;
    selProgress = null;
    await send('SELECTION_SET', { selection: { items, updatedAt: Date.now() } });
    await restoreSelectionToPage(parseCards());
    await refreshSelectionCount(items);
    if (!n) {
      setError('Select pages found 0 videos. Reload the extension and retry; login or site AJAX params may have changed.');
    } else if (fetched === 0) {
      setError('Select pages request succeeded but parsed 0 videos.');
    }
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
      `https://rule34video.com/video/${id}/`,
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
      ignoreMutationsUntil = Date.now() + 1200;
      const want = new Set(succeededIds);
      parseCards().forEach((card) => {
        if (want.has(String(card.videoId))) {
          try {
            card.el.remove();
          } catch (_) {
            /* ignore */
          }
        }
      });
      if (succeededIds.length) {
        if (onPlaylist) {
          await patchIndexRemoveIds(indexScopeKey(), succeededIds);
        } else {
          await patchIndexRemoveIds('favorites', succeededIds);
        }
      }
      await send('SELECTION_CLEAR');
      await refreshSelectionCount({});
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

  function wireFilterBar() {
    return wireControls();
  }

  function wireControls() {
    const bar = ensureControls();
    if (bar.dataset.wired === '1') {
      wirePageRangeInputs(bar);
      wireDurationFilterInputs(bar);
      return bar;
    }
    bar.dataset.wired = '1';
    wirePageRangeInputs(bar);
    wireDurationFilterInputs(bar);
    bar.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !bar.contains(btn)) return;
      const act = btn.dataset.act;
      if (act === 'filter-local') {
        filterState.localOn = !filterState.localOn;
        onMatchRuleEdited();
      } else if (act === 'filter-cloud') {
        filterState.cloudOn = !filterState.cloudOn;
        onMatchRuleEdited();
      } else if (act === 'filter-favorite') {
        filterState.favoriteOn = !filterState.favoriteOn;
        onMatchRuleEdited();
      } else if (act === 'filter-playlist') {
        filterState.playlistOn = !filterState.playlistOn;
        onMatchRuleEdited();
      } else if (act === 'filter-apply') {
        await applyLibraryFilter({ ensureIndex: true });
      } else if (act === 'filter-show-all') {
        await showAllView();
      } else if (act === 'filter-reset') {
        await resetMatchRules();
      } else if (act === 'index-build') {
        await buildFavIndex({ force: true });
      } else if (act === 'playlist-add') {
        await doAddToPlaylist();
      } else if (act === 'scan') {
        await doScan();
      } else if (act === 'select-page') {
        await selectAllOnPage();
      } else if (act === 'select-pages') {
        await selectPageRangeFromInputs();
      } else if (act === 'select-matches') {
        await selectAllMatches();
      } else if (act === 'download') {
        await doDownloadSelected();
      } else if (act === 'rebuild-ordinals') {
        await doRebuildOrdinals();
      } else if (act === 'clear') {
        await send('SELECTION_CLEAR');
        ignoreMutationsUntil = Date.now() + 800;
        clearAllNativeSelectionOnPage();
        setError('');
        await refreshSelectionCount({});
        await refreshQueue();
      } else if (act === 'stop') {
        await doStopDownloads();
      } else if (act === 'wake-queue') {
        await doWakeQueue();
      } else if (act === 'delete-favs') {
        await doDeleteSelected();
      } else if (act === 'prune-local') {
        await doPruneOrphanLocals();
      } else if (act === 'fav-add') {
        await doAddSelectedToFavorites();
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

  function wireToolbar() {
    wireControls();
  }

  let listObserver = null;
  let observedList = null;
  let pageFinger = '';
  let pageWatchTimer = null;

  function listRoot() {
    return (
      favoritesListEl() ||
      qs(document, '#list_videos_my_favourite_videos_items') ||
      qs(document, '.thumbs')
    );
  }

  function pageFingerprint() {
    const cards = parseCards();
    const ids = cards.slice(0, 8).map((c) => c.videoId).join(',');
    return `${currentPageNumber()}|${cards.length}|${ids}`;
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
      if (Date.now() < ignoreMutationsUntil) return;
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
      clearTimeout(listObserver._t);
      listObserver._t = setTimeout(() => {
        onListChanged().catch(() => {});
      }, 250);
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

  function startPageWatch() {
    if (pageWatchTimer) return;
    pageFinger = pageFingerprint();
    let pathFinger = `${location.pathname}|${indexScopeKey()}`;
    pageWatchTimer = setInterval(() => {
      ensureToolbar();
      if (Date.now() < ignoreMutationsUntil) return;
      if (isPlaylistDetailPage()) {
        const list = favoritesListEl();
        if (list) moveLargeNativePanelBelowCards(list);
      }
      const pathNext = `${location.pathname}|${indexScopeKey()}`;
      if (pathNext !== pathFinger) {
        pathFinger = pathNext;
        clearSelectionIfLibraryChanged()
          .then(() => onListChanged({ force: true, light: true }))
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

  async function bootFavorites() {
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
    // Entering Favorites always starts with an empty selection bag.
    await resetSelectionForLibraryEntry();
    await loadFavIndexCache();
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
    // Refresh the disk index once on every full page load. Pagination/AJAX
    // changes continue to use refreshLookup() so they do not rescan the root.
    await doScan();
    await restoreSelectionToPage(parseCards());
    applyFilterToCurrentPage();
    await refreshQueue();
    await refreshSelectionCount();
    ensureJumpBar();
    layoutTopControls();
    pageFinger = pageFingerprint();

    setInterval(() => {
      refreshQueue().catch(() => {});
      refreshSelectionCount().catch(() => {});
    }, 4000);
  }

  function playlistListRoot() {
    return listBoxEl() || qs(document, '.thumbs') || document.body;
  }

  async function bootPlaylistPage() {
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
    // Entering a playlist (or switching lists) always starts empty.
    await resetSelectionForLibraryEntry();
    await loadFavIndexCache();
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
    // Refresh the disk index once on every full page load. Pagination/AJAX
    // changes continue to use refreshLookup() so they do not rescan the root.
    await doScan();
    await restoreSelectionToPage(parseCards());
    applyFilterToCurrentPage();
    await refreshQueue().catch(() => {});
    await refreshSelectionCount();
    layoutTopControls();
    pageFinger = pageFingerprint();

    setInterval(() => {
      refreshQueue().catch(() => {});
      refreshSelectionCount().catch(() => {});
    }, 4000);
  }

  async function boot() {
    try {
      if (isFavoritesPage()) await bootFavorites();
      else if (isPlaylistDetailPage()) await bootPlaylistPage();
    } finally {
      revealFirstLayout();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
