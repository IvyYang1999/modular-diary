(() => {
  'use strict';

  const current = document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh';
  const selected = new URLSearchParams(location.search).get('lang');
  const key = 'modular-diary-language';
  let saved;

  try {
    if (selected === current) localStorage.setItem(key, current);
    saved = localStorage.getItem(key);
  } catch {
    // The page and explicit language links still work when storage is unavailable.
  }

  // An explicit English URL or Chinese language link always wins.
  if (current === 'en' || selected === 'zh') return;

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  const supported = languages.find(language => /^(zh|en)(-|$)/i.test(language));
  const preferred = saved === 'zh' || saved === 'en'
    ? saved
    : /^zh(?:-|$)/i.test(supported || '') ? 'zh' : 'en';

  if (preferred === 'en') {
    const destination = new URL(location.href);
    destination.pathname = '/en/';
    location.replace(destination.href);
  }
})();
