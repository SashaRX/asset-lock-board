using System;

namespace AssetLockBoard.Editor
{
    [Serializable]
    internal class CameraData
    {
        public float pivotX, pivotY, pivotZ;
        public float rotX, rotY, rotZ, rotW;
        public float size;
        public bool orthographic;
    }

    [Serializable]
    internal class SnapshotData
    {
        public string id;           // "{authorId}_{timestamp}"
        public string name;
        public long authorId;
        public string authorName;
        public string scene;        // "Assets/Scenes/Level_01.unity"
        public CameraData camera;
        public string[] selection;  // hierarchy paths
        [NonSerialized] public string image;  // base64 PNG (stored separately, not in metadata)
        public long timestamp;
    }

    [Serializable]
    internal class SnapshotList
    {
        public SnapshotData[] items;
    }
}
