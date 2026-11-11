self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData();
        const cache = await caches.open('wahstruk-share');

        for (const [key, value] of formData.entries()) {
          if (value instanceof File) {
            await cache.put('shared-image', new Response(value));
          } else if (typeof value === 'string' && value.trim()) {
            await cache.put('shared-text', new Response(value));
          }
        }
      } catch (err) {
        console.error("Gagal tangkap share:", err);
      }

      // Alihkan ke aplikasi utama dengan penanda share
      return Response.redirect('./?shared=true', 303);
    })());
  }
});