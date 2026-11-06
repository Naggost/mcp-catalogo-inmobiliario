# mcp-catalogo-inmobiliario

Servidor [MCP](https://modelcontextprotocol.io) que da a agentes de IA acceso al catálogo de una inmobiliaria: **cada identidad ve solo las herramientas que tiene permitidas, cada llamada queda auditada sin datos personales y el feed de datos pasa por un control de calidad antes de llegarle al modelo.**

> **EN:** An MCP server that exposes a real-estate catalog to AI agents with per-identity, scope-based tool access (tools are filtered at `tools/list` and re-checked on every call), hashed bearer tokens, PII-free audit logging, rate limiting, and a validated, quality-checked data feed with safety brakes. TypeScript, official MCP SDK, Streamable HTTP and stdio. 27 tests, including end-to-end tests with the official MCP client.

Está pensado para el conector que ya funciona en producción en la web de [Veta Inmobiliaria](https://vetainmobiliaria.com) (`/api/asistente/catalogo` y `/api/asistente/acciones`). El repo trae un catálogo de ejemplo con datos inventados, así que se puede probar sin acceso a nada real.

## Qué resuelve

Conectar un agente a los datos de un negocio tiene tres riesgos: que vea más de lo que debe, que haga algo que no le corresponde y que responda con datos rotos. Cada uno tiene su control:

| Riesgo | Control |
|---|---|
| Ver de más | Lista de campos permitidos: la dirección exacta y los ids de anuncios nunca llegan al modelo, y un campo nuevo del feed no pasa hasta que alguien lo habilita. |
| Hacer de más | Permisos por identidad (`catalogo:leer`, `consultas:crear`, `calidad:leer`). El servidor se arma por pedido con solo las herramientas permitidas, y cada herramienta vuelve a chequear el permiso antes de ejecutar. |
| Datos rotos | El feed se valida ítem por ítem con Zod. Un ítem roto se descarta y se informa; el feed entero se rechaza si cambia la versión, llega vacío o se descarta más de la mitad. Un catálogo que cae a menos de la mitad de golpe no se aplica. |
| No saber quién hizo qué | Auditoría en JSON Lines: identidad, herramienta, resultado y duración. Nombre, teléfono y mensaje se guardan solo como largo. |
| Abuso | Límite de pedidos por identidad (429 con `Retry-After`). |

## Herramientas

| Herramienta | Permiso | Qué hace |
|---|---|---|
| `buscar_propiedades` | `catalogo:leer` | Filtra por operación, tipo, zona (sin importar tildes) y dormitorios. Hasta 10 resultados. Solo lectura. |
| `ver_propiedad` | `catalogo:leer` | Detalle público por referencia (`VT-XXXXXX`). Solo lectura. |
| `registrar_consulta` | `consultas:crear` | Deja una consulta para que la conteste una persona. Traduce la referencia al id interno sin mostrárselo al modelo. |
| `estado_catalogo` | `calidad:leer` | Última actualización, ítems descartados con su motivo y último error del origen. |

## Identidades

Cada cliente tiene su propio token. El servidor guarda solo el hash SHA-256, compara en tiempo constante y soporta vencimiento y baja:

```bash
node scripts/crear-token.ts agente-ventas "Agente de ventas" catalogo:leer consultas:crear
```

El token se muestra una sola vez; la salida trae la entrada para el registro (`IDENTIDADES_ARCHIVO`).

## Uso

Requiere Node 24 (corre TypeScript directo, sin compilar).

```bash
npm install
npm test            # 27 pruebas
npm run check       # tipos

# HTTP (Streamable HTTP, sin sesiones) en http://127.0.0.1:3200/mcp
IDENTIDADES_ARCHIVO=datos/identidades.json npm run http

# stdio, para Claude Desktop o Claude Code
IDENTIDADES_ARCHIVO=datos/identidades.json MCP_TOKEN=mcp_... npm run stdio
```

Sin `CONECTOR_URL` usa `ejemplos/catalogo.json`; con `CONECTOR_URL` y `CONECTOR_CLAVE` lee el conector real. Las variables están en `.env.example`.

## Pruebas

`node --test`, 27 casos:
- **Feed:** versión, feed vacío, ítem roto que se descarta con su motivo, rechazo si se descarta más de la mitad, referencias duplicadas, campos que no deben llegar al modelo.
- **Identidades:** token válido, inventado, vencido, dado de baja; registro con permisos desconocidos o ids repetidos.
- **Catálogo:** caché, origen caído (sigue con el último bueno), corte por antigüedad, freno ante una caída brusca del catálogo, una sola lectura con pedidos simultáneos.
- **Punta a punta** con el cliente oficial del SDK sobre HTTP: herramientas filtradas por identidad, permiso denegado aunque se llame por nombre, consulta registrada con auditoría sin datos personales, argumentos inválidos, 401 y 429.

## Próximos pasos

- Autorización con OAuth 2.1 según la especificación de MCP, con un proveedor de identidad externo (por ejemplo Microsoft Entra ID), en lugar de tokens propios.
- Exportar la auditoría a un sistema central en vez de un archivo local.
- Desplegarlo junto al conector de Veta.

## Licencia

MIT
