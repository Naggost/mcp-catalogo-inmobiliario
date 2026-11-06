import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auditoriaEnMemoria } from "../src/auditoria.ts";
import { crearCatalogo, type Origen } from "../src/catalogo.ts";
import { crearServidorHttp } from "../src/http.ts";
import { cargarIdentidades, hashToken, nuevoToken, type Permiso } from "../src/identidades.ts";

export function feedEjemplo(): any {
  return JSON.parse(readFileSync(new URL("../ejemplos/catalogo.json", import.meta.url), "utf8"));
}

export function origenEnMemoria(feed: () => unknown = feedEjemplo) {
  const consultas: Array<Parameters<Origen["crearConsulta"]>[0]> = [];
  let lecturas = 0;
  const origen: Origen = {
    async leerCatalogo() {
      lecturas++;
      return feed();
    },
    async crearConsulta(c) {
      consultas.push(c);
      return `consulta-${consultas.length}`;
    },
  };
  return { origen, consultas, lecturas: () => lecturas };
}

/** Levanta el servidor HTTP en un puerto libre con tres identidades de prueba. */
export async function levantar(opciones: { pedidosPorMinuto?: number } = {}) {
  const tokens = { lector: nuevoToken(), operador: nuevoToken(), auditor: nuevoToken(), vencido: nuevoToken() };
  const entrada = (id: string, token: string, permisos: Permiso[], extra = {}) => ({
    id,
    nombre: `Prueba ${id}`,
    hash: hashToken(token),
    permisos,
    ...extra,
  });
  const identidades = cargarIdentidades({
    identidades: [
      entrada("lector", tokens.lector, ["catalogo:leer"]),
      entrada("operador", tokens.operador, ["catalogo:leer", "consultas:crear"]),
      entrada("auditor", tokens.auditor, ["calidad:leer"]),
      entrada("vencido", tokens.vencido, ["catalogo:leer"], { vence: "2020-01-01" }),
    ],
  });
  const memoria = origenEnMemoria();
  const auditoria = auditoriaEnMemoria();
  const http = crearServidorHttp({
    identidades,
    origen: memoria.origen,
    catalogo: crearCatalogo(memoria.origen),
    auditoria,
    pedidosPorMinuto: opciones.pedidosPorMinuto,
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;

  async function cliente(token: string) {
    const c = new Client({ name: "pruebas", version: "1.0.0" });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
    );
    return c;
  }

  return {
    url,
    tokens,
    auditoria,
    consultas: memoria.consultas,
    cliente,
    cerrar: () => new Promise<void>((r) => http.close(() => r())),
  };
}

export function textoDe(r: Record<string, unknown>): string {
  return (r.content as Array<{ type: string; text: string }>)[0].text;
}
