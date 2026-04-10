using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace AssetLockBoard.Editor
{
    [InitializeOnLoad]
    static class AssetLockProjectView
    {
        static GUIStyle _lockStyle;

        static AssetLockProjectView()
        {
            EditorApplication.projectWindowItemOnGUI += OnItemGUI;
        }

        static void OnItemGUI(string guid, Rect rect)
        {
            if (!AssetLockWindow.Ready) return;

            var path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.IsNullOrEmpty(path)) return;

            var filename = Path.GetFileName(path);
            if (string.IsNullOrEmpty(filename) || !filename.Contains(".")) return;

            var key = filename.Replace(".", "~");
            if (!AssetLockWindow.Files.TryGetValue(key, out var file)) return;

            if (_lockStyle == null)
            {
                _lockStyle = new GUIStyle(EditorStyles.miniLabel)
                {
                    alignment = TextAnchor.MiddleRight,
                    fontSize = 10
                };
            }

            var isMine = file.ownerId == AssetLockWindow.CurrentUserId;
            var display = !string.IsNullOrEmpty(file.ownerUsername)
                ? $"@{file.ownerUsername}" : file.ownerName;

            var label = isMine ? "\U0001F512 you" : $"\U0001F512 {display}";
            _lockStyle.normal.textColor = isMine
                ? new Color(0.35f, 0.7f, 0.35f)
                : new Color(0.83f, 0.13f, 0.13f);

            var iconRect = new Rect(rect.xMax - 120, rect.y, 118, rect.height);
            GUI.Label(iconRect, label, _lockStyle);
        }
    }

    static class AssetLockContextMenu
    {
        [MenuItem("Assets/Asset Lock Board/Lock File", false, 1000)]
        static void Lock()
        {
            var path = AssetDatabase.GetAssetPath(Selection.activeObject);
            var filename = Path.GetFileName(path);
            if (!string.IsNullOrEmpty(filename) && filename.Contains("."))
                AssetLockWindow.LockFileStatic(filename);
        }

        [MenuItem("Assets/Asset Lock Board/Lock File", true)]
        static bool CanLock()
        {
            if (!AssetLockWindow.Ready || Selection.activeObject == null) return false;
            var path = AssetDatabase.GetAssetPath(Selection.activeObject);
            var filename = Path.GetFileName(path);
            if (string.IsNullOrEmpty(filename) || !filename.Contains(".")) return false;
            var key = filename.Replace(".", "~");
            return !AssetLockWindow.Files.ContainsKey(key);
        }

        [MenuItem("Assets/Asset Lock Board/Free File", false, 1001)]
        static void Free()
        {
            var path = AssetDatabase.GetAssetPath(Selection.activeObject);
            var filename = Path.GetFileName(path);
            if (!string.IsNullOrEmpty(filename) && filename.Contains("."))
                AssetLockWindow.FreeFileStatic(filename);
        }

        [MenuItem("Assets/Asset Lock Board/Free File", true)]
        static bool CanFree()
        {
            if (!AssetLockWindow.Ready || Selection.activeObject == null) return false;
            var path = AssetDatabase.GetAssetPath(Selection.activeObject);
            var filename = Path.GetFileName(path);
            if (string.IsNullOrEmpty(filename) || !filename.Contains(".")) return false;
            var key = filename.Replace(".", "~");
            return AssetLockWindow.Files.TryGetValue(key, out var f) && f.ownerId == AssetLockWindow.CurrentUserId;
        }
    }
}
