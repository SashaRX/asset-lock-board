# Asset Lock Board

Telegram Mini App для координации файлов Unity-команды. Показывает кто какой файл занял, уведомляет при освобождении.

## Стек

- **Mini App**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Firebase Realtime Database (бесплатный Spark план)
- **Bot**: Node.js + Telegraf
- **Auth**: Telegram WebApp API (zero config)

## Быстрый старт

Подробная инструкция в [SETUP.md](./SETUP.md).

```bash
# Webapp
cp .env.example .env        # заполнить Firebase credentials
pnpm install
pnpm build                  # → dist/

# Bot
cd bot
npm install
BOT_TOKEN=... WEBAPP_URL=... FIREBASE_DB_URL=... node bot.js
```

## Структура

```
├── src/                 # Mini App (React)
│   ├── App.tsx          # Главный компонент + Firebase sync
│   ├── firebase.ts      # Firebase config (env vars)
│   ├── telegram.ts      # Telegram WebApp API helper
│   └── icons.ts         # Unity Editor иконки (base64)
├── bot/
│   └── bot.js           # Telegram бот + уведомления
├── firebase-rules.json  # Realtime Database rules
└── SETUP.md             # Пошаговая инструкция
```
