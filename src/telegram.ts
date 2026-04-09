// Telegram Mini App WebApp API
// Docs: https://core.telegram.org/bots/webapps

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
            photo_url?: string;
          };
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        MainButton: {
          text: string;
          show: () => void;
          hide: () => void;
          onClick: (fn: () => void) => void;
        };
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
        };
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
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

// Color palette for users (deterministic based on user id)
const COLORS = [
  "#4A90D9", "#E8A04C", "#B07ACC", "#D35555",
  "#5AAFAF", "#8BC34A", "#FF7043", "#AB47BC",
  "#26A69A", "#EF5350", "#42A5F5", "#FFA726",
];

function colorForId(id: number): string {
  return COLORS[id % COLORS.length];
}

export function getTelegramUser(): AppUser | null {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initDataUnsafe?.user) return null;

  const u = tg.initDataUnsafe.user;
  return {
    id: u.id,
    name: u.first_name + (u.last_name ? " " + u.last_name[0] + "." : ""),
    color: colorForId(u.id),
  };
}

export function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }
}

export function haptic(type: 'light' | 'medium' | 'heavy' = 'light') {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(type);
}

export function hapticNotify(type: 'success' | 'warning' | 'error' = 'success') {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
}

// Dev mode: fake user when not inside Telegram
export function getUser(): AppUser {
  return getTelegramUser() || { id: 999, name: "Dev User", color: "#58B258" };
}
