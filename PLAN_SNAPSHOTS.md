# PLAN: Viewport Snapshots — командные закладки сцены

## Суть
Снимок состояния Editor: скриншот viewport + камера + выделение + сцена. Можно сохранить, назвать, поделиться через Telegram. Другой человек нажимает — Unity открывает сцену, ставит камеру, выделяет объекты.

## Данные snapshot

```
snapshots/{id}/
  name: string           — пользовательское название
  authorId: number       — кто создал
  authorName: string
  scene: string          — "Assets/Scenes/Level_01.unity"
  camera:
    posX, posY, posZ: float
    rotX, rotY, rotZ, rotW: float  — quaternion
    size: float          — ortho size (0 если perspective)
    pivot: {x,y,z}       — SceneView pivot
  selection: string[]    — пути в иерархии: ["Environment/Buildings/House_01"]
  image: string          — base64 PNG (сжатый, ~50-150KB)
  timestamp: number
```

## Ограничения

- Firebase RTDB: max 10MB на ноду, base64 PNG ~100KB = до 100 снимков
- SceneView API: `SceneView.lastActiveSceneView` — камера, `Camera.Render()` — скриншот
- Путь объекта может не совпасть — fallback: поиск по имени
- Сцена должна быть в билде или Assets для `EditorSceneManager.OpenScene`

## Этапы

### Этап 1 — Локальные снимки (Unity only, без Firebase)

**Файл:** `Editor/SnapshotManager.cs`

1. Кнопка `[📷]` в toolbar окна Lock Board
2. `SceneView.lastActiveSceneView` → позиция/поворот камеры, pivot, size
3. `Selection.gameObjects` → пути через `GetGameObjectPath()`
4. `EditorApplication.isPaused` сцена → имя
5. Скриншот: `SceneView.lastActiveSceneView.camera` → `RenderTexture` → `ReadPixels` → `EncodeToPNG` → resize до 256px width → base64
6. Сохранение в `EditorPrefs` как JSON массив (временно, до Firebase)
7. Список снимков в окне Lock Board (ниже файлов): превью 48px + название + кнопка Apply
8. Apply: открыть сцену → `SceneView.pivot/rotation/size` → `Selection.activeGameObject` по пути

**Ключевые API:**
```csharp
var sv = SceneView.lastActiveSceneView;
sv.camera  // Camera для скриншота
sv.pivot   // Vector3
sv.rotation // Quaternion
sv.size    // float
sv.orthographic // bool
EditorSceneManager.GetActiveScene().path  // сцена
Selection.gameObjects → transform path
```

**Скриншот (без sharp/native):**
```csharp
var sv = SceneView.lastActiveSceneView;
var rt = new RenderTexture(256, 144, 24);
sv.camera.targetTexture = rt;
sv.camera.Render();
RenderTexture.active = rt;
var tex = new Texture2D(256, 144, TextureFormat.RGB24, false);
tex.ReadPixels(new Rect(0, 0, 256, 144), 0, 0);
tex.Apply();
var png = tex.EncodeToPNG();
var base64 = System.Convert.ToBase64String(png);
// cleanup rt, tex
```

**Apply:**
```csharp
EditorSceneManager.OpenScene(snapshot.scene);
var sv = SceneView.lastActiveSceneView;
sv.pivot = snapshot.camera.pivot;
sv.rotation = snapshot.camera.rotation;
sv.size = snapshot.camera.size;
sv.Repaint();
// Selection
foreach (var path in snapshot.selection) {
    var go = GameObject.Find(path); // fallback
    if (go) Selection.activeGameObject = go;
}
```

### Этап 2 — Firebase sync

**Изменения:** `Editor/SnapshotManager.cs`, `Editor/AssetLockBoard.cs`

1. Сохранение: PUT `snapshots/{id}.json` через существующий REST client
2. Загрузка: GET `snapshots.json` при старте + polling (как files)
3. Список: показывать все снимки команды, не только свои
4. Delete: только автор или admin
5. ID: `{userId}_{timestamp}` — уникальный
6. base64 image прямо в RTDB (не Storage) — проще, бесплатно, достаточно для 256px превью

**Firebase rules добавить:**
```json
"snapshots": {
  ".read": true,
  "$id": { ".write": true }
}
```

### Этап 3 — Telegram шаринг

**Изменения:** `bot/bot.js`, `Editor/SnapshotManager.cs`

1. Unity: кнопка Share → PUT snapshot в Firebase + вызов бота через HTTP
2. Бот: watcher на `snapshots/` → новый снимок → отправить фото (decode base64 → Buffer → sendPhoto) в чат/ЛС автора
3. Сообщение: фото + caption (название, автор, сцена) + inline кнопка "Open in Unity"
4. Deep link: `unityyamlmerge://snapshot/{id}` или custom URI scheme `alb://snap/{id}`
5. Fallback: `/snap {id}` команда бота → показать фото + данные

**Проблема deep link:** Unity не регистрирует URI scheme по умолчанию. Альтернативы:
- Кнопка "Copy ID" в Telegram → вставить в окно Unity
- Бот отправляет ID → в Unity окне поле "Load snapshot" + Paste
- Clipboard: Unity читает `GUIUtility.systemCopyBuffer` при фокусе

**Рекомендация:** Clipboard flow — самый простой. Бот копирует ID, Unity кнопка "Paste & Load".

## Структура файлов

```
unity/AssetLockBoard/Editor/
  ├── AssetLockBoard.cs        — существующий, добавить секцию Snapshots
  ├── SnapshotManager.cs       — NEW: capture, save, apply, sync
  ├── SnapshotData.cs          — NEW: [Serializable] data class
  └── ...

bot/
  └── bot.js                   — добавить snapshot watcher + /snap команду
```

## Порядок реализации

1. `SnapshotData.cs` — data class
2. `SnapshotManager.cs` — Capture() + Apply() + локальное хранение
3. UI в `AssetLockBoard.cs` — кнопка 📷, список, превью
4. Тестирование локально
5. Firebase sync — PUT/GET snapshots
6. Telegram — бот watcher + фото
7. Clipboard flow для получения

## Риски

- `SceneView.camera.Render()` может не сработать если viewport свёрнут — нужен fallback
- base64 PNG 256px ≈ 30-80KB, 100 снимков = 3-8MB — в пределах RTDB
- `GameObject.Find(path)` не работает для неактивных объектов — использовать `transform.Find` рекурсивно
- Spark план RTDB: 1GB storage, 10GB/month download — достаточно
