# Publishing

Three ways to publish a post to `akogan.dev/blog`. All go through the same
worker code (`publishPost` in `src/worker/lib/blog.js`), so output is identical.

## 1. From the phone (Telegram, posts with photos)

Send photos to the bot the normal way — **not** as files. (Photos sent as
files still go to the album pipeline.) Telegram's compression does the same
work `publish.mjs` does locally: downscales to ≤2560px and strips all EXIF,
including GPS.

Then send the post text as a message:

```
A night in Tokyo
tags: travel, japan

The izakaya we'd been looking for turned out to be
three floors up, no sign.
```

First line is the title; an optional `tags:` line follows; the rest is the
body. (A full `---` frontmatter block also works.) Photos are appended to the
end of the post in the order they were sent — you can keep sending photos
until the text arrives. If the photos had a caption, the bot offers a
"Use caption as text" button. `/cancel` discards the session.

The bot replies with the live URL. Publishing again with the same title
updates the existing post.

## 2. From Telegram (.md file, text-only posts)

Send a `.md` file to the bot. Frontmatter sets the title/tags/date:

```markdown
---
title: A night in Tokyo
tags: travel, japan
---

Body text in markdown.
```

The bot replies with the live URL. Re-sending a file with the same title
updates the existing post.

## 3. From Claude / the command line (posts with photos)

A draft is a folder under `drafts/` (gitignored — drafts aren't content):

```
drafts/tokyo/
  post.md
  tokyo-1.jpg
  tokyo-2.jpg
```

`post.md` references its images by filename:

```markdown
---
title: A night in Tokyo
tags: travel, japan
date: 2026-06-05
---

Me and my friends in Tokyo. The izakaya we'd been looking for
turned out to be three floors up, no sign.

![](tokyo-1.jpg)
![](tokyo-2.jpg)
```

Publish:

```bash
npm run publish drafts/tokyo            # publish or update
npm run publish drafts/tokyo -- --dry-run   # process locally, send nothing
npm run publish -- --delete a-night-in-tokyo   # unpublish
```

The script downscales images (long edge ≤ 2400px) and strips all EXIF —
including GPS — before upload. Images are stored privately under the post
(`/blog/<slug>/img/...`) and never touch your photo albums or map. They're
served through Cloudflare image resizing (`?w=…&f=webp` added automatically).

The publish token is read from `$PUBLISH_TOKEN` or the `PUBLISH_TOKEN` line in
`.dev.vars`.

## One-time setup / deploy

The code is in place. To make it live you need to set the production secret,
build, and deploy:

```bash
# 1. Set the publish token as a production secret.
#    Use the same value that's in .dev.vars (PUBLISH_TOKEN line).
wrangler secret put PUBLISH_TOKEN

# 2. Install deps (adds sharp, used by the publish script).
npm install

# 3. Build the static site (picks up the new "Writing" footer link)
#    and deploy the worker.
npm run build
wrangler deploy
```

`BLOG_ENABLED` is now `true` in `wrangler.toml`, so `/blog` serves in
production after deploy.

## What's where

- `src/worker/lib/blog.js` — `publishPost`, `deletePost`, rendering, R2 storage
- `src/worker/handlers/blog-photos.js` — phone flow: photo staging, text →
  markdown assembly, publish
- `src/worker/lib/post-images.js` — pure image-ref rewriting / filename helpers
- `src/worker/index.js` — routes: `POST /api/publish`, `DELETE /api/post/:slug`,
  `GET /blog/:slug/img/:file`, bearer-token auth
- `scripts/publish.mjs` — the command-line / Claude publish client
- `.dev.vars` — local secrets incl. `PUBLISH_TOKEN` (gitignored)
