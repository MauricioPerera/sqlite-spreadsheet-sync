# SQLite Spreadsheet Sync

Una aplicación web interactiva que centraliza datos relacionales en una base de datos **SQLite**, ofreciendo una interfaz de usuario similar a **Excel** / **Google Sheets** para reducir la fricción en equipos de trabajo no técnicos. 

Esto previene la desincronización y pérdida de información provocada por el uso de múltiples archivos de Excel locales dispersos.

## 🚀 Características
* **Pestañas por Tabla**: Navegación inmediata entre las tablas de la base de datos central.
* **Edición tipo Excel**: Edición directa de celdas con doble clic, navegación con teclado (Tab, Enter, Flechas) y autoguardado en base de datos.
* **Importación y Consolidación**: Sube archivos Excel `.xlsx` o `.csv` sueltos para crear tablas automáticamente o añadir registros en lote.
* **Exportación Directa**: Descarga cualquier tabla activa de la base de datos de vuelta a formato Excel en un clic.
* **Validación en Tiempo Real**: Evita la corrupción de datos alertando al usuario si ingresa tipos incompatibles (ej. texto en campos numéricos).
* **Gestión de Estructura**: Crea tablas nuevas y añade columnas directamente desde la interfaz gráfica.

---

## 📚 Documentación

* [Especificación de la API REST](docs/API.md) — endpoints, autenticación, validación y errores.
* [Servidor MCP](docs/MCP.md) — integración con asistentes (Claude, etc.) vía Model Context Protocol.
* [Modelo de Seguridad](docs/SECURITY.md) — defensas implementadas y hardening de despliegue.
* [Guía de Contribución](CONTRIBUTING.md) — puesta en marcha, smoke test y convenciones.
* [`.env.example`](.env.example) — variables de entorno de configuración.

---

## 🛠️ Requisitos
* [Node.js](https://nodejs.org/) (Versión 18 o superior recomendada).

---

## 💻 Instalación y Configuración

Sigue estos pasos sencillos para poner en marcha el proyecto localmente o en un servidor de red:

1. **Instalar todas las dependencias** (servidor y cliente en un solo comando):
   ```bash
   npm run install-all
   ```

2. **Iniciar en modo desarrollo** (corre tanto la API Express como el cliente Vite en paralelo):
   ```bash
   npm run dev
   ```

3. **Acceder a la aplicación**:
   * Abre tu navegador en [http://localhost:3000](http://localhost:3000)

*Nota: La API del backend se ejecuta en el puerto `3001` y el frontend se comunica de manera transparente mediante un Proxy.*

---

## 🔒 Despliegue en Producción (Seguridad)

Por defecto, la aplicación arranca en **Modo Desarrollo** sin autenticación. Si vas a exponer el sistema en una red local o en internet, **debes activar la seguridad** usando variables de entorno (`.env` en la raíz):

```env
API_KEY=tu_contraseña_secreta_super_segura
ALLOWED_ORIGIN=https://tu-dominio-frontend.com
```

- `API_KEY`: Activa la autenticación en todos los endpoints de la API. En el frontend, deberás inyectar esta clave en `localStorage.setItem('apiKey', 'tu_contraseña_secreta_super_segura')` desde la consola del navegador (o adaptar la UI de React para pedirla).
- `ALLOWED_ORIGIN`: Restringe el acceso CORS. Por defecto es `http://localhost:3000`.

---

## 📁 Estructura del Proyecto

```
sqlite-spreadsheet-sync/
├── package.json          # Dependencias y scripts globales de ejecución
├── server.js             # API REST en Express para operaciones SQLite e Import/Export
├── database.js           # Módulo de base de datos SQLite y helpers relacionales
├── data.db               # Archivo físico de la base de datos SQLite (se genera auto)
└── frontend/             # Código fuente de la interfaz React + Vite
    ├── package.json      # Dependencias del cliente
    ├── vite.config.js    # Proxy de comunicación configurado
    ├── index.html        # Plantilla principal HTML
    └── src/
        ├── main.jsx      # Entrada de ejecución React
        ├── App.jsx       # Componentes de UI, modales y lógica de comunicación
        └── App.css       # Estilos premium, animaciones y temas oscuros
```

---

## 📝 Comandos Útiles

* **Instalar backend**: `npm install`
* **Instalar frontend**: `npm run install-frontend`
* **Iniciar backend solo**: `npm run server` (http://localhost:3001)
* **Iniciar frontend solo**: `npm run client` (http://localhost:3000)
* **Ejecutar todo junto (Recomendado)**: `npm run dev`
* **Servidor MCP (stdio)**: `npm run mcp` (ver [docs/MCP.md](docs/MCP.md))
