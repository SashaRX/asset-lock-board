// Asset Lock Board — Telegram Bot
// Uses client Firebase SDK (no service account needed)

const { Telegraf } = require('telegraf');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onValue } = require('firebase/database');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://sasharx.github.io/asset-lock-board/';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://asset-lock-board-default-rtdb.europe-west1.firebasedatabase.app';

if (!BOT_TOKEN) { console.error('BOT_TOKEN not set'); process.exit(1); }

// Firebase client init
const app = initializeApp({
  databaseURL: FIREBASE_DB_URL,
  apiKey: 'AIzaSyBxxpfnWqPgAmRgTaM7y0LmeQMaBhsQ38U',
  projectId: 'asset-lock-board',
});
const db = getDatabase(app);

// Bot
const bot = new Telegraf(BOT_TOKEN);

bot.command('start', (ctx) => {
  ctx.reply('Asset Lock Board — координация файлов команды', {
    reply_markup: {
      inline_keyboard: [[
        { text: '\u{1F512} Open Lock Board', web_app: { url: WEBAPP_URL } }
      ]]
    }
  });
});

bot.command('status', async (ctx) => {
  const filesRef = ref(db, 'files');
  onValue(filesRef, (snap) => {
    const files = snap.val() || {};
    const entries = Object.values(files);

    if (entries.length === 0) {
      return ctx.reply('Нет занятых файлов');
    }

    const grouped = {};
    entries.forEach(f => {
      if (!grouped[f.ownerName]) grouped[f.ownerName] = [];
      grouped[f.ownerName].push(f.name);
    });

    let msg = `\u{1F512} *Занято файлов: ${entries.length}*\n\n`;
    for (const [name, files] of Object.entries(grouped)) {
      msg += `*${name}* (${files.length}):\n`;
      files.forEach(f => { msg += `  \u2022 ${f}\n`; });
      msg += '\n';
    }

    ctx.reply(msg, { parse_mode: 'Markdown' });
  }, { onlyOnce: true });
});

// Watch for freed files → notify watchers
let previousFiles = {};

onValue(ref(db, 'files'), (snap) => {
  const currentFiles = snap.val() || {};

  for (const [key, prev] of Object.entries(previousFiles)) {
    if (!currentFiles[key]) {
      const watchers = prev.watchers || {};
      const watcherIds = Object.keys(watchers);
      const fileName = prev.name;
      const ownerName = prev.ownerName;

      watcherIds.forEach(userId => {
        const msg = `\u{1F513} *${fileName}* освобождён!\nБыл занят: ${ownerName}`;
        bot.telegram.sendMessage(userId, msg, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '\u{1F512} Open Lock Board', web_app: { url: WEBAPP_URL } }
            ]]
          }
        }).catch(err => console.log(`Notify ${userId} failed:`, err.message));
      });

      if (watcherIds.length > 0) {
        console.log(`${fileName} freed by ${ownerName}, notified: ${watcherIds.join(', ')}`);
      }
    }
  }

  previousFiles = JSON.parse(JSON.stringify(currentFiles));
});

bot.launch().then(() => {
  console.log('\u{1F916} Bot started');
  console.log(`\u{1F4F1} WebApp: ${WEBAPP_URL}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
