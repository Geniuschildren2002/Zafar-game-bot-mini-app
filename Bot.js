// ═══════════════════════════════════════════════════════════
// ZAFAR GameFi — Telegram Bot (bot.js)
// ═══════════════════════════════════════════════════════════

const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const APP_URL   = process.env.APP_URL   || 'https://your-app.vercel.app';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── /start ───
bot.onText(/\/start(.*)/, (msg, match) => {
  const chatId  = msg.chat.id;
  const refCode = match[1]?.trim() || null;
  const name    = msg.from.first_name || 'Do\'st';

  const greeting = `🏆 Assalomu alaykum, <b>${name}</b>!\n\n` +
    `🎮 <b>ZAFAR</b> — O'ylab pul top!\n\n` +
    `⚡ Har kuni 1000 marta tap qilib <b>ZFC tanga</b> yig'\n` +
    `💳 <b>Click</b> yoki <b>Payme</b> orqali real pul ol\n` +
    `👥 Do'stlarni taklif qilib ularning daromadidan <b>10%</b> ol\n\n` +
    `🎁 Hozir qo'shiling — <b>5,000 ZFC sovg'a!</b>`;

  const keyboard = {
    inline_keyboard: [[
      {
        text: '🎮 O\'yinni Boshlash',
        web_app: { url: `${APP_URL}${refCode ? '?ref=' + refCode : ''}` }
      }
    ], [
      { text: '📢 Kanal', url: 'https://t.me/zafar_game' },
      { text: '🤝 Yordam', url: 'https://t.me/zafar_support' }
    ]]
  };

  bot.sendMessage(chatId, greeting, {
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
});

// ─── /stats ───
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId,
    `📊 <b>Sizning statistikangiz:</b>\n\n` +
    `🪙 ZFC: Yuklanmoqda...\n` +
    `⚡ Energiya: Yuklanmoqda...\n` +
    `🏆 Reyting: Yuklanmoqda...\n\n` +
    `<i>O'yinni ochib ko'ring!</i>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 O\'yinga kirish', web_app: { url: APP_URL } }
        ]]
      }
    }
  );
});

// ─── /ref ───
bot.onText(/\/ref/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const refCode = 'ZAF' + userId.toString(36).toUpperCase().slice(-6);
  const refLink = `https://t.me/ZafarBot?start=${refCode}`;

  bot.sendMessage(chatId,
    `🤝 <b>Referal havolangiz:</b>\n\n` +
    `<code>${refLink}</code>\n\n` +
    `Do'st taklif qilganda:\n` +
    `✅ Siz: <b>+5,000 ZFC</b>\n` +
    `✅ Do'stingiz: <b>+5,000 ZFC</b>\n` +
    `✅ Do'stingiz topganining: <b>10%</b> sizga!`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '📤 Ulashish', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('🎮 ZAFAR o\'ynab pul top! Menga qo\'shil!')}` }
        ]]
      }
    }
  );
});

// ─── /top ───
bot.onText(/\/top/, (msg) => {
  const chatId = msg.chat.id;

  // TODO: fetch from API
  const mockTop = [
    { name: 'Asilbek', coins: '4.2M' },
    { name: 'Nilufar', coins: '3.1M' },
    { name: 'Sherzod', coins: '2.7M' },
  ];

  const topText = mockTop.map((u, i) => {
    const medals = ['🥇', '🥈', '🥉'];
    return `${medals[i]} <b>${u.name}</b> — ${u.coins} ZFC`;
  }).join('\n');

  bot.sendMessage(chatId,
    `🏆 <b>TOP O'yinchilar:</b>\n\n${topText}\n\n` +
    `Siz ham bo'ling!`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 O\'ynash', web_app: { url: APP_URL } }
        ]]
      }
    }
  );
});

// ─── Inline button handlers ───
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  bot.answerCallbackQuery(query.id);
});

// ─── Daily reminder (cron job uchun endpoint) ───
async function sendDailyReminders(userIds) {
  const message = `⚡ <b>Kunlik bonus sizni kutmoqda!</b>\n\n` +
    `🔥 Streakingizni yo'qotmang!\n` +
    `🪙 Bugungi tap bonusini oling\n\n` +
    `Hozir o'ynang!`;

  for (const userId of userIds) {
    try {
      await bot.sendMessage(userId, message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🎮 O\'ynash', web_app: { url: APP_URL } }
          ]]
        }
      });
      await new Promise(r => setTimeout(r, 100)); // Rate limit
    } catch (e) {
      console.error(`Failed to message ${userId}:`, e.message);
    }
  }
}

console.log('🤖 ZAFAR Bot ishga tushdi!');
module.exports = { bot, sendDailyReminders };
