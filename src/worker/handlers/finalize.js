import { tg } from '../lib/telegram.js';
import { clearState } from '../lib/state.js';
import { reverseGeocode } from '../lib/geocode.js';
import {
  getIndex, putIndex,
  getManifest, putManifest,
  listStagedFiles,
  moveStagedFile,
} from '../lib/r2.js';

export async function finalizeUpload(chatId, state, env) {
  const bot = tg(env.TELEGRAM_BOT_TOKEN);
  const { sessionId, albumId, caption, newAlbumTitle, newAlbumDescription } = state;

  try {
    // ── Discover all staged files for this session ──────────────────────────
    const stagedFiles = await listStagedFiles(env.PHOTOS, chatId, sessionId);

    if (stagedFiles.length === 0) {
      await bot.send(chatId, '❌ No staged files found. Please send the photos again.');
      await clearState(env.UPLOAD_STATE, chatId);
      return;
    }

    // ── Load or create manifest ─────────────────────────────────────────────
    let manifest = await getManifest(env.PHOTOS, albumId);
    const firstFile = stagedFiles[0];

    if (!manifest) {
      manifest = {
        id: albumId,
        title: newAlbumTitle ?? albumId,
        description: newAlbumDescription ?? null,
        date: firstFile.exif?.dateTaken?.slice(0, 7) ?? null,
        photos: [],
      };
    }

    const uploadedFiles = [];
    const basePhotoCount = manifest?.photos?.length ?? 0;

    // ── Process each staged photo ───────────────────────────────────────────
    for (let i = 0; i < stagedFiles.length; i++) {
      const { key, ext, exif } = stagedFiles[i];

      let city = null;
      if (exif?.gps) {
        city = await reverseGeocode(exif.gps.lat, exif.gps.lng);
      }

      const num = String(basePhotoCount + i + 1).padStart(3, '0');
      const finalKey = `photos/${albumId}/${num}.${ext}`;

      await moveStagedFile(env.PHOTOS, key, finalKey);

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

      manifest.photos.push(photoEntry);
      uploadedFiles.push(`${num}.${ext}`);
    }

    // ── Sort by date taken ──────────────────────────────────────────────────
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
          date: firstFile.exif?.dateTaken?.slice(0, 7) ?? null,
          cover: `photos/${albumId}/${uploadedFiles[0]}`,
          coverGps: firstFile.exif?.gps ?? null,
          photoCount: 0,
        };

    albumEntry.photoCount = manifest.photos.length;

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
    const count = stagedFiles.length;
    const summary = count === 1
      ? uploadedFiles[0]
      : `${count} photos (${uploadedFiles[0]} – ${uploadedFiles[count - 1]})`;

    await bot.send(chatId, `✓ Uploaded to <b>${albumTitle}</b>: ${summary}`);

  } catch (err) {
    console.error('finalizeUpload error:', err);
    await bot.send(chatId, '❌ Something went wrong. Please try again.');
  }
}
