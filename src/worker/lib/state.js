const key = (chatId) => `state:${chatId}`;

export const getState = (kv, chatId) =>
  kv.get(key(chatId), 'json');

export const setState = (kv, chatId, state) =>
  kv.put(key(chatId), JSON.stringify(state), { expirationTtl: 3600 });

export const clearState = (kv, chatId) =>
  kv.delete(key(chatId));
