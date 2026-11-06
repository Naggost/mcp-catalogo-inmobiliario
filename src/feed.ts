/**
 * Contrato del feed que entrega el conector de la web (versión 1) y control de calidad.
 *
 * El feed se valida ítem por ítem: un ítem roto se descarta y queda en el informe, pero no tira
 * abajo el resto. El feed entero se rechaza cuando el problema es del origen y no de un ítem:
 * versión distinta, cero ítems válidos o más de la mitad descartada.
 */
import { z } from "zod";

export const VERSION_ESPERADA = 1;
/** Si se descarta más de esta fracción de ítems, el problema es del origen: se rechaza el feed. */
export const MAX_FRACCION_DESCARTADA = 0.5;

const Foto = z.object({ url: z.url(), categoria: z.string() });

/** Lo que el servidor acepta de cada ítem. Lo que no está acá se descarta al parsear. */
export const ItemFeed = z.object({
  externalId: z.string().min(1),
  reference: z.string().regex(/^[A-Z]{2}-[A-Z0-9]{6}$/),
  status: z.enum(["available", "reserved", "unavailable"]),
  title: z.string().min(1),
  url: z.url(),
  data: z.object({
    operacion: z.enum(["VENTA", "ALQUILER", "TEMPORAL"]),
    tipo: z.enum(["CASA", "DEPARTAMENTO", "DUPLEX", "LOTE", "LOCAL", "OFICINA"]),
    precio: z.object({
      monto: z.number().nonnegative(),
      moneda: z.enum(["USD", "ARS"]),
      texto: z.string().min(1),
    }),
    expensas: z.object({ monto: z.number().nonnegative(), texto: z.string() }).nullable(),
    barrio: z.string().min(1),
    ciudad: z.string().min(1),
    provincia: z.string().min(1),
    dormitorios: z.number().int().nonnegative().nullable(),
    banios: z.number().int().nonnegative().nullable(),
    superficieCubierta: z.number().nonnegative().nullable(),
    superficieTotal: z.number().nonnegative().nullable(),
    amenities: z.array(z.string()),
    descripcion: z.string(),
    fotos: z.array(Foto),
    actualizada: z.iso.datetime(),
  }),
});
export type ItemFeed = z.infer<typeof ItemFeed>;

const Sobre = z.object({
  version: z.number().int(),
  generatedAt: z.iso.datetime(),
  items: z.array(z.unknown()),
});

export interface Descarte {
  indice: number;
  referencia: string | null;
  motivo: string;
}

export interface InformeCalidad {
  generadoEn: string;
  recibidos: number;
  validos: number;
  descartados: Descarte[];
  referenciasDuplicadas: string[];
}

export class FeedRechazado extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "FeedRechazado";
  }
}

function motivoLegible(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(ítem)"}: ${i.message}`)
    .join("; ");
}

export function validarFeed(crudo: unknown): { items: ItemFeed[]; informe: InformeCalidad } {
  const sobre = Sobre.safeParse(crudo);
  if (!sobre.success) throw new FeedRechazado(`formato del feed inválido: ${motivoLegible(sobre.error)}`);
  if (sobre.data.version !== VERSION_ESPERADA) {
    throw new FeedRechazado(`versión ${sobre.data.version} no soportada (se espera ${VERSION_ESPERADA})`);
  }

  const items: ItemFeed[] = [];
  const descartados: Descarte[] = [];
  const vistas = new Set<string>();
  const duplicadas = new Set<string>();

  sobre.data.items.forEach((crudoItem, indice) => {
    const r = ItemFeed.safeParse(crudoItem);
    if (!r.success) {
      const ref = (crudoItem as { reference?: unknown })?.reference;
      descartados.push({ indice, referencia: typeof ref === "string" ? ref : null, motivo: motivoLegible(r.error) });
      return;
    }
    if (vistas.has(r.data.reference)) {
      duplicadas.add(r.data.reference);
      descartados.push({ indice, referencia: r.data.reference, motivo: "referencia duplicada" });
      return;
    }
    vistas.add(r.data.reference);
    items.push(r.data);
  });

  const recibidos = sobre.data.items.length;
  if (items.length === 0) throw new FeedRechazado(`el feed no trae ningún ítem válido (recibidos: ${recibidos})`);
  if (descartados.length / recibidos > MAX_FRACCION_DESCARTADA) {
    throw new FeedRechazado(`se descartaron ${descartados.length} de ${recibidos} ítems: el origen parece roto`);
  }

  return {
    items,
    informe: {
      generadoEn: sobre.data.generatedAt,
      recibidos,
      validos: items.length,
      descartados,
      referenciasDuplicadas: [...duplicadas],
    },
  };
}
