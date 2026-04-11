using System.IO;
using UnityEditor;
using UnityEngine;

namespace AssetLockBoard.Editor
{
    [InitializeOnLoad]
    static class AssetLockProjectView
    {
        static Texture2D _lockTex;
        static Texture2D _lockMineTex;
        static Texture2D _busyTex;
        static Texture2D _busyMineTex;
        static GUIStyle _nameStyle;

        static AssetLockProjectView()
        {
            EditorApplication.projectWindowItemOnGUI += OnItemGUI;
        }

        static Texture2D MakeLockIcon(Color bodyColor, Color shackleColor, int size = 16)
        {
            var tex = new Texture2D(size, size, TextureFormat.ARGB32, false);
            tex.hideFlags = HideFlags.HideAndDontSave;
            var pixels = new Color[size * size];

            for (int y = 1; y <= 7; y++)
                for (int x = 4; x <= 11; x++)
                    pixels[y * size + x] = bodyColor;

            for (int y = 8; y <= 13; y++)
                for (int x = 5; x <= 10; x++)
                    if (x <= 6 || x >= 9 || y >= 12)
                        pixels[y * size + x] = shackleColor;

            pixels[5 * size + 7] = Color.black;
            pixels[5 * size + 8] = Color.black;
            pixels[4 * size + 7] = Color.black;
            pixels[4 * size + 8] = Color.black;
            pixels[3 * size + 7] = Color.black;

            tex.SetPixels(pixels);
            tex.Apply(false, true);
            tex.filterMode = FilterMode.Point;
            return tex;
        }

        static Texture2D MakeBusyIcon(Color color, int size = 16)
        {
            var tex = new Texture2D(size, size, TextureFormat.ARGB32, false);
            tex.hideFlags = HideFlags.HideAndDontSave;
            var pixels = new Color[size * size];
            float c = size / 2f, r = size / 2f - 2f;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                    if ((x - c) * (x - c) + (y - c) * (y - c) <= r * r)
                        pixels[y * size + x] = color;
            tex.SetPixels(pixels);
            tex.Apply(false, true);
            tex.filterMode = FilterMode.Point;
            return tex;
        }

        static void EnsureTextures()
        {
            if (_lockTex == null)
                _lockTex = MakeLockIcon(
                    new Color(0.83f, 0.13f, 0.13f, 0.9f),
                    new Color(0.83f, 0.13f, 0.13f, 0.7f));
            if (_lockMineTex == null)
                _lockMineTex = MakeLockIcon(
                    new Color(0.35f, 0.70f, 0.35f, 0.9f),
                    new Color(0.35f, 0.70f, 0.35f, 0.7f));
            if (_busyTex == null)
                _busyTex = MakeBusyIcon(new Color(0.91f, 0.63f, 0.30f, 0.85f));
            if (_busyMineTex == null)
                _busyMineTex = MakeBusyIcon(new Color(0.35f, 0.70f, 0.35f, 0.85f));
        }

        static void OnItemGUI(string guid, Rect rect)
        {
            if (!AssetLockWindow.Ready) return;

            var path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.IsNullOrEmpty(path)) return;

            var filename = Path.GetFileName(path);
            if (string.IsNullOrEmpty(filename)) return;

            var key = filename.Replace(".", "~");
            if (!AssetLockWindow.Files.TryGetValue(key, out var file)) return;

            EnsureTextures();

            var isMine = file.ownerId == AssetLockWindow.CurrentUserId;
            var isLock = file.IsLock;
            Texture2D tex;
            if (isMine) tex = isLock ? _lockMineTex : _busyMineTex;
            else tex = isLock ? _lockTex : _busyTex;

            var display = isMine ? "you" :
                !string.IsNullOrEmpty(file.ownerUsername)
                    ? $"@{file.ownerUsername}" : file.ownerName;

            bool isList = rect.height <= 20;
            bool isFolder = AssetDatabase.IsValidFolder(path);

