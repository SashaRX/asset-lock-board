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
  }
}

export interface AppUser {
  id: number;
  name: string;
  color: string;
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
  if (tg) {
    tg.ready();

    // Match Telegram chrome to our dark theme
    try { tg.setHeaderColor?.('#191919'); } catch {}
    try { tg.setBackgroundColor?.('#282828'); } catch {}
    try { tg.setBottomBarColor?.('#282828'); } catch {}
  }
}

export function getUser(): AppUser {
  const tg = window.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;

  if (u) {
    return {
      id: u.id,
      name: u.first_name + (u.last_name ? ' ' + u.last_name[0] + '.' : ''),
      color: colorForId(u.id),
    };
  }

  const debugName = !window.Telegram ? 'NO_TG_OBJ'
    : !tg ? 'NO_WEBAPP'
    : !tg.initDataUnsafe ? 'NO_INITDATA'
    : !tg.initDataUnsafe.user ? `NO_USER(initData=${tg.initData?.substring(0,20) || 'empty'})`
    : 'UNKNOWN';

  return { id: 999, name: debugName, color: '#58B258' };
}

export function haptic(type: 'light' | 'medium' | 'heavy' = 'light') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(type);
}

export function hapticNotify(type: 'success' | 'warning' | 'error' = 'success') {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
}
