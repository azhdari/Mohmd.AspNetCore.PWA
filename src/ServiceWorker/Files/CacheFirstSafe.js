(function () {
    'use strict';

    // Update 'version' if you need to refresh the cache
    var version = '{version}';
    var offlineUrl = "{offlineRoute}";
    var patternToIgnore = [{patternToIgnore}];
    var installImmediately = {installImmediately};

    // Store core files in a cache (including a page to display when offline)
    function updateStaticCache() {
        return caches.open(version)
            .then(function (cache) {
                return cache.addAll([
                    offlineUrl,
                    {routes}
                ]);
            });
    }

    function addToCache(request, response) {
        if (!response.ok && response.type !== 'opaque')
            return;

        var copy = response.clone();
        caches.open(version)
            .then(function (cache) {
                cache.put(request, copy);
            });
    }

    function serveOfflineImage(request) {
        if (request.headers.get('Accept').indexOf('image') !== -1) {
            return new Response('<svg role="img" aria-labelledby="offline-title" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg"><title id="offline-title">Offline</title><g fill="none" fill-rule="evenodd"><path fill="#D8D8D8" d="M0 0h400v300H0z"/><text fill="#9B9B9B" font-family="Helvetica Neue,Arial,Helvetica,sans-serif" font-size="72" font-weight="bold"><tspan x="93" y="172">offline</tspan></text></g></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
        }
    }

    function isChromeExtension(request) {
        return request.url.match(/^chrome-extension:\/\//ig)
    }

    function extractRange(request, byteLength) {
        const bytes = /^bytes\=(\d+)\-(\d+)?$/g.exec(
            request.headers.get('range')
        );
        if (bytes) {
            const start = Number(bytes[1]);
            const end = Number(bytes[2]) || byteLength - 1;

            return {
                start: start,
                end: end
            }
        }
    }

    function processRangeRequest(request) {
        return caches
            .open(version)
            .then(function (cache) {
                return cache.match(request.url);
            })
            .then(function (res) {
                if (!res) {
                    return fetch(request)
                        .then(res => {
                            addToCache(request, res);
                            return res.arrayBuffer();
                        });
                } else {
                    return res.arrayBuffer();
                }
            })
            .then(function (arrayBuffer) {
                const bytes = extractRange(request, arrayBuffer.byteLength);
                if (bytes) {
                    return new Response(arrayBuffer.slice(bytes.start, bytes.end + 1), {
                        status: 206,
                        statusText: 'Partial Content',
                        headers: [
                            ['Content-Range', `bytes ${bytes.start}-${bytes.end}/${arrayBuffer.byteLength}`]
                        ]
                    });
                } else {
                    return new Response(null, {
                        status: 416,
                        statusText: 'Range Not Satisfiable',
                        headers: [['Content-Range', `*/${arrayBuffer.byteLength}`]]
                    });
                }
            });
    }

    self.addEventListener('install', function (event) {
        if (installImmediately) {
            self.skipWaiting();
        }

        event.waitUntil(updateStaticCache());
    });

    self.addEventListener('activate', function (event) {
        if (installImmediately) {
            self.clients.matchAll()
                .then(clients => clients.forEach(client => {
                    if (client.url && "navigate" in client) {
                        client.navigate(client.url);
                    }
                }));
        }

        event.waitUntil(
            caches.keys()
                .then(function (keys) {
                    // Remove caches whose name is no longer valid
                    return Promise.all(keys
                        .filter(function (key) {
                            return key.indexOf(version) !== 0;
                        })
                        .map(function (key) {
                            return caches.delete(key);
                        })
                    );
                })
        );
    });

    self.addEventListener('fetch', function (event) {
        var request = event.request;

        // Always ignore pattern
        if (patternToIgnore.filter(p => request.url.match(p)).length) {
          return;
        }

        // Always ignore chromium extensions
        if (isChromeExtension(request)) {
            return;
        }

        // Response to range requests properly
        if (request.headers.get('range')) {
            event.respondWith(
                processRangeRequest(request)
                    .catch(function () {
                        return caches.match(offlineUrl);
                    })
            );
            return;
        }

        // Always fetch non-GET requests from the network
        if (request.method !== 'GET' || request.url.match(/\/browserLink/ig)) {
            event.respondWith(
                fetch(request)
                    .catch(function () {
                        return caches.match(offlineUrl);
                    })
            );
            return;
        }

        // For HTML requests, try the network first, fall back to the cache, finally the offline page
        if (request.headers.get('Accept').indexOf('text/html') !== -1) {
            event.respondWith(
                fetch(request)
                    .then(function (response) {
                        // Stash a copy of this page in the cache
                        addToCache(request, response);
                        return response;
                    })
                    .catch(function () {
                        return caches.match(request)
                            .then(function (response) {
                                return response || caches.match(offlineUrl);
                            });
                    })
            );
            return;
        }

        // cache first for fingerprinted resources
        if (request.url.match(/(\?|&)v=/ig)) {
            event.respondWith(
                caches.match(request)
                    .then(function (response) {
                        return response || fetch(request)
                            .then(function (response) {
                                addToCache(request, response);
                                return response || serveOfflineImage(request);
                            })
                            .catch(function () {
                                return serveOfflineImage(request);
                            });
                    })
            );

            return;
        }

        // network first for non-fingerprinted resources
        event.respondWith(
            fetch(request)
                .then(function (response) {
                    // Stash a copy of this page in the cache
                    addToCache(request, response);
                    return response;
                })
                .catch(function () {
                    return caches.match(request)
                        .then(function (response) {
                            return response || serveOfflineImage(request);
                        })
                        .catch(function () {
                            return serveOfflineImage(request);
                        });
                })
        );
    });

})();
