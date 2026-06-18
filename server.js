const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY; // si está definida, se exige x-api-key en cada petición
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

// Middlewares
// CORS restringido a un único origen (mitiga CSRF desde sitios de terceros)
app.use(cors({
  origin: ALLOWED_ORIGIN,
  allowedHeaders: ['Content-Type', 'x-api-key'],
}));

// Autenticación opcional por API Key. Solo se activa si la variable API_KEY está definida.
app.use((req, res, next) => {
  if (!API_KEY) return next();           // auth deshabilitada: flujo actual intacto
  if (req.method === 'OPTIONS') return next(); // dejar pasar el preflight CORS
  if (req.get('x-api-key') === API_KEY) return next();
  return res.status(401).json({ success: false, error: 'No autorizado: x-api-key ausente o inválida.' });
});

app.use(express.json());

// --- SSRF: validación de URLs de webhook ---
function isPrivateHost(hostname) {
  const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '::') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 127) return true;                 // loopback
    if (a === 10) return true;                  // 10.0.0.0/8
    if (a === 192 && b === 168) return true;    // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true;    // link-local
  }
  return false;
}

// Devuelve un mensaje de error si la URL no es segura, o null si es válida.
function validateWebhookUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'URL de webhook inválida.'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Solo se permiten URLs http/https.';
  if (isPrivateHost(u.hostname)) return 'No se permiten webhooks hacia redes locales o privadas (SSRF).';
  return null;
}

// Configuración de Multer para almacenar subidas temporales de Excel/CSV
const upload = multer({ dest: 'uploads/' });

// Inicializar la base de datos antes de arrancar el servidor
db.initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor SQLite-Spreadsheet Sync corriendo en http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Error inicializando base de datos:', err);
    process.exit(1);
  });

