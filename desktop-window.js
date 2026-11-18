// Loaded only by the desktop install entry point. Normal tabs keep native chrome.
(() => {
  if (window.collectorPwaPlatform !== 'desktop') return;
  const installed = window.matchMedia?.('(display-mode:standalone), (display-mode:window-controls-overlay)');
  if (installed?.matches) {
    const root = document.documentElement;
    let revealed = false;
    const reveal = visible => {
      if (visible === revealed) return;
      revealed = visible;
      root.classList.toggle('desktop-scrollbar-edge', visible);
    };
    window.addEventListener('pointermove', event => {
      // Keep the thumb visible while it is being dragged, even outside the track.
      if (revealed && event.buttons) return;
      reveal(installed.matches && event.clientX >= (window.innerWidth || root.clientWidth) - 14);
    }, {passive:true});
    document.addEventListener('pointerleave', () => reveal(false));
    window.addEventListener('blur', () => reveal(false));
    installed.addEventListener('change', () => reveal(false));
  }
  const overlay = navigator.windowControlsOverlay;
  const titlebar = document.getElementById('desktopWindowTitlebar');
  if (!overlay || !titlebar) return;
  const update = () => {
    const visible = overlay.visible;
    titlebar.hidden = !visible;
    document.documentElement.classList.toggle('desktop-window-overlay', visible);
  };
  overlay.addEventListener('geometrychange', update);
  update();
})();
