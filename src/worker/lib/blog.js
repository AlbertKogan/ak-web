// ── Blog helpers: R2 storage, frontmatter, HTML template ─────────────────────

import { parse as parseMarkdown } from './markdown.js';
import { slugify } from './r2.js';

// ── R2 index / storage ───────────────────────────────────────────────────────

export async function getBlogIndex(bucket) {
  const obj = await bucket.get('blog/index.json');
  if (!obj) return { posts: [] };
  return obj.json();
}

export async function putBlogIndex(bucket, index) {
  await bucket.put('blog/index.json', JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function putPost(bucket, slug, md, html) {
  await Promise.all([
    bucket.put(`blog/${slug}/post.md`, md, {
      httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
    }),
    bucket.put(`blog/${slug}/post.html`, html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    }),
  ]);
}

export async function getRenderedPost(bucket, slug) {
  const obj = await bucket.get(`blog/${slug}/post.html`);
  if (!obj) return null;
  return obj.text();
}

// ── Frontmatter parsing ─────────────────────────────────────────────────────

/**
 * Parse YAML-ish frontmatter from a markdown string.
 *
 * Expects:
 *   ---
 *   title: My Post Title
 *   tags: travel, thoughts
 *   ---
 *
 * Returns { meta: { title, tags[], date }, body: "..." }
 */
export function parseFrontmatter(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const meta = { title: null, tags: [], date: new Date().toISOString().slice(0, 10) };

  if (lines[0]?.trim() !== '---') {
    return { meta, body: raw };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) return { meta, body: raw };

  // Parse simple key: value pairs
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();

    if (key === 'title') {
      meta.title = val;
    } else if (key === 'tags') {
      meta.tags = val
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
    } else if (key === 'date') {
      meta.date = val;
    }
  }

  const body = lines.slice(endIdx + 1).join('\n').replace(/^\n+/, '');
  return { meta, body };
}

// ── Excerpt ──────────────────────────────────────────────────────────────────

export function generateExcerpt(body, maxLen = 160) {
  // Strip markdown syntax for a plain-text excerpt
  const plain = body
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')   // bold
    .replace(/\*(.+?)\*/g, '$1')       // italic
    .replace(/__(.+?)__/g, '$1')       // bold alt
    .replace(/_(.+?)_/g, '$1')         // italic alt
    .replace(/~~(.+?)~~/g, '$1')       // strikethrough
    .replace(/`(.+?)`/g, '$1')         // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
    .replace(/!\[.*?\]\(.+?\)/g, '')   // images
    .replace(/>\s?/gm, '')             // blockquotes
    .replace(/[-*+]\s/gm, '')          // list markers
    .replace(/\n+/g, ' ')             // collapse newlines
    .trim();

  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen).replace(/\s\S*$/, '') + '...';
}

// ── Inlined CSS for pre-rendered pages ────────────────────────────────────────
// Blog pages are stored in R2 and served directly by the Worker, bypassing
// Vite's build. They can't reference hashed asset paths, so we inline the
// styles they need: design tokens, reset, base, nav, and blog-specific rules.

