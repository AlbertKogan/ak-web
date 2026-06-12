import { tg } from '../lib/telegram.js';
import { publishPost, PublishError } from '../lib/blog.js';

export async function handleBlogFile(update, env) {
  const msg = update.message;
  const chatId = String(msg.chat.id);
  const bot = tg(env.TELEGRAM_BOT_TOKEN);
  const doc = msg.document;

  await bot.send(chatId, '⏳ Processing post...');

  let raw;
  try {
    // ── Download the .md file from Telegram ──────────────────────────────────
    const fileUrl = await bot.getFileUrl(doc.file_id);
    const fileRes = await fetch(fileUrl);
    raw = await fileRes.text();
  } catch (err) {
    console.error('handleBlogFile download error:', err);
    await bot.send(chatId, '❌ Failed to download the file. Please try again.');
    return;
  }

  try {
    // Telegram posts are text-only (.md upload); images go through /api/publish.
    const { url, action, title } = await publishPost(env.PHOTOS, { rawMarkdown: raw, images: [] });
    await bot.send(chatId, `✓ ${action}: <b>${title ?? ''}</b>\n${url}`);
  } catch (err) {
    if (err instanceof PublishError) {
      if (err.code === 'NO_TITLE') {
        await bot.send(chatId,
          '❌ Missing <b>title</b> in frontmatter.\n\n' +
          'Start the file with:\n<pre>---\ntitle: Your Post Title\ntags: tag1, tag2\n---</pre>',
        );
      } else {
        await bot.send(chatId, `❌ ${err.message}`);
      }
      return;
    }
    console.error('handleBlogFile error:', err);
    await bot.send(chatId, '❌ Failed to publish post. Please try again.');
  }
}
