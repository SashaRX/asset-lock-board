using System.IO;
using UnityEditor;
using UnityEditor.Callbacks;
using UnityEngine;

namespace AssetLockBoard.Editor
{
    /// <summary>
    /// Intercepts asset saves and blocks modification of files locked by other users.
    /// Shows a dialog with the lock owner's name.
    /// </summary>
    class AssetLockSaveGuard : AssetModificationProcessor
    {
        static string[] OnWillSaveAssets(string[] paths)
        {
            if (!AssetLockWindow.Ready) return paths;

            var allowed = new System.Collections.Generic.List<string>(paths.Length);
            foreach (var path in paths)
            {
                var filename = Path.GetFileName(path);
                if (string.IsNullOrEmpty(filename) || !filename.Contains("."))
                {
                    allowed.Add(path);
                    continue;
                }

                var key = filename.Replace(".", "~");
                if (AssetLockWindow.Files.TryGetValue(key, out var file)
                    && file.ownerId != AssetLockWindow.CurrentUserId)
                {
                    var display = !string.IsNullOrEmpty(file.ownerUsername)
                        ? $"@{file.ownerUsername}"
                        : file.ownerName;

                    EditorUtility.DisplayDialog(
                        "Asset Lock Board",
                        $"\"{filename}\" is locked by {display}.\n\nYou cannot save this file until it is freed.",
                        "OK");
                    
                    Debug.LogWarning($"[ALB] Blocked save: {filename} is locked by {display}");
                    continue;
                }

                allowed.Add(path);
            }

            return allowed.ToArray();
        }

        /// <summary>
        /// Marks locked files as not editable — Unity will show them as read-only.
        /// </summary>
        static bool IsOpenForEdit(string path, out string message)
        {
            message = "";
            if (!AssetLockWindow.Ready) return true;

            var filename = Path.GetFileName(path);
            if (string.IsNullOrEmpty(filename) || !filename.Contains(".")) return true;

            var key = filename.Replace(".", "~");
            if (AssetLockWindow.Files.TryGetValue(key, out var file)
                && file.ownerId != AssetLockWindow.CurrentUserId)
            {
                var display = !string.IsNullOrEmpty(file.ownerUsername)
                    ? $"@{file.ownerUsername}" : file.ownerName;
                message = $"Locked by {display}";
                return false;
            }

            return true;
        }
    }

    /// <summary>
    /// Warns user when they try to open (double-click) a file locked by someone else.
    /// </summary>
    static class AssetLockOpenGuard
    {
        [OnOpenAsset(0)]
        static bool OnOpen(int instanceId, int line)
        {
            if (!AssetLockWindow.Ready) return false;

            var path = AssetDatabase.GetAssetPath(instanceId);
            var filename = Path.GetFileName(path);
            if (string.IsNullOrEmpty(filename) || !filename.Contains(".")) return false;

            var key = filename.Replace(".", "~");
            if (!AssetLockWindow.Files.TryGetValue(key, out var file)) return false;
            if (file.ownerId == AssetLockWindow.CurrentUserId) return false;

            var display = !string.IsNullOrEmpty(file.ownerUsername)
                ? $"@{file.ownerUsername}" : file.ownerName;

            var open = EditorUtility.DisplayDialog(
                "Asset Lock Board",
                $"\"{filename}\" is locked by {display}.\n\nAny changes you make will NOT be saved.\nOpen anyway?",
                "Open (read-only)", "Cancel");

            if (!open) return true; // block opening

            return false; // let Unity open normally
        }
    }
}
