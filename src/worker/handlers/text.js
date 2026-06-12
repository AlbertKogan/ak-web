import { tg, captionPrompt } from '../lib/telegram.js';
import { getState, setState, clearState } from '../lib/state.js';
import { slugify, deleteStagedFiles } from '../lib/r2.js';
import { finalizeUpload } from './finalize.js';

export async function handleText(update, env) {
  const msg = update.message;
  const chatId = String(msg.chat.id);
  const text = msg.text?.trim();
  const bot = tg(env.TELEGRAM_BOT_TOKEN);

  if (!text) return;

  const state = await getState(env.UPLOAD_STATE, chatId);
  if (!state) return; // no active upload, ignore

  // ── /cancel: discard the active session and any staged files ───────────────
  if (text === '/cancel') {
    if (state.sessionId) await deleteStagedFiles(env.PHOTOS, chatId, state.sessionId);
    await clearState(env.UPLOAD_STATE, chatId);
    await bot.send(chatId, 'Cancelled.');
    return;
  }

  // ── Blog post text → publish ────────────────────────────────────────────────
  if (state.step === 'awaiting_post_text') {
    const { finalizeBlogPost } = await import('./blog-photos.js');
    return finalizeBlogPost(chatId, state, text, env);
  }

  // ── New album name ────────────────────────────────────────────────────────
  if (state.step === 'awaiting_new_album_name') {
    const albumId = slugify(text);
    await setState(env.UPLOAD_STATE, chatId, {
      ...state,
      step: 'awaiting_new_album_description',
      albumId,
      newAlbumTitle: text,
      isNewAlbum: true,
    });
    await bot.send(chatId, 'Short description? (or /skip)', {
      reply_markup: { inline_keyboard: [[{ text: 'Skip', callback_data: 'desc:skip' }]] },
    });
    return;
  }

  // ── New album description ─────────────────────────────────────────────────
  if (state.step === 'awaiting_new_album_description') {
    const description = text === '/skip' ? null : text;
    await setState(env.UPLOAD_STATE, chatId, {
      ...state,
      step: 'awaiting_caption',
      newAlbumDescription: description,
    });
    await bot.send(chatId, captionPrompt(state), {
      reply_markup: { inline_keyboard: [[{ text: 'Skip', callback_data: 'caption:skip' }]] },
    });
    return;
  }

  // ── Caption ───────────────────────────────────────────────────────────────
  if (state.step === 'awaiting_caption') {
    const caption = text === '/skip' ? null : text;
    await finalizeUpload(chatId, { ...state, caption }, env);
  }
}
