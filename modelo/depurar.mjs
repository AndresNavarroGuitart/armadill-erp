// Herramienta de diagnóstico: carga los archivos en orden y, si uno falla, lo ejecuta sentencia por sentencia
// para mostrar cuál. Uso:  node modelo/depurar.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const carpeta = new URL('./', import.meta.url);
const db = new PGlite({ extensions: { btree_gist } });

// Separa por ';' respetando bloques $$ ... $$
function sentencias(sql) {
  const salida = [];
  let actual = '';
  let dentro = false;
  for (let i = 0; i < sql.length; i += 1) {
    if (sql.startsWith('$$', i)) { dentro = !dentro; actual += '$$'; i += 1; continue; }
    if (!dentro && sql.startsWith('--', i)) { const fin = sql.indexOf('\n', i); i = fin < 0 ? sql.length : fin; actual += '\n'; continue; }
    if (!dentro && sql[i] === ';') { if (actual.trim()) salida.push(actual.trim()); actual = ''; continue; }
    actual += sql[i];
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

for (const archivo of readdirSync(carpeta).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort()) {
  const sql = readFileSync(new URL(archivo, carpeta), 'utf8');
  for (const s of sentencias(sql)) {
    try { await db.exec(s); }
    catch (e) {
      console.log(`FALLA en ${archivo}: ${e.message}`);
      console.log('--- sentencia ---');
      console.log(s.slice(0, 600));
      process.exit(1);
    }
  }
  console.log(`ok ${archivo}`);
}
