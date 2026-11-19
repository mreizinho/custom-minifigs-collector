// One splash per document launch; returning from another app never replays it.
(() => {
  const installed = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true
    || new URLSearchParams(location.search).get('splash') === 'preview';
  if (!installed) return;
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let appReady = false, animationReady = false, finished = false, layer, frame;
  let dismissed = false, releaseInteraction;
  const interactionReady = new Promise(resolve => { releaseInteraction = resolve; });
  const inertElements = new Map();
  root.classList.add('pwa-splash-pending');
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    window.removeEventListener('message', animationComplete);
    window.removeEventListener('keydown', skipKey, true);
    layer?.removeEventListener('click', skipAnimation);
    root.classList.remove('pwa-splash-pending');
    for (const [element, wasInert] of inertElements) element.inert = wasInert;
    function release() {
      layer?.remove();
      dismissed = true;
      releaseInteraction();
    }
    if (layer) {
      layer.classList.add('is-leaving');
      layer.setAttribute('aria-hidden', 'true');
      setTimeout(release, reduce.matches ? 0 : 320);
    } else release();
    document.dispatchEvent(new CustomEvent('pwa-splash-complete'));
  }
  function maybeFinish() { if (appReady && animationReady) finish(); }
  function skipAnimation(event) {
    if (finished || !layer || layer.hidden) return;
    // Consume this event so it cannot also activate the newly revealed app.
    event.preventDefault();
    event.stopImmediatePropagation();
    animationReady = true;
    maybeFinish();
  }
  function skipKey(event) {
    if (event.key === 'Enter' && !event.repeat && !event.isComposing) skipAnimation(event);
  }
  function animationComplete(event) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow
      || event.data?.type !== 'collector-splash-animation-complete') return;
    animationReady = true;
    maybeFinish();
  }
  window.addEventListener('message', animationComplete);
  window.addEventListener('keydown', skipKey, true);
  // A network/authentication failure must never lock users out of the UI.
  const deadline = setTimeout(finish, 12000);
  window.collectorSplash = {
    ready() { appReady = true; maybeFinish(); },
    beforeInteraction() {
      if (dismissed) return null;
      // Authorization needs user interaction, so reveal that state after the
      // complete animation instead of waiting for a token behind the splash.
      appReady = true;
      maybeFinish();
      return interactionReady;
    },
    mount() {
      layer = document.getElementById('pwaSplash');
      if (!layer || finished) { layer?.remove(); return; }
      layer.hidden = false;
      layer.addEventListener('click', skipAnimation);
      frame = layer.querySelector('iframe');
      const source = new URL(frame.dataset.src, location.origin);
      source.searchParams.set('platform', window.collectorPwaPlatform || (/Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent || '') ? 'mobile' : 'desktop'));
      frame.src = source.href;
      frame.addEventListener('error', () => { animationReady = true; maybeFinish(); }, { once: true });
      document.addEventListener('DOMContentLoaded', () => {
        if (finished) return;
        for (const element of document.body.children) {
          if (element === layer || ['SCRIPT', 'LINK', 'STYLE', 'TEMPLATE'].includes(element.tagName)) continue;
          inertElements.set(element, element.inert);
          element.inert = true;
        }
      }, { once: true });
    }
  };
  for (const event of ['collector-onboarding-needed', 'collector-premium-required']) {
    window.addEventListener(event, () => window.collectorSplash.ready(), { once: true });
  }
})();
