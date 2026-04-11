using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace AssetLockBoard.Editor
{
    public class AssetLockWindow : EditorWindow
    {
        const string FIREBASE_URL = "https://asset-lock-board-default-rtdb.europe-west1.firebasedatabase.app";
        const float POLL_INTERVAL = 5f;

        // --- Settings (EditorPrefs) ---
        static long UserId
        {
            get => long.TryParse(EditorPrefs.GetString("ALB_Id", "0"), out var v) ? v : 0;
            set => EditorPrefs.SetString("ALB_Id", value.ToString());
        }
        static string UserName
        {
            get => EditorPrefs.GetString("ALB_Name", "");
            set => EditorPrefs.SetString("ALB_Name", value);
        }
        static string UserUsername
        {
            get => EditorPrefs.GetString("ALB_Username", "");
            set => EditorPrefs.SetString("ALB_Username", value);
        }
        static string UserColor
        {
            get => EditorPrefs.GetString("ALB_Color", "#4A90D9");
            set => EditorPrefs.SetString("ALB_Color", value);
        }
        static bool IsConfigured => UserId != 0 && !string.IsNullOrEmpty(UserName);

        // --- Shared state for overlay/context menu ---
        internal static Dictionary<string, FileData> Files = new();
        internal static long CurrentUserId => UserId;
        internal static bool Ready => IsConfigured;

        // --- Instance state ---
        Vector2 _scroll;
        double _nextPoll;
        string _setupInput = "";
        string _setupStatus = "";
        string _lockInput = "";
        bool _showLockInput;

        // Request queue (one at a time)
        readonly Queue<(UnityWebRequest req, Action<string> cb)> _queue = new();
        UnityWebRequest _active;
        Action<string> _activeCb;

        [MenuItem("Window/Asset Lock Board")]
        static void Open()
        {
            var w = GetWindow<AssetLockWindow>("Lock Board");
            w.minSize = new Vector2(280, 200);
        }

        void OnEnable()
        {
            EditorApplication.update += Tick;
            Selection.selectionChanged += Repaint;
            _nextPoll = 0;
        }

        void OnDisable()
        {
            EditorApplication.update -= Tick;
            Selection.selectionChanged -= Repaint;
            _active?.Dispose();
        }

        // --- Tick: process requests + poll ---
        void Tick()
        {
            if (_active != null)
            {
                if (!_active.isDone) return;
                var cb = _activeCb;
                var txt = _active.downloadHandler?.text;
                _active.Dispose();
                _active = null;
                _activeCb = null;
                cb?.Invoke(txt);
                Repaint();
            }

            if (_active == null && _queue.Count > 0)
            {
                var (req, cb) = _queue.Dequeue();
                _active = req;
                _activeCb = cb;
                _active.SendWebRequest();
                return;
            }

            if (IsConfigured && EditorApplication.timeSinceStartup > _nextPoll)
            {
                Refresh();
                _nextPoll = EditorApplication.timeSinceStartup + POLL_INTERVAL;
            }
        }

        // --- HTTP helpers ---
        void Enqueue(UnityWebRequest req, Action<string> cb)
        {
            req.downloadHandler = new DownloadHandlerBuffer();
            _queue.Enqueue((req, cb));
        }

        void Get(string path, Action<string> cb) =>
            Enqueue(UnityWebRequest.Get($"{FIREBASE_URL}/{path}"), cb);

        void Put(string path, string json, Action<string> cb = null)
        {
            var req = UnityWebRequest.Put($"{FIREBASE_URL}/{path}", Encoding.UTF8.GetBytes(json));
            req.SetRequestHeader("Content-Type", "application/json");
            Enqueue(req, cb ?? (_ => { }));
        }

        void Delete(string path, Action<string> cb = null)
        {
            var req = new UnityWebRequest($"{FIREBASE_URL}/{path}", "DELETE")
            {
                downloadHandler = new DownloadHandlerBuffer()
            };
            Enqueue(req, cb ?? (_ => { }));
        }

        // --- Firebase actions ---
        void Refresh() => Get("files.json", json => { Files = ParseFiles(json); Repaint(); });

        internal static string LockMode = "busy"; // "busy" or "lock"

        internal static void LockFileStatic(string filename)
        {
            var w = GetWindow<AssetLockWindow>("Lock Board");
            w.DoLock(filename);
        }

        internal static void FreeFileStatic(string filename)
        {
            var w = GetWindow<AssetLockWindow>("Lock Board");
            w.DoFree(filename);
        }

        void DoLock(string filename)
        {
            var key = filename.Replace(".", "~");
            var json = $"{{\"name\":\"{Esc(filename)}\",\"ownerId\":{UserId}," +
                       $"\"ownerName\":\"{Esc(UserName)}\",\"ownerUsername\":\"{Esc(UserUsername)}\"," +
                       $"\"ownerColor\":\"{UserColor}\",\"watchers\":{{}},\"since\":{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}," +
                       $"\"mode\":\"{LockMode}\"}}";
            Put($"files/{key}.json", json, _ =>
                Put($"saved/{key}.json", $"\"{Esc(filename)}\"", __ => Refresh()));
        }

        void DoFree(string filename)
        {
            var key = filename.Replace(".", "~");
            Delete($"files/{key}.json", _ => Refresh());
        }

        static string Esc(string s) => s?.Replace("\\", "\\\\").Replace("\"", "\\\"") ?? "";

        // --- Setup: fetch user by @username ---
        void LookupUser(string username)
        {
            _setupStatus = "Looking up...";
            Repaint();
            Get("users.json", json =>
            {
                foreach (var (key, val) in ExtractObjects(json))
                {
                    if (!long.TryParse(key, out var id)) continue;
                    var u = JsonUtility.FromJson<UserProfile>(val);
                    if (u != null && string.Equals(u.username, username, StringComparison.OrdinalIgnoreCase))
                    {
                        UserId = id;
                        UserName = u.name;
                        UserUsername = u.username;
                        UserColor = u.color;
                        _setupStatus = "";
                        Refresh();
                        return;
                    }
                }
                _setupStatus = $"@{username} not found.\nLog in via web first:\nsasharx.github.io/asset-lock-board";
                Repaint();
            });
        }

        // --- GUI ---
        void OnGUI()
        {
            if (!IsConfigured) { DrawSetup(); return; }
            DrawBoard();
        }

        void DrawSetup()
        {
            GUILayout.FlexibleSpace();
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            EditorGUILayout.BeginVertical(GUILayout.Width(260));

            EditorGUILayout.LabelField("Asset Lock Board", EditorStyles.boldLabel);
            GUILayout.Space(8);
            EditorGUILayout.LabelField("Telegram username:", EditorStyles.miniLabel);
            EditorGUILayout.BeginHorizontal();
            GUILayout.Label("@", GUILayout.Width(14));
            _setupInput = EditorGUILayout.TextField(_setupInput);
            EditorGUILayout.EndHorizontal();
            GUILayout.Space(4);

            EditorGUI.BeginDisabledGroup(string.IsNullOrWhiteSpace(_setupInput));
            if (GUILayout.Button("Connect"))
                LookupUser(_setupInput.Trim().TrimStart('@'));
            EditorGUI.EndDisabledGroup();

            if (!string.IsNullOrEmpty(_setupStatus))
            {
                GUILayout.Space(4);
                EditorGUILayout.HelpBox(_setupStatus, MessageType.Info);
            }

            EditorGUILayout.EndVertical();
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();
            GUILayout.FlexibleSpace();
        }

        void DrawBoard()
        {
            // --- Toolbar ---
            EditorGUILayout.BeginHorizontal(EditorStyles.toolbar);
            GUILayout.Label($"({Files.Count})", EditorStyles.toolbarButton, GUILayout.Width(26));
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("\u21BB", EditorStyles.toolbarButton, GUILayout.Width(24))) Refresh();
            if (GUILayout.Button("+", EditorStyles.toolbarButton, GUILayout.Width(24))) _showLockInput = !_showLockInput;
            if (GUILayout.Button("\u2699", EditorStyles.toolbarButton, GUILayout.Width(24)))
            { UserId = 0; UserName = ""; UserUsername = ""; }
            EditorGUILayout.EndHorizontal();

            // --- Selection panel ---
            var selected = new List<(UnityEngine.Object obj, string path, string filename)>();
            foreach (var obj in Selection.objects)
            {
                if (obj == null) continue;
                var p = AssetDatabase.GetAssetPath(obj);
                if (string.IsNullOrEmpty(p)) continue;
                var fn = System.IO.Path.GetFileName(p);
                if (!string.IsNullOrEmpty(fn) && fn.Contains(".")) selected.Add((obj, p, fn));
            }

            if (selected.Count > 0)
            {
                var unlocked = selected.Where(s => !Files.ContainsKey(s.filename.Replace(".", "~"))).ToList();
                var myFiles = selected.Where(s => { var k = s.filename.Replace(".", "~"); return Files.TryGetValue(k, out var f) && f.ownerId == UserId; }).ToList();

                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                foreach (var (obj, path, filename) in selected)
                {
                    var key = filename.Replace(".", "~");
                    Files.TryGetValue(key, out var fd);
                    EditorGUILayout.BeginHorizontal();
                    var icon = AssetDatabase.GetCachedIcon(path);
                    if (icon != null) GUILayout.Label(new GUIContent(icon), GUILayout.Width(16), GUILayout.Height(16));
                    GUILayout.Label(filename);
                    GUILayout.FlexibleSpace();
                    if (fd != null && fd.ownerId != UserId)
                    {
                        var disp = !string.IsNullOrEmpty(fd.ownerUsername) ? $"@{fd.ownerUsername}" : fd.ownerName;
                        GUILayout.Label(fd.IsLock ? $"\u2588 {disp}" : disp, EditorStyles.miniLabel);
                    }
                    else if (fd != null && fd.ownerId == UserId)
                        GUILayout.Label("yours", EditorStyles.miniLabel);
                    EditorGUILayout.EndHorizontal();
                }

                EditorGUILayout.BeginHorizontal();
                LockMode = GUILayout.Toggle(LockMode == "lock", "Lock", EditorStyles.miniButtonLeft, GUILayout.Width(40)) ? "lock" : LockMode;
                LockMode = GUILayout.Toggle(LockMode == "busy", "Busy", EditorStyles.miniButtonRight, GUILayout.Width(40)) ? "busy" : LockMode;
                GUILayout.FlexibleSpace();
                if (myFiles.Count > 0 && GUILayout.Button(myFiles.Count > 1 ? $"Free ({myFiles.Count})" : "Free", EditorStyles.miniButton))
                    foreach (var s in myFiles) DoFree(s.filename);
                if (unlocked.Count > 0 && GUILayout.Button(unlocked.Count > 1 ? $"Take ({unlocked.Count})" : "Take", EditorStyles.miniButton))
                    foreach (var s in unlocked) DoLock(s.filename);
                EditorGUILayout.EndHorizontal();
                EditorGUILayout.EndVertical();
            }

            // --- Manual input ---
            if (_showLockInput)
            {
                EditorGUILayout.BeginHorizontal();
                _lockInput = EditorGUILayout.TextField(_lockInput);
                EditorGUI.BeginDisabledGroup(string.IsNullOrWhiteSpace(_lockInput) || !_lockInput.Contains("."));
                if (GUILayout.Button("Take", EditorStyles.miniButton, GUILayout.Width(40)))
                { DoLock(_lockInput.Trim()); _lockInput = ""; _showLockInput = false; }
                EditorGUI.EndDisabledGroup();
                EditorGUILayout.EndHorizontal();
            }

            // --- File list ---
            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            var mine = Files.Where(f => f.Value.ownerId == UserId).ToList();
            var others = Files.Where(f => f.Value.ownerId != UserId).ToList();

            if (mine.Count > 0)
            {
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.LabelField($"YOUR FILES ({mine.Count})", EditorStyles.miniLabel);
                GUILayout.FlexibleSpace();
                if (mine.Count > 1 && GUILayout.Button("Free All", EditorStyles.miniButton, GUILayout.Width(50)))
                    foreach (var (k, f) in mine) DoFree(f.name);
                EditorGUILayout.EndHorizontal();

                foreach (var (key, file) in mine)
                {
                    EditorGUILayout.BeginHorizontal();
                    GUILayout.Label(FileIcon(file.name), GUILayout.Width(16), GUILayout.Height(16));
                    if (GUILayout.Button(file.name, EditorStyles.label))
                        PingFile(file.name);
                    GUILayout.FlexibleSpace();
                    // Mode toggle
                    if (GUILayout.Button(file.IsLock ? "L" : "B", EditorStyles.miniButton, GUILayout.Width(20)))
                        Put($"files/{key}/mode.json", $"\"{(file.IsLock ? "busy" : "lock")}\"", _ => Refresh());
                    if (file.watcherCount > 0)
                        GUILayout.Label($"\u2022{file.watcherCount}", EditorStyles.miniLabel, GUILayout.Width(18));
                    GUILayout.Label(Fmt(file.since), EditorStyles.miniLabel, GUILayout.Width(36));
                    if (GUILayout.Button("Free", EditorStyles.miniButton, GUILayout.Width(36)))
                        DoFree(file.name);
                    EditorGUILayout.EndHorizontal();
                }
                GUILayout.Space(4);
            }

            if (others.Count > 0)
            {
                EditorGUILayout.LabelField($"LOCKED ({others.Count})", EditorStyles.miniLabel);
                var grouped = others.GroupBy(f => f.Value.ownerId).OrderByDescending(g => g.Count());
                foreach (var group in grouped)
                {
                    var first = group.First().Value;
                    var disp = !string.IsNullOrEmpty(first.ownerUsername) ? $"@{first.ownerUsername}" : first.ownerName;
                    EditorGUILayout.BeginHorizontal();
                    GUILayout.Label($"  {group.Count()}", EditorStyles.miniLabel, GUILayout.Width(20));
                    GUILayout.FlexibleSpace();
                    EditorGUILayout.LabelField(disp, EditorStyles.boldLabel);
                    EditorGUILayout.EndHorizontal();

                    foreach (var (_, file) in group)
                    {
                        EditorGUILayout.BeginHorizontal();
                        GUILayout.Space(10);
                        GUILayout.Label(FileIcon(file.name), GUILayout.Width(16), GUILayout.Height(16));
                        if (GUILayout.Button(file.name, EditorStyles.label))
                            PingFile(file.name);
                        GUILayout.FlexibleSpace();
                        GUILayout.Label(file.IsLock ? "L" : "B", EditorStyles.miniLabel, GUILayout.Width(12));
                        GUILayout.Label(Fmt(file.since), EditorStyles.miniLabel, GUILayout.Width(36));
                        EditorGUILayout.EndHorizontal();
                    }
                }
            }

            if (Files.Count == 0)
            {
                GUILayout.Space(20);
                GUILayout.Label("No locked files", EditorStyles.centeredGreyMiniLabel);
            }

            EditorGUILayout.EndScrollView();
        }

        static void PingFile(string filename)
        {
            if (_iconCache.TryGetValue(filename, out _)) { } // ensure cached
            var guids = AssetDatabase.FindAssets(System.IO.Path.GetFileNameWithoutExtension(filename));
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (System.IO.Path.GetFileName(path) == filename)
                {
                    var obj = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(path);
                    if (obj != null) { Selection.activeObject = obj; EditorGUIUtility.PingObject(obj); }
                    return;
                }
            }
        }

        static string Fmt(long ms)
        {
            var dt = DateTimeOffset.FromUnixTimeMilliseconds(ms).LocalDateTime;
            return dt.ToString("HH:mm");
        }

        static readonly Dictionary<string, GUIContent> _iconCache = new();

        static GUIContent FileIcon(string filename)
        {
            if (_iconCache.TryGetValue(filename, out var cached)) return cached;

            GUIContent result = null;
            // Try to find actual asset (once, cached)
            var guids = AssetDatabase.FindAssets(System.IO.Path.GetFileNameWithoutExtension(filename));
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (System.IO.Path.GetFileName(path) == filename)
                {
                    var icon = AssetDatabase.GetCachedIcon(path);
                    if (icon != null) { result = new GUIContent(icon); break; }
                }
            }
            if (result == null)
            {
                var ext = System.IO.Path.GetExtension(filename).ToLowerInvariant();
                var t = ext switch
                {
                    ".unity" => typeof(SceneAsset),
                    ".prefab" => typeof(GameObject),
                    ".mat" => typeof(Material),
                    ".cs" => typeof(MonoScript),
                    ".shader" or ".compute" => typeof(Shader),
                    ".png" or ".jpg" or ".jpeg" or ".tga" or ".psd" or ".exr" => typeof(Texture2D),
                    ".anim" => typeof(AnimationClip),
                    ".asset" => typeof(ScriptableObject),
                    ".wav" or ".mp3" or ".ogg" => typeof(AudioClip),
                    _ => typeof(DefaultAsset),
                };
                result = EditorGUIUtility.ObjectContent(null, t);
            }
            _iconCache[filename] = result;
            return result;
        }

        // --- JSON ---
        [Serializable]
        internal class FileData
        {
            public string name;
            public long ownerId;
            public string ownerName;
            public string ownerUsername;
            public string ownerColor;
            public long since;
            public string mode; // "busy" or "lock"
            public bool IsLock => mode == "lock";
            [NonSerialized] public int watcherCount;
        }

        [Serializable]
        class UserProfile { public string name; public string username; public string color; }

        static Dictionary<string, FileData> ParseFiles(string json)
        {
            var r = new Dictionary<string, FileData>();
            if (string.IsNullOrEmpty(json) || json.Trim() == "null") return r;
            foreach (var (k, v) in ExtractObjects(json))
            {
                try
                {
                    var d = JsonUtility.FromJson<FileData>(v);
                    if (d != null && !string.IsNullOrEmpty(d.name))
                    {
                        // Count watchers from raw JSON
                        var wi = v.IndexOf("\"watchers\"");
                        if (wi >= 0)
                        {
                            var bi = v.IndexOf('{', wi);
                            if (bi >= 0)
                            {
                                int depth = 1, j = bi + 1, count = 0;
                                bool inKey = false;
                                while (j < v.Length && depth > 0)
                                {
                                    if (v[j] == '{') { depth++; if (depth == 2) count++; }
                                    else if (v[j] == '}') depth--;
                                    j++;
                                }
                                d.watcherCount = count;
                            }
                        }
                        r[k] = d;
                    }
                }
                catch { }
            }
            return r;
        }

        static IEnumerable<(string key, string value)> ExtractObjects(string json)
        {
            if (string.IsNullOrEmpty(json)) yield break;
            int i = json.IndexOf('{') + 1;
            while (i < json.Length)
            {
                int ks = json.IndexOf('"', i); if (ks < 0) yield break;
                int ke = json.IndexOf('"', ks + 1); if (ke < 0) yield break;
                var key = json.Substring(ks + 1, ke - ks - 1);
                int ci = json.IndexOf(':', ke); if (ci < 0) yield break;
                int vi = ci + 1;
                while (vi < json.Length && char.IsWhiteSpace(json[vi])) vi++;
                if (vi >= json.Length) yield break;

                if (json[vi] == '{')
                {
                    int depth = 1, j = vi + 1;
                    while (j < json.Length && depth > 0) { if (json[j] == '{') depth++; else if (json[j] == '}') depth--; j++; }
                    yield return (key, json.Substring(vi, j - vi));
                    i = j;
                }
                else if (json[vi] == '"')
                {
                    int j = vi + 1;
                    while (j < json.Length && json[j] != '"') { if (json[j] == '\\') j++; j++; }
                    yield return (key, json.Substring(vi, j - vi + 1));
                    i = j + 1;
                }
                else
                {
                    int j = vi;
                    while (j < json.Length && json[j] != ',' && json[j] != '}') j++;
                    yield return (key, json.Substring(vi, j - vi).Trim());
                    i = j + 1;
                }
            }
        }
    }
}
