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

app.use(express.json());

// Autenticación opcional por API Key — montada SOLO en /api para no bloquear el
// frontend estático (express.static) cuando se sirve en producción.
// Solo se activa si la variable API_KEY está definida.
app.use('/api', (req, res, next) => {
  if (!API_KEY) return next();           // auth deshabilitada: flujo actual intacto
  if (req.method === 'OPTIONS') return next(); // dejar pasar el preflight CORS
  if (req.get('x-api-key') === API_KEY) return next();
  return res.status(401).json({ success: false, error: 'No autorizado: x-api-key ausente o inválida.' });
});

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

// Responde con 400 ante errores de validación/cliente y 500 ante el resto.
// Útil para clientes como n8n, que distinguen "mi petición está mal" de "el server falló".
function sendErr(res, err) {
  const msg = (err && err.message) ? err.message : 'Error interno';
  const isClientError = /inv[aá]lid|requiere|falta|no se permiten|permitid|vac[ií]o/i.test(msg);
  return res.status(isClientError ? 400 : 500).json({ success: false, error: msg });
}

// Configuración de Multer para almacenar subidas temporales de Excel/CSV
const ALLOWED_UPLOAD_EXT = ['.xlsx', '.xls', '.csv'];
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB: evita agotamiento de disco/memoria (DoS)
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_UPLOAD_EXT.includes(ext)) return cb(null, true);
    cb(new Error('Tipo de archivo no permitido. Solo se aceptan .xlsx, .xls o .csv.'));
  },
});

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
    sendErr(res, err);
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
    sendErr(res, err);
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
    sendErr(res, err);
  }
});

// 4. Eliminar una tabla
app.delete('/api/tables/:tableName', async (req, res) => {
  const { tableName } = req.params;
  try {
    await db.dropTable(tableName);
    res.json({ success: true, message: `Tabla "${tableName}" eliminada.` });
  } catch (err) {
    sendErr(res, err);
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
    sendErr(res, err);
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
    sendErr(res, err);
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
    sendErr(res, err);
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
    sendErr(res, err);
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
    sendErr(res, err);
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
    // Leer el archivo con XLSX (forzando texto crudo para no perder ceros a la izquierda).
    // Si el contenido es basura/binario no-spreadsheet, devolvemos un 400 limpio (no un 500).
    let workbook;
    try {
      workbook = xlsx.readFile(filePath, { cellText: true, cellDates: true });
    } catch (parseErr) {
      throw new Error('Archivo inválido o corrupto: no se pudo interpretar como hoja de cálculo.');
    }
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convertir hoja a JSON
    // raw: false fuerza a extraer el texto formateado (ej. "007" en vez del número 7)
    const data = xlsx.utils.sheet_to_json(worksheet, { defval: "", raw: false });

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
        
        let type = 'INTEGER'; // Asumimos INTEGER y degradamos según encontramos datos
        let hasData = false;
        
        // Escaneamos hasta 100 filas para inferir el tipo de forma más robusta
        const rowsToScan = Math.min(data.length, 100);
        
        for (let i = 0; i < rowsToScan; i++) {
          const val = data[i][col];
          if (val === undefined || val === null || val === "") continue;
          
          hasData = true;
          const strVal = String(val).trim();
          
          // Si tiene ceros a la izquierda (y no es el cero aislado), forzamos TEXT (ej: "007", "0921")
          if (/^0\d+/.test(strVal)) {
            type = 'TEXT';
            break;
          }
          
          if (isNaN(strVal)) {
            type = 'TEXT';
            break;
          } else if (strVal.includes('.')) {
            type = 'REAL';
          }
        }
        
        if (!hasData) type = 'TEXT'; // Si no hay datos, por seguridad es TEXT
        
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
    sendErr(res, err);
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
    sendErr(res, err);
  }
});

// --- WEBHOOK ROUTES ---

// Obtener webhooks
app.get('/api/webhooks', async (req, res) => {
  try {
    const hooks = await db.getAllWebhooks();
    res.json({ success: true, webhooks: hooks });
  } catch (err) {
    sendErr(res, err);
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
    sendErr(res, err);
  }
});

// Eliminar webhook
app.delete('/api/webhooks/:id', async (req, res) => {
  try {
    const result = await db.deleteWebhook(req.params.id);
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    sendErr(res, err);
  }
});

// Manejador de errores de subida (Multer): tamaño excedido o extensión rechazada -> 400.
// Multer reenvía estos errores a un middleware de 4 argumentos como este.
app.use((err, req, res, next) => {
  if (!err) return next();
  if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  const msg = err.code === 'LIMIT_FILE_SIZE'
    ? 'El archivo supera el límite de 10 MB.'
    : err.message;
  return res.status(400).json({ success: false, error: msg });
});

// Servir frontend en producción (después de construir)
const frontendDist = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}
