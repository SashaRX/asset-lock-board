import { auth, googleProvider, signInWithPopup, signInWithRedirect, getRedirectResult, db, ref, get, update } from './firebase';

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
          };
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        setBottomBarColor?: (color: string) => void;
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
        };
      };
    };
    onTelegramAuth?: (user: TelegramLoginUser) => void;
  }
}

export interface TelegramLoginUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface AppUser {
  id: number;
  name: string;
  username?: string;
  color: string;
  photo?: string;
  provider?: 'simple' | 'telegram' | 'google';
}

const COLORS = [
  "#4A90D9", "#E8A04C", "#B07ACC", "#D35555",
  "#5AAFAF", "#8BC34A", "#FF7043", "#AB47BC",
];

function colorForId(id: number): string {
  return COLORS[Math.abs(id) % COLORS.length];
}

export function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (tg && tg.initData) {
    tg.ready();
    try { tg.setHeaderColor?.('#191919'); } catch {}
    try { tg.setBackgroundColor?.('#282828'); } catch {}
    try { tg.setBottomBarColor?.('#282828'); } catch {}
  }
}

/* Restore session from localStorage or Telegram WebApp */
export function getUser(): AppUser | null {
  // Telegram Mini App — auto-login
  const tg = window.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  if (u) {
    return {
      id: u.id,
      name: u.first_name + (u.last_name ? ' ' + u.last_name[0] + '.' : ''),
      username: u.username,
      color: colorForId(u.id),
      provider: 'telegram',
    };
  }
  // Saved session
  try {
    const saved = localStorage.getItem('alb_user');
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

/* --- Simple login: find existing user by name or create new --- */
export async function loginSimple(name: string): Promise<{ user?: AppUser; error?: string }> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return { error: 'Name too short' };
  if (!/^[\p{L}\s\-'.]+$/u.test(trimmed)) return { error: 'Invalid characters' };

  // Search existing users by name (case-insensitive)
  const snap = await get(ref(db, 'users'));
  const users = snap.val() || {};
  const lower = trimmed.toLowerCase();

  for (const [uid, profile] of Object.entries(users) as [string, any][]) {
    if (profile.name?.toLowerCase() === lower) {
      // Found existing user — restore session
      const user: AppUser = {
        id: Number(uid),
        name: profile.name,
        username: profile.username || '',
        color: profile.color || colorForId(Number(uid)),
        photo: profile.photo,
        provider: profile.provider || 'simple',
      };
      localStorage.setItem('alb_user', JSON.stringify(user));
      return { user };
    }
  }

  // New user — create with stable ID
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const user: AppUser = { id, name: trimmed, color: colorForId(id), provider: 'simple' };
  localStorage.setItem('alb_user', JSON.stringify(user));
  return { user };
}

/* --- Telegram Widget login (browser, not Mini App) --- */
export async function loginWithTelegram(tgUser: TelegramLoginUser): Promise<AppUser> {
  const tgId = tgUser.id;
  // Check if Telegram account already linked to a user
  const snap = await get(ref(db, `users/${tgId}`));
  const existing = snap.val();

  const user: AppUser = {
    id: tgId,
    name: existing?.name || tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name[0] + '.' : ''),
    username: tgUser.username,
    color: existing?.color || colorForId(tgId),
    photo: existing?.photo,
    provider: 'telegram',
  };
  localStorage.setItem('alb_user', JSON.stringify(user));
  return user;
}

export function logout() {
  localStorage.removeItem('alb_user');
  auth.signOut().catch(() => {});
}

/* --- Migrate all Firebase records from oldId to newId --- */
async function migrateUserId(oldId: number, newId: number, merged: Record<string, unknown>): Promise<void> {
  const snap = await get(ref(db, 'files'));
  const files = snap.val() || {};
  const ups: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(files) as [string, any][]) {
    if (f.ownerId === oldId) {
      ups[`files/${k}/ownerId`] = newId;
      if (merged.name) ups[`files/${k}/ownerName`] = merged.name;
      if (merged.username) ups[`files/${k}/ownerUsername`] = merged.username;
      if (merged.color) ups[`files/${k}/ownerColor`] = merged.color;
    }
    if (f.watchers?.[oldId]) {
      ups[`files/${k}/watchers/${newId}`] = f.watchers[oldId];
      ups[`files/${k}/watchers/${oldId}`] = null;
    }
  }
  const oldSnap = await get(ref(db, `users/${oldId}`));
  const oldProfile = oldSnap.val() || {};
  // Preserve isAdmin from either profile
  const newSnap = await get(ref(db, `users/${newId}`));
  const newProfile = newSnap.val() || {};
  const isAdmin = oldProfile.isAdmin || newProfile.isAdmin || null;
  ups[`users/${newId}`] = { ...oldProfile, ...newProfile, ...merged, ...(isAdmin ? { isAdmin } : {}) };
  ups[`users/${oldId}`] = null;
  await update(ref(db), ups);
}

/* --- Link Telegram to existing account --- */
export async function linkTelegram(current: AppUser, tgUser: TelegramLoginUser): Promise<AppUser> {
  const newId = tgUser.id;
  if (newId === current.id) return current;
  const name = current.name; // keep current name
  const merged = { name, username: tgUser.username || '', color: current.color, provider: 'telegram' };
  await migrateUserId(current.id, newId, merged);
  const user: AppUser = { id: newId, name, username: tgUser.username, color: current.color, provider: 'telegram' };
  localStorage.setItem('alb_user', JSON.stringify(user));
  return user;
}

/* --- Link Google to existing account --- */
export async function linkGoogle(current: AppUser): Promise<AppUser | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const u = result.user;
    const numId = Math.abs([...u.uid].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
    if (numId === current.id) return current;
    const merged = { name: current.name, color: current.color, photo: u.photoURL || undefined, provider: 'google' as const };
    await migrateUserId(current.id, numId, merged);
    const user: AppUser = { id: numId, name: current.name, color: current.color, photo: merged.photo, provider: 'google' };
    localStorage.setItem('alb_user', JSON.stringify(user));
    return user;
  } catch { return null; }
}

