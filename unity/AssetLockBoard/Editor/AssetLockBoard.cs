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
        const int ROW_H = 20;

        // --- Palette (matches web T) ---
        static readonly Color C_Bg       = new(0.157f, 0.157f, 0.157f); // #282828
        static readonly Color C_BgDark   = new(0.098f, 0.098f, 0.098f); // #191919
        static readonly Color C_BgRow    = new(0.220f, 0.220f, 0.220f); // #383838
        static readonly Color C_BgPanel  = new(0.208f, 0.208f, 0.208f); // #353535
        static readonly Color C_Border   = new(0.137f, 0.137f, 0.137f); // #232323
        static readonly Color C_Text     = new(0.824f, 0.824f, 0.824f); // #D2D2D2
        static readonly Color C_TextDim  = new(0.478f, 0.478f, 0.478f); // #7A7A7A
        static readonly Color C_TextMute = new(0.345f, 0.345f, 0.345f); // #585858
        static readonly Color C_Accent   = new(0.483f, 0.686f, 0.980f); // #7BAEFA
        static readonly Color C_Orange   = new(0.910f, 0.627f, 0.298f); // #E8A04C
        static readonly Color C_Red      = new(0.827f, 0.133f, 0.133f); // #D32222
        static readonly Color C_Green    = new(0.345f, 0.698f, 0.345f); // #58B258
        static readonly Color C_BlueBg   = new(0.275f, 0.376f, 0.486f); // #46607C

        static GUIStyle _rowLabel;
        static GUIStyle _dimLabel;
        static GUIStyle _headerLabel;
        static GUIStyle _ownerLabel;

        static void InitStyles()
        {
            if (_rowLabel != null) return;
            _rowLabel = new GUIStyle(EditorStyles.label) { fontSize = 11, alignment = TextAnchor.MiddleLeft };
            _rowLabel.normal.textColor = C_Text;
            _dimLabel = new GUIStyle(EditorStyles.miniLabel) { fontSize = 10, alignment = TextAnchor.MiddleRight };
            _dimLabel.normal.textColor = C_TextDim;
            _headerLabel = new GUIStyle(EditorStyles.miniLabel) { fontSize = 9, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleLeft };
            _headerLabel.normal.textColor = C_TextDim;
            _ownerLabel = new GUIStyle(EditorStyles.boldLabel) { fontSize = 11, alignment = TextAnchor.MiddleRight };
        }

        static void DrawRowBg(Rect r, int index)
        {
            if (index % 2 == 1)
                EditorGUI.DrawRect(r, C_BgRow);
        }

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
            InitStyles();

            // Header bar (matches web #191919)
            var headerRect = EditorGUILayout.BeginHorizontal(GUILayout.Height(28));
            EditorGUI.DrawRect(headerRect, C_BgDark);
            GUILayout.Space(6);
            GUI.color = C_Text;
            GUILayout.Label($"\U0001F512 Lock Board", EditorStyles.boldLabel, GUILayout.Height(28));
            GUI.color = Color.white;

            // File count badge
            var countStyle = new GUIStyle(EditorStyles.miniLabel) { alignment = TextAnchor.MiddleCenter };
            countStyle.normal.textColor = C_TextDim;
            GUI.backgroundColor = new Color(0.25f, 0.25f, 0.25f);
            GUILayout.Label($" {Files.Count} ", countStyle, GUILayout.Height(16));
            GUI.backgroundColor = Color.white;

            GUILayout.FlexibleSpace();
            if (GUILayout.Button("\u21BB", EditorStyles.toolbarButton, GUILayout.Width(24))) Refresh();
            if (GUILayout.Button("+", EditorStyles.toolbarButton, GUILayout.Width(24))) _showLockInput = !_showLockInput;
            if (GUILayout.Button("\u2699", EditorStyles.toolbarButton, GUILayout.Width(24))) { UserId = 0; UserName = ""; UserUsername = ""; }
            GUILayout.Space(4);
            EditorGUILayout.EndHorizontal();

            // Selection panel
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
                var panelRect = EditorGUILayout.BeginVertical();
                EditorGUI.DrawRect(panelRect, C_BgPanel);
                GUILayout.Space(2);

                foreach (var (obj, path, filename) in selected)
                {
                    var key = filename.Replace(".", "~");
                    Files.TryGetValue(key, out var fd);
                    EditorGUILayout.BeginHorizontal(GUILayout.Height(ROW_H));
                    GUILayout.Space(4);
                    var icon = AssetDatabase.GetCachedIcon(path);
                    if (icon != null) GUILayout.Label(new GUIContent(icon), GUILayout.Width(16), GUILayout.Height(16));
                    GUILayout.Label(filename, _rowLabel);
                    GUILayout.FlexibleSpace();

                    if (fd == null)
                    {
                        GUI.backgroundColor = LockMode == "lock" ? C_Red : C_Orange;
                        if (GUILayout.Button(LockMode == "lock" ? "\U0001F512" : "\U0001F536", EditorStyles.miniButton, GUILayout.Width(26))) DoLock(filename);
                        GUI.backgroundColor = Color.white;
                    }
                    else if (fd.ownerId == UserId)
                    {
                        GUI.color = fd.IsLock ? C_Red : C_Orange;
                        if (GUILayout.Button(fd.IsLock ? "\U0001F512" : "\U0001F536", EditorStyles.miniButton, GUILayout.Width(26)))
                            Put($"files/{key}/mode.json", $"\"{(fd.IsLock ? "busy" : "lock")}\"", _ => Refresh());
                        GUI.color = Color.white;
                        if (GUILayout.Button("Free", EditorStyles.miniButton, GUILayout.Width(36))) DoFree(filename);
                    }
                    else
                    {
                        var disp = !string.IsNullOrEmpty(fd.ownerUsername) ? $"@{fd.ownerUsername}" : fd.ownerName;
                        GUI.color = fd.IsLock ? C_Red : C_Orange;
                        GUILayout.Label($"{(fd.IsLock ? "\U0001F512" : "\U0001F536")} {disp}", _dimLabel);
                        GUI.color = Color.white;
                    }
                    GUILayout.Space(4);
                    EditorGUILayout.EndHorizontal();
                }

                // Mode toggle + bulk
                EditorGUILayout.BeginHorizontal(GUILayout.Height(18));
                GUILayout.Space(4);
                GUILayout.Label("Mode:", _dimLabel, GUILayout.Width(36));
                GUI.color = LockMode == "busy" ? C_Orange : C_TextMute;
                if (GUILayout.Button("Busy", EditorStyles.miniButton, GUILayout.Width(38))) LockMode = "busy";
                GUI.color = LockMode == "lock" ? C_Red : C_TextMute;
                if (GUILayout.Button("Lock", EditorStyles.miniButton, GUILayout.Width(38))) LockMode = "lock";
                GUI.color = Color.white;
                GUILayout.FlexibleSpace();
                var unlocked = selected.Where(s => !Files.ContainsKey(s.filename.Replace(".", "~"))).ToList();
                var myFiles = selected.Where(s => { var k = s.filename.Replace(".", "~"); return Files.TryGetValue(k, out var f) && f.ownerId == UserId; }).ToList();
                if (unlocked.Count > 1)
                {
                    GUI.backgroundColor = LockMode == "lock" ? C_Red : C_Orange;
                    if (GUILayout.Button($"All ({unlocked.Count})", EditorStyles.miniButton, GUILayout.Width(50)))
                        foreach (var s in unlocked) DoLock(s.filename);
                    GUI.backgroundColor = Color.white;
                }
                if (myFiles.Count > 1)
                    if (GUILayout.Button($"Free ({myFiles.Count})", EditorStyles.miniButton, GUILayout.Width(54)))
                        foreach (var s in myFiles) DoFree(s.filename);
                GUILayout.Space(4);
                EditorGUILayout.EndHorizontal();
                GUILayout.Space(2);
                EditorGUILayout.EndVertical();
            }

            // Manual input
            if (_showLockInput)
            {
                EditorGUILayout.BeginHorizontal(GUILayout.Height(22));
                GUILayout.Space(4);
                _lockInput = EditorGUILayout.TextField(_lockInput);
                var canLock = !string.IsNullOrWhiteSpace(_lockInput) && _lockInput.Contains(".");
                EditorGUI.BeginDisabledGroup(!canLock);
                if (GUILayout.Button(LockMode == "lock" ? "\U0001F512" : "\U0001F536", GUILayout.Width(28)))
                { DoLock(_lockInput.Trim()); _lockInput = ""; _showLockInput = false; }
                EditorGUI.EndDisabledGroup();
                GUILayout.Space(4);
                EditorGUILayout.EndHorizontal();
            }

            // --- File list ---
            _scroll = EditorGUILayout.BeginScrollView(_scroll);

            var mine = Files.Where(f => f.Value.ownerId == UserId).ToList();
            var others = Files.Where(f => f.Value.ownerId != UserId).ToList();

            // Section: Your files
            if (mine.Count > 0)
            {
                var secRect = EditorGUILayout.BeginHorizontal(GUILayout.Height(18));
                EditorGUI.DrawRect(secRect, C_Bg);
                GUILayout.Space(6);
                GUILayout.Label($"YOUR FILES ({mine.Count})", _headerLabel);
                GUILayout.FlexibleSpace();
                if (mine.Count > 1 && GUILayout.Button("Free All", EditorStyles.miniButton, GUILayout.Width(50)))
                { foreach (var (k, f) in mine) DoFree(f.name); }
                GUILayout.Space(4);
                EditorGUILayout.EndHorizontal();

                for (int i = 0; i < mine.Count; i++)
                {
                    var (key, file) = mine[i];
                    var rowRect = EditorGUILayout.BeginHorizontal(GUILayout.Height(ROW_H));
                    DrawRowBg(rowRect, i);
                    GUILayout.Space(4);
                    // Mode icon (clickable)
                    GUI.color = file.IsLock ? C_Red : C_Orange;
                    if (GUILayout.Button(file.IsLock ? "\U0001F512" : "\u25C6", EditorStyles.miniLabel, GUILayout.Width(14)))
                        Put($"files/{key}/mode.json", $"\"{(file.IsLock ? "busy" : "lock")}\"", _ => Refresh());
                    GUI.color = Color.white;
                    // Asset icon
                    GUILayout.Label(FileIcon(file.name), GUILayout.Width(16), GUILayout.Height(16));
                    // Name
                    GUILayout.Label(file.name, _rowLabel);
                    GUILayout.FlexibleSpace();
                    // Watchers
                    if (file.watcherCount > 0)
                    {
                        GUI.color = C_Orange;
                        GUILayout.Label($"\U0001F514", GUILayout.Width(14));
                        GUI.color = Color.white;
                    }
                    // Time
                    GUILayout.Label(Fmt(file.since), _dimLabel, GUILayout.Width(36));
                    // Free
                    if (GUILayout.Button("Free", EditorStyles.miniButton, GUILayout.Width(36))) DoFree(file.name);
                    GUILayout.Space(4);
                    EditorGUILayout.EndHorizontal();
                }
                GUILayout.Space(2);
            }

            // Section: Others
            if (others.Count > 0)
            {
                var secRect = EditorGUILayout.BeginHorizontal(GUILayout.Height(18));
                EditorGUI.DrawRect(secRect, C_Bg);
                GUILayout.Space(6);
                GUILayout.Label($"LOCKED ({others.Count})", _headerLabel);
                EditorGUILayout.EndHorizontal();

                var grouped = others.GroupBy(f => f.Value.ownerId).OrderByDescending(g => g.Count());
                int idx = 0;
                foreach (var group in grouped)
                {
                    var first = group.First().Value;
                    var disp = !string.IsNullOrEmpty(first.ownerUsername) ? $"@{first.ownerUsername}" : first.ownerName;

                    // Owner header
                    var ownerRect = EditorGUILayout.BeginHorizontal(GUILayout.Height(20));
                    EditorGUI.DrawRect(ownerRect, C_Bg);
                    GUILayout.Space(6);
                    GUILayout.Label($"{group.Count()}", _dimLabel, GUILayout.Width(14));
                    GUILayout.FlexibleSpace();
                    _ownerLabel.normal.textColor = ColorFromHex(first.ownerColor);
                    GUILayout.Label(disp, _ownerLabel);
                    GUILayout.Space(4);
                    EditorGUILayout.EndHorizontal();

                    foreach (var (_, file) in group)
                    {
                        var rowRect = EditorGUILayout.BeginHorizontal(GUILayout.Height(ROW_H));
                        DrawRowBg(rowRect, idx++);
                        GUILayout.Space(16);
                        GUI.color = file.IsLock ? C_Red : C_Orange;
                        GUILayout.Label(file.IsLock ? "\U0001F512" : "\u25C6", GUILayout.Width(14));
                        GUI.color = Color.white;
                        GUILayout.Label(FileIcon(file.name), GUILayout.Width(16), GUILayout.Height(16));
                        GUILayout.Label(file.name, _rowLabel);
                        GUILayout.FlexibleSpace();
                        GUILayout.Label(Fmt(file.since), _dimLabel, GUILayout.Width(36));
                        GUILayout.Space(4);
                        EditorGUILayout.EndHorizontal();
                    }
                }
            }

            if (Files.Count == 0)
            {
                GUILayout.Space(20);
                var emptyStyle = new GUIStyle(EditorStyles.centeredGreyMiniLabel);
                emptyStyle.normal.textColor = C_TextMute;
                GUILayout.Label("No locked files", emptyStyle);
            }

            EditorGUILayout.EndScrollView();
        }

        static string Fmt(long ms)
        {
            var dt = DateTimeOffset.FromUnixTimeMilliseconds(ms).LocalDateTime;
            return dt.ToString("HH:mm");
        }

        static Color ColorFromHex(string hex)
        {
            if (string.IsNullOrEmpty(hex)) return C_Text;
            ColorUtility.TryParseHtmlString(hex, out var c);
            return c;
        }

        static GUIContent FileIcon(string filename)
        {
            // Try to find the actual asset in the project
            var guids = AssetDatabase.FindAssets(System.IO.Path.GetFileNameWithoutExtension(filename));
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (System.IO.Path.GetFileName(path) == filename)
                {
                    var icon = AssetDatabase.GetCachedIcon(path);
                    if (icon != null) return new GUIContent(icon);
                }
            }
            // Fallback: type-based icon
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
            return EditorGUIUtility.ObjectContent(null, t);
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
