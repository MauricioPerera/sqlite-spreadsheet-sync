const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

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
          body: JSON.stringify({ event, table: tableName, data: payload, timestamp: new Date().toISOString() })
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
        // Parametrizamos la consulta en vez de usar template literals para evitar inyeccion
        const existingRecords = await new Promise((resolve, reject) => {
           db.runReadOnlyQuery(`SELECT rowid AS _rowid FROM ${sanitizedTableName} WHERE ${upsertKey} = '${rowData[upsertKey]}'`)
             .then(resolve)
             .catch(reject);
        });
        
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
