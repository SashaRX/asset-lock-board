require('dotenv').config();
const sharp = require('sharp');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = 211497439;
const PACK_NAME = 'unity_icons_by_asset_lock_board_bot';
const PACK_TITLE = 'Unity Editor Icons';

const bot = new Telegraf(BOT_TOKEN);

const ICON_EMOJIS = {
  unity: '🎮', fbx: '🔷', prefab: '📦', mat: '🎨',
  cs: '💻', png: '🖼', anim: '🎬', folder: '📁',
};

// Parse base64 icons from icons.ts
const iconsTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'icons.ts'), 'utf8');
const icons = {};
for (const key of Object.keys(ICON_EMOJIS)) {
  const re = new RegExp(`${key}:\\s*"data:image\\/[^;]+;base64,([^"]+)"`, 'i');
  const m = iconsTs.match(re);
  if (m) { icons[key] = m[1]; console.log(`Found: ${key}`); }
  else console.log(`Missing: ${key}`);
}

async function resize100(b64) {
  return sharp(Buffer.from(b64, 'base64'))
    .resize(100, 100, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}

async function main() {
  const stickers = [];
  for (const [key, b64] of Object.entries(icons)) {
    const buf = await resize100(b64);
    stickers.push({ key, emoji: ICON_EMOJIS[key], buf });
    console.log(`Resized ${key}: ${buf.length}b`);
  }

  try {
    await bot.telegram.callApi('createNewStickerSet', {
      user_id: OWNER_ID,
      name: PACK_NAME,
      title: PACK_TITLE,
      sticker_type: 'custom_emoji',
      stickers: JSON.stringify(stickers.map(s => ({
        sticker: 'attach://' + s.key,
        emoji_list: [s.emoji],
        format: 'static',
      }))),
      ...Object.fromEntries(stickers.map(s => [s.key, { source: s.buf, filename: s.key + '.png' }])),
    });
    console.log('Pack created!');
  } catch (e) {
    console.log('Create failed:', e.message);
    console.log('Trying individually...');
    for (const s of stickers) {
      try {
        await bot.telegram.callApi('addStickerToSet', {
          user_id: OWNER_ID, name: PACK_NAME,
          sticker: JSON.stringify({ sticker: 'attach://file', emoji_list: [s.emoji], format: 'static' }),
          file: { source: s.buf, filename: s.key + '.png' },
        });
        console.log(`  + ${s.key}`);
      } catch (e2) { console.log(`  x ${s.key}: ${e2.message}`); }
    }
  }

  const set = await bot.telegram.callApi('getStickerSet', { name: PACK_NAME });
  const map = {};
  set.stickers.forEach((s, i) => {
    const key = stickers[i]?.key || `s${i}`;
    map[key] = s.custom_emoji_id;
    console.log(`${key} = ${s.custom_emoji_id}`);
  });
  fs.writeFileSync(path.join(__dirname, 'emoji-map.json'), JSON.stringify(map, null, 2));
  console.log('Saved emoji-map.json');
}

main().catch(console.error);
