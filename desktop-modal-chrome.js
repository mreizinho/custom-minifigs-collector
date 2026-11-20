// Match browser-painted desktop chrome to modal backdrops without dimming body twice.
(() => {
  if (window.collectorPwaPlatform !== 'desktop') return;
  const installed = window.matchMedia('(display-mode:standalone), (display-mode:window-controls-overlay)').matches;
  const root = document.documentElement;
  root.classList.add('desktop-scrollbars');
  const theme = document.querySelector('meta[name="theme-color"]');
  const header = document.querySelector('.topbar');
  // A horizontally unbounded shadow: same Gaussian blur (10px / 2) and
  // downward offset as .topbar's box-shadow, without fading at the right edge.
  const shadowImage = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="24"><defs><filter id="s" x="-100" y="-1000" width="201" height="1100" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="5"/></filter></defs><rect x="-100" y="-1000" width="201" height="1004" fill="black" fill-opacity="0.0941176471" filter="url(#s)"/></svg>')}")`;
  let modalOrder = [];
  let dimmed = false;
  const rgb = color => {
    const hex = color.trim().match(/^#([\da-f]{6})$/i);
    if (hex) return [0,2,4].map(offset => parseInt(hex[1].slice(offset,offset+2),16)).concat(1);
    const values = color.match(/[\d.]+/g)?.map(Number);
    return values?.length >= 3 ? [...values.slice(0,3),values[3] ?? 1] : null;
  };
  const format = color => `rgb(${color.slice(0,3).map(Math.round).join(', ')})`;
  function sync() {
    const open = [...document.querySelectorAll('dialog:modal')];
    modalOrder = modalOrder.filter(dialog => open.includes(dialog));
    modalOrder.push(...open.filter(dialog => !modalOrder.includes(dialog)));
    const backdrops = modalOrder.map(dialog => rgb(getComputedStyle(dialog,'::backdrop').backgroundColor)).filter(color => color && color[3] > 0);
    const bodyStyle = getComputedStyle(document.body);
    // backgroundColor may still be the old theme during the body's CSS transition.
    // The custom property already contains the selected theme's final color.
    const base = rgb(bodyStyle.getPropertyValue('--bg').trim()) || rgb(bodyStyle.backgroundColor);
    if (!base) return;
    const blend = color => backdrops.reduce((under,over) =>
      under.map((channel,index) => channel*(1-over[3])+over[index]*over[3]),color.slice(0,3));
    const background = format(blend(base));
    const line = (header && rgb(getComputedStyle(header).borderBottomColor)) || base;
    // Explicitly invalidate native scrollbar paint when the sticky header changes.
    root.style.setProperty('--desktop-gutter-shadow-image',header?.classList.contains('is-scrolled') ? shadowImage : 'none');
    if (header) {
      const borderWidth = parseFloat(getComputedStyle(header).borderBottomWidth) || 1;
      root.style.setProperty('--desktop-header-line-top',`${header.getBoundingClientRect().bottom - borderWidth}px`);
    }
    root.style.setProperty('--desktop-scrollbar-background',background);
    const scrollbarThumb = document.body.classList.contains('dark') ? '#3b3c3c' : '#888888';
    root.style.setProperty('--desktop-scrollbar-thumb',format(blend(rgb(scrollbarThumb))));
    root.style.setProperty('--desktop-modal-gutter-line',format(blend(line)));
    if (dimmed !== (backdrops.length > 0)) {
      dimmed = backdrops.length > 0;
      root.classList.toggle('desktop-modal-dimmed',dimmed);
    }
    // Edge chooses the native button rendering; theme-color supplies its backdrop.
    if (installed && theme && theme.content !== background) theme.content = background;
    if (root.style.backgroundColor !== background) root.style.backgroundColor = background;
  }
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      if (record.type === 'attributes') return record.target === theme || record.target === root || record.target === document.body || record.target === header || record.target.tagName === 'DIALOG';
      return [...record.removedNodes].some(node => node.nodeType === 1 && (node.tagName === 'DIALOG' || node.querySelector('dialog')));
    });
    if (relevant) sync();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class','style']});
  observer.observe(root,{attributes:true,attributeFilter:['class']});
  if (theme) observer.observe(theme,{attributes:true,attributeFilter:['content']});
  window.addEventListener('pageshow',sync);
  window.addEventListener('resize',sync);
  if (header && window.ResizeObserver) new window.ResizeObserver(sync).observe(header);
  sync();
})();
