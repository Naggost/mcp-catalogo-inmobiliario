import { test } from "node:test";
import assert from "node:assert/strict";
import { FeedRechazado, validarFeed } from "../src/feed.ts";
import { aPublico } from "../src/publico.ts";
import { feedEjemplo } from "./apoyo.ts";

test("el feed de ejemplo pasa entero", () => {
  const { items, informe } = validarFeed(feedEjemplo());
  assert.equal(items.length, 4);
  assert.deepEqual(informe.descartados, []);
});

test("rechaza una versión distinta", () => {
  assert.throws(() => validarFeed({ ...feedEjemplo(), version: 2 }), FeedRechazado);
});

test("rechaza un feed sin ítems", () => {
  assert.throws(() => validarFeed({ ...feedEjemplo(), items: [] }), /ningún ítem válido/);
});

test("descarta el ítem roto, lo informa con su motivo y sigue con el resto", () => {
  const feed = feedEjemplo();
  feed.items[1].data.precio.monto = -5;
  const { items, informe } = validarFeed(feed);
  assert.equal(items.length, 3);
  assert.equal(informe.descartados.length, 1);
  assert.equal(informe.descartados[0].referencia, "VT-D4E5F6");
  assert.match(informe.descartados[0].motivo, /precio\.monto/);
});

test("rechaza el feed si se descarta más de la mitad", () => {
  const feed = feedEjemplo();
  for (const i of [0, 1, 2]) delete feed.items[i].title;
  assert.throws(() => validarFeed(feed), /el origen parece roto/);
});

test("una referencia duplicada se descarta y se informa", () => {
  const feed = feedEjemplo();
  feed.items.push(structuredClone(feed.items[0]));
  const { items, informe } = validarFeed(feed);
  assert.equal(items.length, 4);
  assert.deepEqual(informe.referenciasDuplicadas, ["VT-A1B2C3"]);
});

test("al modelo no le llegan la dirección, el campo de id interno ni los anuncios", () => {
  const { items } = validarFeed(feedEjemplo());
  const publico = JSON.stringify(items.map(aPublico));
  assert.doesNotMatch(publico, /Calle Ejemplo 123/);
  assert.doesNotMatch(publico, /externalId/);
  assert.doesNotMatch(publico, /120000000000001/);
  assert.match(publico, /VT-A1B2C3/);
});
