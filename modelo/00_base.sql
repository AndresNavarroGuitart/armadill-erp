-- Modelo de datos de la réplica. PostgreSQL 15+ (validado en 18).
-- Principios: dinero siempre en numeric (nunca float); una sola fuente de verdad (los saldos
-- no se guardan, se derivan en vistas); comprobantes inmutables una vez confirmados;
-- aislamiento por empresa con RLS; auditoría append-only.

create extension if not exists btree_gist;

create domain importe  as numeric(18,2);   -- totales y columnas de libro
create domain importe4 as numeric(18,4);   -- renglones y precios (el original guarda 4 decimales)
create domain tasa     as numeric(7,4);    -- alícuotas y porcentajes

-- Contexto de sesión: la aplicación fija estos valores al abrir cada transacción
--   select set_config('app.estudio_id','1',true), set_config('app.empresa_id','10',true), set_config('app.usuario_id','5',true);
create function fn_empresa_actual() returns bigint language sql stable as
$$ select nullif(current_setting('app.empresa_id', true), '')::bigint $$;

create function fn_estudio_actual() returns bigint language sql stable as
$$ select nullif(current_setting('app.estudio_id', true), '')::bigint $$;

create function fn_usuario_actual() returns bigint language sql stable as
$$ select nullif(current_setting('app.usuario_id', true), '')::bigint $$;

create function fn_tocar_actualizado() returns trigger language plpgsql as
$$ begin new.actualizado_en := now(); return new; end $$;

-- CUIT/CUIL: 11 dígitos con dígito verificador módulo 11.
create function fn_cuit_valido(p text) returns boolean language plpgsql immutable as
$$
declare
  pesos int[] := array[5,4,3,2,7,6,5,4,3,2];
  suma int := 0;
  dv int;
  i int;
begin
  if p is null or p !~ '^[0-9]{11}$' then return false; end if;
  for i in 1..10 loop
    suma := suma + substr(p, i, 1)::int * pesos[i];
  end loop;
  dv := 11 - (suma % 11);
  if dv = 11 then dv := 0; elsif dv = 10 then dv := 9; end if;
  return dv = substr(p, 11, 1)::int;
end
$$;
