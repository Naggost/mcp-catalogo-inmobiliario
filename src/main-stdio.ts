/**
 * Transporte stdio, para clientes locales (Claude Desktop, Claude Code).
 * La identidad sale de MCP_TOKEN y pasa por la misma autenticación que el HTTP.
 * Nada se escribe en stdout salvo el protocolo: los avisos van a stderr y la auditoría, a su archivo.
 */
import { mkdirSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { cargarConfig } from "./config.ts";
import { crearServidor } from "./servidor.ts";

mkdirSync("datos", { recursive: true });
const config = cargarConfig();
const auth = config.identidades.autenticar(`Bearer ${process.env.MCP_TOKEN ?? ""}`);
if (!auth.ok) {
  config.auditoria.registrar({ identidad: null, accion: "autenticacion", resultado: "no-autenticado", detalle: { motivo: auth.motivo, transporte: "stdio" } });
  console.error(`MCP_TOKEN rechazado: ${auth.motivo}`);
  process.exit(1);
}
await crearServidor(auth.identidad, config).connect(new StdioServerTransport());
console.error(`MCP por stdio como ${auth.identidad.id} (${auth.identidad.permisos.join(", ")})`);
