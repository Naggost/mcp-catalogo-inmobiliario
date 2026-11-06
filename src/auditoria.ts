/**
 * Registro de auditoría: una línea JSON por evento (autenticación fallida, permiso denegado, cada llamada
 * a una herramienta). Guarda quién, qué, cuándo, cuánto tardó y cómo terminó.
 *
 * Los datos personales no se guardan: de nombre, teléfono y mensaje queda solo el largo.
 */
import { appendFileSync } from "node:fs";

export type Resultado = "ok" | "error" | "denegado" | "no-autenticado" | "limite";

export interface Evento {
  identidad: string | null;
  accion: string;
  resultado: Resultado;
  ms?: number;
  detalle?: Record<string, unknown>;
}

export interface Auditoria {
  registrar(evento: Evento): void;
}

const CAMPOS_PERSONALES = new Set(["nombre", "telefono", "mensaje"]);

export function sinDatosPersonales(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) =>
      CAMPOS_PERSONALES.has(k) && typeof v === "string" ? [k, `[${v.length} caracteres]`] : [k, v],
    ),
  );
}

export function auditoriaEnArchivo(ruta: string): Auditoria {
  return {
    registrar(evento) {
      appendFileSync(ruta, `${JSON.stringify({ ts: new Date().toISOString(), ...evento })}\n`);
    },
  };
}

/** Para las pruebas: guarda los eventos en memoria. */
export function auditoriaEnMemoria(): Auditoria & { eventos: Array<Evento & { ts: string }> } {
  const eventos: Array<Evento & { ts: string }> = [];
  return {
    eventos,
    registrar(evento) {
      eventos.push({ ts: new Date().toISOString(), ...evento });
    },
  };
}
