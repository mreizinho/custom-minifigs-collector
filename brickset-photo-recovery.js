// BrickLink's image host can return its maintenance HTML instead of a photo.
// Try Brickset's own photo only for a failed image in the active Brickset collection.
(() => {
  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !isBricksetCollection()) return;
    const card = image.closest('#catalogue .card');
    const detail = image.closest('#detail');
    const code = card?.dataset.bricksetCode || (detail && activeDetailFigure?.source === 'brickset' ? activeDetailFigure.character : '');
    if (!/^[a-z0-9_-]+$/i.test(code)) return;
    if (image.dataset.bricksetPhotoFallback) {
      // Catalogue thumbnails keep the existing useCardFallback handler. Detail
      // photos need their own last-resort placeholder, with no retry loop.
      if (detail && image.dataset.bricksetPhotoFallback !== 'placeholder') {
        event.stopImmediatePropagation();
        image.dataset.bricksetPhotoFallback = 'placeholder';
        image.classList.remove('bricklink-photo');
        image.classList.add('fallback-image');
        image.src = fallbackImageSource();
      }
      return;
    }
    let source;
    try { source = new URL(image.currentSrc || image.src); } catch { return; }
    if (source.hostname.toLowerCase() !== 'img.bricklink.com') return;
    event.stopImmediatePropagation();
    image.dataset.bricksetPhotoFallback = 'brickset';
    // Retain the same white background and contained image sizing on either host.
    image.classList.add('bricklink-photo');
    image.title = 'Photo from Brickset';
    image.src = `https://images.brickset.com/minifigs/large/${encodeURIComponent(code)}.jpg`;
  }, { capture: true });
})();
