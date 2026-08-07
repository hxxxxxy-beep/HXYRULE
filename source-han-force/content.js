(() => {
  const SOURCE_HAN_SERIF_STACK =
    "'HXY Source Han Serif', 'Source Han Serif CN', 'Source Han Serif SC', " +
    "'Noto Serif CJK SC', 'Noto Serif SC', 'Songti SC', serif";

  function isIconOrPlayer(el) {
    if (
      el?.closest?.(
        '.video-js, .flowplayer, .fp-player, .jwplayer, .plyr, ' +
          '.kt-player, .kt_player, .video-player, .video_player',
      )
    ) {
      return true;
    }
    return !!el?.matches?.(
      '[class*="icon" i], [class*="glyph" i], .fa, .fas, .far, .fab, .fal, .fad, ' +
        '.material-icons, .material-icons-outlined, .material-icons-round, ' +
        '.material-icons-sharp, .material-symbols-outlined, ' +
        '.material-symbols-rounded, .material-symbols-sharp, ' +
        '.vjs-control, .vjs-big-play-button, .jw-icon, .fp-ui, .fp-controls, ' +
        '.plyr__control, [data-plyr]',
    );
  }

  function forceSourceHanSerif(root) {
    if (!(root instanceof Element)) return;
    if (!isIconOrPlayer(root)) {
      root.style.setProperty('font-family', SOURCE_HAN_SERIF_STACK, 'important');
    }
    root.querySelectorAll('*').forEach((el) => {
      if (!isIconOrPlayer(el)) {
        el.style.setProperty('font-family', SOURCE_HAN_SERIF_STACK, 'important');
      }
    });
  }

  if (!document.documentElement) return;

  forceSourceHanSerif(document.documentElement);
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => forceSourceHanSerif(node));
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
