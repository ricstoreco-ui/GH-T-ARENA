self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: 'https://i.ibb.co.com/ymSpL0ht/file-000000000c7482118ac26f712cacd01a.png',
      badge: 'https://i.ibb.co.com/ymSpL0ht/file-000000000c7482118ac26f712cacd01a.png'
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  }
});
