(() => {
  const mobileViewport = window.matchMedia('(max-width: 600px)');
  const keyboardInputTypes = new Set([
    'text',
    'search',
    'email',
    'url',
    'tel',
    'number',
    'password'
  ]);

  function isMobileKeyboardInput(target) {
    return mobileViewport.matches
      && target instanceof HTMLInputElement
      && keyboardInputTypes.has(target.type);
  }

  function dismissKeyboard(target = document.activeElement) {
    if (isMobileKeyboardInput(target)) {
      target.blur();
    }
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      dismissKeyboard(event.target);
    }
  }, true);

  document.addEventListener('search', event => {
    dismissKeyboard(event.target);
  }, true);

  document.addEventListener('submit', () => {
    dismissKeyboard(document.activeElement);
  }, true);
})();
