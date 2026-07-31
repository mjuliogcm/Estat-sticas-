/* ==========================================================================
   GCM — Painel de Inteligência Operacional
   Service Worker — cache do app shell + bibliotecas externas (CDN)
   Estratégia: cache-first com atualização em segundo plano (stale-while-revalidate).
   Depois do primeiro carregamento com internet, o painel abre normalmente offline.
   ========================================================================== */

const CACHE_VERSION = 'gcm-painel-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Cada arquivo é adicionado individualmente: se um falhar (ex. sem internet
      // no primeiro acesso), os demais ainda são cacheados.
      return Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);

      const networkFetch = fetch(req)
        .then((res) => {
          // Só guarda respostas válidas (inclui respostas "opacas" de CDNs cross-origin)
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);

      // Cache-first: responde rápido do cache se existir; atualiza em segundo plano.
      if (cached) {
        networkFetch; // dispara atualização sem bloquear a resposta
        return cached;
      }

      // Sem cache ainda: espera a rede; se falhar e não houver nada salvo, propaga o erro.
      const fresh = await networkFetch;
      if (fresh) return fresh;
      return cached || Response.error();
    })
  );
});
