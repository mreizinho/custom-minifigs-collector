// Loaded only by the desktop install entry point. Normal tabs keep native chrome.
(() => {
  if (window.collectorPwaPlatform !== 'desktop') return;
  const root = document.documentElement;
  if (window.matchMedia('(display-mode:standalone), (display-mode:window-controls-overlay)').matches) {
    const updateFocus = () => root.classList.toggle('desktop-window-active', document.hasFocus());
    window.addEventListener('focus', updateFocus);
    window.addEventListener('blur', updateFocus);
    updateFocus();
  }
  const overlay = navigator.windowControlsOverlay;
  const titlebar = document.getElementById('desktopWindowTitlebar');
  if (!overlay || !titlebar) return;
  const update = () => {
    const visible = overlay.visible;
    titlebar.hidden = !visible;
    root.classList.toggle('desktop-window-overlay', visible);
  };
  overlay.addEventListener('geometrychange', update);
  update();
})();
