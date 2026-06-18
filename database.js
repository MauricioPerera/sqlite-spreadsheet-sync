const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath);

// Activar claves foráneas en la conexión principal
db.run('PRAGMA foreign_keys = ON;');

// Conexión SECUNDARIA de solo lectura para runReadOnlyQuery. Al abrirla con
// OPEN_READONLY, el motor SQLite rechaza cualquier escritura — incluso las
// encubiertas vía CTE (ej. `WITH x AS (...) DELETE FROM t`). Es la defensa real,
// no el regex. Se crea perezosamente para no fallar antes de que exista data.db.
let _dbReadOnly = null;
function getReadOnlyDb() {
  if (!_dbReadOnly) {
    _dbReadOnly = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  }
  return _dbReadOnly;
}

// Tipos SQL permitidos (whitelist cerrado para evitar inyección vía el campo "type")
const ALLOWED_TYPES = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC'];

// Normaliza y valida un tipo de columna contra el whitelist. Lanza si es inválido.
function normalizeColumnType(rawType) {
  const type = String(rawType || 'TEXT').trim().toUpperCase();
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error(`Tipo de columna inválido: "${rawType}". Permitidos: ${ALLOWED_TYPES.join(', ')}`);
  }
  return type;
}

// Valida que los valores de "data" sean compatibles con el tipo declarado en el esquema.
// Las columnas numéricas (INTEGER/REAL/NUMERIC) rechazan texto no numérico.
// Valores null o cadena vacía se consideran válidos (se guardarán como NULL).
function validateDataAgainstSchema(tableName, data) {
  return getTableSchema(tableName).then(schema => {
    const typeByName = {};
    schema.forEach(col => { typeByName[col.name] = String(col.type || '').toUpperCase(); });

    for (const key of Object.keys(data || {})) {
      const declaredType = typeByName[key];
      if (!declaredType) continue; // columna desconocida: SQL la rechazará después
      const isNumeric = declaredType.includes('INT') || declaredType.includes('REAL') || declaredType.includes('NUMERIC');
      if (!isNumeric) continue;

      const value = data[key];
      if (value === null || value === undefined || value === '') continue; // -> NULL
      if (isNaN(value)) {
        throw new Error(`La columna "${key}" es ${declaredType} y requiere un valor numérico (recibido: "${value}").`);
      }
    }
    return true;
  });
}

// Inicializar la base de datos con una tabla de ejemplo si está vacía
function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Crear tabla interna de webhooks
      db.run(`
        CREATE TABLE IF NOT EXISTS _webhooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event TEXT NOT NULL,
          target_table TEXT DEFAULT '*',
          url TEXT NOT NULL
        )
      `);

      // Comprobar si hay tablas existentes (excluyendo la de webhooks)
      db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_webhooks'", (err, tables) => {
        if (err) return reject(err);

        if (tables.length === 0) {
          console.log('Base de datos nueva detectada. Creando tabla de ejemplo: inventario...');
          
          // Crear tabla de ejemplo
          db.run(`
            CREATE TABLE inventario (
              producto TEXT NOT NULL,
              categoria TEXT,
              cantidad INTEGER DEFAULT 0,
              precio REAL DEFAULT 0.0,
              fecha_ingreso TEXT
            )
          `, (err) => {
            if (err) return reject(err);

            // Insertar datos de prueba
            const stmt = db.prepare(`
              INSERT INTO inventario (producto, categoria, cantidad, precio, fecha_ingreso)
              VALUES (?, ?, ?, ?, ?)
            `);

            stmt.run('Computadora Portátil', 'Electrónica', 15, 850.50, '2026-06-01');
            stmt.run('Teclado Mecánico', 'Accesorios', 42, 45.99, '2026-06-10');
            stmt.run('Mouse Inalámbrico', 'Accesorios', 60, 25.00, '2026-06-12');
            stmt.run('Monitor 27 pulgadas', 'Electrónica', 8, 199.90, '2026-06-15');
            stmt.run('Silla Ergonómica', 'Muebles', 10, 150.00, '2026-06-18');
            
            stmt.finalize((err) => {
              if (err) return reject(err);
              console.log('Tabla de ejemplo "inventario" creada con éxito.');
              resolve();
            });
          });
        } else {
          console.log(`Base de datos conectada. Tablas encontradas: ${tables.map(t => t.name).join(', ')}`);
          resolve();
        }
      });
    });
  });
}

// Obtener todas las tablas
function getTables() {
  return new Promise((resolve, reject) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_webhooks'", (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(r => r.name));
    });
  });
}

