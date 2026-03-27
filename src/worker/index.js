import { handleFile } from './handlers/file.js';
import { handleCallback } from './handlers/callback.js';
import { handleText } from './handlers/text.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Telegram webhook ───────────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      return handleWebhook(request, env);
    }

    // ── All other requests → static assets ────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};

async function handleWebhook(request, env) {
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