/* True only in genuine Telegram Mini App (initData is non-empty). */
const isTgWebApp = () => !!window.Telegram?.WebApp?.initData;
export { isTgWebApp };

/* Google standalone login — kept for redirect flow but links to existing or creates */
export async function loginWithGoogle(): Promise<AppUser | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const u = result.user;
    const numId = Math.abs([...u.uid].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
    // Check if this Google ID already exists
    const snap = await get(ref(db, `users/${numId}`));
    const existing = snap.val();
    const user: AppUser = {
      id: numId,
      name: existing?.name || u.displayName || 'User',
      color: existing?.color || colorForId(numId),
      photo: u.photoURL || existing?.photo,
      provider: 'google',
    };
    localStorage.setItem('alb_user', JSON.stringify(user));
    return user;
  } catch {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }
}

export async function checkGoogleRedirect(): Promise<AppUser | null> {
  try {
    const result = await getRedirectResult(auth);
    if (!result?.user) return null;
    const u = result.user;
    const numId = Math.abs([...u.uid].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
    const snap = await get(ref(db, `users/${numId}`));
    const existing = snap.val();
    const user: AppUser = {
      id: numId,
      name: existing?.name || u.displayName || 'User',
      color: existing?.color || colorForId(numId),
      photo: u.photoURL || existing?.photo,
      provider: 'google',
    };
    localStorage.setItem('alb_user', JSON.stringify(user));
    return user;
  } catch {}
  return null;
}

export function haptic(type: 'light' | 'medium' | 'heavy' = 'light') {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData) tg.HapticFeedback?.impactOccurred(type);
}

export function hapticNotify(type: 'success' | 'warning' | 'error' = 'success') {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData) tg.HapticFeedback?.notificationOccurred(type);
}
