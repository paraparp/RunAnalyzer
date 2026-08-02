# Servidor MCP de RunAnalyzer

Servidor **MCP remoto** (Streamable HTTP + OAuth 2.1) que expone los datos de
entrenamiento que la app ya guarda en Supabase (`user_storage`). Diseñado para
enlazarse como **conector** tanto en **Claude** como en **ChatGPT**.

Vive dentro de las funciones serverless de Vercel del propio proyecto, así que se
despliega con la app: no hay servicio aparte que mantener.

## Qué expone

| Tool | Descripción |
|------|-------------|
| `list_activities` | Lista de actividades Strava (resumen) con filtros `from/to/sport/only_running/min_distance_km` y paginación. |
| `get_activity` | Detalle completo: parciales, splits por km, best efforts, tramos llanos (`flat_efforts`) y polyline. |
| `activity_stats` | Agregados de un rango: total km, tiempo, desnivel y desglose por tipo. |
| `list_hrv_resting` | VFC nocturna + FC reposo por día (Garmin), con Body Battery si existe. |
| `list_sleep` | Sueño semanal (Garmin): duración, fases y score. |
| `search` / `fetch` | Contrato de conectores de ChatGPT (buscar actividades → recuperar documento). |

**Nunca** se exponen credenciales: el MCP solo lee `stravaData.activities`,
`garmin_cardiac_data` y `garmin_sleep_data`. Ni `garmin_creds` ni el `accessToken`
de Strava salen del servidor.

## Puesta en marcha

### 1. Variables de entorno (Vercel → Project → Settings → Environment Variables)

```
SUPABASE_SERVICE_ROLE_KEY=<service_role de Supabase>   # Database → Settings → API
MCP_JWT_SECRET=<cadena aleatoria larga>                 # openssl rand -base64 48
```

Ya deben existir `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (los reutiliza el
login OAuth). No hay que crear ninguna tabla nueva. Ver `.env.example`.

### 2. Desplegar

`git push` a la rama conectada con Vercel. Endpoints publicados:

- `POST /api/mcp` — el servidor MCP (Streamable HTTP).
- `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server` — descubrimiento OAuth.
- `/api/oauth/register`, `/api/oauth/authorize`, `/api/oauth/token` — flujo OAuth 2.1 (PKCE + registro dinámico).

La URL del conector es: **`https://TU-DOMINIO/api/mcp`**

## Conectar en Claude

1. Settings → **Connectors** → *Add custom connector*.
2. URL: `https://TU-DOMINIO/api/mcp`.
3. Claude descubre el OAuth solo, abre la pantalla de login (email + contraseña de
   tu cuenta RunAnalyzer/Supabase) y al autorizar queda enlazado.

## Conectar en ChatGPT

1. Settings → **Connectors** (o *Developer mode* → *Add MCP server*).
2. URL: `https://TU-DOMINIO/api/mcp`, autenticación **OAuth**.
3. Login con las mismas credenciales y autorizar.

ChatGPT usa `search`/`fetch` para navegar; el resto de tools quedan disponibles en
modo desarrollador.

## Cómo funciona la autenticación

OAuth 2.1 **sin estado**: authorization codes, access/refresh tokens y el propio
`client_id` son JWT firmados con `MCP_JWT_SECRET` (no requieren tablas). La
identidad real la valida **Supabase Auth** (email+password) en `/api/oauth/authorize`;
el `user_id` resultante viaja dentro del token y el MCP lo usa para leer solo las
filas de ese usuario. El access token vive 1 h; el refresh, 30 días.

## Notas

- Modo **stateless**: cada petición crea su propio server+transport, ideal para
  serverless (sin almacén de sesión compartido).
- `stravaData` puede pesar varios MB: `list_activities` pagina (50 por defecto,
  tope 200) y `get_activity` sirve una sola actividad para no saturar el contexto.
- Para el detalle temporal punto a punto (streams de FC/altitud) haría falta el
  token de Strava; hoy el MCP sirve lo cacheado en DB (incluido `flat_efforts`).
