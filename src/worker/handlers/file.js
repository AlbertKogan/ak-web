import { tg } from '../lib/telegram.js';
import { getState, setState } from '../lib/state.js';
import { extractExif } from '../lib/exif.js';
import { stageFile, getIndex, suggestAlbums } from '../lib/r2.js';

export async function handleFile(update, env) {
  const msg = update.message;
  const chatId = String(msg.chat.id);
  const bot = tg(env.TELEGRAM_BOT_TOKEN);
  const doc = msg.document;
  const groupId = msg.media_group_id ?? null;

  // Reject compressed photos — quality is lost
  if (msg.photo) {
    await bot.send(chatId,
      'Please send as a <b>file</b> (Attach → File) to preserve quality. Photos get compressed by Telegram.',
    );
    return;
  }

  if (!doc) return;

  // ── Route .md files to the blog handler ────────────────────────────────────
  const fileName = doc.file_name ?? '';
  if (fileName.toLowerCase().endsWith('.md')) {
    const { handleBlogFile } = await import('./blog-file.js');
    return handleBlogFile(update, env);
  }

  const mimeType = doc.mime_type ?? 'image/jpeg';
  if (!mimeType.startsWith('image/')) {
    await bot.send(chatId, 'Only image files are supported.');
    return;
  }

  // Download from Telegram
  const fileUrl = await bot.getFileUrl(doc.file_id);
  const fileRes = await fetch(fileUrl);
  const buffer = await fileRes.arrayBuffer();

  const exif = await extractExif(buffer);
  const ext = doc.file_name?.split('.').pop()?.toLowerCase() ?? 'jpg';

  // sessionId ties together all photos in a batch.
  // For media groups, use the shared media_group_id so all photos land under the same prefix.
  // For single photos, use the file_id (unique enough).
  const sessionId = groupId ?? doc.file_id;

  // Stage the file — key is deterministic from sessionId + file_id, no KV read needed
  await stageFile(env.PHOTOS, chatId, sessionId, doc.file_id, buffer, mimeType, exif, ext);

  // ── Media group continuation: just stage, no prompt ────────────────────────
  if (groupId) {
    const existingState = await getState(env.UPLOAD_STATE, chatId);
    if (existingState?.sessionId === sessionId) {
      // Another photo in this group — update count only, file is already staged above
      await setState(env.UPLOAD_STATE, chatId, {
        ...existingState,
        photoCount: (existingState.photoCount ?? 1) + 1,
      });
      return;
    }
  }

  // ── First (or only) photo — save state and prompt ──────────────────────────
  await bot.send(chatId, '⏳ Processing...');

  await setState(env.UPLOAD_STATE, chatId, {
    step: 'awaiting_album',
    sessionId,
    groupId,
    photoCount: 1,
    firstExif: exif, // used for GPS-based album suggestion in prompt
  });

  // Build album keyboard using first photo's GPS
  const index = await getIndex(env.PHOTOS);
  const suggested = exif.gps
    ? suggestAlbums(index, exif.gps.lat, exif.gps.lng)
    : [];
  const suggestedIds = new Set(suggested.map(a => a.id));

  const albumButtons = [
    ...suggested.map(a => [{ text: `📍 ${a.title}`, callback_data: `album:${a.id}` }]),
    ...index.albums
      .filter(a => !suggestedIds.has(a.id))
      .map(a => [{ text: a.title, callback_data: `album:${a.id}` }]),
    [{ text: '＋ New album', callback_data: 'album:__new__' }],
  ];

  const exifSummary = formatExifSummary(exif);

  await bot.send(chatId,
    `Got it.${exifSummary ? `\n<i>${exifSummary}</i>` : ''}\n\nWhich album?`,
    { reply_markup: { inline_keyboard: albumButtons } },
  );
}

function formatExifSummary(exif) {
  const parts = [];
  if (exif.dateTaken) parts.push(exif.dateTaken.slice(0, 10));
  if (exif.camera?.focal) parts.push(exif.camera.focal);
  if (exif.camera?.aperture) parts.push(exif.camera.aperture);
  if (exif.camera?.shutter) parts.push(exif.camera.shutter);
  if (exif.camera?.iso) parts.push(`ISO ${exif.camera.iso}`);
  return parts.join(' · ');
}
