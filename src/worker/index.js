import { handleFile } from './handlers/file.js';
import { handleCallback } from './handlers/callback.js';
import { handleText } from './handlers/text.js';
import { getRenderedPost, getBlogIndex, renderBlogIndexPage, publishPost, deletePost, PublishError } from './lib/blog.js';
import { getIndex, getManifest } from './lib/r2.js';

const MAX_PUBLISH_BYTES = 25 * 1024 * 1024; // 25 MB cap on a publish request

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Telegram webhook ───────────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      return handleWebhook(request, env);
    }

    // ── Publish API ──────────────────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/api/publish') {
      return handlePublishApi(request, env);
    }
    if (request.method === 'DELETE') {
      const delMatch = url.pathname.match(/^\/api\/post\/([a-z0-9-]+)$/);
      if (delMatch) return handleDeleteApi(delMatch[1], request, env);
    }

    if (request.method === 'GET') {
      // ── Photo file serving — /photos/:albumId/:file ──────────────────────
      const photoMatch = url.pathname.match(/^\/photos\/([a-z0-9-]+)\/([a-z0-9_.-]+)$/i);
      if (photoMatch) {
        return serveImage(`photos/${photoMatch[1]}/${photoMatch[2]}`, request, env);
      }

      // ── Post-local image serving — /blog/:slug/img/:file ─────────────────
      // Ungated (independent of BLOG_ENABLED) so post images always resolve.
      const blogImgMatch = url.pathname.match(/^\/blog\/([a-z0-9-]+)\/img\/([a-z0-9_.-]+)$/i);
      if (blogImgMatch) {
        return serveImage(`blog/${blogImgMatch[1]}/img/${blogImgMatch[2]}`, request, env);
      }

      // ── Dev-only: photo index API for snippet generation ─────────────────
      // Gated behind WEBHOOK_SECRET so it's safe to leave in production too —
      // the index is not secret, but this keeps it from being a public API.
      if (url.pathname === '/api/photos' && url.searchParams.get('secret') === env.WEBHOOK_SECRET) {
        return servePhotoIndex(env);
      }

      // ── Blog routes (gated behind BLOG_ENABLED for local dev/testing) ────
      if (env.BLOG_ENABLED) {
        if (url.pathname === '/blog' || url.pathname === '/blog/') {
          return serveBlogIndex(env);
        }
        const blogMatch = url.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/);
        if (blogMatch) {
          return serveBlogPost(blogMatch[1], env);
        }
      }
    }

    // ── All other requests → static assets ────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};

async function handleWebhook(request, env) {
  // ── Auth: verify the request came from Telegram ──────────────────────────
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!secret || secret !== env.WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  // ── Auth: only accept messages from your chat ────────────────────────────
  const senderId = String(
    update.message?.from?.id ??
    update.callback_query?.from?.id ??
    '',
  );
  if (senderId !== String(env.ALLOWED_USER_ID)) {
    // Return 200 so Telegram doesn't retry — we just silently ignore unknown senders
    return new Response('Ignored');
  }

  try {
    if (update.callback_query) {
      await handleCallback(update, env);
    } else if (update.message?.document || update.message?.photo) {
      await handleFile(update, env);
    } else if (update.message?.text) {
      await handleText(update, env);
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }

  return new Response('OK');
}

// ── Blog serving ──────────────────────────────────────────────────────────────

async function serveBlogPost(slug, env) {
  const html = await getRenderedPost(env.PHOTOS, slug);

  if (!html) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400, max-age=3600',
    },
  });
}

// ── Image serving (shared by /photos and /blog/:slug/img) ──────────────────────

