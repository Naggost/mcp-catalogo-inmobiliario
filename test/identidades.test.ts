import { test } from "node:test";
import assert from "node:assert/strict";
import { cargarIdentidades, hashToken, nuevoToken } from "../src/identidades.ts";

const token = nuevoToken();
const registro = cargarIdentidades({
  identidades: [
    { id: "agente-ventas", nombre: "Agente de ventas", hash: hashToken(token), permisos: ["catalogo:leer"], vence: "2099-12-31" },
    { id: "baja", nombre: "Dada de baja", hash: hashToken("otro"), permisos: ["catalogo:leer"], activa: false },
  ],
});

test("un token válido devuelve la identidad con sus permisos y sin el hash", () => {
  const r = registro.autenticar(`Bearer ${token}`);
  assert.deepEqual(r, { ok: true, identidad: { id: "agente-ventas", nombre: "Agente de ventas", permisos: ["catalogo:leer"] } });
});

test("sin header, con otro esquema o con token inventado, no entra", () => {
  assert.deepEqual(registro.autenticar(undefined), { ok: false, motivo: "sin-token" });
  assert.deepEqual(registro.autenticar(`Basic ${token}`), { ok: false, motivo: "sin-token" });
  assert.deepEqual(registro.autenticar(`Bearer ${nuevoToken()}`), { ok: false, motivo: "token-invalido" });
});

test("una identidad vencida o dada de baja no entra", () => {
  assert.deepEqual(registro.autenticar(`Bearer ${token}`, new Date("2100-01-01")), { ok: false, motivo: "vencido" });
  assert.deepEqual(registro.autenticar("Bearer otro"), { ok: false, motivo: "desactivada" });
});

test("el registro rechaza permisos desconocidos, ids repetidos y hashes mal formados", () => {
  const base = { id: "x-uno", nombre: "X", hash: hashToken("a"), permisos: ["catalogo:leer"] };
  assert.throws(() => cargarIdentidades({ identidades: [{ ...base, permisos: ["todo:hacer"] }] }));
  assert.throws(() => cargarIdentidades({ identidades: [base, base] }), /repetida/);
  assert.throws(() => cargarIdentidades({ identidades: [{ ...base, hash: "abc" }] }));
});

test("el registro guarda hashes, no tokens: el token en texto plano no autentica como hash", () => {
  assert.equal(registro.autenticar(`Bearer ${hashToken(token)}`).ok, false);
});
