import { mkdirSync } from "node:fs";
import { cargarConfig } from "./config.ts";
import { crearServidorHttp } from "./http.ts";

mkdirSync("datos", { recursive: true });
const config = cargarConfig();
crearServidorHttp(config).listen(config.puerto, config.host, () => {
  console.log(`MCP escuchando en http://${config.host}:${config.puerto}/mcp`);
});
