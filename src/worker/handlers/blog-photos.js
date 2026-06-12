import { tg } from '../lib/telegram.js';
import { getState, setState, clearState } from '../lib/state.js';
import { stageFile, listStagedFiles, deleteStagedFiles } from '../lib/r2.js';
import { publishPost, PublishError } from '../lib/blog.js';

// ── Blog posts with photos, straight from the phone ───────────────────────────
// Compressed photos (regular Telegram send) become blog-post images. Telegram's
// re-encode conveniently does what scripts/publish.mjs does locally with sharp:
// downscales to ≤2560px and strips all EXIF, including GPS. Albums still
// require photos sent as files, which keeps the two pipelines unambiguous.
//
// Flow:
//   1. Send photo(s)            → staged under one session
//   2. Send text                → first line = title, optional "tags: a, b"
//                                 line, rest = body; or full ---frontmatter---
//   3. Bot publishes            → replies with the live URL
//
// Photos are appended to the end of the post in the order they were sent.
// /cancel discards the session.

export async function handleBlogPhoto(update, env) {
  const msg = update.message;
  const chatId = String(msg.chat.id);
  const bot = tg(env.TELEGRAM_BOT_TOKEN);
  const groupId = msg.media_group_id ?? null;

  // Telegram sends multiple sizes; the last is the largest (≤2560px long edge)
  const sizes = msg.photo;
  const best = sizes?.[sizes.length - 1];
  if (!best) return;

  const existing = await getState(env.UPLOAD_STATE, chatId);
  const continuing = existing?.step === 'awaiting_post_text';

  const sessionId = continuing
    ? existing.sessionId
    : (groupId ?? best.file_unique_id);

  // ── Download from Telegram and stage ────────────────────────────────────────
  let buffer;
  try {
    const fileUrl = await bot.getFileUrl(best.file_id);
    const fileRes = await fetch(fileUrl);
    buffer = await fileRes.arrayBuffer();
  } catch (err) {
    console.error('handleBlogPhoto download error:', err);
    await bot.send(chatId, '❌ Failed to download the photo. Please try again.');
    return;
  }

  await stageFile(
    env.PHOTOS, chatId, sessionId, best.file_unique_id,
    buffer, 'image/jpeg', null, 'jpg',
    { msgId: String(msg.message_id) }, // preserves send order at publish time
  );

  const caption = msg.caption?.trim() || existing?.caption || null;

  // ── Continuation: more photos for an already-prompted session ──────────────
  if (continuing) {
    await setState(env.UPLOAD_STATE, chatId, {
      ...existing,
      caption,
      photoCount: (existing.photoCount ?? 1) + 1,
    });
    return;
  }

  // ── Media-group continuation before state exists (concurrent webhooks) ─────
  if (groupId && existing?.sessionId === sessionId) {
    await setState(env.UPLOAD_STATE, chatId, {
      ...existing,
      caption,
      photoCount: (existing.photoCount ?? 1) + 1,
    });
    return;
  }

  // ── First photo — save state and prompt for the post text ──────────────────
  await setState(env.UPLOAD_STATE, chatId, {
    step: 'awaiting_post_text',
    sessionId,
    caption,
    photoCount: 1,
  });

  const keyboard = caption
    ? { reply_markup: { inline_keyboard: [[{ text: 'Use caption as text', callback_data: 'blog:usecaption' }]] } }
    : {};

  await bot.send(chatId,
    '📝 Staged for a blog post. Send more photos, or the post text:\n' +
    '<i>first line = title, optional second line "tags: a, b", rest = body</i>\n\n' +
    'Photos are appended at the end. /cancel to discard.\n' +
    '(Albums still need photos sent as <b>files</b>.)',
    keyboard,
  );
}

// ── Finalize: text received → build markdown → publish ───────────────────────

export async function finalizeBlogPost(chatId, state, text, env) {
  const bot = tg(env.TELEGRAM_BOT_TOKEN);

  try {
    const staged = await listStagedFiles(env.PHOTOS, chatId, state.sessionId);
    staged.sort((a, b) => Number(a.msgId ?? 0) - Number(b.msgId ?? 0));

    const images = [];
    const names = [];
    for (let i = 0; i < staged.length; i++) {
      const obj = await env.PHOTOS.get(staged[i].key);
      if (!obj) continue;
      const name = `photo-${i + 1}.jpg`;
      images.push({ filename: name, contentType: 'image/jpeg', bytes: await obj.arrayBuffer() });
      names.push(name);
    }

    const rawMarkdown = buildPostMarkdown(text, names);
    const { url, action, title } = await publishPost(env.PHOTOS, { rawMarkdown, images });

    await deleteStagedFiles(env.PHOTOS, chatId, state.sessionId);
    await clearState(env.UPLOAD_STATE, chatId);

    await bot.send(chatId, `✓ ${action}: <b>${title ?? ''}</b>\n${url}`);
  } catch (err) {
    if (err instanceof PublishError) {
      // Keep state + staged photos so the user can just resend corrected text
      await bot.send(chatId, `❌ ${err.message}\nSend the text again, or /cancel.`);
      return;
    }
    console.error('finalizeBlogPost error:', err);
    await bot.send(chatId, '❌ Failed to publish post. Please try again.');
  }
}

// ── Markdown assembly ─────────────────────────────────────────────────────────
// Either full frontmatter (text starts with ---), or the phone-friendly form:
//   line 1            → title
//   "tags: a, b"      → tags (optional, first non-empty line after the title)
//   everything else   → body
export function buildPostMarkdown(text, imageNames = []) {
  let md;
  const trimmed = text.replace(/\r\n/g, '\n');

  if (trimmed.trimStart().startsWith('---')) {
    md = trimmed;
  } else {
    const lines = trimmed.split('\n');
    const title = lines[0].trim();
    let rest = lines.slice(1);

    let tags = '';
    const firstContent = rest.findIndex(l => l.trim() !== '');
    if (firstContent !== -1 && /^tags\s*:/i.test(rest[firstContent].trim())) {
      tags = rest[firstContent].trim().replace(/^tags\s*:\s*/i, '');
      rest = rest.slice(firstContent + 1);
    }

    const body = rest.join('\n').trim();
    md = `---\ntitle: ${title}\n${tags ? `tags: ${tags}\n` : ''}---\n\n${body}`;
  }

  if (imageNames.length) {
    md = `${md.trimEnd()}\n\n${imageNames.map(n => `![](${n})`).join('\n\n')}\n`;
  }
  return md;
}
