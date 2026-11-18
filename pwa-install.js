// Explicit install routes are stable even when a desktop window is resized.
(() => {
  const explicit = location.pathname.match(/^\/(mobile|desktop)(?:\/|$)/)?.[1];
  const ua = navigator.userAgent || '';
  const mobileDevice = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(ua)
    || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const platform = explicit || (mobileDevice ? 'mobile' : 'desktop');
  window.collectorPwaPlatform = platform;
  document.documentElement.dataset.pwaPlatform = platform;
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.href = `/manifest-${platform}.webmanifest`;
  if (platform === 'mobile') {
    // This selector runs in the head before the icon link has been parsed.
    const updateAppleIcon = () => {
      const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleIcon) appleIcon.href = '/icons/f1-180.png';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateAppleIcon, {once:true});
    else updateAppleIcon();
  }
})();
