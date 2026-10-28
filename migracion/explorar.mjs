// Herramienta de exploración: muestra columnas y primeras filas de tablas del dump. Uso: node migracion/explorar.mjs tabla [campos,...]
import { leerTablaDump } from './leer_dump.mjs';
const RUTA = process.env.DUMP_ORIGINAL ?? 'C:/administraNET/Bases/estructura_default_adm.sql';
const [tabla, campos] = process.argv.slice(2);
const filas = leerTablaDump(RUTA, tabla);
console.log(`${tabla}: ${filas.length} filas`);
const elegir = campos ? campos.split(',') : Object.keys(filas[0] ?? {});
for (const f of filas.slice(0, 5)) console.log(JSON.stringify(Object.fromEntries(elegir.map((c) => [c, f[c]]))));
