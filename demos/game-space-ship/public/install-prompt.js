(function () {
  const DISMISS_KEY = 'asteroidRunInstallDismissed';

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIOS() {
    const ua = window.navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS 13+ reports as "Macintosh" but has touch support.
    return ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
  }

  function isMobile() {
    return /Mobi|Android|iPhone|iPad|iPod/.test(window.navigator.userAgent) || isIOS();
  }

  if (isStandalone() || !isMobile() || localStorage.getItem(DISMISS_KEY) === 'true') {
    return;
  }

  const banner = document.getElementById('install-banner');
  const textEl = document.getElementById('install-text');
  const actionBtn = document.getElementById('install-action');
  const dismissBtn = document.getElementById('install-dismiss');

  function dismiss(remember) {
    banner.classList.remove('visible');
    if (remember) localStorage.setItem(DISMISS_KEY, 'true');
  }

  dismissBtn.addEventListener('click', () => dismiss(true));

  if (isIOS()) {
    textEl.innerHTML = 'Install for true full screen play: tap <b>Share</b> <span style="font-size:14px">⬆️</span>, then <b>Add to Home Screen</b>.';
    banner.classList.add('visible');
  } else {
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      textEl.innerHTML = 'Install <b>Asteroid Run</b> for full screen play.';
      actionBtn.hidden = false;
      banner.classList.add('visible');
    });

    actionBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      actionBtn.disabled = true;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      dismiss(false);
    });

    window.addEventListener('appinstalled', () => {
      dismiss(true);
    });
  }
})();
