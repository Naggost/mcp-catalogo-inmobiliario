/**
 * Genera un token nuevo para una identidad.
 * Uso: node scripts/crear-token.ts <id> "<nombre>" <permiso> [<permiso>...]
 *
 * El token se muestra una sola vez. En el registro de identidades se guarda solo su hash.
 */
import { hashToken, nuevoToken, PERMISOS } from "../src/identidades.ts";

const [id, nombre, ...permisos] = process.argv.slice(2);
const invalidos = permisos.filter((p) => !(PERMISOS as readonly string[]).includes(p));
if (!id || !nombre || permisos.length === 0 || invalidos.length > 0) {
  console.error(`Uso: node scripts/crear-token.ts <id> "<nombre>" <permiso>...\nPermisos: ${PERMISOS.join(", ")}`);
  process.exit(1);
}
const token = nuevoToken();
console.log(`Token (guardalo ahora, no se vuelve a mostrar):\n${token}\n`);
console.log("Entrada para el registro de identidades:");
console.log(JSON.stringify({ id, nombre, hash: hashToken(token), permisos }, null, 2));
