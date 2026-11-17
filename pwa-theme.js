// Keep browser/PWA chrome in step with the app's selected theme, not the OS theme.
(() => {
  const root = document.documentElement;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const colorScheme = document.querySelector('meta[name="color-scheme"]');
  const fallback = { light: '#e6e7e4', dark: '#181917' };
  // Let supported Android WebAPKs paint the page canvas behind system bars.
  // Regular browser tabs and other platforms retain their current viewport.
  const androidApp = /Android/i.test(window.navigator?.userAgent || '')
    && window.matchMedia('(display-mode: standalone)').matches;
  if (androidApp) {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && !/viewport-fit\s*=/.test(viewport.content)) viewport.content += ',viewport-fit=cover';
    root.classList.add('pwa-edge-to-edge');
  }
  let currentDark = null;
  function apply(dark, color) {
    currentDark = dark;
    if (themeColor) themeColor.content = color;
    if (colorScheme) colorScheme.content = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.style.backgroundColor = color;
    root.style.setProperty('--pwa-chrome-bg', color);
  }
  function savedTheme() {
    try {
      const device = window.matchMedia('(max-width: 600px)').matches ? 'mobile' : 'desktop';
      const user = localStorage.getItem('minifig-google-user-id') || 'anonymous';
      return (localStorage.getItem(`minifig-theme-${device}-${user}`)
        ?? localStorage.getItem(`minifig-theme-${device}`)
        ?? localStorage.getItem('minifig-theme') ?? 'light') === 'dark';
    } catch { return false; }
  }
  const initialDark = savedTheme();
  apply(initialDark, fallback[initialDark ? 'dark' : 'light']);
  function sync(force = false) {
    const dark = root.classList.contains('dark') || document.body.classList.contains('dark');
    if (!force && dark === currentDark) return;
    const color = getComputedStyle(document.body).getPropertyValue('--bg').trim() || fallback[dark ? 'dark' : 'light'];
    apply(dark, color);
  }
  function connect() {
    sync(true);
    const observer = new MutationObserver(() => sync());
    for (const element of [root, document.body]) observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('pageshow', () => sync(true));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect, { once: true });
  else connect();
})();
