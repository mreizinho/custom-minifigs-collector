// One splash per document launch; returning from another app never replays it.
(() => {
  const installed = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true
    || new URLSearchParams(location.search).get('splash') === 'preview';
  if (!installed) return;
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let appReady = false, animationReady = false, finished = false, layer, frame;
  const inertElements = new Map();
  root.classList.add('pwa-splash-pending');
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    window.removeEventListener('message', animationComplete);
    root.classList.remove('pwa-splash-pending');
    for (const [element, wasInert] of inertElements) element.inert = wasInert;
    if (layer) {
      layer.classList.add('is-leaving');
      layer.setAttribute('aria-hidden', 'true');
      setTimeout(() => layer.remove(), reduce.matches ? 0 : 320);
    }
    document.dispatchEvent(new CustomEvent('pwa-splash-complete'));
  }
  function maybeFinish() { if (appReady && animationReady) finish(); }
  function animationComplete(event) {
    if (event.origin !== location.origin || event.source !== frame?.contentWindow
      || event.data?.type !== 'collector-splash-animation-complete') return;
    animationReady = true;
    maybeFinish();
  }
  window.addEventListener('message', animationComplete);
  // A network/authentication failure must never lock users out of the UI.
  const deadline = setTimeout(finish, 8000);
  window.collectorSplash = {
    ready() { appReady = true; maybeFinish(); },
    mount() {
      layer = document.getElementById('pwaSplash');
      if (!layer || finished) { layer?.remove(); return; }
      layer.hidden = false;
      frame = layer.querySelector('iframe');
      frame.src = frame.dataset.src;
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
