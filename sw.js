// Service Worker für die Entdecker-Quest-App.
// Muss im selben Ordner wie die HTML-Datei liegen (Registrierung: navigator.serviceWorker.register('sw.js')).
//
// Strategie:
// - Kartenkacheln (OpenStreetMap): Cache-first, im Hintergrund aktualisieren. Das gezielte
//   Vorab-Herunterladen eines Gebiets passiert direkt in der App (Cache Storage API),
//   dieser Worker sorgt dafür, dass genau diese Kacheln offline auch ausgeliefert werden.
// - App-Grundgerüst & CDN-Ressourcen (Leaflet, Google Fonts, TensorFlow.js/MobileNet):
//   Cache-first mit Hintergrund-Update ("stale-while-revalidate"), damit die App auch ohne
//   Netz startet, sich aber online automatisch aktualisiert.
// - Live-Daten (Overpass, Wetter): NIE cachen — hier zählt nur der aktuelle Stand, ein
//   veralteter Cache-Treffer wäre irreführend (falsches Wetter, falsche Umgebungsdaten).

var TILE_CACHE = 'entdecker-tiles-v1';
var SHELL_CACHE = 'entdecker-shell-v1';
var RUNTIME_CACHE = 'entdecker-runtime-v1';
var CURRENT_CACHES = [TILE_CACHE, SHELL_CACHE, RUNTIME_CACHE];

self.addEventListener('install', function(event){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys
          .filter(function(k){ return CURRENT_CACHES.indexOf(k) === -1; })
          .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

function isLiveDataUrl(url){
  return /overpass-api\.de|api\.open-meteo\.com/.test(url);
}
function isTileUrl(url){
  return /tile\.openstreetmap\.org/.test(url);
}
function isShellAssetUrl(url){
  return /cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net/.test(url);
}

self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method !== 'GET') return;
  var url = req.url;

  // Live-APIs: nie über den Service Worker cachen, immer echtes Netz.
  if(isLiveDataUrl(url)) return;

  // Kartenkacheln: aus dem Cache, wenn vorhanden (auch durch den Vorab-Download befüllt),
  // sonst aus dem Netz laden und für später merken.
  if(isTileUrl(url)){
    event.respondWith(
      caches.open(TILE_CACHE).then(function(cache){
        return cache.match(req).then(function(cached){
          if(cached) return cached;
          return fetch(req).then(function(res){
            if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(function(){
            // Offline und nicht im Cache: nichts, was wir tun können — Leaflet zeigt
            // an dieser Stelle dann eine graue Kachel.
            return cached;
          });
        });
      })
    );
    return;
  }

  // App-Seite selbst und CDN-Ressourcen (Leaflet, Fonts, TensorFlow.js/MobileNet):
  // Cache-first, im Hintergrund aktualisieren.
  if(req.mode === 'navigate' || isShellAssetUrl(url)){
    var cacheName = req.mode === 'navigate' ? SHELL_CACHE : RUNTIME_CACHE;
    event.respondWith(
      caches.open(cacheName).then(function(cache){
        return cache.match(req).then(function(cached){
          var networkFetch = fetch(req).then(function(res){
            if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(function(){ return cached; });
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // Alles andere: normal durchreichen, kein Eingriff.
});
