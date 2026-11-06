/**
 * Quién llama y qué puede hacer.
 *
 * Cada cliente (un agente, un asistente, una persona) tiene su propio token. El servidor guarda solo el
 * hash SHA-256 de cada token, nunca el token. Cada identidad tiene permisos, y el servidor arma para cada
 * pedido solo las herramientas que esa identidad puede usar: lo que no puede usar, ni siquiera lo ve.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const PERMISOS = ["catalogo:leer", "consultas:crear", "calidad:leer"] as const;
export type Permiso = (typeof PERMISOS)[number];

export interface Identidad {
  id: string;
  nombre: string;
  permisos: Permiso[];
}

const Registro = z.object({
  identidades: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{3,40}$/),
        nombre: z.string().min(1),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        permisos: z.array(z.enum(PERMISOS)).min(1),
        vence: z.iso.date().optional(),
        activa: z.boolean().default(true),
      }),
    )
    .min(1),
});

interface Entrada extends Identidad {
  hash: Buffer;
  vence: Date | null;
  activa: boolean;
}

export type ResultadoAuth =
  | { ok: true; identidad: Identidad }
  | { ok: false; motivo: "sin-token" | "token-invalido" | "vencido" | "desactivada" };

export interface RegistroIdentidades {
  autenticar(authorization: string | undefined | null, ahora?: Date): ResultadoAuth;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function nuevoToken(): string {
  return `mcp_${randomBytes(32).toString("base64url")}`;
}

export function cargarIdentidades(json: unknown): RegistroIdentidades {
  const datos = Registro.parse(json);
  const ids = new Set<string>();
  const entradas: Entrada[] = datos.identidades.map((e) => {
    if (ids.has(e.id)) throw new Error(`identidad repetida: ${e.id}`);
    ids.add(e.id);
    return {
      id: e.id,
      nombre: e.nombre,
      permisos: [...new Set(e.permisos)],
      hash: Buffer.from(e.hash, "hex"),
      // Vence al terminar el día indicado (UTC).
      vence: e.vence ? new Date(`${e.vence}T23:59:59.999Z`) : null,
      activa: e.activa,
    };
  });

  return {
    autenticar(authorization, ahora = new Date()) {
      const m = /^Bearer (\S+)$/.exec(authorization ?? "");
      if (!m) return { ok: false, motivo: "sin-token" };
      const recibido = createHash("sha256").update(m[1], "utf8").digest();
      // Se compara contra todas las entradas sin cortar antes, en tiempo constante.
      let encontrada: Entrada | null = null;
      for (const e of entradas) {
        if (timingSafeEqual(recibido, e.hash)) encontrada = e;
      }
      if (!encontrada) return { ok: false, motivo: "token-invalido" };
      if (!encontrada.activa) return { ok: false, motivo: "desactivada" };
      if (encontrada.vence && ahora > encontrada.vence) return { ok: false, motivo: "vencido" };
      const { id, nombre, permisos } = encontrada;
      return { ok: true, identidad: { id, nombre, permisos } };
    },
  };
}
