// Telegram Mini App WebApp API

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
  "#26A69A", "#EF5350", "#42A5F5", "#FFA726",
];

function colorForId(id: number): string {
  return COLORS[id % COLORS.length];
}

export function initTelegram() {
  const tg = window.Telegram?.WebApp;
  console.log('[TG] Telegram object:', !!window.Telegram);
  console.log('[TG] WebApp:', !!tg);
  console.log('[TG] initData:', tg?.initData);
  console.log('[TG] initDataUnsafe:', JSON.stringify(tg?.initDataUnsafe));
  console.log('[TG] user:', JSON.stringify(tg?.initDataUnsafe?.user));
  if (tg) {
    tg.ready();
    tg.expand();
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

  // Fallback for browser testing
  return { id: 999, name: 'Dev User', color: '#58B258' };
}

export function haptic(type: 'light' | 'medium' | 'heavy' = 'light') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(type);
}

export function hapticNotify(type: 'success' | 'warning' | 'error' = 'success') {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
}
