/**
 * De dónde sale el catálogo:
 * - `origenConector`: el conector HTTP de la web del negocio (GET catálogo, POST acciones), con clave Bearer.
 * - `origenArchivo`: un JSON local, para la demo y las pruebas. Las consultas quedan en un archivo.
 */
import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Origen } from "./catalogo.ts";

const TIMEOUT_MS = 15_000;

export function origenConector(baseUrl: string, clave: string): Origen {
  const base = baseUrl.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${clave}`, "content-type": "application/json" };

  async function pedir(ruta: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${base}${ruta}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    // El cuerpo de un error puede traer detalles internos del origen: no se propaga, solo el código.
    if (!res.ok) throw new Error(`el conector respondió ${res.status} en ${ruta}`);
    return res.json();
  }

  return {
    leerCatalogo: () => pedir("/api/asistente/catalogo"),
    async crearConsulta(c) {
      const r = (await pedir("/api/asistente/acciones", {
        method: "POST",
        body: JSON.stringify({
          action: "create_inquiry",
          externalId: c.externalId,
          name: c.nombre,
          phone: c.telefono,
          message: c.mensaje,
        }),
      })) as { ok?: boolean; id?: string };
      if (!r.ok || typeof r.id !== "string") throw new Error("el conector no confirmó la consulta");
      return r.id;
    },
  };
}

export function origenArchivo(rutaCatalogo: string, rutaConsultas: string): Origen {
  return {
    async leerCatalogo() {
      return JSON.parse(await readFile(rutaCatalogo, "utf8"));
    },
    async crearConsulta(c) {
      const id = randomUUID();
      await appendFile(rutaConsultas, `${JSON.stringify({ id, fecha: new Date().toISOString(), ...c })}\n`);
      return id;
    },
  };
}
