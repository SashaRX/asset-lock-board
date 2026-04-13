using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace AssetLockBoard.Editor
{
    internal class SnapshotManager
    {
        readonly Action<string, Action<string>> _get;
        readonly Action<string, string, Action<string>> _put;
        readonly Action<string, Action<string>> _delete;
        readonly Func<long> _getUserId;
        readonly Func<string> _getUserName;

        internal List<SnapshotData> Snapshots = new();
        readonly Dictionary<string, Texture2D> _thumbCache = new();

        internal SnapshotManager(
            Action<string, Action<string>> get,
            Action<string, string, Action<string>> put,
            Action<string, Action<string>> delete,
            Func<long> getUserId,
            Func<string> getUserName)
        {
            _get = get;
            _put = put;
            _delete = delete;
            _getUserId = getUserId;
            _getUserName = getUserName;
        }

        // --- Capture ---

        internal SnapshotData Capture(string snapshotName)
        {
            var userId = _getUserId();
            var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var snap = new SnapshotData
            {
                id = $"{userId}_{ts}",
                name = snapshotName,
                authorId = userId,
                authorName = _getUserName(),
                scene = EditorSceneManager.GetActiveScene().path,
                camera = CaptureCamera(),
                selection = GetSelectionPaths(),
                image = CaptureScreenshot(),
                timestamp = ts
            };
            return snap;
        }

        static CameraData CaptureCamera()
        {
            var sv = SceneView.lastActiveSceneView;
            if (sv == null) return new CameraData();
            return new CameraData
            {
                pivotX = sv.pivot.x,
                pivotY = sv.pivot.y,
                pivotZ = sv.pivot.z,
                rotX = sv.rotation.x,
                rotY = sv.rotation.y,
                rotZ = sv.rotation.z,
                rotW = sv.rotation.w,
                size = sv.size,
                orthographic = sv.orthographic
            };
        }

        static string CaptureScreenshot()
        {
            var sv = SceneView.lastActiveSceneView;
            if (sv == null || sv.camera == null) return "";

            var oldRt = sv.camera.targetTexture;
            var rt = new RenderTexture(256, 144, 24);
            try
            {
                sv.camera.targetTexture = rt;
                sv.camera.Render();
                RenderTexture.active = rt;
                var tex = new Texture2D(256, 144, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, 256, 144), 0, 0);
                tex.Apply();
                var png = tex.EncodeToPNG();
                UnityEngine.Object.DestroyImmediate(tex);
                return Convert.ToBase64String(png);
            }
            finally
            {
                sv.camera.targetTexture = oldRt;
                RenderTexture.active = null;
                UnityEngine.Object.DestroyImmediate(rt);
            }
        }

        static string[] GetSelectionPaths()
        {
            return Selection.gameObjects
                .Where(go => go != null)
                .Select(go => GetGameObjectPath(go.transform))
                .ToArray();
        }

        static string GetGameObjectPath(Transform t)
        {
            var path = t.name;
            while (t.parent != null)
            {
                t = t.parent;
                path = t.name + "/" + path;
            }
            return path;
        }

        // --- Apply ---

        internal void Apply(SnapshotData snap)
        {
            if (snap == null) return;

            // Open scene if different
            var currentScene = EditorSceneManager.GetActiveScene().path;
            if (!string.IsNullOrEmpty(snap.scene) && snap.scene != currentScene)
            {
                if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
                EditorSceneManager.OpenScene(snap.scene);
            }

            // Set camera
            var sv = SceneView.lastActiveSceneView;
            if (sv == null) sv = EditorWindow.GetWindow<SceneView>();
            if (sv != null && snap.camera != null)
            {
                sv.pivot = new Vector3(snap.camera.pivotX, snap.camera.pivotY, snap.camera.pivotZ);
                sv.rotation = new Quaternion(snap.camera.rotX, snap.camera.rotY, snap.camera.rotZ, snap.camera.rotW);
                sv.size = snap.camera.size;
                sv.orthographic = snap.camera.orthographic;
                sv.Repaint();
            }

            // Select objects
            if (snap.selection != null && snap.selection.Length > 0)
            {
                var objects = new List<UnityEngine.Object>();
                foreach (var path in snap.selection)
                {
                    var go = FindByPath(path);
                    if (go != null) objects.Add(go);
                }
                if (objects.Count > 0) Selection.objects = objects.ToArray();
            }
        }

        static GameObject FindByPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;

            var parts = path.Split('/');
            // Find root object
            var roots = UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects();
            GameObject current = null;
            foreach (var root in roots)
            {
                if (root.name == parts[0]) { current = root; break; }
            }
            if (current == null) return null;

            // Drill down using Transform.Find (works for inactive)
            if (parts.Length > 1)
            {
                var remaining = string.Join("/", parts.Skip(1));
                var child = current.transform.Find(remaining);
                return child != null ? child.gameObject : null;
            }
            return current;
        }

        // --- Firebase sync ---

        internal void RefreshFromFirebase()
        {
            _get("snapshots.json", json =>
            {
                Snapshots.Clear();
                _thumbCache.Clear();
                if (string.IsNullOrEmpty(json) || json.Trim() == "null") return;
                foreach (var (key, val) in AssetLockWindow.ExtractObjects(json))
                {
                    try
                    {
                        var snap = JsonUtility.FromJson<SnapshotData>(val);
                        if (snap != null)
                        {
                            snap.id = key;
                            Snapshots.Add(snap);
                        }
                    }
                    catch { }
                }
                Snapshots.Sort((a, b) => b.timestamp.CompareTo(a.timestamp));
            });
        }

        internal void SaveToFirebase(SnapshotData snap)
        {
            var json = JsonUtility.ToJson(snap);
            _put($"snapshots/{snap.id}.json", json, _ => RefreshFromFirebase());
        }

        internal void DeleteFromFirebase(string id)
        {
            _delete($"snapshots/{id}.json", _ => RefreshFromFirebase());
        }

        // --- Thumbnail ---

        internal Texture2D GetThumbnail(SnapshotData snap)
        {
            if (snap == null || string.IsNullOrEmpty(snap.image)) return null;
            if (_thumbCache.TryGetValue(snap.id, out var cached)) return cached;

            try
            {
                var bytes = Convert.FromBase64String(snap.image);
                var tex = new Texture2D(2, 2);
                tex.LoadImage(bytes);
                tex.hideFlags = HideFlags.HideAndDontSave;
                _thumbCache[snap.id] = tex;
                return tex;
            }
            catch
            {
                return null;
            }
        }

        // --- Clipboard flow ---

        internal void CopyIdToClipboard(SnapshotData snap)
        {
            GUIUtility.systemCopyBuffer = snap.id;
        }

        internal void PasteAndLoad()
        {
            var id = GUIUtility.systemCopyBuffer?.Trim();
            if (string.IsNullOrEmpty(id)) return;

            // Check local cache first
            var local = Snapshots.FirstOrDefault(s => s.id == id);
            if (local != null) { Apply(local); return; }

            // Fetch from Firebase
            _get($"snapshots/{id}.json", json =>
            {
                if (string.IsNullOrEmpty(json) || json.Trim() == "null")
                {
                    Debug.LogWarning("[ALB] Snapshot not found: " + id);
                    return;
                }
                var snap = JsonUtility.FromJson<SnapshotData>(json);
                if (snap != null)
                {
                    snap.id = id;
                    Apply(snap);
                }
            });
        }
    }
}
