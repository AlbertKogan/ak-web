const api = (token, method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json());

export const tg = (token) => ({
  send: (chatId, text, extra = {}) =>
    api(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra }),

  answer: (callbackQueryId, text = '') =>
    api(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text }),

  getFileUrl: async (fileId) => {
    const res = await api(token, 'getFile', { file_id: fileId });
    return `https://api.telegram.org/file/bot${token}/${res.result.file_path}`;
  },
});