            if (isList)
            {
                if (isFolder)
                {
                    // Tree view (left panel): small badge bottom-left of folder icon
                    var iconRect = new Rect(rect.x, rect.y + rect.height - 9, 8, 8);
                    GUI.DrawTexture(iconRect, tex, ScaleMode.ScaleToFit);
                }
                else
                {
                    // Flat list (right panel): icon + name on the right
                    if (_nameStyle == null)
                        _nameStyle = new GUIStyle(EditorStyles.miniLabel) { alignment = TextAnchor.MiddleLeft, fontSize = 9 };
                    _nameStyle.normal.textColor = isMine
                        ? new Color(0.35f, 0.70f, 0.35f)
                        : isLock ? new Color(0.83f, 0.33f, 0.33f)
                        : new Color(0.91f, 0.63f, 0.30f);
                    var nameW = Mathf.Min(_nameStyle.CalcSize(new GUIContent(display)).x, 70f);
                    var totalW = 10 + 2 + nameW + 4;
                    var iconRect = new Rect(rect.xMax - totalW, rect.y + (rect.height - 10) / 2f, 10, 10);
                    GUI.DrawTexture(iconRect, tex, ScaleMode.ScaleToFit);
                    GUI.Label(new Rect(iconRect.xMax + 2, rect.y, nameW, rect.height), display, _nameStyle);
                }
            }
            else
            {
                // Grid/icon view: badge in bottom-left
                var iconRect = new Rect(rect.x, rect.yMax - 28, 10, 10);
                GUI.DrawTexture(iconRect, tex, ScaleMode.ScaleToFit);
            }
        }
    }

    static class AssetLockContextMenu
    {
        [MenuItem("Assets/Lock File %&l", false, 1000)]
        static void Lock()
        {
            foreach (var obj in Selection.objects)
            {
                var path = AssetDatabase.GetAssetPath(obj);
                var filename = Path.GetFileName(path);
                if (string.IsNullOrEmpty(filename)) continue;
                var key = filename.Replace(".", "~");
                if (!AssetLockWindow.Files.ContainsKey(key))
                    AssetLockWindow.LockFileStatic(filename);
            }
        }

        [MenuItem("Assets/Lock File %&l", true)]
        static bool CanLock()
        {
            if (!AssetLockWindow.Ready || Selection.objects.Length == 0) return false;
            foreach (var obj in Selection.objects)
            {
                var path = AssetDatabase.GetAssetPath(obj);
                var filename = Path.GetFileName(path);
                if (string.IsNullOrEmpty(filename)) continue;
                var key = filename.Replace(".", "~");
                if (!AssetLockWindow.Files.ContainsKey(key)) return true;
            }
            return false;
        }

        [MenuItem("Assets/Free File %&u", false, 1001)]
        static void Free()
        {
            foreach (var obj in Selection.objects)
            {
                var path = AssetDatabase.GetAssetPath(obj);
                var filename = Path.GetFileName(path);
                if (string.IsNullOrEmpty(filename)) continue;
                var key = filename.Replace(".", "~");
                if (AssetLockWindow.Files.TryGetValue(key, out var f) && f.ownerId == AssetLockWindow.CurrentUserId)
                    AssetLockWindow.FreeFileStatic(filename);
            }
        }

        [MenuItem("Assets/Free File %&u", true)]
        static bool CanFree()
        {
            if (!AssetLockWindow.Ready || Selection.objects.Length == 0) return false;
            foreach (var obj in Selection.objects)
            {
                var path = AssetDatabase.GetAssetPath(obj);
                var filename = Path.GetFileName(path);
                if (string.IsNullOrEmpty(filename)) continue;
                var key = filename.Replace(".", "~");
                if (AssetLockWindow.Files.TryGetValue(key, out var f) && f.ownerId == AssetLockWindow.CurrentUserId) return true;
            }
            return false;
        }
    }
}
