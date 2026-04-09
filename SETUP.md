# Asset Lock Board — Setup Guide

Координация файлов для Unity-команды через Telegram Mini App.

## Архитектура

```
Telegram Chat → Mini App (React) → Firebase Realtime DB ← Bot (Node.js)
                    ↑                      ↓
              Telegram WebApp API    Уведомления в личку
```

- **Mini App** — интерфейс, хостится как статичный HTML (Vercel/Netlify/GitHub Pages)
- **Firebase** — хранит состояние файлов, real-time синхронизация между всеми
- **Bot** — отправляет кнопку открытия Mini App + уведомления при освобождении файлов

## Шаг 1: Firebase

1. Зайти на https://console.firebase.google.com
2. Create a project → любое имя (например `asset-lock-board`)
3. Build → Realtime Database → Create Database → Start in **test mode**
4. Скопировать URL базы (вида `https://xxx-default-rtdb.firebaseio.com`)
5. Project Settings → General → Your apps → Add app → Web (</>) → Register
6. Скопировать конфигурацию (apiKey, authDomain, databaseURL, projectId и т.д.)
7. Rules → вставить содержимое `firebase-rules.json`

## Шаг 2: Telegram Bot

1. Открыть @BotFather в Telegram
2. `/newbot` → имя бота → username бота
3. Скопировать токен
4. `/mybots` → выбрать бота → Bot Settings → Menu Button → настроить URL Mini App (после деплоя)

## Шаг 3: Mini App

1. В файле `src/firebase.ts` заменить placeholder-значения на реальные из шага 1
2. Собрать:
   ```bash
   pnpm install
   pnpm build
   ```
3. Задеплоить папку `dist/` на:
   - **Vercel**: `npx vercel --prod`
   - **Netlify**: drag & drop папки dist на https://app.netlify.com/drop
   - **GitHub Pages**: push в репо, Settings → Pages → Source: /docs или GitHub Actions

4. Получить URL (например `https://asset-lock.vercel.app`)

## Шаг 4: Bot

1. Перейти в папку `bot/`:
   ```bash
   cd bot
   npm init -y
   npm install telegraf firebase-admin
   ```

2. Задать переменные окружения:
   ```bash
   export BOT_TOKEN="123456:ABC..."
   export WEBAPP_URL="https://asset-lock.vercel.app"
   export FIREBASE_DB_URL="https://xxx-default-rtdb.firebaseio.com"
   ```

3. Запустить:
   ```bash
   node bot.js
   ```

4. Для продакшена: задеплоить на Railway/Fly.io/VPS.

## Шаг 5: Проверка

1. Открыть бота в Telegram
2. Отправить `/start`
3. Нажать кнопку "Open Lock Board"
4. Mini App откроется → можно добавлять файлы
5. Попросить коллегу открыть — состояние синхронизируется в real-time
6. `/status` в боте — текстовый отчёт о занятых файлах

## Команды бота

- `/start` — кнопка открытия Mini App
- `/status` — текущий список занятых файлов

## Уведомления

Когда кто-то нажимает "Free" на файле, бот автоматически отправляет личное сообщение всем подписчикам (кто нажал колокольчик) с информацией что файл освободился.

## Стоимость

Бесплатно:
- Firebase Spark план: 1 GB хранилища, 10 GB/мес трафик (хватит с запасом)
- Vercel/Netlify: бесплатный хостинг статики
- Railway: $5/мес бесплатного кредита (хватит на бота)
- Telegram Bot API: бесплатно