// Función para disparar webhooks
async function fireWebhooks(event, tableName, payload) {
  try {
    const webhooks = await db.getWebhooksForEvent(event, tableName);
    if (!webhooks || webhooks.length === 0) return;

    for (const hook of webhooks) {
      try {
        fetch(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, table: tableName, data: payload, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(5000) // evita que webhooks lentos (tarpits) agoten conexiones
        }).catch(e => console.error(`Error disparando webhook a ${hook.url}:`, e.message));
      } catch (err) {
        console.error(`Error interno al llamar webhook ${hook.url}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Error obteniendo webhooks:', err.message);
  }
}

// --- API ROUTES ---

// 1. Obtener todas las tablas
app.get('/api/tables', async (req, res) => {
  try {
    const tables = await db.getTables();
    res.json({ success: true, tables });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Obtener esquema y filas de una tabla
app.get('/api/tables/:tableName', async (req, res) => {
  const { tableName } = req.params;
  try {
    const schema = await db.getTableSchema(tableName);
    const rows = await db.getTableData(tableName);
    res.json({ success: true, schema, rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Crear una nueva tabla vacía
app.post('/api/tables', async (req, res) => {
  const { tableName, columns } = req.body; // columns: Array of { name, type }
  try {
    if (!tableName || !columns || !Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({ success: false, error: 'Falta el nombre de la tabla o la definición de columnas.' });
    }
    await db.createTable(tableName, columns);
    res.json({ success: true, message: `Tabla "${tableName}" creada.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Eliminar una tabla
app.delete('/api/tables/:tableName', async (req, res) => {
  const { tableName } = req.params;
  try {
    await db.dropTable(tableName);
    res.json({ success: true, message: `Tabla "${tableName}" eliminada.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Agregar una columna a una tabla existente
app.post('/api/tables/:tableName/columns', async (req, res) => {
  const { tableName } = req.params;
  const { columnName, columnType } = req.body;
  try {
    if (!columnName) {
      return res.status(400).json({ success: false, error: 'Nombre de columna requerido.' });
    }
    await db.addColumn(tableName, columnName, columnType || 'TEXT');
    res.json({ success: true, message: `Columna "${columnName}" agregada a "${tableName}".` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Agregar una fila a una tabla
app.post('/api/tables/:tableName/rows', async (req, res) => {
  const { tableName } = req.params;
  const initialData = req.body; // Opcional, pares { columna: valor }
  try {
    const result = await db.addRow(tableName, initialData);
    fireWebhooks('row_created', tableName, { _rowid: result.rowid, ...(initialData || {}) });
    res.json({ success: true, rowid: result.rowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Actualizar una celda específica de una fila
app.put('/api/tables/:tableName/rows/:rowid', async (req, res) => {
  const { tableName, rowid } = req.params;
  const { columnName, value } = req.body;
  try {
    if (!columnName) {
      return res.status(400).json({ success: false, error: 'Se requiere columnName.' });
    }
    const result = await db.updateCell(tableName, rowid, columnName, value);
    fireWebhooks('row_updated', tableName, { _rowid: rowid, [columnName]: value });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7b. Actualizar multiples celdas de una fila (Ideal para n8n)
app.patch('/api/tables/:tableName/rows/:rowid', async (req, res) => {
  const { tableName, rowid } = req.params;
  const data = req.body;
  try {
    const result = await db.updateRow(tableName, rowid, data);
    fireWebhooks('row_updated', tableName, { _rowid: rowid, ...data });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Eliminar una fila de una tabla
app.delete('/api/tables/:tableName/rows/:rowid', async (req, res) => {
  const { tableName, rowid } = req.params;
  try {
    const result = await db.deleteRow(tableName, rowid);
    fireWebhooks('row_deleted', tableName, { _rowid: rowid });
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Importar un archivo Excel/CSV y convertirlo a tabla SQLite
app.post('/api/import', upload.single('file'), async (req, res) => {
  const { targetTable, newTableName, upsertKey } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No se subió ningún archivo.' });
  }

  const filePath = req.file.path;
  const finalTableName = newTableName || targetTable;

  // Validar estrictamente la clave de upsert para evitar inyección SQL en posición de columna
  if (upsertKey && !/^[a-zA-Z0-9_-]+$/.test(upsertKey)) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.status(400).json({ success: false, error: 'upsertKey inválido.' });
  }

  try {
    // Leer el archivo con XLSX
    const workbook = xlsx.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convertir hoja a JSON
    // raw: false fuerza a leer todo como string/formato visual, defval evita valores vacíos omitidos
    const data = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

    if (data.length === 0) {
      throw new Error('El archivo Excel está vacío.');
    }

    // Obtener los nombres de las columnas a partir de las llaves del primer objeto
    const columns = Object.keys(data[0]);

    // Sanitizar nombres de columnas y tabla
    const sanitizedTableName = finalTableName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const existingTables = await db.getTables();
    const tableExists = existingTables.includes(sanitizedTableName);

    if (!tableExists) {
      // Crear tabla nueva
      const columnDefs = columns.map(col => {
        const cleanCol = col.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        // Intentar adivinar tipo de dato básico
        let type = 'TEXT';
        const sampleValue = data[0][col];
        if (sampleValue !== undefined && sampleValue !== "") {
          if (!isNaN(sampleValue)) {
            type = sampleValue.toString().includes('.') ? 'REAL' : 'INTEGER';
          }
        }
        return { name: cleanCol, type };
      });

      await db.createTable(sanitizedTableName, columnDefs);
    }

    // Insertar registros uno a uno
    let insertCount = 0;
    let updateCount = 0;
    for (const row of data) {
      const rowData = {};
      columns.forEach(col => {
        const cleanCol = col.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        rowData[cleanCol] = row[col];
      });
      
      if (upsertKey && rowData[upsertKey] !== undefined) {
        // Modo Upsert
        // upsertKey ya validado contra regex arriba; el valor va parametrizado para evitar inyección
        const existingRecords = await db.runReadOnlyQuery(
          `SELECT rowid AS _rowid FROM ${sanitizedTableName} WHERE ${upsertKey} = ?`,
          [rowData[upsertKey]]
        );
        
        if (existingRecords && existingRecords.length > 0) {
          const rowid = existingRecords[0]._rowid;
          await db.updateRow(sanitizedTableName, rowid, rowData);
          fireWebhooks('row_updated', sanitizedTableName, { _rowid: rowid, ...rowData });
          updateCount++;
        } else {
          const result = await db.addRow(sanitizedTableName, rowData);
          fireWebhooks('row_created', sanitizedTableName, { _rowid: result.rowid, ...rowData });
          insertCount++;
        }
      } else {
        // Normal Insert
        const result = await db.addRow(sanitizedTableName, rowData);
        fireWebhooks('row_created', sanitizedTableName, { _rowid: result.rowid, ...rowData });
        insertCount++;
      }
    }

    // Eliminar archivo temporal
    fs.unlinkSync(filePath);

    res.json({ 
      success: true, 
      message: `Archivo importado con éxito. Se insertaron ${insertCount} filas y se actualizaron ${updateCount} filas en la tabla "${sanitizedTableName}".`,
      tableName: sanitizedTableName
    });

  } catch (err) {
    // Limpiar archivo temporal en caso de error
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Exportar una tabla a Excel (.xlsx)
app.get('/api/export/:tableName', async (req, res) => {
  const { tableName } = req.params;
  try {
    const rows = await db.getTableData(tableName);
    
    // Limpiar la columna interna _rowid para que no aparezca en el Excel final
    const cleanRows = rows.map(r => {
      const { _rowid, ...rest } = r;
      return rest;
    });

    const worksheet = xlsx.utils.json_to_sheet(cleanRows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, tableName);

    // Escribir a un buffer en memoria
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${tableName}.xlsx`);
    res.send(buffer);

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- WEBHOOK ROUTES ---

// Obtener webhooks
app.get('/api/webhooks', async (req, res) => {
  try {
    const hooks = await db.getAllWebhooks();
    res.json({ success: true, webhooks: hooks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Agregar webhook
app.post('/api/webhooks', async (req, res) => {
  const { event, url, targetTable } = req.body;
  if (!event || !url) return res.status(400).json({ success: false, error: 'Faltan event o url' });
  const urlError = validateWebhookUrl(url);
  if (urlError) return res.status(400).json({ success: false, error: urlError });
  try {
    const result = await db.addWebhook(event, url, targetTable || '*');
    res.json({ success: true, id: result.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eliminar webhook
app.delete('/api/webhooks/:id', async (req, res) => {
  try {
    const result = await db.deleteWebhook(req.params.id);
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Servir frontend en producción (después de construir)
const frontendDist = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}
