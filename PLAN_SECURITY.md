# PLAN: Security, Full Paths, Audit Log

Реализовать после PLAN_SNAPSHOTS.

## 1. Полный путь файла как ключ

**Проблема:** `Chair.fbx` в двух папках = один ключ, конфликт.

**Решение:** ключ = закодированный полный путь.

```
Assets/Content/Models/Chair.fbx
→ ключ: Assets|Content|Models|Chair~fbx
```

Замены: `/` → `|`, `.` → `~` (Firebase запрещает `.` `/` в ключах).

**Миграция:**
- Добавить поле `path` в FileData (полный путь от Assets/)
- Новые записи используют полный ключ
- Старые записи без `path` — fallback на имя файла (обратная совместимость)
- Одноразовый скрипт миграции для существующих данных

**Источники пути:**
- Unity: `AssetDatabase.GetAssetPath()` — полный путь всегда доступен
- Сайт: пользователь вводит имя → показать предупреждение что путь неизвестен, или добавить поле пути
- Бот: аналогично сайту — только имя, путь опционален

**Отображение:**
- В списках показывать только имя файла (как сейчас)
- Полный путь — в tooltip / при наведении
- Если есть два файла с одинаковым именем — показывать относительный путь для различия

## 2. Firebase Auth

**Сейчас:** открытая база, общий пароль `alb2025`, ID на основе имени/timestamp.

**Цель:** каждый пользователь аутентифицирован через Firebase Auth, rules проверяют `auth.uid`.

**Схема:**

```
Вход на сайт:
1. Ввод имени + team password → Firebase Anonymous Auth
2. Или Google Sign-In → Firebase Google Auth  
3. Или Telegram Mini App → Custom Token через бота

uid = Firebase Auth UID (строка, стабильная)
```

**Изменение ID:** сейчас числовой `ownerId`, станет строковый Firebase UID. Это ломающее изменение — нужна миграция всех files/watchers/users.

**Бот:** 
- Вариант A: Firebase Admin SDK (Node.js) — генерирует custom tokens, имеет полный доступ
- Вариант B: Service account REST API — без SDK, но сложнее
- Рекомендация: Admin SDK только для auth, данные через REST (как сейчас)

**Unity:**
- Хранить Firebase ID Token в EditorPrefs
- Refresh token flow — токен живёт 1 час, нужен refresh
- Добавить Authorization header ко всем REST запросам

## 3. Security Rules

```json
{
  "rules": {
    "teams": {
      "$teamId": {
        ".read": "auth != null && root.child('members').child($teamId).child(auth.uid).exists()",
        ".write": "auth != null && root.child('members').child($teamId).child(auth.uid).exists()",
        
        "files": {
          "$key": {
            ".write": "auth != null",
            ".validate": "newData.hasChildren(['name', 'ownerId', 'ownerName'])"
          }
        },
        "snapshots": {
          "$id": {
            ".write": "auth != null",
            ".validate": "newData.child('authorId').val() === auth.uid || !data.exists()"
          }
        },
        "audit": {
          ".write": "auth != null",
          ".read": "root.child('members').child($teamId).child(auth.uid).child('isAdmin').val() === true"
        }
      }
    },
    "members": {
      "$teamId": {
        ".read": "auth != null && data.child(auth.uid).exists()"
      }
    }
  }
}
```

## 4. Аудит лог

**Структура:**
```
teams/{teamId}/audit/{pushId}/
  action: "lock" | "free" | "mode_change" | "user_purge" | "snapshot_create"
  userId: string
  userName: string
  filePath: string        — полный путь
  fileName: string        — имя для отображения
  mode: "busy" | "lock"   — для lock/mode_change
  details: string         — дополнительная инфо
  timestamp: number
```

**Запись:**
- При каждом lock/free/mode change — клиент пишет в `audit/`
- Firebase push ID обеспечивает хронологический порядок и уникальность
- Бот тоже пишет (команды /lock /free)

**Чтение:**
- Админ: полный лог в UI (сайт → отдельная страница, Unity → вкладка)
- Обычный пользователь: только свои действия или не видит
- Бот: `/audit` команда для админа → последние N записей

**Retention:**
- Cloud Function (или cron бота) удаляет записи старше 30 дней
- Или без лимита пока база не растёт (Spark = 1GB)

## 5. Мультитенантность (подготовка)

Текущая структура:
```
files/{key}
users/{id}
```

Новая:
```
teams/{teamId}/files/{key}
teams/{teamId}/users/{uid}
teams/{teamId}/snapshots/{id}
teams/{teamId}/audit/{pushId}
members/{teamId}/{uid}: { role: "admin" | "member", joinedAt }
```

**Team создание:**
- Первый пользователь создаёт team, получает admin
- Invite: team ID + team password (или invite link)
- Join: ввод team ID → добавление в members

**Для MVP:** одна команда, teamId = "default". Структура готова к расширению.

## Порядок реализации

1. **Полные пути** — добавить `path` в FileData, новый формат ключей, миграция
2. **Аудит лог** — простая запись при каждом действии, UI для админа
3. **Firebase Auth** — Anonymous + Google + Telegram custom token
4. **Security Rules** — закрыть базу, проверять auth
5. **Мультитенантность** — переструктурировать в `teams/`, invite flow

Каждый этап — отдельный PR, тестируется независимо.

## Риски

- Миграция ключей (имя → путь) может сломать существующие данные — нужен скрипт и обратная совместимость
- Firebase Auth в Unity Editor — нет официального SDK, только REST API с ручным token refresh
- Admin SDK для бота добавит зависимость (firebase-admin ~30MB) — или реализовать через REST
- Мультитенантность меняет все пути в коде — делать последней
