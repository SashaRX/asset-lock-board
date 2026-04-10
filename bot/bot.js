const toKey = (s) => s.replace(/\./g, '~');

require('dotenv').config();

// Asset Lock Board — Telegram Bot
// Dual mode: Mini App + Inline Board in group chats

const { Telegraf } = require('telegraf');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onValue, set, remove, get } = require('firebase/database');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://sasharx.github.io/asset-lock-board/';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://asset-lock-board-default-rtdb.europe-west1.firebasedatabase.app';

if (!BOT_TOKEN) { console.error('BOT_TOKEN not set'); process.exit(1); }

const firebaseApp = initializeApp({
  databaseURL: FIREBASE_DB_URL,
  apiKey: 'AIzaSyBxxpfnWqPgAmRgTaM7y0LmeQMaBhsQ38U',
  projectId: 'asset-lock-board',
});
const db = getDatabase(firebaseApp);
const bot = new Telegraf(BOT_TOKEN);

// Custom emoji icons
let emojiMap = {};
try { emojiMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'emoji-map.json'), 'utf8')); } catch {}
const EXT_EMOJI = { unity:'unity', scene:'unity', fbx:'fbx', obj:'fbx', prefab:'prefab', mat:'mat', cs:'cs', png:'png', jpg:'png', jpeg:'png', tga:'png', psd:'png', anim:'anim', controller:'anim', wav:'folder', mp3:'folder', txt:'folder', json:'folder', asset:'folder' };
function fileEmoji(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const key = EXT_EMOJI[ext] || 'folder';
  const id = emojiMap[key];
  if (!id) return '';
  return `<tg-emoji emoji-id="${id}">${ICON_EMOJIS[key]||'📄'}</tg-emoji> `;
}
const ICON_EMOJIS = { unity:'🎮', fbx:'🔷', prefab:'📦', mat:'🎨', cs:'💻', png:'🖼', anim:'🎬', folder:'📁' };

// --- State ---
const boards = {};       // chatId -> messageId
const waitingLock = {};  // userId -> chatId

const COLORS = ['#4A90D9','#E8A04C','#B07ACC','#D35555','#5AAFAF','#8BC34A','#FF7043','#AB47BC'];
function colorForId(id) { return COLORS[id % COLORS.length]; }

// Sync user profile + photo to Firebase
async function syncUserProfile(ctx) {
  const u = ctx.from;
  if (!u) return;
  const profile = {
    name: userName(u),
    username: u.username || '',
    color: colorForId(u.id),
  };
  // Get profile photo
  try {
    const photos = await bot.telegram.getUserProfilePhotos(u.id, 0, 1);
    console.log('Photos result:', JSON.stringify(photos));
    if (photos.total_count > 0) {
      const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
      console.log('File ID:', fileId);
      const fileLink = await bot.telegram.getFileLink(fileId);
      console.log('File link:', fileLink);
      profile.photo = fileLink.href || fileLink.toString();
    } else {
      console.log('No profile photos for user', u.id);
      // Send instruction to user
      bot.telegram.sendMessage(u.id,
        '⚠️ Не вижу аватар.\n\n' +
        'Чтобы фото отображалось в Asset Lock Board:\n' +
        '1. Settings → Privacy and Security → Profile Photos\n' +
        '2. Always share with → Add users → @asset_lock_board_bot\n' +
        '3. Отправь /start ещё раз',
      ).catch(() => {});
    }
  } catch (e) { console.error('Photo error:', e.message); }
  await set(ref(db, `users/${u.id}`), profile);
}


// --- Format board message ---
function formatBoard(files) {
  const entries = Object.values(files || {});
  if (entries.length === 0) {
    return '\u{1F512} *Asset Lock Board*\n\n_No locked files_';
  }
  const grouped = {};
  entries.forEach(f => {
    if (!grouped[f.ownerName]) grouped[f.ownerName] = [];
    grouped[f.ownerName].push(f);
  });
  let msg = `\u{1F512} *Asset Lock Board* (${entries.length})\n`;
  for (const [name, list] of Object.entries(grouped)) {
    msg += `\n*${name}* (${list.length}):\n`;
    list.forEach(f => {
      const d = new Date(f.since);
      const t = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
      msg += `  \u2022 \`${f.name}\`  ${t}\n`;
    });
  }
  return msg;
}

function boardKeyboard() {
  return { inline_keyboard: [
    [
      { text: '\u{1F512} Lock', callback_data: 'b_lock' },
      { text: '\u{1F513} Free', callback_data: 'b_free' },
      { text: '\u{1F504}', callback_data: 'b_refresh' },
    ],
  ]};
}

async function getFiles() {
  return (await get(ref(db, 'files'))).val() || {};
}

