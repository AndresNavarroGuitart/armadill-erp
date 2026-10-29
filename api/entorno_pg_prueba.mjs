// SOLO PRUEBAS: levanta un PGlite vacío, lo expone por el protocolo de PostgreSQL (socket) y le aplica el modelo con el MISMO migrador
// que se usará en producción. Así la API se prueba pasando por `pg` de verdad (pool, transacciones, tipos, SET LOCAL ROLE), no por el atajo de PGlite.
import net from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import { migrar } from '../modelo/migrar_pg.mjs';

const puertoLibre = () => new Promise((ok, mal) => { const s = net.createServer(); s.once('error', mal); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

/** { db (PGlite), pool (pg, 1 conexión: PGlite es un solo proceso, no hay concurrencia real), url, migracion, cerrar() } */
export async function crearEntornoPg({ antesDelModelo } = {}) {
  const db = new PGlite({ extensions: { btree_gist } });
  if (antesDelModelo) await antesDelModelo(db);
  const port = await puertoLibre();
  const servidor = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 4 });
  await servidor.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  const migrador = new pg.Client({ connectionString: url });
  await migrador.connect();
  const migracion = await migrar(migrador, { aplicar: true });
  await migrador.end();
  const { crearPool } = await import('./bd_pg.mjs');
  const pool = crearPool({ url, maximo: 1 });
  return { db, pool, url, migracion, cerrar: async () => { await pool.end(); await servidor.stop(); } };
}
