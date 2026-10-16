/** Google Analytics 4 vía gtag. Solo se carga si hay ID de medición. */
declare global {
  interface Window { dataLayer: unknown[]; gtag?: (...args: unknown[]) => void }
}

const GA_ID = import.meta.env.VITE_GA_ID as string | undefined;

export function initAnalytics(): void {
  if (!GA_ID) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { send_page_view: true });
}

export function track(event: string, params: Record<string, string | number | boolean> = {}): void {
  window.gtag?.('event', event, params);
}