async function serveImage(key, request, env) {
  const url = new URL(request.url);

  // ── Transform params: ?w=800&h=600&q=85&f=webp&fit=cover ─────────────────
  // When any transform param is present, let Cloudflare Image Resizing handle
  // it via a subrequest to the same path with no params, which reads the raw
  // bytes from R2. Cloudflare transforms before returning to the caller.
  const w   = url.searchParams.get('w') ?? url.searchParams.get('width');
  const h   = url.searchParams.get('h') ?? url.searchParams.get('height');
  const q   = url.searchParams.get('q') ?? url.searchParams.get('quality');
  const f   = url.searchParams.get('f') ?? url.searchParams.get('format');
  const fit = url.searchParams.get('fit');

  if (w || h || q || f || fit) {
    const rawUrl = `${url.origin}${url.pathname}`;
    const image  = {};
    if (w)   image.width   = parseInt(w);
    if (h)   image.height  = parseInt(h);
    if (q)   image.quality = parseInt(q);
    if (f)   image.format  = f;
    if (fit) image.fit     = fit;

    return fetch(rawUrl, { cf: { image } });
  }

  // ── Raw serving from R2 ───────────────────────────────────────────────────
  const obj = await env.PHOTOS.get(key);

  if (!obj) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

// ── Publish API ────────────────────────────────────────────────────────────────
// Bearer-token gated. Powers "publish from Claude" and any future client.

function publishAuthFailed(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!env.PUBLISH_TOKEN || !token || !timingSafeEqual(token, env.PUBLISH_TOKEN)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function handlePublishApi(request, env) {
  const denied = publishAuthFailed(request, env);
  if (denied) return denied;

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Expected multipart/form-data with a "markdown" field' }, 400);
  }

  const markdown = form.get('markdown');
  if (typeof markdown !== 'string' || !markdown.trim()) {
    return json({ error: 'Missing "markdown" field' }, 400);
  }

  const images = [];
  let total = markdown.length;
  for (const [name, value] of form.entries()) {
    if (name === 'markdown') continue;
    if (value && typeof value === 'object' && typeof value.arrayBuffer === 'function') {
      const bytes = await value.arrayBuffer();
      total += bytes.byteLength;
      if (total > MAX_PUBLISH_BYTES) {
        return json({ error: 'Upload too large (25 MB max)' }, 413);
      }
      images.push({ filename: value.name || name, contentType: value.type || '', bytes });
    }
  }

  try {
    const result = await publishPost(env.PHOTOS, { rawMarkdown: markdown, images });
    return json({ ok: true, ...result }, 200);
  } catch (err) {
    if (err instanceof PublishError) return json({ error: err.message, code: err.code }, 400);
    console.error('handlePublishApi error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

async function handleDeleteApi(slug, request, env) {
  const denied = publishAuthFailed(request, env);
  if (denied) return denied;

  try {
    const result = await deletePost(env.PHOTOS, slug);
    return json({ ok: true, ...result }, 200);
  } catch (err) {
    console.error('handleDeleteApi error:', err);
    return json({ error: 'Internal error' }, 500);
  }
}

// ── Dev photo index API ───────────────────────────────────────────────────────
// Returns the full index + per-album manifests so the snippet generator can
// build .vscode/photos.code-snippets without needing wrangler CLI tricks.

async function servePhotoIndex(env) {
  try {
    const index = await getIndex(env.PHOTOS);

    // Attach manifests so the script has file names + EXIF dates/cities
    const albums = await Promise.all(
      index.albums.map(async (album) => {
        const manifest = await getManifest(env.PHOTOS, album.id);
        return { ...album, photos: manifest?.photos ?? [] };
      }),
    );

    return new Response(JSON.stringify({ albums }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('servePhotoIndex error:', err);
    return new Response('Internal error', { status: 500 });
  }
}

async function serveBlogIndex(env) {
  try {
    const index = await getBlogIndex(env.PHOTOS);
    const html = await renderBlogIndexPage(index.posts);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, max-age=300',
      },
    });
  } catch (err) {
    console.error('serveBlogIndex error:', err);
    return new Response('Internal error', { status: 500 });
  }
}
