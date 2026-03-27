// ── Manifest helpers ──────────────────────────────────────────────────────────

export async function getIndex(bucket) {
  const obj = await bucket.get('photos/index.json');
  if (!obj) return { albums: [] };
  return obj.json();
}

export async function putIndex(bucket, index) {
  await bucket.put('photos/index.json', JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function getManifest(bucket, albumId) {
  const obj = await bucket.get(`photos/${albumId}/manifest.json`);
  if (!obj) return null;
  return obj.json();
}

export async function putManifest(bucket, albumId, manifest) {
  await bucket.put(
    `photos/${albumId}/manifest.json`,
    JSON.stringify(manifest),
    { httpMetadata: { contentType: 'application/json' } },
  );
}

// ── Photo file helpers ────────────────────────────────────────────────────────

export async function stageFile(bucket, chatId, buffer, mimeType) {
  const key = `staging/${chatId}/pending`;
  await bucket.put(key, buffer, { httpMetadata: { contentType: mimeType } });
  return key;
}

export async function moveStagedFile(bucket, stagingKey, finalKey) {
  const obj = await bucket.get(stagingKey);
  if (!obj) throw new Error('Staged file not found');
  const buffer = await obj.arrayBuffer();
  await bucket.put(finalKey, buffer, {
    httpMetadata: obj.httpMetadata,
  });
  await bucket.delete(stagingKey);
}

// ── Album helpers ─────────────────────────────────────────────────────────────

export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function nextPhotoNumber(manifest) {
  const count = manifest?.photos?.length ?? 0;
  return String(count + 1).padStart(3, '0');
}

// Returns albums whose existing photos have GPS within ~50km of given coords
export function suggestAlbums(index, lat, lng) {
  return index.albums.filter((album) => {
    if (!album.coverGps) return false;
    return haversineKm(lat, lng, album.coverGps.lat, album.coverGps.lng) < 50;
  });
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLng = deg2rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function deg2rad(d) { return d * (Math.PI / 180); }
