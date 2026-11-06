import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCatalogo } from "../src/catalogo.ts";
import { feedEjemplo, origenEnMemoria } from "./apoyo.ts";

function reloj(inicio = 0) {
  let t = inicio;
  return { ahora: () => t, avanzar: (ms: number) => (t += ms) };
}

test("usa la caché dentro del TTL y refresca después", async () => {
  const r = reloj();
  const m = origenEnMemoria();
  const cat = crearCatalogo(m.origen, { ttlMs: 1000, ahora: r.ahora });
  await cat.propiedades();
  await cat.propiedades();
  assert.equal(m.lecturas(), 1);
  r.avanzar(1001);
  await cat.propiedades();
  assert.equal(m.lecturas(), 2);
});

test("si el origen se cae, sigue sirviendo el último catálogo bueno y registra el error", async () => {
  const r = reloj();
  let caido = false;
  const m = origenEnMemoria(() => {
    if (caido) throw new Error("timeout del conector");
    return feedEjemplo();
  });
  const cat = crearCatalogo(m.origen, { ttlMs: 1000, maxAntiguedadMs: 10_000, ahora: r.ahora });
  await cat.propiedades();
  caido = true;
  r.avanzar(2000);
  assert.equal((await cat.propiedades()).length, 4);
  assert.match(cat.estado().ultimoError ?? "", /timeout/);
});

test("pasado el máximo de antigüedad, corta en vez de servir datos viejos", async () => {
  const r = reloj();
  let caido = false;
  const m = origenEnMemoria(() => {
    if (caido) throw new Error("conector caído");
    return feedEjemplo();
  });
  const cat = crearCatalogo(m.origen, { ttlMs: 1000, maxAntiguedadMs: 5000, ahora: r.ahora });
  await cat.propiedades();
  caido = true;
  r.avanzar(6000);
  await assert.rejects(cat.propiedades(), /desactualizado/);
});

test("no aplica un catálogo que cae a menos de la mitad de golpe", async () => {
  const r = reloj();
  let feed = feedEjemplo();
  const m = origenEnMemoria(() => feed);
  const cat = crearCatalogo(m.origen, { ttlMs: 1000, ahora: r.ahora });
  await cat.propiedades();
  feed = { ...feedEjemplo(), items: feedEjemplo().items.slice(0, 1) };
  r.avanzar(1001);
  assert.equal((await cat.propiedades()).length, 4);
  assert.match(cat.estado().ultimoError ?? "", /bajó de 4 a 1/);
});

test("pedidos simultáneos con la caché vencida hacen una sola lectura al origen", async () => {
  const m = origenEnMemoria();
  const cat = crearCatalogo(m.origen);
  await Promise.all(Array.from({ length: 20 }, () => cat.propiedades()));
  assert.equal(m.lecturas(), 1);
});