const BLOG_CSS = `
:root {
  --background: #050505; --surface: #0e0e0e;
  --surface-container-low: #131313; --surface-container: #191a1a;
  --surface-container-high: #252626;
  --primary: #d5c5a7; --primary-container: #51452f; --primary-dim: #c7b79a;
  --secondary: #9f9d9d; --on-surface: #e7e5e4; --on-surface-variant: #acabaa;
  --on-primary: #4a3f29; --outline-variant: #484848;
  --font-headline: "Manrope", sans-serif;
  --font-body: "Cormorant Garamond", serif;
  --font-label: "Inter", sans-serif;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-font-smoothing: antialiased; background-color: var(--background); }
body {
  background-color: transparent; color: var(--on-surface);
  font-family: var(--font-body); overflow-x: hidden;
  min-height: 100svh; cursor: default;
}
::selection { background-color: var(--primary-container); color: var(--primary); }
a { color: inherit; text-decoration: none; }
.site-nav {
  position: fixed; top: 0; width: 100%; z-index: 50;
  display: flex; justify-content: center; align-items: center; padding: 3rem;
}
.site-nav__wordmark {
  font-family: var(--font-headline); font-weight: 300; font-size: 10px;
  letter-spacing: 0.5em; text-transform: uppercase;
  color: var(--on-surface); opacity: 0.3;
  transition: opacity 300ms var(--ease-standard);
}
.site-nav__wordmark:hover { opacity: 0.7; }

/* Post page */
.blog-post { max-width: 40rem; margin: 0 auto; padding: 8rem 2rem 6rem; min-height: 100svh; }
.blog-post__header { margin-bottom: 3rem; }
.blog-post__date { font-family: var(--font-label); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--secondary); }
.blog-post__title { font-family: var(--font-headline); font-weight: 200; font-size: clamp(1.75rem, 4vw, 2.5rem); line-height: 1.25; color: var(--primary); margin: 0.75rem 0 1rem; }
.blog-post__tags { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.blog-post__tag { font-family: var(--font-label); font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--on-surface-variant); background: var(--surface-container); padding: 0.25em 0.75em; border-radius: 2px; }
.blog-post__body { font-family: var(--font-body); font-size: clamp(1.1rem, 1.8vw, 1.3rem); line-height: 1.8; color: rgba(231, 229, 228, 0.9); }
.blog-post__body > * + * { margin-top: 1.5em; }
.blog-post__body h2 { font-family: var(--font-headline); font-weight: 300; font-size: 1.4em; color: var(--primary); margin-top: 2.5em; }
.blog-post__body h3 { font-family: var(--font-headline); font-weight: 300; font-size: 1.15em; color: var(--primary-dim); margin-top: 2em; }
.blog-post__body a { color: var(--primary); text-decoration: underline; text-underline-offset: 0.15em; transition: color 300ms var(--ease-standard); }
.blog-post__body a:hover { color: var(--on-surface); }
.blog-post__body strong { font-weight: 600; color: var(--on-surface); }
.blog-post__body em { font-style: italic; }
.blog-post__body blockquote { border-left: 2px solid var(--primary-container); padding-left: 1.25em; color: var(--on-surface-variant); font-style: italic; }
.blog-post__body code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85em; background: var(--surface-container); padding: 0.15em 0.4em; border-radius: 3px; }
.blog-post__body pre { background: var(--surface-container-low); border: 1px solid var(--outline-variant); border-radius: 6px; padding: 1.25em 1.5em; overflow-x: auto; line-height: 1.5; }
.blog-post__body pre code { background: none; padding: 0; font-size: 0.85em; }
.blog-post__body img { max-width: 100%; border-radius: 4px; }
.blog-post__body hr { border: none; border-top: 1px solid var(--outline-variant); margin: 2.5em 0; }
.blog-post__body ul, .blog-post__body ol { padding-left: 1.5em; }
.blog-post__body li + li { margin-top: 0.5em; }
.blog-post__body table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
.blog-post__body th, .blog-post__body td { text-align: left; padding: 0.5em 1em; border-bottom: 1px solid var(--outline-variant); }
.blog-post__body th { font-family: var(--font-label); font-size: 0.8em; letter-spacing: 0.1em; text-transform: uppercase; color: var(--secondary); }
.blog-post__footer { margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--outline-variant); }
.blog-post__back { font-family: var(--font-label); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--secondary); transition: color 300ms var(--ease-standard); }
.blog-post__back:hover { color: var(--primary); }

/* Listing page */
.blog-list { max-width: 40rem; margin: 0 auto; padding: 8rem 2rem 6rem; min-height: 100svh; }
.blog-list__heading { font-family: var(--font-headline); font-weight: 200; font-size: clamp(1.75rem, 4vw, 2.5rem); color: var(--primary); margin-bottom: 3rem; }
.blog-list__item { display: block; padding: 1.5rem 0; border-bottom: 1px solid var(--surface-container-high); transition: border-color 300ms var(--ease-standard); }
.blog-list__item:first-of-type { border-top: 1px solid var(--surface-container-high); }
.blog-list__item:hover { border-color: var(--primary-container); }
.blog-list__date { font-family: var(--font-label); font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--secondary); }
.blog-list__title { font-family: var(--font-headline); font-weight: 300; font-size: 1.25rem; color: var(--on-surface); margin: 0.4rem 0 0.5rem; transition: color 300ms var(--ease-standard); }
.blog-list__item:hover .blog-list__title { color: var(--primary); }
.blog-list__tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.5rem; }
.blog-list__tag { font-family: var(--font-label); font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--on-surface-variant); }
.blog-list__excerpt { font-family: var(--font-body); font-size: 1rem; line-height: 1.6; color: var(--secondary); }
.blog-list__empty { font-family: var(--font-body); font-size: 1.1rem; color: var(--secondary); font-style: italic; }
`;

