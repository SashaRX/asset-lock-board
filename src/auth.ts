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
}

const COLORS = [
  "#4A90D9", "#E8A04C", "#B07ACC", "#D35555",
  "#5AAFAF", "#8BC34A", "#FF7043", "#AB47BC",
];

function colorForId(id: number): string {
  return COLORS[id % COLORS.length];
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

export function getUser(): AppUser | null {
  const tg = window.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  if (u) {
    return {
      id: u.id,
      name: u.first_name + (u.last_name ? ' ' + u.last_name[0] + '.' : ''),
      username: u.username,
      color: colorForId(u.id),
    };
  }
  try {
    const saved = localStorage.getItem('alb_user');
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

export function loginWithTelegram(tgUser: TelegramLoginUser): AppUser {
  const user: AppUser = {
    id: tgUser.id,
    name: tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name[0] + '.' : ''),
    username: tgUser.username,
    color: colorForId(tgUser.id),
    // photo comes from Firebase (bot saves working URL), not from Login Widget (404s)
  };
  localStorage.setItem('alb_user', JSON.stringify(user));
  return user;
}

export function logout() {
  localStorage.removeItem('alb_user');
  auth.signOut().catch(() => {});
}

export function loginSimple(name: string): AppUser {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const user: AppUser = { id, name: name.trim(), color: colorForId(id) };
  localStorage.setItem('alb_user', JSON.stringify(user));
  return user;
}

/* Migrate all Firebase records from oldId to newId */
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
  ups[`users/${newId}`] = { ...oldProfile, ...merged };
  ups[`users/${oldId}`] = null;
  await update(ref(db), ups);
}

export async function linkTelegram(current: AppUser, tgUser: TelegramLoginUser): Promise<AppUser> {
  const newId = tgUser.id;
  if (newId === current.id) return current;
  const name = tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name[0] + '.' : '');
  const merged = { name, username: tgUser.username || '', color: colorForId(newId) };
  await migrateUserId(current.id, newId, merged);
  const user: AppUser = { id: newId, name, username: tgUser.username, color: merged.color };
  localStorage.setItem('alb_user', JSON.stringify(user));
  return user;
}

export async function linkGoogle(current: AppUser): Promise<AppUser | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const u = result.user;
    const numId = Math.abs([...u.uid].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
    // If already same id, just update profile
    if (numId === current.id) return current;
    const merged = { name: u.displayName || current.name, color: colorForId(numId), photo: u.photoURL || undefined };
    await migrateUserId(current.id, numId, merged);
    const user: AppUser = { id: numId, name: merged.name, color: merged.color, photo: merged.photo };
    localStorage.setItem('alb_user', JSON.stringify(user));
    return user;
  } catch { return null; }
}

function googleUserToAppUser(u: {uid:string; displayName:string|null; photoURL:string|null}): AppUser {
  const numId = Math.abs([...u.uid].reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0));
  const user: AppUser = {
    id: numId,
    name: u.displayName || 'User',
    color: colorForId(numId),
    photo: u.photoURL || undefined,
  };
  localStorage.setItem('alb_user', JSON.stringify(user));
  return user;
}

/* True only in genuine Telegram Mini App (initData is non-empty).
   Telegram Desktop in-app browser: initData="", Google popup works (with COOP warning).
   Regular browser: telegram-web-app.js from <head> creates WebApp but initData="" too. */
const isTgWebApp = () => !!window.Telegram?.WebApp?.initData;

export { isTgWebApp };

export async function loginWithGoogle(): Promise<AppUser | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return googleUserToAppUser(result.user);
  } catch {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }
}

export async function checkGoogleRedirect(): Promise<AppUser | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) return googleUserToAppUser(result.user);
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
