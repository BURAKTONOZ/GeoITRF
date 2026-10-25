const CACHE_NAME = 'geoitrf-pro-v5.0';
const TILE_CACHE_NAME = 'geoitrf-tiles-v2.1';

const APP_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './logo.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(APP_ASSETS.map(url => cache.add(url)));
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const reqUrl = event.request.url;

    // Harita karoları (Map Tiles) ve TKGM WMS için önbellekleme (Offline Arazi Desteği)
    if (
        reqUrl.includes('arcgisonline.com') ||
        reqUrl.includes('tile.openstreetmap.org') ||
        reqUrl.includes('opentopomap.org') ||
        reqUrl.includes('google.com/vt/') ||
        reqUrl.includes('tkgm.gov.tr')
    ) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    const fetchPromise = fetch(event.request)
                        .then((networkResponse) => {
                            if (networkResponse && networkResponse.status === 200) {
                                cache.put(event.request, networkResponse.clone());
                            }
                            return networkResponse;
                        })
                        .catch(() => cachedResponse);
                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }

    // Firebase ve TKGM MAKS sorgulama API isteklerini doğrudan ağa yönlendir
    if (
        reqUrl.includes('firestore.googleapis.com') ||
        reqUrl.includes('googleapis.com/identitytoolkit') ||
        reqUrl.includes('cbsapi.tkgm.gov.tr')
    ) {
        return;
    }

    // Uygulama dosyaları: Önce Ağ, hata durumunda Önbellek (Stale-While-Revalidate)
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const networkFetch = fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200 && event.request.method === 'GET') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => cachedResponse);
            return cachedResponse || networkFetch;
        })
    );
});