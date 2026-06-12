#!/usr/bin/env node
// ── gen-photo-snippets.mjs ────────────────────────────────────────────────────
//
// Reads your photo index directly from the remote R2 bucket via wrangler CLI
// and writes .vscode/photos.code-snippets for VS Code autocomplete.
//
// Usage:
//   npm run photos
//
// Each snippet uses the album slug as a prefix, e.g. typing "st-anton"
// in a .md file and pressing Ctrl+Space surfaces every photo in that album.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const BUCKET    = 'ak-photos';
const OUT_FILE  = path.join(ROOT, '.vscode', 'photos.code-snippets');

// ── R2 helpers via wrangler CLI ───────────────────────────────────────────────

function r2Get(key) {
  const result = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, '--pipe', '--remote'],
    { cwd: ROOT, encoding: 'utf8' },
  );

  if (result.status !== 0 || !result.stdout.trim()) {
    // Surface the real wrangler error so we know what's wrong
    const err = (result.stderr ?? '').trim();
    if (err) process.stderr.write(`  wrangler: ${err}\n`);
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

// List all keys under a prefix — used to discover albums when index.json
// doesn't exist yet (e.g. photos were uploaded outside the normal pipeline).
function r2List(prefix) {
  const result = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'list', `${BUCKET}`, '--prefix', prefix, '--remote'],
    { cwd: ROOT, encoding: 'utf8' },
  );

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  // wrangler outputs JSON: { objects: [{ key, size, ... }], ... }
  try {
    const parsed = JSON.parse(result.stdout);
    return (parsed.objects ?? []).map(o => o.key);
  } catch {
    return [];
  }
}

// ── Index reconstruction ──────────────────────────────────────────────────────
// Falls back to listing the bucket when photos/index.json is missing.

function buildIndexFromBucket() {
  process.stdout.write('  photos/index.json not found — scanning bucket for manifests...\n');

  const keys = r2List('photos/');
  const manifestKeys = keys.filter(k => k.endsWith('/manifest.json'));

  if (manifestKeys.length === 0) {
    return { albums: [] };
  }

  const albums = [];
  for (const mKey of manifestKeys) {
    const manifest = r2Get(mKey);
    if (!manifest) continue;
    albums.push({
      id:    manifest.id,
      title: manifest.title ?? manifest.id,
      cover: manifest.photos?.length ? `photos/${manifest.id}/${manifest.photos[0].file}` : null,
      photos: manifest.photos ?? [],
    });
  }

  return { albums };
}

// ── Snippet helpers ───────────────────────────────────────────────────────────

function formatDescription(photo, albumTitle) {
  const parts = [albumTitle];
  if (photo.dateTaken) parts.push(photo.dateTaken.slice(0, 10));
  if (photo.location?.city) parts.push(photo.location.city);
  return parts.join(' · ');
}

function buildSnippets(albums) {
  const snippets = {};

  for (const album of albums) {
    if (!album.photos?.length) continue;

    for (const photo of album.photos) {
      const key     = `${album.id}/${photo.file}`;
      const imgPath = `/photos/${album.id}/${photo.file}`;

      snippets[key] = {
        scope: 'markdown',
        prefix: [album.id, `img:${album.id}`],
        body: [`![\${1:${photo.caption ?? ''}}](${imgPath})`],
        description: formatDescription(photo, album.title),
      };
    }

    if (album.cover) {
      const coverFile = album.cover.split('/').pop();
      snippets[`cover:${album.id}`] = {
        scope: 'markdown',
        prefix: [`cover:${album.id}`],
        body: [`![cover](/photos/${album.id}/${coverFile})`],
        description: `Cover · ${album.title}`,
      };
    }
  }

  return snippets;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write(`Reading from R2 bucket: ${BUCKET}\n`);

  let index = r2Get('photos/index.json');

  if (!index) {
    // index.json missing — try to reconstruct from manifest files
    index = buildIndexFromBucket();

    if (!index.albums.length) {
      console.error('\n❌  No albums found in the bucket.');
      console.error('    Check that you are logged in: npx wrangler login');
      console.error(`    And that the bucket name is correct: ${BUCKET}`);
      process.exit(1);
    }
  } else {
    // index.json found — enrich with per-album photo lists from manifests
    process.stdout.write(`  ${index.albums.length} albums in index — fetching manifests...\n`);

    index.albums = index.albums.map((album) => {
      const manifest = r2Get(`photos/${album.id}/manifest.json`);
      return { ...album, photos: manifest?.photos ?? [] };
    });
  }

  const totalPhotos = index.albums.reduce((n, a) => n + a.photos.length, 0);
  process.stdout.write(`  ${index.albums.length} albums · ${totalPhotos} photos\n\n`);

  const snippets = buildSnippets(index.albums);
  const count    = Object.keys(snippets).length;

  fs.mkdirSync(path.join(ROOT, '.vscode'), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(snippets, null, 2) + '\n');

  console.log(`✓  Wrote ${count} snippets → .vscode/photos.code-snippets`);

  const sample = index.albums.find(a => a.photos.length > 0);
  if (sample) {
    console.log(`\n   Example: type "${sample.id}" in a .md file and press Ctrl+Space`);
  }
}

main();
