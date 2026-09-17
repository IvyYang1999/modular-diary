const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync(__dirname + '/../site/language.js', 'utf8');

function visit({ url = 'https://modular-diary.vercel.app/', lang = 'zh-CN',
  languages = ['en-US'], saved, storageBlocked = false } = {}) {
  const values = new Map();
  if (saved) values.set('modular-diary-language', saved);
  let redirect;
  const location = new URL(url);
  location.replace = target => { redirect = target; };
  const localStorage = {
    getItem(key) {
      if (storageBlocked) throw new Error('Storage blocked');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (storageBlocked) throw new Error('Storage blocked');
      values.set(key, value);
    }
  };
  vm.runInNewContext(script, {
    URL, URLSearchParams, location, localStorage,
    document: { documentElement: { lang } },
    navigator: { languages, language: languages[0] }
  });
  return { redirect, saved: values.get('modular-diary-language') };
}

test('first visit follows the first supported browser language', () => {
  assert.equal(visit({ languages: ['en-US', 'zh-CN'] }).redirect,
    'https://modular-diary.vercel.app/en/');
  assert.equal(visit({ languages: ['fr-FR', 'zh-TW', 'en-US'] }).redirect, undefined);
  assert.equal(visit({ languages: ['fr-FR'] }).redirect,
    'https://modular-diary.vercel.app/en/');
});

test('a manual preference wins over browser language', () => {
  assert.equal(visit({ languages: ['en-US'], saved: 'zh' }).redirect, undefined);
  assert.equal(visit({ languages: ['zh-CN'], saved: 'en' }).redirect,
    'https://modular-diary.vercel.app/en/');
});

test('language switch persists and explicit URLs are not overridden', () => {
  assert.deepEqual(visit({ url: 'https://modular-diary.vercel.app/?lang=zh', saved: 'en' }),
    { redirect: undefined, saved: 'zh' });
  assert.deepEqual(visit({ url: 'https://modular-diary.vercel.app/en/?lang=en', lang: 'en',
    languages: ['zh-CN'], saved: 'zh' }), { redirect: undefined, saved: 'en' });
  assert.equal(visit({ url: 'https://modular-diary.vercel.app/en/', lang: 'en',
    saved: 'zh' }).redirect, undefined);
});

test('redirect preserves other query parameters and anchors', () => {
  assert.equal(visit({ url: 'https://modular-diary.vercel.app/?utm_source=friend#demo' }).redirect,
    'https://modular-diary.vercel.app/en/?utm_source=friend#demo');
});

test('blocked storage still allows explicit Chinese and browser-language fallback', () => {
  assert.equal(visit({ url: 'https://modular-diary.vercel.app/?lang=zh',
    storageBlocked: true }).redirect, undefined);
  assert.equal(visit({ storageBlocked: true }).redirect,
    'https://modular-diary.vercel.app/en/');
});