// Obtener el esquema de una tabla
function getTableSchema(tableName) {
  return new Promise((resolve, reject) => {
    // Validar nombre de tabla para evitar SQL injection
    if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) {
      return reject(new Error('Nombre de tabla inválido'));
    }
    db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Obtener los datos de una tabla (incluyendo rowid interno para actualizaciones)
function getTableData(tableName) {
  return new Promise((resolve, reject) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) {
      return reject(new Error('Nombre de tabla inválido'));
    }
    db.all(`SELECT rowid AS _rowid, * FROM ${tableName}`, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Actualizar una celda específica usando el rowid de la fila
function updateCell(tableName, rowid, columnName, value) {
  if (!/^[a-zA-Z0-9_-]+$/.test(tableName) || !/^[a-zA-Z0-9_-]+$/.test(columnName)) {
    return Promise.reject(new Error('Nombre de tabla o columna inválido'));
  }

  return validateDataAgainstSchema(tableName, { [columnName]: value }).then(() => new Promise((resolve, reject) => {
    // Convertir valor vacío a null si corresponde, o sanitizar
    const finalValue = value === '' ? null : value;

    db.run(
      `UPDATE ${tableName} SET ${columnName} = ? WHERE rowid = ?`,
      [finalValue, rowid],
      function(err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      }
    );
  }));
}

// Actualizar multiples columnas de una fila
function updateRow(tableName, rowid, data) {
  if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) {
    return Promise.reject(new Error('Nombre de tabla inválido'));
  }

  return validateDataAgainstSchema(tableName, data).then(() => new Promise((resolve, reject) => {
    const keys = Object.keys(data).filter(k => /^[a-zA-Z0-9_-]+$/.test(k));
    if (keys.length === 0) return resolve({ changes: 0 });

    const setClauses = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => data[k] === '' ? null : data[k]);

    const query = `UPDATE ${tableName} SET ${setClauses} WHERE rowid = ?`;
    db.run(query, [...values, rowid], function(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  }));
}

// Agregar una fila vacía o con datos iniciales
function addRow(tableName, initialData = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) {
    return Promise.reject(new Error('Nombre de tabla inválido'));
  }

  return validateDataAgainstSchema(tableName, initialData).then(() => new Promise((resolve, reject) => {
    const keys = Object.keys(initialData).filter(k => /^[a-zA-Z0-9_-]+$/.test(k));
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map(k => initialData[k] === '' ? null : initialData[k]);

    let query = `INSERT INTO ${tableName} DEFAULT VALUES`;
    if (keys.length > 0) {
      query = `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders})`;
    }

    db.run(query, values, function(err) {
      if (err) return reject(err);
      resolve({ rowid: this.lastID });
    });
  }));
}

// Eliminar una fila usando rowid
function deleteRow(tableName, rowid) {
  return new Promise((resolve, reject) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) {
      return reject(new Error('Nombre de tabla inválido'));
    }
    db.run(`DELETE FROM ${tableName} WHERE rowid = ?`, [rowid], function(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

// Crear una nueva tabla a partir de un nombre y columnas { name: string, type: string }
function createTable(tableName, columns) {
  return new Promise((resolve, reject) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) {
      return reject(new Error('Nombre de tabla inválido'));
    }

    const columnDefs = columns.map(col => {
      const colName = col.name;
      if (!/^[a-zA-Z0-9_-]+$/.test(colName)) {
        throw new Error(`Nombre de columna inválido: ${colName}`);
      }
      const colType = normalizeColumnType(col.type);

      let def = `${colName} ${colType}`;
      if (col.foreignKey && col.foreignKey.table && col.foreignKey.column) {
        // Validación básica de nombres de tabla y columna para la FK
        if (/^[a-zA-Z0-9_-]+$/.test(col.foreignKey.table) && /^[a-zA-Z0-9_-]+$/.test(col.foreignKey.column)) {
          def += ` REFERENCES ${col.foreignKey.table}(${col.foreignKey.column})`;
        }
      }
      return def;
    }).join(', ');

    const query = `CREATE TABLE ${tableName} (${columnDefs})`;
    
    db.run(query, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Eliminar una tabla
function dropTable(tableName) {
  return new Promise((resolve, reject) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(tableName)) {
      return reject(new Error('Nombre de tabla inválido'));
    }
    db.run(`DROP TABLE ${tableName}`, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Agregar una columna a una tabla existente
function addColumn(tableName, columnName, columnType = 'TEXT') {
  return new Promise((resolve, reject) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(tableName) || !/^[a-zA-Z0-9_-]+$/.test(columnName)) {
      return reject(new Error('Nombre de tabla o columna inválido'));
    }
    let safeType;
    try {
      safeType = normalizeColumnType(columnType);
    } catch (e) {
      return reject(e);
    }
    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${safeType}`, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// === WEBHOOKS ===

// Obtener webhooks
function getAllWebhooks() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM _webhooks`, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// Obtener webhooks para un evento específico
function getWebhooksForEvent(event, targetTable) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM _webhooks WHERE event IN (?, '*') AND target_table IN (?, '*')`,
      [event, targetTable],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  });
}

// Agregar webhook
function addWebhook(event, url, targetTable = '*') {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO _webhooks (event, target_table, url) VALUES (?, ?, ?)`,
      [event, targetTable, url],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID });
      }
    );
  });
}

// Eliminar webhook
function deleteWebhook(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM _webhooks WHERE id = ?`, [id], function (err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

// Ejecutar una consulta SQL de solo lectura (con parámetros blindados opcionales)
function runReadOnlyQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    // Primer filtro: la sentencia debe empezar por SELECT, PRAGMA o WITH (CTE).
    if (!/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) {
      return reject(new Error('Solo se permiten consultas SELECT, PRAGMA o WITH (CTE) por razones de seguridad.'));
    }
    // Defensa real: la conexión es OPEN_READONLY, así que cualquier intento de
    // escritura (incluido `WITH ... DELETE/UPDATE/INSERT`) falla en el motor.
    getReadOnlyDb().all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = {
  initDatabase,
  getTables,
  getTableSchema,
  getTableData,
  updateCell,
  updateRow,
  addRow,
  deleteRow,
  createTable,
  dropTable,
  addColumn,
  getAllWebhooks,
  getWebhooksForEvent,
  addWebhook,
  deleteWebhook,
  runReadOnlyQuery
};
