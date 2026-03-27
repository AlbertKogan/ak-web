import { tg } from '../lib/telegram.js';
import { getState, setState } from '../lib/state.js';
import { slugify } from '../lib/r2.js';
import { finalizeUpload } from './finalize.js';

function captionPrompt(state) {
  const count = state.stagedPhotos?.length ?? 1;
  return count > 1
    ? `Caption for all ${count} photos? (or /skip)`
    : 'Caption? (or /skip)';
}

export async function handleText(update, env) {
  const msg = update.message;
  const chatId = String(msg.chat.id);
  const text = msg.text?.trim();
  const bot = tg(env.TELEGRAM_BOT_TOKEN);

  if (!text) return;

  const state = await getState(env.UPLOAD_STATE, chatId);
  if (!state) return; // no active upload, ignore

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
