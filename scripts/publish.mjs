#!/usr/bin/env node
// ── Publish a post draft to akogan.dev ───────────────────────────────────────
//
// Usage:
//   node scripts/publish.mjs drafts/tokyo           publish (or update) a draft
//   node scripts/publish.mjs drafts/tokyo --dry-run  process locally, send nothing
//   node scripts/publish.mjs --delete <slug>         unpublish a post
//
// A draft folder contains post.md plus any images it references by name:
//
//   drafts/tokyo/
//     post.md
//     tokyo-1.jpg
//     tokyo-2.jpg
//
// Images are downscaled and stripped of EXIF (incl. GPS) before upload, then
// served post-locally at /blog/<slug>/img/<name>. The publish token is read
// from $PUBLISH_TOKEN or the PUBLISH_TOKEN line in .dev.vars.

import { readFile } from 'node:fs/promises';
import { basename, join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const SITE = process.env.PUBLISH_URL || 'https://akogan.dev';
const MAX_EDGE = 2400;       // longest-edge cap, px
const JPEG_QUALITY = 82;

async function loadToken() {
  if (process.env.PUBLISH_TOKEN) return process.env.PUBLISH_TOKEN.trim();
  try {
    const text = await readFile(join(REPO_ROOT, '.dev.vars'), 'utf8');
    const m = text.match(/^PUBLISH_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* fall through */ }
  throw new Error('No publish token — set $PUBLISH_TOKEN or add PUBLISH_TOKEN to .dev.vars');
}

function referencedImages(md) {
  const names = new Set();
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(md))) {
    const src = m[1].trim();
    if (/^https?:\/\//i.test(src) || src.startsWith('/')) continue;
    names.add(basename(src.split('?')[0]));
  }
  return [...names];
}

async function processImage(path) {
  const { default: sharp } = await import('sharp');
  // .rotate() bakes EXIF orientation into pixels; sharp drops all metadata
  // (including GPS) unless .withMetadata() is called — which we never do.
  const pipeline = sharp(path)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });

  const ext = extname(path).toLowerCase();
  if (ext === '.png') return pipeline.png().toBuffer();
  if (ext === '.webp') return pipeline.webp({ quality: JPEG_QUALITY }).toBuffer();
  return pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

async function deletePost(slug, token) {
  const res = await fetch(`${SITE}/api/post/${slug}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Delete failed (${res.status}):`, data);
    process.exit(1);
  }
  console.log(data.deleted ? `✓ Deleted: ${slug}` : `No such post: ${slug}`);
}

async function publish(dir, { dryRun }, token) {
  const draftPath = resolve(dir);
  const md = await readFile(join(draftPath, 'post.md'), 'utf8');
  const imageNames = referencedImages(md);

  const form = new FormData();
  form.set('markdown', md);

  for (const name of imageNames) {
    let buf;
    try {
      buf = await processImage(join(draftPath, name));
    } catch (err) {
      throw new Error(`Image "${name}" referenced in post.md but couldn't be processed: ${err.message}`);
    }
    form.append('image', new Blob([buf]), name);
    console.log(`  + ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
  }

  if (dryRun) {
    console.log(`dry run — ${imageNames.length} image(s) processed, nothing sent.`);
    return;
  }

  const res = await fetch(`${SITE}/api/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Publish failed (${res.status}):`, data.error || data);
    process.exit(1);
  }
  console.log(`✓ ${data.action}: ${data.url}`);
}

async function main() {
  const args = process.argv.slice(2);
  const token = await loadToken();

  const delIdx = args.indexOf('--delete');
  if (delIdx !== -1) {
    const slug = args[delIdx + 1];
    if (!slug) throw new Error('usage: publish.mjs --delete <slug>');
    return deletePost(slug, token);
  }

  const dryRun = args.includes('--dry-run');
  const dir = args.find(a => !a.startsWith('--'));
  if (!dir) {
    throw new Error('usage: publish.mjs <draftDir> [--dry-run]  |  publish.mjs --delete <slug>');
  }
  return publish(dir, { dryRun }, token);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
