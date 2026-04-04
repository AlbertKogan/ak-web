import { tg } from '../lib/telegram.js';
import {
  parseFrontmatter,
  generateExcerpt,
  renderPostPage,
  getBlogIndex,
  putBlogIndex,
  putPost,
  slugify,
} from '../lib/blog.js';

export async function handleBlogFile(update, env) {
  const msg = update.message;
  const chatId = String(msg.chat.id);
  const bot = tg(env.TELEGRAM_BOT_TOKEN);
  const doc = msg.document;

  await bot.send(chatId, '⏳ Processing post...');

  try {
    // ── Download the .md file from Telegram ──────────────────────────────────
    const fileUrl = await bot.getFileUrl(doc.file_id);
    const fileRes = await fetch(fileUrl);
    const raw = await fileRes.text();

    // ── Parse frontmatter ────────────────────────────────────────────────────
    const { meta, body } = parseFrontmatter(raw);

    if (!meta.title) {
      await bot.send(chatId,
        '❌ Missing <b>title</b> in frontmatter.\n\n' +
        'Start the file with:\n<pre>---\ntitle: Your Post Title\ntags: tag1, tag2\n---</pre>',
      );
      return;
    }

    if (!body.trim()) {
      await bot.send(chatId, '❌ Post body is empty.');
      return;
    }

    const slug = slugify(meta.title);

    if (!slug) {
      await bot.send(chatId, '❌ Title must contain at least one letter or number.');
      return;
    }

    // ── Render markdown → full HTML page ─────────────────────────────────────
    const html = await renderPostPage(slug, meta, body);
    const excerpt = generateExcerpt(body);

    // ── Store in R2 ──────────────────────────────────────────────────────────
    await putPost(env.PHOTOS, slug, raw, html);

    // ── Update blog index ────────────────────────────────────────────────────
    const index = await getBlogIndex(env.PHOTOS);
    const existingIdx = index.posts.findIndex(p => p.slug === slug);

    const postEntry = {
      slug,
      title: meta.title,
      date: meta.date,
      tags: meta.tags,
      excerpt,
    };

    if (existingIdx >= 0) {
      index.posts[existingIdx] = postEntry;
    } else {
      index.posts.push(postEntry);
    }

    await putBlogIndex(env.PHOTOS, index);

    // ── Confirm ──────────────────────────────────────────────────────────────
    const action = existingIdx >= 0 ? 'Updated' : 'Published';
    await bot.send(chatId,
      `✓ ${action}: <b>${meta.title}</b>\nhttps://akogan.dev/blog/${slug}`,
    );

  } catch (err) {
    console.error('handleBlogFile error:', err);
    await bot.send(chatId, '❌ Failed to publish post. Please try again.');
  }
}
