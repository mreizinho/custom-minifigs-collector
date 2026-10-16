document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || !window.matchMedia('(max-width: 600px)').matches) return;

  const input = event.target;
  const keyboardInputTypes = ['text', 'search', 'email', 'url', 'tel', 'number', 'password'];
  if (!(input instanceof HTMLInputElement) || !keyboardInputTypes.includes(input.type)) return;

  // Let the field's normal Enter/Go/Search handler run before dismissing the keyboard.
  setTimeout(() => {
    if (document.activeElement === input) input.blur();
  }, 0);
});
