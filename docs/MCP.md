# Servidor MCP

`mcp.js` expone la base de datos a clientes [MCP (Model Context Protocol)](https://modelcontextprotocol.io) por transporte **stdio**, permitiendo que un asistente (Claude, etc.) lea y escriba en las mismas tablas que la app web.

## Ejecución

```bash
npm run mcp        # equivale a: node mcp.js
```

- El protocolo JSON-RPC viaja por **stdout**; los logs van a **stderr** (`SQLite Spreadsheet MCP Server running on stdio`).
- Opera sobre el mismo `data.db` que el backend.

Comprobación rápida (lista de herramientas):
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp.js
```

## Configuración en un cliente MCP

Ejemplo de entrada en la config de un cliente (ajusta la ruta absoluta):
```json
{
  "mcpServers": {
    "sqlite-spreadsheet": {
      "command": "node",
      "args": ["D:/repos/sqlite-spreadsheet-sync/mcp.js"]
    }
  }
}
```

## Herramientas disponibles

| Herramienta | Parámetros | Descripción |
|---|---|---|
| `list_tables` | — | Lista todas las tablas. |
| `get_schema` | `tableName` | Esquema de columnas de una tabla. |
| `read_table` | `tableName` | Todas las filas de una tabla. |
| `execute_sql_query` | `query` | Ejecuta una consulta **de solo lectura** (`SELECT`/`PRAGMA`). Otras sentencias se rechazan. |
| `add_row` | `tableName`, `data` (objeto) | Inserta una fila. |
| `update_row` | `tableName`, `rowid` (número), `data` (objeto) | Actualiza una fila por su `rowid`. |

> Las escrituras vía MCP (`add_row`, `update_row`) pasan por la **misma validación estricta de tipos** que la API REST: texto no numérico en columnas numéricas es rechazado.

## Notas de seguridad

- El MCP **no aplica `API_KEY`**: el control de acceso es el propio canal stdio (quien lanza el proceso ya tiene acceso al `data.db`).
- `execute_sql_query` está limitado a lectura, pero **no parametriza** la consulta entrante (la escribe el cliente MCP). Trátalo como una superficie de confianza: no lo expongas a entrada no confiable.
