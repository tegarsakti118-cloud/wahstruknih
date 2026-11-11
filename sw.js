self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Tangkap kiriman Share dari e-wallet (Metode POST)
  if (event.request.method === 'POST') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const text = formData.get('text') || formData.get('title') || '';
      const imageFile = formData.get('image');

      const cache = await caches.open('wahstruk-share');
      if (text) await cache.put('shared-text', new Response(text));
      if (imageFile) await cache.put('shared-image', new Response(imageFile));

      // Buka aplikasi kembali ke halaman utama
      return Response.redirect('./?shared=true', 303);
    })());
  }
});