// Carga el esquema completo (00_*.sql ... 12_*.sql) en un PostgreSQL real en memoria (PGlite).
// Uso desde otro script:  const db = await crearBase();
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const carpeta = new URL('./', import.meta.url);

export async function crearBase() {
  const db = new PGlite({ extensions: { btree_gist } });
  const archivos = readdirSync(carpeta).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
  for (const archivo of archivos) {
    const sql = readFileSync(new URL(archivo, carpeta), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      error.message = `${archivo}: ${error.message}`;
      throw error;
    }
  }
  return { db, archivos };
}

// Ejecución directa:  node modelo/cargar.mjs  -> lista tablas, vistas y funciones.
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('cargar.mjs')) {
  const { db, archivos } = await crearBase();
  const cuenta = async (sql) => (await db.query(sql)).rows[0].n;
  console.log(`archivos: ${archivos.length}`);
  console.log('tablas   :', await cuenta(`select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`));
  console.log('vistas   :', await cuenta(`select count(*)::int n from information_schema.views where table_schema='public'`));
  console.log('funciones:', await cuenta(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'`));
  console.log('triggers :', await cuenta(`select count(*)::int n from pg_trigger where not tgisinternal`));
}
