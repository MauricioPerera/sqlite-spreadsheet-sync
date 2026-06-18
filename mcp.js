const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const db = require("./database.js");

async function run() {
  // Aseguramos que la DB esté lista
  await db.initDatabase();

  const server = new Server(
    {
      name: "sqlite-spreadsheet-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "list_tables",
          description: "Lista todas las tablas disponibles en la base de datos.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_schema",
          description: "Obtiene el esquema de columnas de una tabla específica.",
          inputSchema: {
            type: "object",
            properties: {
              tableName: { type: "string" },
            },
            required: ["tableName"],
          },
        },
        {
          name: "read_table",
          description: "Lee todas las filas de una tabla.",
          inputSchema: {
            type: "object",
            properties: {
              tableName: { type: "string" },
            },
            required: ["tableName"],
          },
        },
        {
          name: "execute_sql_query",
          description: "Ejecuta una consulta SQL de solo lectura (SELECT) contra la base de datos para análisis profundo.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "La consulta SQL SELECT a ejecutar" },
            },
            required: ["query"],
          },
        },
        {
          name: "add_row",
          description: "Agrega una nueva fila a una tabla específica.",
          inputSchema: {
            type: "object",
            properties: {
              tableName: { type: "string" },
              data: { type: "object", description: "Pares clave-valor con los datos de la fila" },
            },
            required: ["tableName", "data"],
          },
        },
        {
          name: "update_row",
          description: "Actualiza una fila existente identificada por su _rowid.",
          inputSchema: {
            type: "object",
            properties: {
              tableName: { type: "string" },
              rowid: { type: "number" },
              data: { type: "object", description: "Pares clave-valor con los nuevos datos" },
            },
            required: ["tableName", "rowid", "data"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "list_tables") {
        const tables = await db.getTables();
        return { content: [{ type: "text", text: JSON.stringify(tables, null, 2) }] };
      }

      if (name === "get_schema") {
        const schema = await db.getTableSchema(args.tableName);
        return { content: [{ type: "text", text: JSON.stringify(schema, null, 2) }] };
      }

      if (name === "read_table") {
        const rows = await db.getTableData(args.tableName);
        return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
      }

      if (name === "execute_sql_query") {
        const result = await db.runReadOnlyQuery(args.query);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (name === "add_row") {
        const result = await db.addRow(args.tableName, args.data);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, rowid: result.rowid }) }] };
      }

      if (name === "update_row") {
        const result = await db.updateRow(args.tableName, args.rowid, args.data);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, changes: result.changes }) }] };
      }

      throw new Error(`Tool desconocida: ${name}`);
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log message to stderr so it doesn't corrupt stdout which is used for MCP messages
  console.error("SQLite Spreadsheet MCP Server running on stdio");
}

run().catch(err => {
  console.error("Fatal error running MCP server:", err);
  process.exit(1);
});
