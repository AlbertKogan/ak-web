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
  const { stagedPhotos, albumId, caption, isNewAlbum, newAlbumTitle, newAlbumDescription } = state;

  try {
    // ── Load or create manifest ─────────────────────────────────────────────
    let manifest = await getManifest(env.PHOTOS, albumId);
    const isFirstAlbum = !manifest;
    const firstPhoto = stagedPhotos[0];

    if (!manifest) {
      manifest = {
        id: albumId,
        title: newAlbumTitle ?? albumId,
        description: newAlbumDescription ?? null,
        date: firstPhoto?.exif?.dateTaken?.slice(0, 7) ?? null,
        photos: [],
      };
    }

    const uploadedFiles = [];

    // ── Process each photo ──────────────────────────────────────────────────
    for (const photo of stagedPhotos) {
      const { stagingKey, ext, exif } = photo;

      let city = null;
      if (exif?.gps) {
        city = await reverseGeocode(exif.gps.lat, exif.gps.lng);
      }

      const num = nextPhotoNumber(manifest);
      const finalKey = `photos/${albumId}/${num}.${ext}`;

      await moveStagedFile(env.PHOTOS, stagingKey, finalKey);

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
          date: firstPhoto?.exif?.dateTaken?.slice(0, 7) ?? null,
          cover: `photos/${albumId}/${uploadedFiles[0]}`,
          coverGps: firstPhoto?.exif?.gps ?? null,
          photoCount: 0,
        };

    albumEntry.photoCount = manifest.photos.length;

    // First batch into a new album sets the cover
    if (isFirstAlbum) {
      albumEntry.cover = `photos/${albumId}/${uploadedFiles[0]}`;
      albumEntry.coverGps = firstPhoto?.exif?.gps ?? null;
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
    const count = stagedPhotos.length;
    const summary = count === 1
      ? uploadedFiles[0]
      : `${count} photos (${uploadedFiles[0]} – ${uploadedFiles[count - 1]})`;

    await bot.send(chatId, `✓ Uploaded to <b>${albumTitle}</b>: ${summary}`);

  } catch (err) {
    console.error('finalizeUpload error:', err);
    await bot.send(chatId, '❌ Something went wrong. Please try again.');
  }
}
