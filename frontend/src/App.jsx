import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  Plus, 
  Trash2, 
  Download, 
  Upload, 
  RefreshCw, 
  Search, 
  AlertCircle, 
  CheckCircle2, 
  Table,
  ToggleLeft,
  Settings,
  HelpCircle,
  FileSpreadsheet
} from 'lucide-react';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator_modern.min.css';

const API_KEY = (typeof localStorage !== 'undefined' && localStorage.getItem('apiKey')) || '';

function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return fetch(url, { ...options, headers });
}

// --- Componentes Modales (Extraídos para bajar complejidad ciclomática) ---

const ImportModal = ({ show, onClose, onSubmit, importFile, setImportFile, importTableName, setImportTableName }) => {
  if (!show) return null;
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Importar / Consolidar Archivo Excel</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label>Selecciona Archivo (.xlsx, .xls, .csv)</label>
            <input 
              type="file" accept=".xlsx,.xls,.csv" required 
              onChange={(e) => {
                setImportFile(e.target.files[0]);
                if (e.target.files[0]) {
                  setImportTableName(e.target.files[0].name.split('.')[0].replace(/[^a-zA-Z0-9_-]/g, '_'));
                }
              }} 
            />
          </div>
          <div className="form-group">
            <label>Nombre de la tabla destino en SQLite</label>
            <input 
              type="text" placeholder="Ej. ventas_2026" required
              value={importTableName} onChange={(e) => setImportTableName(e.target.value)}
            />
            <small>Los datos se guardarán centralizados bajo este nombre de tabla.</small>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary">Importar y Sincronizar</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const AddColumnModal = ({ show, onClose, onSubmit, newColName, setNewColName, newColType, setNewColType }) => {
  if (!show) return null;
  return (
    <div className="modal-overlay">
      <div className="modal-card small">
        <div className="modal-header">
          <h2>Agregar Nueva Columna</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label>Nombre de la columna</label>
            <input type="text" placeholder="Ej. telefono_contacto" value={newColName} onChange={(e) => setNewColName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Tipo de datos</label>
            <select value={newColType} onChange={(e) => setNewColType(e.target.value)}>
              <option value="TEXT">Texto (TEXT)</option>
              <option value="INTEGER">Entero (INTEGER)</option>
              <option value="REAL">Decimal/Número (REAL)</option>
            </select>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary">Agregar Columna</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const CreateTableModal = ({ show, onClose, onSubmit, newTableName, setNewTableName, newTableColumns, setNewTableColumns }) => {
  if (!show) return null;

  const handleAddCol = () => setNewTableColumns([...newTableColumns, { name: `col_${newTableColumns.length + 1}`, type: 'TEXT' }]);
  const handleRemoveCol = (idx) => {
    const updated = [...newTableColumns];
    updated.splice(idx, 1);
    setNewTableColumns(updated);
  };
  const handleChange = (idx, field, val) => {
    const updated = [...newTableColumns];
    updated[idx][field] = val;
    setNewTableColumns(updated);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Crear Nueva Tabla</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label>Nombre de la tabla</label>
            <input type="text" placeholder="Ej. clientes_nuevos" value={newTableName} onChange={(e) => setNewTableName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Estructura de Columnas</span>
              <button type="button" className="btn-small-link" onClick={handleAddCol}>+ Agregar columna</button>
            </label>
            <div className="column-definitions-list">
              {newTableColumns.map((col, idx) => (
                <div key={idx} className="column-definition-row">
                  <input type="text" value={col.name} placeholder="Nombre de columna" required disabled={idx === 0}
                    onChange={(e) => handleChange(idx, 'name', e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_'))} />
                  <select value={col.type} onChange={(e) => handleChange(idx, 'type', e.target.value)}>
                    <option value="TEXT">Texto</option>
                    <option value="INTEGER">Entero</option>
                    <option value="REAL">Decimal</option>
                  </select>
                  {idx > 0 && <button type="button" className="delete-row-def" onClick={() => handleRemoveCol(idx)}>&times;</button>}
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary">Crear Tabla</button>
          </div>
        </form>
      </div>
    </div>
  );
};


// --- Componente Principal ---

function App() {
  const [tables, setTables] = useState([]);
  const [activeTable, setActiveTable] = useState('');
  const [schema, setSchema] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncState, setSyncState] = useState('synced'); 
  const [searchQuery, setSearchQuery] = useState('');
  const [notification, setNotification] = useState(null);
  
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [showCreateTableModal, setShowCreateTableModal] = useState(false);

  const [importFile, setImportFile] = useState(null);
  const [importTableName, setImportTableName] = useState('');
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('TEXT');
  const [newTableName, setNewTableName] = useState('');
  const [newTableColumns, setNewTableColumns] = useState([{ name: 'id_registro', type: 'INTEGER' }]);

  const tableRef = useRef(null);
  const tabulatorInstance = useRef(null);

  const showNotice = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchTables = async (selectDefault = false) => {
    try {
      const res = await authFetch('/api/tables');
      const data = await res.json();
      if (data.success) {
        setTables(data.tables);
        if (data.tables.length > 0 && (selectDefault || !activeTable)) setActiveTable(data.tables[0]);
      }
    } catch (err) {
      showNotice('Error cargando tablas', 'error');
    }
  };

  const fetchTableData = async (tableName) => {
    if (!tableName) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/tables/${tableName}`);
      const data = await res.json();
      if (data.success) {
        setSchema(data.schema);
        setRows(data.rows);
      } else {
        showNotice(data.error || 'Error cargando datos', 'error');
      }
    } catch (err) {
      showNotice('Error cargando datos de tabla', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTables(true); }, []);
  useEffect(() => { fetchTableData(activeTable); }, [activeTable]);

  // Handler de edición de celda extraído para abatir anidamiento
  const handleCellEdit = async (cell, col, tableName) => {
    const rowData = cell.getRow().getData();
    const rowid = rowData._rowid;
    const columnName = cell.getField();
    const value = cell.getValue();

    if (col.type === 'INTEGER' || col.type === 'REAL') {
      if (value !== "" && value !== null && isNaN(value)) {
        showNotice(`El campo ${columnName} requiere un valor numérico (${col.type})`, 'error');
        cell.setValue(cell.getOldValue());
        return;
      }
    }

    setSyncState('saving');
    try {
      const response = await authFetch(`/api/tables/${tableName}/rows/${rowid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnName, value })
      });
      const resData = await response.json();
      if (resData.success) {
        setSyncState('synced');
        cell.getElement().classList.add('cell-saved');
        setTimeout(() => cell.getElement().classList.remove('cell-saved'), 1000);
      } else {
        setSyncState('error');
        showNotice(resData.error || 'Error al guardar celda', 'error');
        cell.setValue(cell.getOldValue());
      }
    } catch (err) {
      setSyncState('error');
      showNotice('Error de red al sincronizar', 'error');
      cell.setValue(cell.getOldValue());
    }
  };

  useEffect(() => {
    if (!tableRef.current || schema.length === 0) return;
    if (tabulatorInstance.current) tabulatorInstance.current.destroy();

    const tabulatorColumns = [
      {
        formatter: "rowSelection", titleFormatter: "rowSelection", hovertarget: true,
        width: 40, headerSort: false, cellClick: (e, cell) => cell.getRow().toggleSelect()
      },
      ...schema.map(col => ({
        title: `${col.name} <span class="col-type">${col.type}</span>${col.pk === 1 ? ' 🔑' : ''}`,
        field: col.name,
        editor: true,
        sorter: col.type === 'INTEGER' || col.type === 'REAL' ? 'number' : 'string',
        headerFilter: "input",
        headerFilterPlaceholder: "Filtrar...",
        cellEdited: (cell) => handleCellEdit(cell, col, activeTable)
      }))
    ];

    tabulatorInstance.current = new Tabulator(tableRef.current, {
      data: rows,
      columns: tabulatorColumns,
      layout: "fitColumns",
      responsiveLayout: "collapse",
      pagination: true,
      paginationSize: 15,
      paginationSizeSelector: [10, 15, 30, 50, 100],
      movableColumns: true,
      keybindings: { "navPrev" : "shift + 9", "navNext" : 9, "navUp" : 38, "navDown" : 40 },
      placeholder: "<div class='no-data-msg'>La tabla está vacía o no hay datos para mostrar</div>"
    });
  }, [schema, rows]);

  const handleSearch = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (tabulatorInstance.current) {
      const filters = schema.map(col => ({ field: col.name, type: "like", value: query }));
      if (query) tabulatorInstance.current.setFilter([filters]);
      else tabulatorInstance.current.clearFilter();
    }
  };

  const handleAddRow = async () => {
    if (!activeTable) return;
    setSyncState('saving');
    try {
      const res = await authFetch(`/api/tables/${activeTable}/rows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.success) {
        setSyncState('synced');
        showNotice('Fila vacía agregada al final');
        fetchTableData(activeTable);
      } else {
        setSyncState('error');
        showNotice(data.error || 'Error agregando fila', 'error');
      }
    } catch (err) {
      setSyncState('error');
      showNotice('Error de conexión', 'error');
    }
  };

  const handleDeleteSelected = async () => {
    if (!activeTable || !tabulatorInstance.current) return;
    const selectedRows = tabulatorInstance.current.getSelectedRows();
    if (selectedRows.length === 0) return showNotice('No hay filas seleccionadas para eliminar', 'error');
    if (!confirm(`¿Estás seguro de que deseas eliminar ${selectedRows.length} fila(s)?`)) return;

    setSyncState('saving');
    try {
      let successCount = 0;
      for (const row of selectedRows) {
        const res = await authFetch(`/api/tables/${activeTable}/rows/${row.getData()._rowid}`, { method: 'DELETE' });
        if ((await res.json()).success) successCount++;
      }
      setSyncState('synced');
      showNotice(`Se eliminaron ${successCount} fila(s) con éxito.`);
      fetchTableData(activeTable);
    } catch (err) {
      setSyncState('error');
      showNotice('Error al eliminar algunas filas', 'error');
    }
  };

  const handleAddColumnSubmit = async (e) => {
    e.preventDefault();
    if (!newColName.trim() || !activeTable) return;
    try {
      const res = await authFetch(`/api/tables/${activeTable}/columns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnName: newColName.trim(), columnType: newColType })
      });
      const data = await res.json();
      if (data.success) {
        showNotice(`Columna "${newColName}" agregada.`);
        setShowAddColumnModal(false);
        setNewColName('');
        fetchTableData(activeTable);
      } else showNotice(data.error || 'Error al agregar columna', 'error');
    } catch (err) { showNotice('Error al conectar con servidor', 'error'); }
  };

  const handleCreateTableSubmit = async (e) => {
    e.preventDefault();
    if (!newTableName.trim()) return;
    try {
      const res = await authFetch('/api/tables', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName: newTableName.trim(), columns: newTableColumns })
      });
      const data = await res.json();
      if (data.success) {
        showNotice(`Tabla "${newTableName}" creada.`);
        setShowCreateTableModal(false);
        setNewTableName('');
        setNewTableColumns([{ name: 'id_registro', type: 'INTEGER' }]);
        await fetchTables();
        setActiveTable(newTableName.trim());
      } else showNotice(data.error || 'Error al crear tabla', 'error');
    } catch (err) { showNotice('Error de conexión al crear tabla', 'error'); }
  };

  const handleImportSubmit = async (e) => {
    e.preventDefault();
    if (!importFile) return showNotice('Por favor selecciona un archivo.', 'error');
    const tName = importTableName.trim() || importFile.name.split('.')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('newTableName', tName);

    setLoading(true);
    try {
      const res = await authFetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        showNotice(data.message);
        setShowImportModal(false);
        setImportFile(null);
        setImportTableName('');
        await fetchTables();
        setActiveTable(data.tableName);
      } else showNotice(data.error || 'Error al importar archivo', 'error');
    } catch (err) { showNotice('Error de conexión durante la importación', 'error'); } 
    finally { setLoading(false); }
  };

  const handleExport = async () => {
    if (!activeTable) return;
    showNotice('Exportación iniciada...');
    try {
      const res = await authFetch(`/api/export/${activeTable}`);
      if (!res.ok) throw new Error(res.status === 401 ? 'No autorizado. Revisa tu API_KEY.' : 'Error al exportar tabla');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeTable}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) { showNotice(err.message, 'error'); }
  };

  const handleDeleteActiveTable = async () => {
    if (!activeTable) return;
    if (!confirm(`¿ESTÁS SEGURO de que deseas eliminar COMPLETAMENTE la tabla "${activeTable}" y todos sus registros?`)) return;
    try {
      const res = await authFetch(`/api/tables/${activeTable}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showNotice(`Tabla "${activeTable}" eliminada con éxito.`);
        const oldActive = activeTable;
        await fetchTables();
        if (tables.length > 1) {
          setActiveTable(tables.filter(t => t !== oldActive)[0]);
        } else {
          setActiveTable('');
          setSchema([]);
          setRows([]);
        }
      } else showNotice(data.error || 'Error al eliminar tabla', 'error');
    } catch (err) { showNotice('Error de conexión al eliminar tabla', 'error'); }
  };

  return (
    <div className="app-container">
      {notification && (
        <div className={`notification ${notification.type}`}>
          {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{notification.message}</span>
        </div>
      )}

      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon-wrapper"><FileSpreadsheet size={24} className="logo-icon" /></div>
          <div className="logo-text">
            <h1>SQLite Spreadsheet Sync</h1>
            <p>Consolidación de Datos para Equipos de Trabajo</p>
          </div>
        </div>
        <div className="header-status">
          {syncState === 'synced' && <div className="status-badge synced"><span className="dot"></span><span>Guardado en Base de Datos</span></div>}
          {syncState === 'saving' && <div className="status-badge saving"><RefreshCw size={14} className="spin" /><span>Guardando cambios...</span></div>}
          {syncState === 'error' && <div className="status-badge error"><span className="dot"></span><span>Error de Sincronización</span></div>}
        </div>
      </header>

      <div className="tables-bar">
        <div className="tabs-container">
          {tables.map(table => (
            <button key={table} className={`table-tab ${activeTable === table ? 'active' : ''}`} onClick={() => setActiveTable(table)}>
              <Table size={16} /><span>{table}</span>
            </button>
          ))}
          <button className="action-tab-btn" title="Crear tabla vacía" onClick={() => setShowCreateTableModal(true)}>
            <Plus size={16} /><span>Nueva Tabla</span>
          </button>
        </div>
        <div className="import-export-actions">
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={16} /><span>Consolidar / Importar Excel</span>
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <button className="btn-primary" onClick={handleAddRow} disabled={!activeTable}><Plus size={16} /><span>Fila</span></button>
          <button className="btn-secondary" onClick={() => setShowAddColumnModal(true)} disabled={!activeTable}><Plus size={16} /><span>Columna</span></button>
          <button className="btn-danger-outline" onClick={handleDeleteSelected} disabled={!activeTable}><Trash2 size={16} /><span>Eliminar Selección</span></button>
          {activeTable && <button className="btn-danger-text" onClick={handleDeleteActiveTable} title="Borrar toda esta tabla">Borrar Tabla</button>}
        </div>
        <div className="toolbar-right">
          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input type="text" placeholder="Buscar en esta tabla..." value={searchQuery} onChange={handleSearch} disabled={!activeTable} />
          </div>
          <button className="btn-secondary btn-icon" onClick={handleExport} disabled={!activeTable} title="Exportar a Excel"><Download size={16} /><span>Exportar Excel</span></button>
        </div>
      </div>

      <main className="grid-main">
        {loading ? (
          <div className="grid-loading"><RefreshCw size={40} className="spin loading-icon" /><p>Cargando datos de la tabla...</p></div>
        ) : activeTable ? (
          <div ref={tableRef} className="tabulator-grid-container"></div>
        ) : (
          <div className="no-table-selected">
            <Database size={60} />
            <h2>No hay tablas seleccionadas</h2>
            <p>Para comenzar, selecciona una tabla arriba o importa una hoja de cálculo Excel existente.</p>
            <div className="no-table-actions">
              <button className="btn-primary" onClick={() => setShowImportModal(true)}><Upload size={16} /><span>Importar archivo Excel</span></button>
              <button className="btn-secondary" onClick={() => setShowCreateTableModal(true)}><Plus size={16} /><span>Crear tabla vacía</span></button>
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>SQLite Spreadsheet Sync &copy; 2026. Diseñado para simplificar el flujo de datos.</p>
        <div className="footer-links">
          <span>Filas cargadas: {rows.length}</span><span className="separator">|</span><span>Esquema: {schema.length} columnas</span>
        </div>
      </footer>

      <ImportModal 
        show={showImportModal} onClose={() => setShowImportModal(false)} onSubmit={handleImportSubmit} 
        importFile={importFile} setImportFile={setImportFile} importTableName={importTableName} setImportTableName={setImportTableName} 
      />
      
      <AddColumnModal 
        show={showAddColumnModal} onClose={() => setShowAddColumnModal(false)} onSubmit={handleAddColumnSubmit} 
        newColName={newColName} setNewColName={setNewColName} newColType={newColType} setNewColType={setNewColType} 
      />

      <CreateTableModal 
        show={showCreateTableModal} onClose={() => setShowCreateTableModal(false)} onSubmit={handleCreateTableSubmit} 
        newTableName={newTableName} setNewTableName={setNewTableName} newTableColumns={newTableColumns} setNewTableColumns={setNewTableColumns} 
      />
    </div>
  );
}

export default App;
