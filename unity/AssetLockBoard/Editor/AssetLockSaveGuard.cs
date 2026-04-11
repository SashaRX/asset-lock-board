using System.IO;
using UnityEditor;
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
                    continue; // skip this file
                }

                allowed.Add(path);
            }

            return allowed.ToArray();
        }
    }
}
