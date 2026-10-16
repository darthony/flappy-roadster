// Servidor de Flappy Roadster: sirve el juego compilado y la API de puntuaciones.
import express from 'express';
import path from 'node:path';
import { createStore, TOP_N } from './store.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const DIST = path.join(process.cwd(), 'dist');

const store = await createStore();

// Límite básico por IP: 12 envíos por minuto.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 12;
}

function cleanNickname(raw) {
  if (typeof raw !== 'string') return null;
  const nick = raw.normalize('NFKC').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
  return nick.length >= 2 ? nick : null;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '2kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, store: store.kind }));

app.get('/api/scores', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ top: await store.top() });
  } catch (e) { next(e); }
});

app.post('/api/scores', async (req, res, next) => {
  try {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Demasiados envíos, espera un momento.' });
    const nickname = cleanNickname(req.body?.nickname);
    const score = Number(req.body?.score);
    if (!nickname) return res.status(400).json({ error: 'Nickname de 2 a 16 caracteres.' });
    if (!Number.isInteger(score) || score < 1 || score > 1_000_000) return res.status(400).json({ error: 'Puntuación no válida.' });
    const rank = await store.rank(score);
    await store.insert(nickname, score);
    res.status(201).json({ rank, nickname, score, top: await store.top(), topN: TOP_N });
  } catch (e) { next(e); }
});

app.use(express.static(DIST, { maxAge: '1h', index: false }));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error del servidor.' });
});

const server = app.listen(PORT, () => console.log(`Flappy Roadster en http://localhost:${PORT}  (${store.kind}: ${store.label})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); store.close().finally(() => process.exit(0)); });
