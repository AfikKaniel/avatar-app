/**
 * Persistent storage that writes to both localStorage AND a cookie.
 * Cookies survive iOS Safari's aggressive localStorage clearing.
 */

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function setCookie(key: string, value: string) {
  document.cookie = `${key}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
}

function getCookie(key: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function removeCookie(key: string) {
  document.cookie = `${key}=; max-age=0; path=/`;
}

export function persistSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
  setCookie(key, value);
}

export function persistGet(key: string): string | null {
  try {
    const ls = localStorage.getItem(key);
    if (ls) return ls;
  } catch {}
  // Fallback to cookie and restore localStorage
  const cookie = getCookie(key);
  if (cookie) {
    try { localStorage.setItem(key, cookie); } catch {}
  }
  return cookie;
}

export function persistRemove(key: string) {
  try { localStorage.removeItem(key); } catch {}
  removeCookie(key);
}
