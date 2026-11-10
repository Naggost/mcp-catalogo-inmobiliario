/** Punta a punta: servidor HTTP real y el cliente oficial del SDK de MCP. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { levantar, textoDe } from "./apoyo.ts";

let s: Awaited<ReturnType<typeof levantar>>;
before(async () => (s = await levantar()));
after(async () => s.cerrar());

const nombres = async (token: string) => {
  const c = await s.cliente(token);
  const lista = (await c.listTools()).tools.map((t) => t.name).sort();
  await c.close();
  return lista;
};

test("cada identidad ve solo las herramientas de sus permisos", async () => {
  assert.deepEqual(await nombres(s.tokens.lector), ["buscar_propiedades", "ver_propiedad"]);
  assert.deepEqual(await nombres(s.tokens.operador), ["buscar_propiedades", "registrar_consulta", "ver_propiedad"]);
  assert.deepEqual(await nombres(s.tokens.auditor), ["estado_catalogo"]);
});

test("las herramientas de lectura se marcan como de solo lectura", async () => {
  const c = await s.cliente(s.tokens.operador);
  const { tools } = await c.listTools();
  await c.close();
  assert.equal(tools.find((t) => t.name === "buscar_propiedades")?.annotations?.readOnlyHint, true);
  assert.equal(tools.find((t) => t.name === "registrar_consulta")?.annotations?.readOnlyHint, false);
});

test("cada herramienta declara las cuatro pistas, y registrar_consulta no se marca como repetible", async () => {
  const herramientas = [];
  for (const token of [s.tokens.operador, s.tokens.auditor]) {
    const c = await s.cliente(token);
    herramientas.push(...(await c.listTools()).tools);
    await c.close();
  }
  assert.equal(herramientas.length, 4);
  for (const t of herramientas) {
    for (const pista of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
      assert.equal(typeof t.annotations?.[pista], "boolean", `${t.name} sin ${pista}`);
    }
  }
  // Cada llamada crea una consulta nueva: si un cliente la reintentara creyéndola idempotente, la duplicaría.
  assert.equal(herramientas.find((t) => t.name === "registrar_consulta")?.annotations?.idempotentHint, false);
});

test("buscar filtra por operación, zona sin tildes y disponibilidad", async () => {
  const c = await s.cliente(s.tokens.lector);
  const r = JSON.parse(textoDe(await c.callTool({ name: "buscar_propiedades", arguments: { operacion: "venta", zona: "cordoba" } })));
  await c.close();
  // La reservada (VT-G7H8J9) queda afuera por defecto. El lote de Mendiolaza entra por la provincia.
  assert.deepEqual(r.propiedades.map((p: { referencia: string }) => p.referencia).sort(), ["VT-A1B2C3", "VT-K1M2N3"]);
});

test("ver_propiedad devuelve el detalle sin la dirección exacta", async () => {
  const c = await s.cliente(s.tokens.lector);
  const texto = textoDe(await c.callTool({ name: "ver_propiedad", arguments: { referencia: "vt-a1b2c3" } }));
  const noExiste = await c.callTool({ name: "ver_propiedad", arguments: { referencia: "VT-ZZZZZZ" } });
  await c.close();
  assert.equal(JSON.parse(texto).referencia, "VT-A1B2C3");
  assert.doesNotMatch(texto, /Calle Ejemplo/);
  assert.equal(noExiste.isError, true);
});

test("el lector no puede registrar consultas aunque llame la herramienta por nombre", async () => {
  const c = await s.cliente(s.tokens.lector);
  const r = await c.callTool({ name: "registrar_consulta", arguments: { nombre: "Ana", mensaje: "Hola" } });
  await c.close();
  assert.equal(r.isError, true);
  assert.equal(s.consultas.length, 0);
});

test("el operador registra una consulta: llega con el id interno y la auditoría no guarda datos personales", async () => {
  const c = await s.cliente(s.tokens.operador);
  const r = await c.callTool({
    name: "registrar_consulta",
    arguments: { referencia: "VT-D4E5F6", nombre: "Ana Pérez", telefono: "+54 351 555-0000", mensaje: "¿Se puede visitar el sábado?" },
  });
  await c.close();
  assert.equal(JSON.parse(textoDe(r)).ok, true);
  assert.equal(s.consultas.at(-1)?.externalId, "cm0ejemplo000000000d4e5f6");

  const evento = s.auditoria.eventos.findLast((e) => e.accion === "registrar_consulta");
  assert.equal(evento?.identidad, "operador");
  assert.equal(evento?.resultado, "ok");
  assert.doesNotMatch(JSON.stringify(evento), /Ana Pérez|555-0000|sábado/);
});

test("argumentos inválidos se rechazan antes de llegar al origen", async () => {
  const c = await s.cliente(s.tokens.operador);
  const antes = s.consultas.length;
  const r = await c.callTool({ name: "registrar_consulta", arguments: { nombre: "", mensaje: "x".repeat(5000) } });
  await c.close();
  assert.equal(r.isError, true);
  assert.equal(s.consultas.length, antes);
});

test("estado_catalogo informa la calidad del último feed", async () => {
  const c = await s.cliente(s.tokens.auditor);
  const estado = JSON.parse(textoDe(await c.callTool({ name: "estado_catalogo", arguments: {} })));
  await c.close();
  assert.equal(estado.informe.validos, 4);
  assert.equal(estado.ultimoError, null);
});

test("sin token, con token inventado o vencido: 401 y queda en la auditoría", async () => {
  const pedir = (auth?: string) =>
    fetch(s.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  for (const auth of [undefined, "Bearer mcp_inventado", `Bearer ${s.tokens.vencido}`]) {
    const res = await pedir(auth);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("www-authenticate"), 'Bearer realm="mcp"');
  }
  const motivos = s.auditoria.eventos.filter((e) => e.resultado === "no-autenticado").map((e) => e.detalle?.motivo);
  assert.deepEqual(motivos.slice(-3), ["sin-token", "token-invalido", "vencido"]);
});

test("el límite de pedidos corta con 429 por identidad", async () => {
  const chico = await levantar({ pedidosPorMinuto: 3 });
  try {
    const pedir = () =>
      fetch(chico.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${chico.tokens.lector}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    const estados = [];
    for (let i = 0; i < 4; i++) estados.push((await pedir()).status);
    assert.deepEqual(estados, [200, 200, 200, 429]);
  } finally {
    await chico.cerrar();
  }
});
