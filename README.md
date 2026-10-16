# Flappy Roadster

Tributo no oficial al Tesla Roadster presentado el 15 de octubre de 2026 en McGregor, Texas:
diez propulsores de nitrógeno a 10.000 psi, saltos sobre una fila de vehículos y un barrel roll en el aire.
Un *flappy* en 3D hecho con Three.js, jugable en web y móvil.

## Jugar

```bash
npm install
npm run dev      # http://localhost:5173 (también accesible desde el móvil en la misma red)
npm run build    # typecheck + build a dist/
```

## Controles

| Acción | Móvil | Teclado |
| --- | --- | --- |
| Ráfaga de nitrógeno | Toque | Espacio / ↑ / W |
| Barrel roll (×2 al pasar) | Deslizar | R / → / ↓ |
| Nitro (×10, con la barra llena) | Mantener o botón N₂ | N / Shift / Enter |

## Mecánicas

- Física flotante tipo Mario 3 bajo el agua: cada ráfaga suma impulso, la gravedad te baja.
- Obstáculos: la fila de la demo (Cybertruck, Semi, Model Y, Cybercab, Model 3) abajo y el labio de la rampa invertida arriba.
- Pasar por el centro del hueco da +1 y carga más nitro. Hacer un barrel roll al pasar duplica.
- La barra de N₂ se llena con el progreso. Al dispararla: 3,2 s de cohete con control de actitud automático,
  barrel rolls encadenados, invulnerabilidad y cada obstáculo reventado vale 10 puntos.
- Cada uso de nitro hace que la barra tarde más en volver a llenarse.

## Ranking y servidor

- `server/index.mjs` — Express: sirve `dist/` y la API `GET /api/scores` (top 20) y `POST /api/scores` (`{nickname, score}`).
  Validación de nickname (2–16 caracteres), límite de 12 envíos por minuto e IP.
- `server/store.mjs` — almacén de puntuaciones. Si existe `DATABASE_URL` usa **Postgres** (`pg`); si no, **SQLite** local
  con `node:sqlite` en `DATABASE_PATH` (por defecto `data/scores.db`). Las tablas se crean solas al arrancar.
- Al terminar la partida el jugador escribe su nickname, se guarda y ve el Top 20 con su fila resaltada. El nickname se recuerda en el dispositivo.
- En desarrollo: `npm start` (API en 8080, SQLite) y `npm run dev` (Vite en 5173 con proxy a `/api`).
- Para probar con Postgres en local: `docker run -d -e POSTGRES_PASSWORD=test -e POSTGRES_DB=flappy -p 55432:5432 postgres:16-alpine`
  y `DATABASE_URL=postgres://postgres:test@localhost:55432/flappy npm start`.
- Producción local: `npm run serve`.

## Google Analytics 4

Propiedad "Flappy Roadster", ID de medición `G-WGVSJK662E` (en `.env` como `VITE_GA_ID`, se inyecta al compilar).
Eventos enviados: `page_view`, `game_start`, `nitro_fired`, `game_over` (score, passed, nitro_uses) y `score_submitted` (score, rank).

## Despliegue en DigitalOcean App Platform

`.do/app.yaml` define el servicio web y una base Postgres gestionada (`db`, modo desarrollo, la más barata).
App Platform inyecta `DATABASE_URL` en el servicio y el ranking persiste entre despliegues.

1. Sube el repositorio a GitHub y edita `repo` en `.do/app.yaml`.
2. `doctl apps create --spec .do/app.yaml` (o Create App → importar spec desde el panel).
3. El build ejecuta `npm ci --include=dev && npm run build` (App Platform fija NODE_ENV=production) y el servicio arranca con `npm start` en el puerto 8080.
4. Cuando tengas la URL definitiva, actualiza la URL del flujo web en Google Analytics.

App desplegada: https://flappyroadster.simgulary.io (ingreso por defecto https://flappy-roadster-4msdd.ondigitalocean.app).

**Nota sobre la base de desarrollo:** App Platform concede al usuario de la base el permiso de CREATE sobre `public`
solo cuando un despliegue termina con éxito. Si el primer despliegue falla, la base queda sin permisos
("permission denied for schema public"). Solución oficial: desplegar una vez sin la sección `databases`, volver a
añadirla y desplegar de nuevo. El servidor no se cae si Postgres falla: avisa y usa SQLite mientras tanto.
Con `DEBUG_DB=1` expone `/api/dbinfo` con el diagnóstico de permisos.

## Estructura

- `src/roadster.ts` — coche: carga `public/models/roadster.glb` (y mientras tanto muestra un modelo procedural), añade las 10 toberas.
- `tools/prepare-roadster.mjs` — convierte el glTF original de Sketchfab en el GLB del juego: repinta en Ano White, quita el mapa de normales de 8 MB y la transmisión del cristal, simplifica la malla y comprime con meshopt. `node tools/prepare-roadster.mjs ruta/scene.gltf 0.2`.
- `src/particles.ts` — pluma de nitrógeno (gas frío, sin fuego) y escombros instanciados.
- `src/obstacles.ts` — vehículos y labio de rampa, colisión AABB.
- `src/world.ts` — escenario nocturno de la presentación: neón rojo en los bordes, asfalto mojado con charcos que reflejan, focos de presentación sobre el coche, bruma baja y siluetas de hangares. Bloom activado (desactivable con `?nobloom` en la URL).
- `src/game.ts` — estado, física, nitro, cámara.
- `src/hud.ts`, `src/input.ts`, `src/audio.ts` — interfaz, entrada unificada y sonido sintetizado.

## Créditos

Modelo 3D basado en ["Tesla Roadster 2020"](https://sketchfab.com/3d-models/tesla-roadster-2020-1fbf29e297bd4a17ac39a00a378441d8) de [metarex.4d](https://sketchfab.com/metarex.4d), licencia [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/). Repintado en blanco y simplificado para web. Licencia completa en `public/models/roadster-LICENSE.txt`.
