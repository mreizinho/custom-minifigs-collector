// Match browser-painted desktop chrome to modal backdrops without dimming body twice.
(() => {
  if (window.collectorPwaPlatform !== 'desktop'
    || !window.matchMedia('(display-mode:standalone), (display-mode:window-controls-overlay)').matches) return;
  const root = document.documentElement;
  const theme = document.querySelector('meta[name="theme-color"]');
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
    const header = document.querySelector('.topbar');
    const line = (header && rgb(getComputedStyle(header).borderBottomColor)) || base;
    root.style.setProperty('--desktop-scrollbar-background',background);
    root.style.setProperty('--desktop-scrollbar-thumb',format(blend([136,136,136])));
    root.style.setProperty('--desktop-modal-gutter-line',format(blend(line)));
    if (dimmed !== (backdrops.length > 0)) {
      dimmed = backdrops.length > 0;
      root.classList.toggle('desktop-modal-dimmed',dimmed);
    }
    // Edge chooses the native button rendering; theme-color supplies its backdrop.
    if (theme && theme.content !== background) theme.content = background;
    if (root.style.backgroundColor !== background) root.style.backgroundColor = background;
  }
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      if (record.type === 'attributes') return record.target === theme || record.target === root || record.target === document.body || record.target.tagName === 'DIALOG';
      return [...record.removedNodes].some(node => node.nodeType === 1 && (node.tagName === 'DIALOG' || node.querySelector('dialog')));
    });
    if (relevant) sync();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class','style']});
  observer.observe(root,{attributes:true,attributeFilter:['class']});
  if (theme) observer.observe(theme,{attributes:true,attributeFilter:['content']});
  window.addEventListener('pageshow',sync);
  sync();
})();
