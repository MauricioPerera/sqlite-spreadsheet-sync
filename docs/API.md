# Especificación de la API REST

Backend Express. Base URL por defecto: `http://localhost:3001`.
Todas las respuestas son JSON con la forma `{ "success": boolean, ... }` salvo `GET /api/export/:tableName`, que devuelve un binario `.xlsx`.

## Autenticación

La autenticación es **opcional** y se controla con la variable de entorno `API_KEY`:

- Si `API_KEY` **no está definida** → la API está abierta (modo desarrollo).
- Si `API_KEY` **está definida** → toda petición debe incluir el header:

  ```
  x-api-key: <valor de API_KEY>
  ```

  Las peticiones sin la clave (o con clave incorrecta) reciben `401 Unauthorized`:
  ```json
  { "success": false, "error": "No autorizado: x-api-key ausente o inválida." }
  ```

CORS está restringido al origen `ALLOWED_ORIGIN` (por defecto `http://localhost:3000`).

## Reglas de validación

- **Nombres** de tabla y columna deben cumplir `^[a-zA-Z0-9_-]+$`. En caso contrario: error.
- **Tipos de columna** permitidos (whitelist): `TEXT`, `INTEGER`, `REAL`, `BLOB`, `NUMERIC`. Cualquier otro valor es rechazado.
- **Validación estricta de tipos**: insertar/actualizar texto no numérico en una columna `INTEGER`/`REAL`/`NUMERIC` devuelve error (las cadenas vacías y `null` se guardan como `NULL`).

## Errores

| Código | Cuándo |
|---|---|
| `400` | Petición inválida (faltan campos, `upsertKey`/URL de webhook inválidos, tipo fuera del whitelist). |
| `401` | Falta o es incorrecto el header `x-api-key` (solo si `API_KEY` está activa). |
| `500` | Error de SQL, de validación de datos o interno. El mensaje viaja en `error`. |

---

## Tablas

### `GET /api/tables`
Lista los nombres de todas las tablas de usuario (excluye internas como `_webhooks`).
```json
{ "success": true, "tables": ["inventario", "ventas"] }
```

### `GET /api/tables/:tableName`
Devuelve el esquema (vía `PRAGMA table_info`) y todas las filas. Cada fila incluye `_rowid` (rowid interno de SQLite) para edición.
```json
{
  "success": true,
  "schema": [{ "cid": 0, "name": "producto", "type": "TEXT", "notnull": 0, "dflt_value": null, "pk": 0 }],
  "rows": [{ "_rowid": 1, "producto": "Teclado", "cantidad": 42 }]
}
```

### `POST /api/tables`
Crea una tabla vacía.
```json
{
  "tableName": "clientes",
  "columns": [
    { "name": "nombre", "type": "TEXT" },
    { "name": "edad", "type": "INTEGER" },
    { "name": "ciudad_id", "type": "INTEGER", "foreignKey": { "table": "ciudades", "column": "id" } }
  ]
}
```
`foreignKey` es opcional y añade una cláusula `REFERENCES`.

### `DELETE /api/tables/:tableName`
Elimina (`DROP TABLE`) la tabla indicada. **Irreversible.**

### `POST /api/tables/:tableName/columns`
Añade una columna.
```json
{ "columnName": "telefono", "columnType": "TEXT" }
```

---

## Filas

### `POST /api/tables/:tableName/rows`
Crea una fila. El cuerpo es opcional; sin él, inserta una fila con valores por defecto.
```json
{ "producto": "Mouse", "cantidad": 10 }
```
Respuesta: `{ "success": true, "rowid": 7 }`. Dispara el webhook `row_created`.

### `PUT /api/tables/:tableName/rows/:rowid`
Actualiza **una** celda.
```json
{ "columnName": "cantidad", "value": 99 }
```
Respuesta: `{ "success": true, "changes": 1 }`. Dispara `row_updated`.

### `PATCH /api/tables/:tableName/rows/:rowid`
Actualiza **varias** celdas a la vez (ideal para integraciones tipo n8n).
```json
{ "producto": "Mouse Pro", "cantidad": 5 }
```
Respuesta: `{ "success": true, "changes": 1 }`. Dispara `row_updated`.

### `DELETE /api/tables/:tableName/rows/:rowid`
Elimina la fila por su `_rowid`. Dispara `row_deleted`.

---

## Importación / Exportación

### `POST /api/import`
`multipart/form-data`. Crea una tabla nueva desde un Excel/CSV o consolida registros en una existente.

| Campo | Tipo | Descripción |
|---|---|---|
| `file` | archivo | `.xlsx`, `.xls` o `.csv` (obligatorio). |
| `newTableName` o `targetTable` | texto | Nombre destino (se sanitiza). |
| `upsertKey` | texto | Opcional. Columna usada como clave para *upsert* (actualiza si existe, inserta si no). Debe cumplir `^[a-zA-Z0-9_-]+$`. |

**Inferencia de tipos**: al crear una tabla nueva, se escanean hasta las primeras 100 filas por columna. Si aparece texto no numérico **o** valores con ceros a la izquierda (ej. `"007"`), la columna se fuerza a `TEXT`; si todo es entero → `INTEGER`; si hay decimales → `REAL`. La lectura usa `raw: false` para preservar el texto original.

```json
{ "success": true, "message": "Archivo importado con éxito. Se insertaron 3 filas y se actualizaron 0 filas en la tabla \"clientes\".", "tableName": "clientes" }
```

### `GET /api/export/:tableName`
Devuelve la tabla como archivo `.xlsx` (binario). Cabeceras `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` y `Content-Disposition: attachment`. Omite la columna interna `_rowid`.

> Nota: si `API_KEY` está activa, este endpoint también la exige. El frontend lo descarga vía `fetch` + Blob para poder enviar el header (no por `window.open`).

---

## Webhooks

Permiten notificar a sistemas externos ante cambios en los datos.

**Eventos**: `row_created`, `row_updated`, `row_deleted`, o `*` (todos).
**Payload enviado** (POST al `url` registrado, con timeout de 5 s):
```json
{ "event": "row_created", "table": "clientes", "data": { "_rowid": 7, "nombre": "Ana" }, "timestamp": "2026-06-18T10:00:00.000Z" }
```

### `GET /api/webhooks`
Lista los webhooks registrados.

### `POST /api/webhooks`
Registra un webhook.
```json
{ "event": "row_created", "url": "https://ejemplo.com/hook", "targetTable": "clientes" }
```
`targetTable` es opcional (por defecto `*`). **Mitigación SSRF**: se rechazan (`400`) URLs que no sean `http`/`https` o que apunten a hosts privados/locales (`localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`, `169.254.0.0/16`).

### `DELETE /api/webhooks/:id`
Elimina el webhook por su `id`.
