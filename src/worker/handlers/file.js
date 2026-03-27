import { tg } from '../lib/telegram.js';
import { setState } from '../lib/state.js';
import { extractExif } from '../lib/exif.js';
import { stageFile, getIndex, suggestAlbums } from '../lib/r2.js';

export async function handleFile(update, env) {
  const msg = update.message;
  const chatId = String(msg.chat.id);
  const bot = tg(env.TELEGRAM_BOT_TOKEN);

  // Reject compressed photos — quality is lost
  if (msg.photo) {
    await bot.send(chatId,
      'Please send as a <b>file</b> (Attach → File) to preserve quality. Photos get compressed by Telegram.',
    );
    return;
  }

  const doc = msg.document;
  if (!doc) return;

  const mimeType = doc.mime_type ?? 'image/jpeg';
  if (!mimeType.startsWith('image/')) {
    await bot.send(chatId, 'Only image files are supported.');
    return;
  }

  await bot.send(chatId, '⏳ Processing...');

  // Download from Telegram
  const fileUrl = await bot.getFileUrl(doc.file_id);
  const fileRes = await fetch(fileUrl);
  const buffer = await fileRes.arrayBuffer();

  // Extract EXIF (gracefully handles missing data)
  const exif = await extractExif(buffer);

  // Stage in R2
  const stagingKey = await stageFile(env.PHOTOS, chatId, buffer, mimeType);

  // Determine file extension
  const ext = doc.file_name?.split('.').pop()?.toLowerCase() ?? 'jpg';

  // Save state
  await setState(env.UPLOAD_STATE, chatId, {
    step: 'awaiting_album',
    stagingKey,
    fileName: doc.file_name ?? `photo.${ext}`,
    ext,
    exif,
  });

  // Build album keyboard
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
