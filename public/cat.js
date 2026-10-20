// Decorative, local-only interaction. No pointer positions are stored or sent.
window.mountCatArt = art => {
  if (!art) return;
  const old = art.querySelector('img');
  if (!old) return;
  old.outerHTML = '<svg class="kitty-cat" viewBox="0 0 160 160" aria-hidden="true" focusable="false"><path d="M29 55 19 16l39 17a75 75 0 0 1 45 0l38-17-11 39a66 66 0 1 1-101 0Z" fill="#8a3857"/><path d="M37 40 29 28l17 7M123 40l8-12-17 7" fill="#dc8da6"/><g class="kitty-eye"><ellipse cx="57" cy="81" rx="13" ry="15" fill="#fff6f0"/><path d="M44 78q13-16 26 0m-25-5-5-7m11 3-2-9" fill="none" stroke="#4e2339" stroke-width="3.5" stroke-linecap="round"/><circle class="kitty-pupil" cx="57" cy="82" r="6" fill="#3d2435"/></g><g class="kitty-eye"><ellipse cx="103" cy="81" rx="13" ry="15" fill="#fff6f0"/><path d="M90 78q13-16 26 0m-1-5 5-7m-11 3 2-9" fill="none" stroke="#4e2339" stroke-width="3.5" stroke-linecap="round"/><circle class="kitty-pupil" cx="103" cy="82" r="6" fill="#3d2435"/></g><path d="m76 105 4 4 4-4m-4 4q-6 6-12 2m12-2q6 6 12 2" fill="none" stroke="#ffe9df" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 98 9 94m24 17-22 4m116-17 23-4m-23 17 22 4" fill="none" stroke="#8a3857" stroke-width="4" stroke-linecap="round"/></svg>';
  const cat = art.querySelector('.kitty-cat');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const look = event => {
    if (reduced.matches) return;
    const rect = cat.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)));
    const y = Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (rect.height / 2)));
    cat.style.setProperty('--eye-x', (x * 4).toFixed(1) + 'px');
    cat.style.setProperty('--eye-y', (y * 3).toFixed(1) + 'px');
  };
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) art.addEventListener('pointermove', look);
  art.addEventListener('pointerdown', event => {
    look(event);
    if (reduced.matches) return;
    cat.classList.remove('is-blinking');
    void cat.getBoundingClientRect();
    cat.classList.add('is-blinking');
  });
  art.addEventListener('pointerleave', () => {
    cat.style.removeProperty('--eye-x');
    cat.style.removeProperty('--eye-y');
  });
};
