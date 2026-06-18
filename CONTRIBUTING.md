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

## Verificación antes de un PR

1. Comprueba que el frontend compila de forma pura: `cd frontend && npm run build`.
2. Ejecuta la validación End-to-End localmente: `npm run test:smoke` (requiere tener el puerto 3999 libre).
3. Todas tus ramas en GitHub pasarán automáticamente por GitHub Actions (CI/CD) para asegurar la integridad total.

## Convenciones

- Mantén el estilo del código existente (mismo nivel de comentarios e idioma).
- Toda nueva ruta que reciba nombres de tabla/columna **debe** validarlos (`^[a-zA-Z0-9_-]+$`) y parametrizar los valores.
- Cualquier campo de tipo de columna debe pasar por el whitelist (`normalizeColumnType`).
- Si tocas el comportamiento de la API, actualiza [`docs/API.md`](docs/API.md).

## Pull Requests

1. Crea una rama desde `main`.
2. Asegúrate de que el smoke test pasa y `npm run build` (en `frontend/`) compila.
3. Describe el cambio y, si aplica, su impacto en seguridad.
