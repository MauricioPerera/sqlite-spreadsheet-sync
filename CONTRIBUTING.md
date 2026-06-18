# Guía de Contribución

¡Gracias por tu interés en mejorar **SQLite Spreadsheet Sync**!

## Requisitos

- Node.js 18+ (probado en v24).

## Puesta en marcha

```bash
npm run install-all   # instala backend + frontend
npm run dev           # backend (3001) + frontend (3000) en paralelo
```

## Estructura

| Ruta | Responsabilidad |
|---|---|
| `server.js` | API REST Express (rutas, auth, CORS, import/export, webhooks). |
| `database.js` | Acceso a SQLite, validación de nombres/tipos, helpers relacionales. |
| `mcp.js` | Servidor MCP (stdio) sobre la misma base de datos. |
| `frontend/src/App.jsx` | UI React (grilla Tabulator, modales, `authFetch`). |
| `docs/` | Especificaciones (API, MCP, seguridad). |

## Smoke test / arnés de validación

Hay un driver que ejercita la API de extremo a extremo (crear tabla → fila → editar → exportar → webhooks → borrar):

```bash
# Auto-arranca un server en un puerto libre, prueba y lo apaga:
node .claude/skills/run-sqlite-spreadsheet-sync/driver.mjs

# O contra un server ya en marcha:
BASE_URL=http://localhost:3001 node .claude/skills/run-sqlite-spreadsheet-sync/driver.mjs
```
Debe terminar con `OK: 11 passed, 0 failed`. Ejecútalo antes de abrir un PR.

## Convenciones

- Mantén el estilo del código existente (mismo nivel de comentarios e idioma).
- Toda nueva ruta que reciba nombres de tabla/columna **debe** validarlos (`^[a-zA-Z0-9_-]+$`) y parametrizar los valores.
- Cualquier campo de tipo de columna debe pasar por el whitelist (`normalizeColumnType`).
- Si tocas el comportamiento de la API, actualiza [`docs/API.md`](docs/API.md).

## Pull Requests

1. Crea una rama desde `main`.
2. Asegúrate de que el smoke test pasa y `npm run build` (en `frontend/`) compila.
3. Describe el cambio y, si aplica, su impacto en seguridad.
