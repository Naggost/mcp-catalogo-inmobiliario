/**
 * Lo que ve el modelo de cada propiedad. Es una lista de campos permitidos, no de campos prohibidos:
 * si el feed suma un campo nuevo, no llega al modelo hasta que alguien lo agregue acá.
 *
 * Fuera a propósito: la dirección exacta (se da solo al confirmar una visita) y los ids de anuncios.
 * El id de la base no va como campo: el modelo trabaja con la referencia corta (aunque ese id ya es
 * parte del link público de la ficha, no se le da como algo para operar).
 */
import type { ItemFeed } from "./feed.ts";

const MAX_DESCRIPCION = 1500;
const MAX_FOTOS = 4;

export interface PropiedadPublica {
  referencia: string;
  titulo: string;
  estado: "disponible" | "reservada" | "no disponible";
  operacion: string;
  tipo: string;
  precio: string;
  expensas: string | null;
  ubicacion: string;
  dormitorios: number | null;
  banios: number | null;
  superficieCubiertaM2: number | null;
  superficieTotalM2: number | null;
  amenities: string[];
  descripcion: string;
  fotos: string[];
  url: string;
  actualizada: string;
}

const ESTADO = { available: "disponible", reserved: "reservada", unavailable: "no disponible" } as const;

export function aPublico(item: ItemFeed): PropiedadPublica {
  const d = item.data;
  const descripcion =
    d.descripcion.length > MAX_DESCRIPCION ? `${d.descripcion.slice(0, MAX_DESCRIPCION).trimEnd()}…` : d.descripcion;
  return {
    referencia: item.reference,
    titulo: item.title,
    estado: ESTADO[item.status],
    operacion: d.operacion.toLowerCase(),
    tipo: d.tipo.toLowerCase(),
    precio: d.precio.texto,
    expensas: d.expensas?.texto ?? null,
    ubicacion: `${d.barrio}, ${d.ciudad}, ${d.provincia}`,
    dormitorios: d.dormitorios,
    banios: d.banios,
    superficieCubiertaM2: d.superficieCubierta,
    superficieTotalM2: d.superficieTotal,
    amenities: d.amenities,
    descripcion,
    fotos: d.fotos.slice(0, MAX_FOTOS).map((f) => f.url),
    url: item.url,
    actualizada: d.actualizada,
  };
}
