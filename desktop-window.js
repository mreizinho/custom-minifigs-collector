// Loaded only by the desktop install entry point. Normal tabs keep native chrome.
(() => {
  if (window.collectorPwaPlatform !== 'desktop') return;
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
