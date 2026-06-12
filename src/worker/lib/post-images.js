// ── Post-local image helpers (pure, no wasm) ─────────────────────────────────
// Kept free of the markdown-wasm import so this module can be unit-tested in
// plain Node and reused by both the worker and tooling.

// Filenames must match the serving route's allowed charset: [a-z0-9_.-]+
export function sanitizeFilename(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function guessContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':  return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif':  return 'image/gif';
    case 'avif': return 'image/avif';
    case 'jpg':
    case 'jpeg':
    default:     return 'image/jpeg';
  }
}

/**
 * Rewrite local image references in a markdown body to served post-image URLs.
 *
 * - Absolute refs (http(s):// or starting with /) are left untouched.
 * - Local refs are matched by sanitized basename against `imageMap`
 *   (basename → public URL). Matched refs get on-the-fly resize params.
 * - Unmatched local refs are left as-is (nothing to point them at).
 *
 * @param {string} body      markdown body
 * @param {Record<string,string>} imageMap  sanitized basename → URL
 * @param {number} width     resize width to request from the image route
 */
export function rewriteImageRefs(body, imageMap, width = 1600) {
  return body.replace(/!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (match, alt, src, title) => {
    const trimmed = src.trim();
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return match;
    const base = sanitizeFilename(trimmed.split('/').pop().split('?')[0]);
    const url = imageMap[base];
    if (!url) return match;
    return `![${alt}](${url}?w=${width}&f=webp${title ? title : ''})`;
  });
}

/** Collect sanitized basenames of all local image refs in a markdown body. */
export function referencedImageNames(body) {
  const names = new Set();
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(body))) {
    const src = m[1].trim();
    if (/^https?:\/\//i.test(src) || src.startsWith('/')) continue;
    names.add(sanitizeFilename(src.split('/').pop().split('?')[0]));
  }
  return [...names];
}
