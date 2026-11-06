/** Límite de pedidos por identidad, con ventana deslizante de un minuto. */
export interface Limitador {
  /** `true` si el pedido entra; si no, cuántos ms faltan para que entre. */
  permitir(clave: string): true | number;
}

export function crearLimitador(porMinuto: number, ahora: () => number = Date.now): Limitador {
  const ventana = 60_000;
  const historial = new Map<string, number[]>();
  return {
    permitir(clave) {
      const t = ahora();
      const recientes = (historial.get(clave) ?? []).filter((x) => t - x < ventana);
      if (recientes.length >= porMinuto) {
        historial.set(clave, recientes);
        return ventana - (t - recientes[0]);
      }
      recientes.push(t);
      historial.set(clave, recientes);
      return true;
    },
  };
}
