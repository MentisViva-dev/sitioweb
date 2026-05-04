/**
 * Cloudflare Pages Function — sitemap.xml dinámico
 *
 * Lee el contenido publicado del CMS (https://api.mentisviva.cl/api/content)
 * y genera el sitemap solo con las páginas que tienen pageVisibility !== false.
 *
 * Cuando el admin oculta una página desde /unidos, en el siguiente fetch del
 * sitemap (~5min cache) Google ya no la ve listada. Combinado con el
 * <meta name="robots" content="noindex"> que inyecta content.js en runtime,
 * es defense-in-depth: Google primero deja de visitar la URL, después si
 * alguien la enlaza desde fuera y la visita, ve el noindex.
 */
export async function onRequest(context) {
  const SITE = 'https://mentisviva.cl';
  // Lista canónica de páginas (URL clean = sin .html) y su prioridad/changefreq.
  // Solo páginas públicas — cuenta/tracking/encuesta/unidos NO van en sitemap.
  const PAGES = [
    { url: '/',           file: 'index.html',     priority: '1.0', changefreq: 'weekly' },
    { url: '/centro',     file: 'centro.html',    priority: '0.9', changefreq: 'monthly' },
    { url: '/editorial',  file: 'editorial.html', priority: '0.9', changefreq: 'weekly' },
    { url: '/fundacion',  file: 'fundacion.html', priority: '0.8', changefreq: 'monthly' },
    { url: '/recursos',   file: 'recursos.html',  priority: '0.7', changefreq: 'monthly' },
    { url: '/terminos',   file: 'terminos.html',  priority: '0.3', changefreq: 'yearly' },
  ];

  // Trae visibility actual desde el CMS publicado
  let pageVisibility = {};
  try {
    const r = await fetch('https://api.mentisviva.cl/api/content', {
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (r.ok) {
      const d = await r.json();
      pageVisibility = (d.global && d.global.pageVisibility) || {};
    }
  } catch (_) {
    // Si la API falla, asumimos todas visibles (fail-open SEO-wise)
  }

  // Filtra páginas marcadas como ocultas en el CMS
  const visiblePages = PAGES.filter(p => pageVisibility[p.file] !== false);

  // Build XML
  const today = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${visiblePages.map(p => `  <url>
    <loc>${SITE}${p.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // 5 minutos en CDN: balance entre frescura para Google y carga al backend
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
