import { handleFile } from './handlers/file.js';
import { handleCallback } from './handlers/callback.js';
import { handleText } from './handlers/text.js';
import { getRenderedPost, getBlogIndex, renderBlogIndexPage } from './lib/blog.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Telegram webhook ───────────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      return handleWebhook(request, env);
    }

    // ── Blog routes (gated behind BLOG_ENABLED for local dev/testing) ────
    if (env.BLOG_ENABLED && request.method === 'GET') {
      if (url.pathname === '/blog' || url.pathname === '/blog/') {
        return serveBlogIndex(env);
      }
      const blogMatch = url.pathname.match(/^\/blog\/([a-z0-9-]+)\/?$/);
      if (blogMatch) {
        return serveBlogPost(blogMatch[1], env);
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