async function updateBoard(chatId) {
  const msgId = boards[chatId];
  if (!msgId) return;
  try {
    const files = await getFiles();
    await bot.telegram.editMessageText(chatId, msgId, null, formatBoard(files), {
      parse_mode: 'Markdown', reply_markup: boardKeyboard(),
    });
  } catch (e) {
    if (!e.message?.includes('not modified')) console.log(`Board update ${chatId}:`, e.message);
  }
}

async function updateAllBoards() {
  for (const cid of Object.keys(boards)) await updateBoard(Number(cid));
}

// --- Commands ---

bot.command('start', async (ctx) => {
  syncUserProfile(ctx).then(() => console.log('Profile synced:', ctx.from.id)).catch(e => console.error('Profile sync error:', e.message));

  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const markup = isGroup
    ? undefined
    : { reply_markup: { inline_keyboard: [[{ text: '\u{1F512} Open Mini App', web_app: { url: WEBAPP_URL } }]] } };

  ctx.reply(
    'Asset Lock Board\n\n' +
    '/board \u2014 create board in chat\n' +
    '/lock filename \u2014 lock a file\n' +
    '/free filename \u2014 free a file\n' +
    '/status \u2014 text status',
    markup || {}
  );
});

bot.command('board', async (ctx) => {
  const files = await getFiles();
  const msg = await ctx.reply(formatBoard(files), {
    parse_mode: 'Markdown', reply_markup: boardKeyboard(),
  });
  boards[ctx.chat.id] = msg.message_id;
  await set(ref(db, `boards/${ctx.chat.id}`), msg.message_id);
});

bot.command('lock', async (ctx) => {
  const filename = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!filename || !filename.includes('.')) {
    waitingLock[ctx.from.id] = ctx.chat.id;
    return ctx.reply('Enter filename with extension, e.g. `Level_01.unity`', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '\u274C Cancel', callback_data: 'b_cancel' }]] },
    });
  }
  await doLock(ctx, filename);
});

bot.command('free', async (ctx) => {
  const filename = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!filename) return showFreeMenu(ctx);
  await doFree(ctx, filename);
});

bot.command('status', async (ctx) => {
  const files = await getFiles();
  ctx.reply(formatBoard(files), { parse_mode: 'Markdown' });
});

// --- Lock / Free ---

function userName(from) {
  return from.first_name + (from.last_name ? ' ' + from.last_name[0] + '.' : '');
}

async function doLock(ctx, filename) {
  const k = toKey(filename);
  const uid = ctx.from.id;
  const snap = await get(ref(db, `files/${k}`));
  const existing = snap.val();

  if (existing) {
    const who = existing.ownerId === uid ? 'you' : existing.ownerName;
    return ctx.reply(`\u{1F512} \`${filename}\` already locked by *${who}*`, { parse_mode: 'Markdown' });
  }

  await set(ref(db, `files/${k}`), {
    name: filename, ownerId: uid, ownerName: userName(ctx.from),
    ownerUsername: ctx.from.username || '',
    ownerColor: colorForId(uid), watchers: {}, since: Date.now(),
  });
  await set(ref(db, `saved/${k}`), filename);
  delete waitingLock[uid];
  await ctx.reply(`\u2705 \`${filename}\` locked`, { parse_mode: 'Markdown' });
  await updateAllBoards();
}

async function doFree(ctx, filename) {
  const k = toKey(filename);
  const uid = ctx.from.id;
  const snap = await get(ref(db, `files/${k}`));
  const f = snap.val();
  if (!f) return ctx.reply(`\`${filename}\` not locked`, { parse_mode: 'Markdown' });
  if (f.ownerId !== uid) return ctx.reply(`\`${filename}\` locked by *${f.ownerName}*, not you`, { parse_mode: 'Markdown' });

  await notifyWatchers(f);
  await remove(ref(db, `files/${k}`));
  await ctx.reply(`\u{1F513} \`${filename}\` freed`, { parse_mode: 'Markdown' });
  await updateAllBoards();
}

