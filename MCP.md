# Servidor MCP de RunAnalyzer

Servidor **MCP remoto** (Streamable HTTP + OAuth 2.1) que expone los datos de
entrenamiento que la app ya guarda en Supabase (`user_storage`). Diseñado para
enlazarse como **conector** tanto en **Claude** como en **ChatGPT**.

Vive dentro de las funciones serverless de Vercel del propio proyecto, así que se
despliega con la app: no hay servicio aparte que mantener.

## Qué expone

| Tool | Descripción |
|------|-------------|
| `list_activities` | Lista de actividades Strava (resumen) con filtros `from/to/sport/only_running/min_distance_km/max_distance_km/hr_min/hr_max/flat_only/hr_source` y paginación. |
| `get_activity` | Detalle completo: parciales, splits por km, best efforts, tramos llanos (`flat_efforts`), polyline, **desacoplamiento** (deriva cardíaca) y **GAP**; si la carrera está correlacionada con Garmin: **origen de FC** (banda/muñeca), **laps reales** con tipo INTERVAL/REST, potencia y balance por lap, **WBGT** y running dynamics. |
| `activity_stats` | Agregados de un rango: total km, tiempo, desnivel y desglose por tipo. |
| `list_running_dynamics` | Running dynamics de Garmin por carrera (cadencia, GCT, oscilación/ratio vertical, zancada, potencia, carga, training effect, VO2max) y **origen de FC**, fusionadas con Strava, **con medias del periodo** para agregar. |
| `list_hrv_resting` | VFC nocturna + FC reposo por día (Garmin), con Body Battery si existe. |
| `list_sleep` | Sueño semanal (Garmin): duración, fases y score. |
| `get_training_load_model` | Modelo de Banister: serie diaria CTL/ATL/TSB con rampa semanal (desde `training_load` de Garmin). |
| `get_health_alerts` | Alertas de patrón (firma de infección/sobrecarga): Body Battery bajo o VFC↓ con FC reposo↑. |
| `detect_threshold_efforts` | Detecta tests de umbral (bloque ≥88% FCmax) → LTHR y ritmo umbral, con bandera de estabilización de FC. |
| `search` / `fetch` | Contrato de conectores de ChatGPT (buscar actividades → recuperar documento). |

**Nunca** se exponen credenciales: el MCP solo lee `stravaData.activities`,
`garmin_cardiac_data`, `garmin_sleep_data` y `garmin_activities`. Ni `garmin_creds`
ni el `accessToken` de Strava salen del servidor.

### Running dynamics de Garmin (banda)

`get_activity` y `list_running_dynamics` incluyen los datos de la banda (cadencia,
tiempo de contacto con el suelo, oscilación/ratio vertical, longitud de zancada,
potencia, training effect, VO2max). Se obtienen así:

1. En la app, al sincronizar Garmin (panel de FC/VFC), además de la salud se
   descargan las **actividades con running dynamics** (`/api/garmin/activities`) y
   se guardan en `user_storage` bajo `garmin_activities`.
2. El MCP correlaciona cada actividad de Garmin con la de Strava por **hora de
   inicio** (±3 min) y adjunta las dynamics a esa carrera.

Por tanto, para que aparezcan, hay que haber sincronizado Garmin en la app. Las
carreras sin coincidencia salen con `has_garmin: false` y sin bloque `garmin`.

Además, al sincronizar se **enriquecen las carreras más recientes** con su detalle
(`activity-service/activity/{id}` + `/splits` + `/weather`): de ahí salen el **origen
de FC** (`hr_source`: banda/muñeca), los **laps reales** con su tipo (INTERVAL/REST…),
la potencia y el balance L/D por lap, y el **WBGT** con la penalización por calor. Estos
campos solo aparecen tras **re-sincronizar Garmin** (los caches antiguos no los tienen).

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
`client_id` son JWT firmados con `MCP_JWT_SECRET`. La identidad real la valida
**Supabase Auth** en `/api/oauth/authorize`, con dos vías:

- **Google** (igual que la app): botón que reutiliza el Google OAuth ya
  configurado en Supabase; al volver, el token de Supabase se canjea por el code.
- **Email + contraseña** (para cuentas que tengan contraseña de Supabase).

El `user_id` resultante viaja dentro del token y el MCP lo usa para leer solo las
filas de ese usuario. El access token vive 1 h; el refresh, 30 días. Los codes son
single-use (tabla `oauth_used_codes`).

### Configuración necesaria para el login con Google

En Supabase → **Authentication → URL Configuration → Redirect URLs**, añade la URL
del authorize del conector para que Supabase acepte devolver ahí la sesión:

```
https://TU-DOMINIO/api/oauth/authorize
```

(o un comodín `https://TU-DOMINIO/**`). El proveedor Google ya debe estar activo,
que lo está porque la app lo usa.

## Notas

- Modo **stateless**: cada petición crea su propio server+transport, ideal para
  serverless (sin almacén de sesión compartido).
- `stravaData` puede pesar varios MB: `list_activities` pagina (50 por defecto,
  tope 200) y `get_activity` sirve una sola actividad para no saturar el contexto.
- Para el detalle temporal punto a punto (streams de FC/altitud) haría falta el
  token de Strava; hoy el MCP sirve lo cacheado en DB (incluido `flat_efforts`).