// ── Shared HTML head/scaffolding ─────────────────────────────────────────────

function blogHead(title, description, canonicalUrl, extraMeta = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonicalUrl}" />
  ${extraMeta}
  <meta name="theme-color" content="#050505" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@300;400&display=swap" rel="stylesheet" />
  <style>${BLOG_CSS}</style>
</head>`;
}

const NAV = `
  <nav class="site-nav" aria-label="Site">
    <a href="/" class="site-nav__wordmark">akogan.dev</a>
  </nav>`;

// ── HTML template ────────────────────────────────────────────────────────────

export async function renderPostPage(slug, meta, markdownBody) {
  const htmlContent = await parseMarkdown(markdownBody);
  const excerpt = generateExcerpt(markdownBody);

  const tagsHtml = meta.tags.length
    ? `<div class="blog-post__tags">${meta.tags.map(t => `<span class="blog-post__tag">${esc(t)}</span>`).join('')}</div>`
    : '';

  const formattedDate = formatDate(meta.date);

  const ogMeta = `
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://akogan.dev/blog/${slug}" />
  <meta property="og:title" content="${esc(meta.title)}" />
  <meta property="og:description" content="${esc(excerpt)}" />
  <meta property="og:site_name" content="akogan.dev" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(meta.title)}" />
  <meta name="twitter:description" content="${esc(excerpt)}" />`;

  return `${blogHead(`${esc(meta.title)} — Albert Kogan`, excerpt, `https://akogan.dev/blog/${slug}`, ogMeta)}
<body>
  ${NAV}

  <main class="blog-post">
    <header class="blog-post__header">
      <time class="blog-post__date" datetime="${meta.date}">${formattedDate}</time>
      <h1 class="blog-post__title">${esc(meta.title)}</h1>
      ${tagsHtml}
    </header>

    <article class="blog-post__body">
      ${htmlContent}
    </article>

    <footer class="blog-post__footer">
      <a href="/blog" class="blog-post__back">&larr; all posts</a>
    </footer>
  </main>
</body>
</html>`;
}

export async function renderBlogIndexPage(posts) {
  const postsHtml = posts
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(post => `
      <a href="/blog/${post.slug}" class="blog-list__item">
        <time class="blog-list__date" datetime="${post.date}">${formatDate(post.date)}</time>
        <h2 class="blog-list__title">${esc(post.title)}</h2>
        ${post.tags.length ? `<div class="blog-list__tags">${post.tags.map(t => `<span class="blog-list__tag">${esc(t)}</span>`).join('')}</div>` : ''}
        <p class="blog-list__excerpt">${esc(post.excerpt)}</p>
      </a>`)
    .join('\n');

  const ogMeta = `
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://akogan.dev/blog" />
  <meta property="og:title" content="Writing — Albert Kogan" />
  <meta property="og:description" content="Notes and thoughts from a life in motion." />
  <meta property="og:site_name" content="akogan.dev" />`;

  return `${blogHead('Writing — Albert Kogan', 'Notes and thoughts from a life in motion.', 'https://akogan.dev/blog', ogMeta)}
<body>
  ${NAV}

  <main class="blog-list">
    <h1 class="blog-list__heading">Writing</h1>
    ${postsHtml || '<p class="blog-list__empty">Nothing here yet.</p>'}
  </main>
</body>
</html>`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return dateStr;
  }
}

export { slugify };
