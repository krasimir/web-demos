const KEY_MAP = {
  ArrowLeft: 'x-',
  ArrowRight: 'x+',
  ArrowUp: 'y-',
  ArrowDown: 'y+',
  a: 'x-',
  d: 'x+',
  w: 'y-',
  s: 'y+',
};

export function createKeyboardController() {
  const held = new Set();

  window.addEventListener('keydown', (e) => {
    const action = KEY_MAP[e.key];
    if (action) held.add(action);
  });

  window.addEventListener('keyup', (e) => {
    const action = KEY_MAP[e.key];
    if (action) held.delete(action);
  });

  return {
    getInput() {
      let x = 0;
      let y = 0;
      if (held.has('x-')) x -= 1;
      if (held.has('x+')) x += 1;
      if (held.has('y-')) y -= 1;
      if (held.has('y+')) y += 1;
      return { x, y };
    },
  };
}
