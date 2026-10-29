// Aplica el modelo (00_*.sql … NN_*.sql) a un PostgreSQL REAL (Supabase u otro), de a un archivo por transacción, y deja constancia
// en `schema_migracion` (archivo + huella SHA-256). Es repetible: lo ya aplicado se saltea; si un archivo ya aplicado cambió, se
// detiene (no se reaplica ni se modifica en silencio: un cambio al modelo va en un archivo nuevo).
// Uso:   DATABASE_URL=postgres://… node modelo/migrar_pg.mjs            → muestra qué falta (no cambia nada)
//        DATABASE_URL=postgres://… node modelo/migrar_pg.mjs --aplicar  → aplica lo que falta
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

const carpetaPorDefecto = new URL('./', import.meta.url);
const huella = (texto) => createHash('sha256').update(texto.replace(/\r\n/g, '\n')).digest('hex');
const CLAVE_BLOQUEO = 7_190_001;   // advisory lock: dos personas no migran a la vez

export function archivosDelModelo(carpeta = carpetaPorDefecto) {
  return readdirSync(carpeta).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort().map((archivo) => ({ archivo, sql: readFileSync(new URL(archivo, carpeta), 'utf8') }));
}

/** `cliente` es un cliente de `pg` ya conectado (no un pool: el lock y las transacciones tienen que ir por la misma conexión). */
export async function migrar(cliente, { aplicar = false, carpeta = carpetaPorDefecto, registrar = () => {} } = {}) {
  await cliente.query('select pg_advisory_lock($1)', [CLAVE_BLOQUEO]);
  try {
    await cliente.query(`create table if not exists schema_migracion (archivo text primary key, huella text not null, aplicado_en timestamptz not null default now())`);
    const hechas = new Map((await cliente.query('select archivo, huella from schema_migracion')).rows.map((f) => [f.archivo, f.huella]));
    const pendientes = [];
    for (const { archivo, sql } of archivosDelModelo(carpeta)) {
      const h = huella(sql);
      if (hechas.has(archivo)) {
        if (hechas.get(archivo) !== h) throw new Error(`${archivo} ya estaba aplicado y ahora es distinto. Los cambios al modelo van en un archivo nuevo, no editando uno aplicado.`);
        continue;
      }
      pendientes.push({ archivo, sql, huella: h });
    }
    if (!aplicar) return { aplicadas: [], pendientes: pendientes.map((p) => p.archivo) };
    const aplicadas = [];
    for (const p of pendientes) {
      registrar(`aplicando ${p.archivo}…`);
      try {
        await cliente.query('BEGIN');
        await cliente.query(p.sql);
        await cliente.query('insert into schema_migracion (archivo, huella) values ($1, $2)', [p.archivo, p.huella]);
        await cliente.query('COMMIT');
      } catch (error) {
        try { await cliente.query('ROLLBACK'); } catch (e) { /* la conexión se pierde igual */ }
        error.message = `${p.archivo}: ${error.message}`;
        throw error;
      }
      aplicadas.push(p.archivo);
    }
    return { aplicadas, pendientes: [] };
  } finally { await cliente.query('select pg_advisory_unlock($1)', [CLAVE_BLOQUEO]).catch(() => {}); }
}

if (process.argv[1] && /migrar_pg\.mjs$/.test(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Falta DATABASE_URL (la cadena de conexión de la base, con el usuario dueño).'); process.exit(1); }
  const { default: pg } = await import('pg');
  const cliente = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1|\[::1\]/.test(url) ? undefined : { rejectUnauthorized: true } });
  await cliente.connect();
  try {
    const aplicar = process.argv.includes('--aplicar');
    const r = await migrar(cliente, { aplicar, registrar: (m) => console.log(m) });
    if (aplicar) console.log(r.aplicadas.length ? `Listo: ${r.aplicadas.length} archivo(s) aplicados.` : 'No había nada pendiente.');
    else { console.log(r.pendientes.length ? `Falta aplicar ${r.pendientes.length} archivo(s):\n  ${r.pendientes.join('\n  ')}\nPara aplicarlos: node modelo/migrar_pg.mjs --aplicar` : 'La base está al día.'); }
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await cliente.end(); }
}
