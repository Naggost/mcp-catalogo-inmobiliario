/**
 * El servidor MCP de una identidad.
 *
 * Se arma uno por pedido con solo las herramientas que esa identidad tiene permitidas, así que
 * `tools/list` ya viene filtrado. Igual, cada herramienta vuelve a comprobar el permiso antes de
 * ejecutar: si algún día se registra mal, el control sigue estando.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Auditoria } from "./auditoria.ts";
import { sinDatosPersonales } from "./auditoria.ts";
import type { Catalogo, Origen } from "./catalogo.ts";
import type { Identidad, Permiso } from "./identidades.ts";

export const VERSION = "0.1.0";
const MAX_RESULTADOS = 10;

export interface Dependencias {
  catalogo: Catalogo;
  origen: Origen;
  auditoria: Auditoria;
}

function texto(datos: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(datos, null, 2) }] };
}

function error(mensaje: string): CallToolResult {
  return { content: [{ type: "text", text: mensaje }], isError: true };
}

export function crearServidor(identidad: Identidad, deps: Dependencias): McpServer {
  const servidor = new McpServer(
    { name: "mcp-catalogo-inmobiliario", version: VERSION },
    {
      instructions:
        "Catálogo público de una inmobiliaria. Respondé solo con lo que devuelven las herramientas: " +
        "no inventes precios, superficies ni disponibilidad. Para dejar una consulta hace falta el " +
        "consentimiento de la persona.",
    },
  );

  const puede = (p: Permiso) => identidad.permisos.includes(p);

  /** Envuelve cada herramienta: vuelve a chequear el permiso, mide, audita y nunca filtra errores internos. */
  function auditada<A extends Record<string, unknown>>(
    nombre: string,
    permiso: Permiso,
    fn: (args: A) => Promise<CallToolResult>,
  ) {
    return async (args: A): Promise<CallToolResult> => {
      const inicio = performance.now();
      const detalle = sinDatosPersonales(args);
      if (!puede(permiso)) {
        deps.auditoria.registrar({ identidad: identidad.id, accion: nombre, resultado: "denegado", detalle });
        return error(`La identidad ${identidad.id} no tiene el permiso ${permiso}.`);
      }
      try {
        const r = await fn(args);
        deps.auditoria.registrar({
          identidad: identidad.id,
          accion: nombre,
          resultado: r.isError ? "error" : "ok",
          ms: Math.round(performance.now() - inicio),
          detalle,
        });
        return r;
      } catch (err) {
        deps.auditoria.registrar({
          identidad: identidad.id,
          accion: nombre,
          resultado: "error",
          ms: Math.round(performance.now() - inicio),
          detalle: { ...detalle, error: err instanceof Error ? err.message : String(err) },
        });
        return error("No se pudo completar la operación. Probá de nuevo en unos minutos.");
      }
    };
  }

  if (puede("catalogo:leer")) {
    servidor.registerTool(
      "buscar_propiedades",
      {
        title: "Buscar propiedades",
        description:
          "Busca en el catálogo público. Todos los filtros son opcionales. Devuelve hasta 10 resultados " +
          "resumidos; para el detalle completo usá ver_propiedad con la referencia.",
        inputSchema: {
          operacion: z.enum(["venta", "alquiler", "temporal"]).optional(),
          tipo: z.enum(["casa", "departamento", "duplex", "lote", "local", "oficina"]).optional(),
          zona: z.string().max(60).optional().describe("Barrio o ciudad, sin importar mayúsculas ni tildes"),
          dormitoriosMin: z.number().int().min(0).max(10).optional(),
          soloDisponibles: z.boolean().default(true),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      auditada("buscar_propiedades", "catalogo:leer", async (a) => {
        const normal = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        const encontradas = (await deps.catalogo.propiedades()).filter(
          (p) =>
            (!a.operacion || p.operacion === a.operacion) &&
            (!a.tipo || p.tipo === a.tipo) &&
            (!a.zona || normal(p.ubicacion).includes(normal(a.zona))) &&
            (a.dormitoriosMin === undefined || (p.dormitorios ?? 0) >= a.dormitoriosMin) &&
            (!a.soloDisponibles || p.estado === "disponible"),
        );
        return texto({
          total: encontradas.length,
          mostradas: Math.min(encontradas.length, MAX_RESULTADOS),
          propiedades: encontradas.slice(0, MAX_RESULTADOS).map((p) => ({
            referencia: p.referencia,
            titulo: p.titulo,
            estado: p.estado,
            operacion: p.operacion,
            tipo: p.tipo,
            precio: p.precio,
            ubicacion: p.ubicacion,
            dormitorios: p.dormitorios,
            url: p.url,
          })),
        });
      }),
    );

    servidor.registerTool(
      "ver_propiedad",
      {
        title: "Ver propiedad",
        description: "Detalle público de una propiedad por su referencia (por ejemplo VT-4F9K2A).",
        inputSchema: { referencia: z.string().regex(/^[A-Za-z]{2}-[A-Za-z0-9]{6}$/) },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      auditada("ver_propiedad", "catalogo:leer", async ({ referencia }) => {
        const p = await deps.catalogo.porReferencia(referencia);
        return p ? texto(p) : error(`No hay ninguna propiedad con la referencia ${referencia.toUpperCase()}.`);
      }),
    );
  }

  if (puede("consultas:crear")) {
    servidor.registerTool(
      "registrar_consulta",
      {
        title: "Registrar consulta",
        description:
          "Deja una consulta en el sistema de la inmobiliaria para que la conteste una persona. Usala solo " +
          "si la persona pidió que la contacten y dio su nombre.",
        inputSchema: {
          referencia: z.string().regex(/^[A-Za-z]{2}-[A-Za-z0-9]{6}$/).optional(),
          nombre: z.string().trim().min(1).max(120),
          telefono: z.string().regex(/^\+?[0-9 ()-]{6,25}$/).optional(),
          mensaje: z.string().trim().min(1).max(2000),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      auditada("registrar_consulta", "consultas:crear", async (a) => {
        let externalId: string | null = null;
        if (a.referencia) {
          externalId = await deps.catalogo.idInterno(a.referencia);
          if (!externalId) return error(`No hay ninguna propiedad con la referencia ${a.referencia.toUpperCase()}.`);
        }
        const id = await deps.origen.crearConsulta({
          externalId,
          nombre: a.nombre,
          telefono: a.telefono ?? null,
          mensaje: `${a.mensaje}\n\n(Consulta registrada por ${identidad.nombre} vía MCP)`,
        });
        return texto({ ok: true, idConsulta: id });
      }),
    );
  }

  if (puede("calidad:leer")) {
    servidor.registerTool(
      "estado_catalogo",
      {
        title: "Estado y calidad del catálogo",
        description: "Cuándo se actualizó el catálogo, qué ítems se descartaron del feed y por qué, y el último error.",
        // Esquema vacío a propósito: así el SDK le pasa (args, extra) al handler igual que en las demás.
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      auditada("estado_catalogo", "calidad:leer", async () => {
        await deps.catalogo.propiedades().catch(() => undefined);
        return texto(deps.catalogo.estado());
      }),
    );
  }

  return servidor;
}
