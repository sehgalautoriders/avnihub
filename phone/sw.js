/* Avni QR Freedom - service worker.
 *
 * Its whole job is the Android share sheet. Ravi, 15-09-2026: *"I GO INTO THE PHOTO APP,
 * WHERE SHOULD I SEND ... WHAT IS IN THE PHONE TO SEND TO PC?"* - the honest answer was
 * "nothing", because a plain web page cannot appear there. A PWA can: the Web Share Target
 * API puts "Avni" in the share sheet of every app on the phone once the page is added to
 * the home screen. Still no app store, no APK, no developer options.
 *
 * Android POSTs the shared files to ./share. A POST cannot be read by the page it lands on,
 * so it is caught HERE, parked in a cache, and the page is told to come and collect it.
 */

const PARK = 'avni-shared-v1';
const SHELL = 'avni-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // The share sheet landing. Only ever a POST to ./share within our own scope.
  if (event.request.method === 'POST' && url.pathname.endsWith('/share')) {
    event.respondWith(park(event.request, url));
    return;
  }

  // Everything else: network first, falling back to the cached shell so the page still
  // opens with no signal (it will say "no network" and retry by itself).
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(SHELL).then(c => c.put(event.request, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(event.request).then(hit => hit || Response.error()))
    );
  }
});

async function park(request, url) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter(f => f && f.size !== undefined);

    // Text-only shares (a link from the browser, a snippet) become a small .txt so that
    // "share to Avni" always produces something on the PC rather than silently nothing.
    if (!files.length) {
      const text = [form.get('title'), form.get('text'), form.get('url')]
        .filter(Boolean).join('\n');
      if (text) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        files.push(new File([text], `shared-${stamp}.txt`, { type: 'text/plain' }));
      }
    }

    const park = await caches.open(PARK);
    const names = [];
    for (const file of files) {
      const key = `./parked/${Date.now()}-${names.length}-${encodeURIComponent(file.name)}`;
      await park.put(key, new Response(file, {
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Avni-Name': encodeURIComponent(file.name),
        },
      }));
      names.push(key);
    }
    return Response.redirect(`./?shared=${names.length}`, 303);
  } catch (err) {
    return Response.redirect('./?shared=error', 303);
  }
}
