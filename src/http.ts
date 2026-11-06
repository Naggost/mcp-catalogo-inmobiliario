/**
 * Transporte HTTP (Streamable HTTP de MCP, sin sesiones).
 *
 * Orden de cada pedido a /mcp: autenticación → límite de pedidos → servidor armado para esa identidad.
 * Un pedido sin token válido nunca llega al servidor MCP.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Auditoria } from "./auditoria.ts";
import type { Catalogo, Origen } from "./catalogo.ts";
import type { RegistroIdentidades } from "./identidades.ts";
import { crearLimitador } from "./limite.ts";
import { crearServidor, VERSION } from "./servidor.ts";

const MAX_CUERPO = 1024 * 1024;

export interface OpcionesHttp {
  identidades: RegistroIdentidades;
  catalogo: Catalogo;
  origen: Origen;
  auditoria: Auditoria;
  pedidosPorMinuto?: number;
}

function json(res: ServerResponse, status: number, cuerpo: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(cuerpo));
}

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    total += (parte as Buffer).length;
    if (total > MAX_CUERPO) throw new Error("cuerpo demasiado grande");
    partes.push(parte as Buffer);
  }
  return JSON.parse(Buffer.concat(partes).toString("utf8"));
}

export function crearServidorHttp(op: OpcionesHttp): Server {
  const limitador = crearLimitador(op.pedidosPorMinuto ?? 60);

  return createServer(async (req, res) => {
    const ruta = new URL(req.url ?? "/", "http://localhost").pathname;

    if (ruta === "/salud" && req.method === "GET") {
      const e = op.catalogo.estado();
      return json(res, 200, { ok: true, version: VERSION, catalogoActualizadoEn: e.actualizadoEn });
    }
    if (ruta !== "/mcp") return json(res, 404, { error: "no encontrado" });
    // Sin sesiones: no hay stream de GET ni cierre con DELETE.
    if (req.method !== "POST") return json(res, 405, { error: "método no permitido" }, { allow: "POST" });

    const auth = op.identidades.autenticar(req.headers.authorization);
    if (!auth.ok) {
      op.auditoria.registrar({ identidad: null, accion: "autenticacion", resultado: "no-autenticado", detalle: { motivo: auth.motivo } });
      return json(res, 401, { error: "no autorizado" }, { "www-authenticate": 'Bearer realm="mcp"' });
    }
    const { identidad } = auth;

    const espera = limitador.permitir(identidad.id);
    if (espera !== true) {
      op.auditoria.registrar({ identidad: identidad.id, accion: "pedido", resultado: "limite" });
      return json(res, 429, { error: "demasiados pedidos" }, { "retry-after": String(Math.ceil(espera / 1000)) });
    }

    let cuerpo: unknown;
    try {
      cuerpo = await leerCuerpo(req);
    } catch {
      return json(res, 400, { error: "cuerpo inválido" });
    }

    const servidor = crearServidor(identidad, op);
    const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transporte.close();
      void servidor.close();
    });
    try {
      await servidor.connect(transporte);
      // El token no se reenvía a los handlers: solo quién es y qué puede hacer.
      const authInfo: AuthInfo = { token: "[oculto]", clientId: identidad.id, scopes: identidad.permisos };
      await transporte.handleRequest(Object.assign(req, { auth: authInfo }), res, cuerpo);
    } catch (err) {
      op.auditoria.registrar({
        identidad: identidad.id,
        accion: "pedido",
        resultado: "error",
        detalle: { error: err instanceof Error ? err.message : String(err) },
      });
      if (!res.headersSent) json(res, 500, { error: "error interno" });
    }
  });
}
