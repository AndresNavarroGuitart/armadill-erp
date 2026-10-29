-- Endurecimiento para Supabase (y cualquier base con roles anon/authenticated). Se carga ÚLTIMO.
-- Supabase publica por defecto el esquema `public` por su API REST (PostgREST) y da permisos a `anon` y `authenticated` sobre todo lo
-- que se crea ahí; además, PostgreSQL deja ejecutable por PUBLIC cualquier función nueva. Este sistema NO usa esa API: toda lectura y
-- escritura pasa por la API propia, que baja al rol app_usuario con el contexto de la empresa. Por eso:
--   1. se les quita a anon y authenticated todo acceso a tablas, secuencias y funciones;
--   2. las funciones dejan de ser ejecutables por PUBLIC: solo las puede ejecutar app_usuario, y únicamente las que ya podía
--      ejecutar (así no se "abre" por accidente una que 19_api.sql había cerrado, como fn_roles_base);
--   3. lo que se cree de acá en adelante nace cerrado: una función nueva hay que concederla a app_usuario a propósito.
-- En una base sin esos roles (PGlite, Postgres común) solo aplica 2 y 3, y deja a quien carga el modelo en condiciones de usar app_usuario.
do $$
declare
  r text;
  f record;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;

  -- 2. Funciones propias del modelo (las de extensiones, como btree_gist, no se tocan).
  for f in
    select p.oid::regprocedure as firma, has_function_privilege('app_usuario', p.oid, 'execute') as la_usa_la_app
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public', f.firma);
    if f.la_usa_la_app then execute format('grant execute on function %s to app_usuario', f.firma); end if;
  end loop;

  -- 3. Lo nuevo nace cerrado (para lo que cree este mismo usuario).
  alter default privileges revoke execute on functions from public;

  -- La API se conecta con el dueño de la base y baja a app_usuario con SET LOCAL ROLE: hace falta poder hacerlo.
  if not (select rolsuper from pg_roles where rolname = current_user)
     and not exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
                      where g.rolname = 'app_usuario' and u.rolname = current_user) then
    execute format('grant app_usuario to %I', current_user);
  end if;
end $$;
