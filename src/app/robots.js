export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // /email/ holds images for internal emails (public so mail clients can load them, but never crawled).
        disallow: ['/api/', '/email/'],
      },
    ],
    sitemap: 'https://premarket.homes/sitemap.xml',
  };
}
