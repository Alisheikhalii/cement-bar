'use client';
import { useEffect } from 'react';

/**
 * Registers the conservative PWA service worker (public/sw.js) in production builds only.
 * In development an SW would cache hot-reloaded chunks, so any previous registration is left alone
 * and nothing new is registered.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Installation is optional; the app works without it.
      });
    };
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);
  return null;
}
