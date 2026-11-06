/**
 * Catálogo en memoria con caché y frenos de seguridad.
 *
 * - Se refresca del origen cuando el dato tiene más de `ttlMs`.
 * - Si el origen falla o manda un feed rechazado, se sigue sirviendo el último catálogo bueno
 *   mientras no supere `maxAntiguedadMs`. Pasado eso, se corta: mejor un error claro que datos viejos.
 * - Si el catálogo nuevo trae menos de la mitad de propiedades que el anterior, no se aplica.
 *   Una caída así casi siempre es un error del origen, no la realidad del negocio.
 */
import { validarFeed, FeedRechazado, type InformeCalidad, type ItemFeed } from "./feed.ts";
import { aPublico, type PropiedadPublica } from "./publico.ts";

export interface Origen {
  /** Devuelve el feed crudo, sin validar. */
  leerCatalogo(): Promise<unknown>;
  /** Deja una consulta en el sistema del negocio. Devuelve el id que le asignó. */
  crearConsulta(c: { externalId: string | null; nombre: string; telefono: string | null; mensaje: string }): Promise<string>;
}

export interface EstadoCatalogo {
  actualizadoEn: string | null;
  antiguedadMs: number | null;
  ultimoError: string | null;
  informe: InformeCalidad | null;
}

export interface Catalogo {
  propiedades(): Promise<PropiedadPublica[]>;
  porReferencia(referencia: string): Promise<PropiedadPublica | null>;
  /** Id interno para mandarle acciones al origen. Nunca se le muestra al modelo. */
  idInterno(referencia: string): Promise<string | null>;
  estado(): EstadoCatalogo;
}

export const FRACCION_MINIMA_RESPECTO_ANTERIOR = 0.5;

export function crearCatalogo(
  origen: Origen,
  opciones: { ttlMs?: number; maxAntiguedadMs?: number; ahora?: () => number } = {},
): Catalogo {
  const ttlMs = opciones.ttlMs ?? 60_000;
  const maxAntiguedadMs = opciones.maxAntiguedadMs ?? 30 * 60_000;
  const ahora = opciones.ahora ?? Date.now;

  let items: ItemFeed[] | null = null;
  let actualizadoEn = 0;
  let informe: InformeCalidad | null = null;
  let ultimoError: string | null = null;
  let enCurso: Promise<void> | null = null;

  async function refrescar(): Promise<void> {
    try {
      const resultado = validarFeed(await origen.leerCatalogo());
      if (items && resultado.items.length < items.length * FRACCION_MINIMA_RESPECTO_ANTERIOR) {
        throw new FeedRechazado(
          `el catálogo bajó de ${items.length} a ${resultado.items.length} propiedades de golpe: no se aplica`,
        );
      }
      items = resultado.items;
      informe = resultado.informe;
      actualizadoEn = ahora();
      ultimoError = null;
    } catch (err) {
      ultimoError = err instanceof Error ? err.message : String(err);
    }
  }

  async function vigentes(): Promise<ItemFeed[]> {
    if (!items || ahora() - actualizadoEn > ttlMs) {
      enCurso ??= refrescar().finally(() => (enCurso = null));
      await enCurso;
    }
    if (!items) throw new Error(`catálogo no disponible: ${ultimoError ?? "sin datos"}`);
    if (ahora() - actualizadoEn > maxAntiguedadMs) {
      throw new Error(`catálogo desactualizado hace más de ${Math.round(maxAntiguedadMs / 60_000)} min: ${ultimoError}`);
    }
    return items;
  }

  return {
    async propiedades() {
      return (await vigentes()).map(aPublico);
    },
    async porReferencia(referencia) {
      const item = (await vigentes()).find((i) => i.reference === referencia.toUpperCase());
      return item ? aPublico(item) : null;
    },
    async idInterno(referencia) {
      return (await vigentes()).find((i) => i.reference === referencia.toUpperCase())?.externalId ?? null;
    },
    estado() {
      return {
        actualizadoEn: items ? new Date(actualizadoEn).toISOString() : null,
        antiguedadMs: items ? ahora() - actualizadoEn : null,
        ultimoError,
        informe,
      };
    },
  };
}
