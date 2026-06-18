const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const db = require("./database.js");

const MCP_TOOLS = [
  {
    name: "list_tables",
    description: "Lista todas las tablas disponibles en la base de datos.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_schema",
    description: "Obtiene el esquema de columnas de una tabla específica.",
    inputSchema: { type: "object", properties: { tableName: { type: "string" } }, required: ["tableName"] },
  },
  {
    name: "read_table",
    description: "Lee todas las filas de una tabla.",
    inputSchema: { type: "object", properties: { tableName: { type: "string" } }, required: ["tableName"] },
  },
  {
    name: "execute_sql_query",
    description: "Ejecuta una consulta SQL de solo lectura (SELECT) contra la base de datos para análisis profundo.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "La consulta SQL SELECT a ejecutar" } }, required: ["query"] },
  },
  {
    name: "add_row",
    description: "Agrega una nueva fila a una tabla específica.",
    inputSchema: { type: "object", properties: { tableName: { type: "string" }, data: { type: "object", description: "Pares clave-valor con los datos de la fila" } }, required: ["tableName", "data"] },
  },
  {
    name: "update_row",
    description: "Actualiza una fila existente identificada por su _rowid.",
    inputSchema: { type: "object", properties: { tableName: { type: "string" }, rowid: { type: "number" }, data: { type: "object", description: "Pares clave-valor con los nuevos datos" } }, required: ["tableName", "rowid", "data"] },
  },
];

async function handleMcpToolCall(request) {
  const { name, arguments: args } = request.params;
  try {
    if (name === "list_tables") return { content: [{ type: "text", text: JSON.stringify(await db.getTables(), null, 2) }] };
    if (name === "get_schema") return { content: [{ type: "text", text: JSON.stringify(await db.getTableSchema(args.tableName), null, 2) }] };
    if (name === "read_table") return { content: [{ type: "text", text: JSON.stringify(await db.getTableData(args.tableName), null, 2) }] };
    if (name === "execute_sql_query") return { content: [{ type: "text", text: JSON.stringify(await db.runReadOnlyQuery(args.query), null, 2) }] };
    if (name === "add_row") return { content: [{ type: "text", text: JSON.stringify({ success: true, rowid: (await db.addRow(args.tableName, args.data)).rowid }) }] };
    if (name === "update_row") return { content: [{ type: "text", text: JSON.stringify({ success: true, changes: (await db.updateRow(args.tableName, args.rowid, args.data)).changes }) }] };
    throw new Error(`Tool desconocida: ${name}`);
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
}

async function run() {
  await db.initDatabase();

  const server = new Server(
    { name: "sqlite-spreadsheet-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, handleMcpToolCall);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SQLite Spreadsheet MCP Server running on stdio");
}

run().catch(err => {
  console.error("Fatal error running MCP server:", err);
  process.exit(1);
});
