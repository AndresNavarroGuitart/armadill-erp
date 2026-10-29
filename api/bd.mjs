// Acceso a la base desde la API. Toda consulta corre dentro de una transacción, con el rol de la aplicación (sin privilegios
// de administrador) y con el contexto de sesión fijado: estudio, empresa y persona. Así la RLS de la base es la que manda.
//   conContexto(ctx, fn)  → trabajo normal dentro de una empresa
//   sinContexto(fn)       → solo para identificar a la persona (las funciones fn_autenticar / fn_empresas_de / fn_contexto_empresa)
// fn recibe un objeto con  consultar(sql, parametros) → filas   y   uno(sql, parametros) → primera fila o undefined.
// Este archivo es la versión para PGlite (pruebas y desarrollo). La de producción es el mismo patrón sobre un pool de `pg`:
//   BEGIN; select set_config(..., true); SET LOCAL ROLE app_usuario; ...; COMMIT.

export function crearBd(db) {
  const envolver = (tx) => {
    const consultar = async (sql, parametros = []) => (await tx.query(sql, parametros)).rows;
    return { consultar, uno: async (sql, parametros) => (await consultar(sql, parametros))[0] };
  };
  return {
    conContexto: (ctx, fn) => db.transaction(async (tx) => {
      await tx.query(`select set_config('app.estudio_id', $1, true), set_config('app.empresa_id', $2, true), set_config('app.usuario_id', $3, true)`,
        [String(ctx.estudioId), ctx.empresaId ? String(ctx.empresaId) : '', String(ctx.usuarioId)]);
      await tx.query('set local role app_usuario');
      return fn(envolver(tx));
    }),
    sinContexto: (fn) => db.transaction(async (tx) => { await tx.query('set local role app_usuario'); return fn(envolver(tx)); }),
  };
}