async function notifyWatchers(f) {
  for (const wId of Object.keys(f.watchers || {})) {
    bot.telegram.sendMessage(wId,
      `\u{1F513} *${f.name}* freed! (was: ${f.ownerName})`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

async function showFreeMenu(ctx) {
  const files = await getFiles();
  const mine = Object.entries(files).filter(([, f]) => f.ownerId === ctx.from.id);
  if (mine.length === 0) return ctx.reply('You have no locked files');
  const buttons = mine.map(([k, f]) => [{ text: `\u{1F513} ${f.name}`, callback_data: `fr:${k.substring(0,58)}` }]);
  buttons.push([{ text: '\u2B05\uFE0F Back', callback_data: 'b_refresh' }]);
  ctx.reply('Select file to free:', { reply_markup: { inline_keyboard: buttons } });
}

// --- Callbacks ---

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data) return ctx.answerCbQuery();

  if (data === 'b_lock') {
    waitingLock[ctx.from.id] = ctx.callbackQuery.message.chat.id;
    await ctx.answerCbQuery();
    return ctx.reply('Enter filename with extension, e.g. `Level_01.unity`', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '\u274C Cancel', callback_data: 'b_cancel' }]] },
    });
  }

  if (data === 'b_free') {
    await ctx.answerCbQuery();
    return showFreeMenu(ctx);
  }

  if (data === 'b_refresh') {
    const chatId = ctx.callbackQuery.message.chat.id;
    boards[chatId] = ctx.callbackQuery.message.message_id;
    await updateBoard(chatId);
    return ctx.answerCbQuery('Updated');
  }

  if (data === 'b_cancel') {
    delete waitingLock[ctx.from.id];
    await ctx.answerCbQuery('Cancelled');
    try { await ctx.deleteMessage(); } catch {}
    return;
  }

  if (data.startsWith('fr:')) {
    const k = data.substring(3);
    const snap = await get(ref(db, `files/${k}`));
    const f = snap.val();
    if (f && f.ownerId === ctx.from.id) {
      await notifyWatchers(f);
      await remove(ref(db, `files/${k}`));
      await ctx.answerCbQuery(`${f.name} freed`);
      try { await ctx.deleteMessage(); } catch {}
      await updateAllBoards();
    } else {
      await ctx.answerCbQuery('Not found or not yours');
    }
    return;
  }

  await ctx.answerCbQuery();
});

// --- Text input for lock ---

bot.on('text', async (ctx) => {
  if (waitingLock[ctx.from.id]) {
    const filename = ctx.message.text.trim();
    if (!filename.includes('.')) {
      return ctx.reply('Need extension, e.g. `Level_01.unity`', { parse_mode: 'Markdown' });
    }
    return doLock(ctx, filename);
  }
});

// --- Firebase watcher: auto-update boards + notify ---

let previousFiles = {};
let notifyQueue = {};      // userId -> [{type, text}]
let notifyTimer = null;
const DEBOUNCE_MS = 2000;

function queueNotify(userId, text) {
  if (!notifyQueue[userId]) notifyQueue[userId] = [];
  if (!notifyQueue[userId].includes(text)) notifyQueue[userId].push(text);
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(flushNotify, DEBOUNCE_MS);
}

async function flushNotify() {
  for (const [userId, lines] of Object.entries(notifyQueue)) {
    try {
      const snap = await get(ref(db, `users/${userId}/notifyPref`));
      const pref = snap.val() || 'both';
      if (pref === 'browser' || pref === 'off') continue;
    } catch {}
    bot.telegram.sendMessage(userId, lines.join('\n'), { parse_mode: 'HTML' }).catch(() => {});
  }
  notifyQueue = {};
}

function shortName(file) {
  return file.ownerUsername ? '@' + file.ownerUsername : file.ownerName;
}

onValue(ref(db, 'files'), async (snap) => {
  const current = snap.val() || {};

  // Freed files -> notify watchers
  for (const [key, prev] of Object.entries(previousFiles)) {
    if (!current[key]) {
      for (const wId of Object.keys(prev.watchers || {})) {
        queueNotify(wId, `\u{1F513} ${fileEmoji(prev.name)}<b>${prev.name}</b> свободен`);
      }
    }
  }

  // New watchers -> notify owner
  for (const [key, cur] of Object.entries(current)) {
    const prev = previousFiles[key];
    if (prev) {
      const prevW = Object.keys(prev.watchers || {});
      const curW = Object.keys(cur.watchers || {});
      const added = curW.filter(w => !prevW.includes(w));
      for (const wId of added) {
        const wName = cur.watchers[wId]?.name || 'Someone';
        queueNotify(cur.ownerId, `\u{1F514} <b>${wName}</b> ожидает ${fileEmoji(cur.name)}<b>${cur.name}</b>`);
      }
    }
  }

  previousFiles = JSON.parse(JSON.stringify(current));
  await updateAllBoards();
});

// --- Load boards on start ---

async function loadBoards() {
  const snap = await get(ref(db, 'boards'));
  const saved = snap.val() || {};
  Object.assign(boards, saved);
  console.log(`Loaded ${Object.keys(saved).length} board(s)`);
}

loadBoards().then(async () => {
  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  console.log('Webhook deleted');
  console.log('Starting bot...');
  bot.launch({ dropPendingUpdates: true });
  console.log('Bot started');
  console.log(`WebApp: ${WEBAPP_URL}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
