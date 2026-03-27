import { tg } from '../lib/telegram.js';
import { clearState } from '../lib/state.js';
import { reverseGeocode } from '../lib/geocode.js';
import {
  getIndex, putIndex,
  getManifest, putManifest,
  moveStagedFile,
  nextPhotoNumber,
} from '../lib/r2.js';

export async function finalizeUpload(chatId, state, env) {
  const bot = tg(env.TELEGRAM_BOT_TOKEN);
  const { stagingKey, ext, albumId, exif, caption, isNewAlbum, newAlbumTitle, newAlbumDescription } = state;

  try {
    // ── Resolve location from GPS ───────────────────────────────────────────
    let city = null;
    if (exif?.gps) {
      city = await reverseGeocode(exif.gps.lat, exif.gps.lng);
    }

    // ── Load or create manifest ─────────────────────────────────────────────
    let manifest = await getManifest(env.PHOTOS, albumId);
    const isFirstPhoto = !manifest;

    if (!manifest) {
      manifest = {
        id: albumId,
        title: newAlbumTitle ?? albumId,
        description: newAlbumDescription ?? null,
        date: exif?.dateTaken?.slice(0, 7) ?? null, // YYYY-MM
        photos: [],
      };
    }

    // ── Determine final filename ────────────────────────────────────────────
    const num = nextPhotoNumber(manifest);
    const finalKey = `photos/${albumId}/${num}.${ext}`;

    // ── Move staged file to final location ──────────────────────────────────
    await moveStagedFile(env.PHOTOS, stagingKey, finalKey);

    // ── Build photo entry ───────────────────────────────────────────────────
    const photoEntry = {
      file: `${num}.${ext}`,
      caption: caption ?? null,
    };
    if (exif?.dateTaken) photoEntry.dateTaken = exif.dateTaken;
    if (exif?.orientation && exif.orientation !== 1) photoEntry.orientation = exif.orientation;
    if (exif?.gps || city) {
      photoEntry.location = {
        ...(exif?.gps ?? {}),
        ...(city ? { city } : {}),
      };
    }
    if (exif?.camera) photoEntry.camera = exif.camera;

    // ── Add photo and sort by date taken ────────────────────────────────────
    manifest.photos.push(photoEntry);
    manifest.photos.sort((a, b) => {
      if (!a.dateTaken && !b.dateTaken) return 0;
      if (!a.dateTaken) return 1;
      if (!b.dateTaken) return -1;
      return a.dateTaken.localeCompare(b.dateTaken);
    });

    await putManifest(env.PHOTOS, albumId, manifest);

    // ── Update index.json ───────────────────────────────────────────────────
    const index = await getIndex(env.PHOTOS);
    const existingIdx = index.albums.findIndex(a => a.id === albumId);

    const albumEntry = existingIdx >= 0
      ? { ...index.albums[existingIdx] }
      : {
          id: albumId,
          title: newAlbumTitle ?? albumId,
          description: newAlbumDescription ?? null,
          date: exif?.dateTaken?.slice(0, 7) ?? null,
          cover: finalKey,
          coverGps: exif?.gps ?? null,
          photoCount: 0,
        };

    albumEntry.photoCount = manifest.photos.length;

    // First photo in album becomes cover
    if (isFirstPhoto) {
      albumEntry.cover = finalKey;
      albumEntry.coverGps = exif?.gps ?? null;
    }

    if (existingIdx >= 0) {
      index.albums[existingIdx] = albumEntry;
    } else {
      index.albums.push(albumEntry);
    }

    await putIndex(env.PHOTOS, index);

    // ── Clean up state ──────────────────────────────────────────────────────
    await clearState(env.UPLOAD_STATE, chatId);

    // ── Confirm ─────────────────────────────────────────────────────────────
    const albumTitle = manifest.title;
    const locationNote = city ? ` · ${city}` : '';
    await bot.send(chatId,
      `✓ Uploaded to <b>${albumTitle}</b> as ${num}.${ext}${locationNote}`,
    );

  } catch (err) {
    console.error('finalizeUpload error:', err);
    await bot.send(chatId, '❌ Something went wrong. Please try again.');
  }
}
