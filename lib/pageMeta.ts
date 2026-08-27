// Best-effort metadata fetch for the worker "Add Job" feature: given a job
// posting URL, pull the OpenGraph/HTML <title> + meta description so the
// manually-added job has a real entry the worker can refine. Non-fatal — any
// failure just returns empty fields and the worker fills them by hand.

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface PageMeta {
  title: string;
  description: string;
  company: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export async function fetchPageMeta(url: string): Promise<PageMeta> {
  const empty: PageMeta = { title: '', description: '', company: '' };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
    clearTimeout(t);
    if (!res.ok) return empty;
    const html = await res.text();
    if (!html) return empty;

    const og = (name: string) => {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']og:${name}["'][^>]+content=["']([^"']*)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']og:${name}["']`, 'i'));
      return m ? decodeEntities(m[1]) : '';
    };

    const title = og('title')
      || decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '')
      || '';
    const description = og('description')
      || (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1]
      || '';

    // Heuristic company: og:site_name, else the domain hostname (without TLD).
    let company = og('site_name');
    if (!company) {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        company = host.split('.')[0] || '';
      } catch { /* ignore */ }
    }

    return { title: title.slice(0, 300), description: description.slice(0, 4000), company: company.slice(0, 120) };
  } catch {
    return empty; // never block the manual add on a metadata failure
  }
}