// Acceso a la base en PRODUCCIÓN (PostgreSQL/Supabase) con un pool de `pg`. Misma interfaz que bd.mjs (la versión de PGlite):
//   conContexto(ctx, fn) y sinContexto(fn), con fn({ consultar, uno }).
// Cada llamada es UNA transacción: BEGIN; límites de tiempo; set_config(contexto, local); SET LOCAL ROLE app_usuario; trabajo; COMMIT.
// Todo es "local a la transacción", por eso es seguro detrás del pooler de Supabase en modo transacción (puerto 6543): ningún
// ajuste de sesión queda pegado a una conexión que luego use otra persona.
// La conexión del pool es la del dueño de la base (en Supabase, `postgres`): las funciones SECURITY DEFINER de 19_api.sql necesitan
// saltear la RLS para identificar a la persona. El código de la API nunca corre como dueño: siempre baja a app_usuario antes de trabajar.
import pg from 'pg';

/** Los id (bigint) se leen como número: son enteros chicos y la API/el front los usan como número. Si alguno no cupiera, queda como texto. */
const tipos = {
  getTypeParser: (oid, formato) => (oid === 20 ? (v) => { const n = Number(v); return Number.isSafeInteger(n) ? n : v; } : pg.types.getTypeParser(oid, formato)),
};

export function crearPool({ url, maximo = 10, tiempoConexionMs = 5000, ssl } = {}) {
  if (!url) throw new Error('Falta la cadena de conexión a la base (DATABASE_URL).');
  const pool = new pg.Pool({ connectionString: url, max: maximo, connectionTimeoutMillis: tiempoConexionMs, idleTimeoutMillis: 30_000, types: tipos,
    ssl: ssl ?? (/localhost|127\.0\.0\.1|\[::1\]/.test(url) ? undefined : { rejectUnauthorized: true }) });
  pool.on('error', () => { /* una conexión ociosa que se cae no debe tumbar el proceso: el pool la reemplaza */ });
  return pool;
}

export function crearBdPg(pool, { tiempoMaximoMs = 15_000 } = {}) {
  const envolver = (cliente) => {
    const consultar = async (sql, parametros = []) => (await cliente.query(sql, parametros)).rows;
    return { consultar, uno: async (sql, parametros) => (await consultar(sql, parametros))[0] };
  };
  async function enTransaccion(preparar, fn) {
    const cliente = await pool.connect();
    let roto = false;
    try {
      await cliente.query('BEGIN');
      await cliente.query(`select set_config('statement_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $2, true)`, [String(tiempoMaximoMs), String(tiempoMaximoMs)]);
      await preparar(cliente);
      await cliente.query('SET LOCAL ROLE app_usuario');
      const resultado = await fn(envolver(cliente));
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      try { await cliente.query('ROLLBACK'); } catch (e) { roto = true; }         // si ni siquiera se puede deshacer, esa conexión se descarta
      throw error;
    } finally { cliente.release(roto); }
  }
  return {
    conContexto: (ctx, fn) => enTransaccion(
      (c) => c.query(`select set_config('app.estudio_id', $1, true), set_config('app.empresa_id', $2, true), set_config('app.usuario_id', $3, true)`,
        [String(ctx.estudioId), ctx.empresaId ? String(ctx.empresaId) : '', String(ctx.usuarioId)]), fn),
    sinContexto: (fn) => enTransaccion(async () => {}, fn),
    cerrar: () => pool.end(),
  };
}
