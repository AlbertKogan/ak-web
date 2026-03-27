import { tg } from '../lib/telegram.js';
import { getState, setState } from '../lib/state.js';

export async function handleCallback(update, env) {
  const query = update.callback_query;
  const chatId = String(query.message.chat.id);
  const data = query.data;
  const bot = tg(env.TELEGRAM_BOT_TOKEN);

  await bot.answer(query.id);

  const state = await getState(env.UPLOAD_STATE, chatId);
  if (!state) {
    await bot.send(chatId, 'Session expired. Please send the photo again.');
    return;
  }

  // ── Album selection ───────────────────────────────────────────────────────
  if (data.startsWith('album:') && state.step === 'awaiting_album') {
    const albumId = data.slice('album:'.length);

    if (albumId === '__new__') {
      await setState(env.UPLOAD_STATE, chatId, { ...state, step: 'awaiting_new_album_name' });
      await bot.send(chatId, 'Album name?');
      return;
    }

    await setState(env.UPLOAD_STATE, chatId, { ...state, step: 'awaiting_caption', albumId });
    await bot.send(chatId, captionPrompt(state), {
      reply_markup: { inline_keyboard: [[{ text: 'Skip', callback_data: 'caption:skip' }]] },
    });
    return;
  }

  // ── Caption skip ─────────────────────────────────────────────────────────
  if (data === 'caption:skip' && state.step === 'awaiting_caption') {
    const { finalizeUpload } = await import('./finalize.js');
    await finalizeUpload(chatId, { ...state, caption: null }, env);
    return;
  }

  // ── Album description skip ────────────────────────────────────────────────
  if (data === 'desc:skip' && state.step === 'awaiting_new_album_description') {
    await setState(env.UPLOAD_STATE, chatId, {
      ...state,
      step: 'awaiting_caption',
      newAlbumDescription: null,
    });
    await bot.send(chatId, captionPrompt(state), {
      reply_markup: { inline_keyboard: [[{ text: 'Skip', callback_data: 'caption:skip' }]] },
    });
  }
}

function captionPrompt(state) {
  const count = state.stagedPhotos?.length ?? 1;
  return count > 1
    ? `Caption for all ${count} photos? (or /skip)`
    : 'Caption? (or /skip)';
}
