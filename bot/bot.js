// Asset Lock Board — Telegram Bot
// Sends Mini App button on /start
// Watches Firebase for freed files → notifies watchers
//
// Setup:
//   npm init -y
//   npm install telegraf firebase-admin
//   Set env vars: BOT_TOKEN, WEBAPP_URL, FIREBASE_DB_URL
//   node bot.js

const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');

// ─── Config ───
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.vercel.app';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://YOUR_PROJECT-default-rtdb.firebaseio.com';

// ─── Firebase Admin (server-side) ───
admin.initializeApp({
  databaseURL: FIREBASE_DB_URL,
  // For production: use service account key
  // credential: admin.credential.cert(require('./serviceAccountKey.json')),
});
const db = admin.database();

// ─── Bot ───
const bot = new Telegraf(BOT_TOKEN);

bot.command('start', (ctx) => {
  ctx.reply('Asset Lock Board — координация файлов команды', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🔒 Open Lock Board', web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

bot.command('status', async (ctx) => {
  const snap = await db.ref('files').once('value');
  const files = snap.val() || {};
  const entries = Object.values(files);

  if (entries.length === 0) {
    return ctx.reply('Нет занятых файлов');
  }

  // Group by owner
  const grouped = {};
  entries.forEach(f => {
    if (!grouped[f.ownerName]) grouped[f.ownerName] = [];
    grouped[f.ownerName].push(f.name);
  });

  let msg = `🔒 *Занято файлов: ${entries.length}*\n\n`;
  for (const [name, files] of Object.entries(grouped)) {
    msg += `*${name}* (${files.length}):\n`;
    files.forEach(f => { msg += `  • ${f}\n`; });
    msg += '\n';
  }

  ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ─── Watch Firebase for freed files → notify watchers ───
let previousFiles = {};

db.ref('files').on('value', (snap) => {
  const currentFiles = snap.val() || {};

  // Find files that were removed (freed)
  for (const [key, prev] of Object.entries(previousFiles)) {
    if (!currentFiles[key]) {
      // File was freed
      const watchers = prev.watchers || {};
      const watcherIds = Object.keys(watchers);

      if (watcherIds.length > 0) {
        const fileName = prev.name;
        const ownerName = prev.ownerName;

        watcherIds.forEach(userId => {
          const msg = `🔓 *${fileName}* освобождён!\n` +
            `Был занят: ${ownerName}\n` +
            `Можете взять в работу.`;

          bot.telegram.sendMessage(userId, msg, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '🔒 Open Lock Board', web_app: { url: WEBAPP_URL } }
              ]]
            }
          }).catch(err => {
            console.log(`Failed to notify user ${userId}:`, err.message);
          });
        });

        console.log(`[${new Date().toISOString()}] ${fileName} freed by ${ownerName}, notified: ${watcherIds.join(', ')}`);
      }
    }
  }

  previousFiles = { ...currentFiles };
});

// ─── Start ───
bot.launch().then(() => {
  console.log('🤖 Asset Lock Board bot started');
  console.log(`📱 WebApp URL: ${WEBAPP_URL}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
