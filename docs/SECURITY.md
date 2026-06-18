# Modelo de Seguridad

Este documento resume las defensas implementadas y los límites conocidos. La base de código pasó una auditoría de seguridad con remediaciones verificadas contra el backend real.

## Defensas implementadas

| Área | Mitigación |
|---|---|
| **Inyección SQL (datos)** | Todas las consultas con valores de usuario usan parámetros (`?`). El *upsert* de import valida `upsertKey` contra `^[a-zA-Z0-9_-]+$` y parametriza el valor. |
| **Inyección SQL (identificadores)** | Nombres de tabla/columna validados con `^[a-zA-Z0-9_-]+$`. Tipos de columna restringidos a un whitelist cerrado (`TEXT, INTEGER, REAL, BLOB, NUMERIC`). |
| **Corrupción de datos** | Validación estricta de tipos en el backend (API y MCP): texto no numérico en columnas numéricas → error. |
| **SSRF (webhooks)** | Al registrar un webhook se rechazan URLs no `http(s)` o hacia hosts privados/locales. Los disparos llevan `AbortSignal.timeout(5000)`. |
| **Autenticación** | API Key opcional vía header `x-api-key`, activada con la env `API_KEY`. |
| **CSRF / orígenes cruzados** | CORS restringido a `ALLOWED_ORIGIN` (no comodín `*`). |

Detalle de rangos privados bloqueados para webhooks: `localhost`, `*.localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`, `169.254.0.0/16`, `0.0.0.0`, `::1`, `::`.

## Configuración para producción

Define un `.env` (ver [`.env.example`](../.env.example)):
```env
API_KEY=<clave-larga-y-aleatoria>
ALLOWED_ORIGIN=https://tu-frontend.com
```
En el frontend, registra la clave con `localStorage.setItem('apiKey', '<clave>')` (o adapta la UI para pedirla).

## Límites conocidos (hardening de despliegue)

Estos puntos **no son bugs de código**, sino responsabilidades de la capa de infraestructura/operación:

1. **Auth deshabilitada por defecto.** Sin `API_KEY` definida, la API queda abierta. En producción es obligatorio definirla.
2. **Sin HTTPS, rate-limiting ni protección anti-DNS-rebinding** a nivel de app. Se delega en un reverse proxy (Nginx/Caddy/Cloudflare) o red aislada (Docker).
3. **SSRF por IP literal.** El bloqueo es por rango de IP; un hostname público que resuelva a una IP interna (DNS rebinding) no se detecta.
4. **Webhooks ya almacenados no se re-validan.** La validación SSRF aplica solo en el registro, no a los que ya están en la base.
5. **MCP `execute_sql_query`** acepta SQL del cliente (solo lectura) sin parametrizar: superficie de confianza.

## Reporte de vulnerabilidades

Si encuentras un problema de seguridad, abre un *issue* privado o contacta al mantenedor antes de divulgarlo públicamente.
