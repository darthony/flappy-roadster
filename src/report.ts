/**
 * Captura de errores del cliente: excepciones, promesas rechazadas, pérdida del
 * contexto WebGL y errores de shader de Three. Se envían al servidor
 * (POST /api/client-errors) y a Analytics como evento `exception`.
 */
import { track } from './analytics';

const MAX_PER_SESSION = 12;
let sent = 0;

export interface ClientError { kind: string; message: string; stack?: string; extra?: Record<string, unknown> }

export function report(err: ClientError): void {
  if (sent++ >= MAX_PER_SESSION) return;
  const payload = {
    ...err,
    url: location.href,
    ua: navigator.userAgent,
    viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    at: new Date().toISOString(),
  };
  try {
    const body = JSON.stringify(payload);
    if (!navigator.sendBeacon?.('/api/client-errors', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* sin red */ }
  track('exception', { description: `${err.kind}: ${err.message}`.slice(0, 150), fatal: err.kind === 'webgl' });
  console.warn('[report]', err.kind, err.message);
}

export function installErrorReporting(canvas: HTMLCanvasElement): void {
  window.addEventListener('error', (e) => report({ kind: 'error', message: e.message, stack: e.error?.stack, extra: { file: e.filename, line: e.lineno } }));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | string;
    report({ kind: 'rejection', message: typeof r === 'string' ? r : r?.message ?? String(r), stack: typeof r === 'object' ? r?.stack : undefined });
  });
  canvas.addEventListener('webglcontextlost', (e) => report({ kind: 'webgl', message: 'context lost: ' + ((e as WebGLContextEvent).statusMessage || 'sin detalle') }));
  // Three informa los errores de shader por console.error; se reenvían recortados.
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : '')).join(' ');
    if (/THREE\.|WebGL/.test(text)) report({ kind: 'three', message: text.slice(0, 600) });
  };
}
