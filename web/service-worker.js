self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stagepass is offline</title><main style="max-width:32rem;margin:16vh auto;padding:1rem;font:1.15rem system-ui;color:#342855"><h1>Stagepass is offline</h1><p>Reconnect to view current seat availability and book an event.</p><button onclick="location.reload()">Try again</button></main></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});
