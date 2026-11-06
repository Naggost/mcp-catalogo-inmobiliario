/** Configuración desde variables de entorno. Ver `.env.example`. */
import { readFileSync } from "node:fs";
import { auditoriaEnArchivo } from "./auditoria.ts";
import { crearCatalogo } from "./catalogo.ts";
import { cargarIdentidades } from "./identidades.ts";
import { origenArchivo, origenConector } from "./origenes.ts";

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`falta la variable de entorno ${nombre}`);
  return v;
}

export function cargarConfig() {
  const origen = process.env.CONECTOR_URL
    ? origenConector(process.env.CONECTOR_URL, requerida("CONECTOR_CLAVE"))
    : origenArchivo(
        process.env.CATALOGO_ARCHIVO ?? "ejemplos/catalogo.json",
        process.env.CONSULTAS_ARCHIVO ?? "datos/consultas-demo.jsonl",
      );
  return {
    origen,
    catalogo: crearCatalogo(origen, { ttlMs: Number(process.env.CATALOGO_TTL_MS ?? 60_000) }),
    identidades: cargarIdentidades(JSON.parse(readFileSync(requerida("IDENTIDADES_ARCHIVO"), "utf8"))),
    auditoria: auditoriaEnArchivo(process.env.AUDITORIA_ARCHIVO ?? "datos/auditoria.jsonl"),
    puerto: Number(process.env.PUERTO ?? 3200),
    host: process.env.HOST ?? "127.0.0.1",
    pedidosPorMinuto: Number(process.env.PEDIDOS_POR_MINUTO ?? 60),
  };
}
