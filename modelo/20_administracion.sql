-- Administración del estudio: quién puede administrarlo, alta de empresas ya listas para facturar y reglas que la base impone
-- (no la API) para que el estudio no quede sin administrador ni mezcle personas, roles y empresas de distintos estudios.
-- Va DESPUÉS de 19 y ANTES de 27 (que cierra las funciones: lo que acá no se conceda a app_usuario queda cerrado para la aplicación).

-- Administrador del estudio = quien gestiona personas, accesos, roles y empresas del estudio completo. No depende de una empresa:
-- es una marca de la persona. Los permisos por empresa (rol) siguen siendo aparte.
alter table usuario add column admin_estudio boolean not null default false;

-- El email identifica a la persona en el primer ingreso (se compara sin mayúsculas): se guarda siempre en minúsculas y sin espacios.
create function fn_normalizar_email() returns trigger language plpgsql as
$$ begin new.email := lower(btrim(new.email)); return new; end $$;
create trigger trg_usuario_email before insert or update of email on usuario for each row execute function fn_normalizar_email();
update usuario set email = email;

-- Un estudio no puede quedarse sin ningún administrador activo (ni por baja ni por quitarle la marca).
create function fn_proteger_ultimo_admin() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if old.admin_estudio and old.activo and not (new.admin_estudio and new.activo) then
    if not exists (select 1 from usuario u where u.estudio_id = old.estudio_id and u.id <> old.id and u.admin_estudio and u.activo) then
      raise exception 'El estudio tiene que tener al menos un administrador activo. Designá a otra persona antes de quitarle el acceso a esta.';
    end if;
  end if;
  return new;
end
$$;
create trigger trg_usuario_ultimo_admin before update of admin_estudio, activo on usuario for each row execute function fn_proteger_ultimo_admin();
revoke execute on function fn_proteger_ultimo_admin(), fn_normalizar_email() from public;

-- Persona, empresa y rol de un acceso son siempre del mismo estudio (aunque alguien conozca ids ajenos).
create function fn_vinculo_coherente() returns trigger language plpgsql security definer set search_path = public as
$$
declare v_u bigint; v_e bigint; v_r bigint;
begin
  select estudio_id into v_u from usuario where id = new.usuario_id;
  select estudio_id into v_e from empresa where id = new.empresa_id;
  select estudio_id into v_r from rol where id = new.rol_id;
  if v_u is distinct from v_e or v_u is distinct from v_r then
    raise exception 'La persona, la empresa y el rol tienen que ser del mismo estudio.';
  end if;
  return new;
end
$$;
create trigger trg_usuario_empresa_coherente before insert or update on usuario_empresa for each row execute function fn_vinculo_coherente();
revoke execute on function fn_vinculo_coherente() from public;

-- El estudio solo ve y toca su propia fila (antes la tabla no tenía aislamiento).
alter table estudio enable row level security;
alter table estudio force row level security;
create policy acceso_estudio_propio on estudio using (id = fn_estudio_actual()) with check (id = fn_estudio_actual());

-- RLS: el administrador trabaja sobre el estudio (sin empresa activa). Las políticas se suman a las de empresa que ya existían.
create policy acceso_estudio on usuario_empresa
  using (exists (select 1 from empresa e where e.id = empresa_id and e.estudio_id = fn_estudio_actual()))
  with check (exists (select 1 from empresa e where e.id = empresa_id and e.estudio_id = fn_estudio_actual()));
-- rol_permiso no tenía aislamiento: ahora solo se ve y se toca lo de los roles del propio estudio (rol ya tiene su RLS).
alter table rol_permiso enable row level security;
alter table rol_permiso force row level security;
create policy acceso_rol_permiso on rol_permiso
  using (exists (select 1 from rol r where r.id = rol_id)) with check (exists (select 1 from rol r where r.id = rol_id));
-- El catálogo de permisos lo define el sistema, no cada estudio.
revoke insert, update, delete on permiso from app_usuario;

-- Cuentas y parámetros con los que nace una empresa lista para facturar. Es una propuesta: el contador del estudio la ajusta.
create function fn_provisionar_empresa(p_empresa bigint, p_anio int) returns void language plpgsql as
$$
declare
  cuentas text[][] := array[
    ['1.1.1','Caja','activo'], ['1.1.2','Valores a depositar','activo'], ['1.1.3','Deudores por ventas','activo'], ['1.1.5','IVA crédito fiscal','activo'],
    ['1.1.6','Percepciones sufridas','activo'], ['1.1.7','Retenciones sufridas','activo'], ['2.1.1','Proveedores','pasivo'], ['2.1.4','IVA débito fiscal','pasivo'],
    ['2.1.5','Percepciones a depositar','pasivo'], ['2.1.6','Retenciones a depositar','pasivo'], ['4.1.1','Ventas','ingreso'], ['4.1.9','Descuentos otorgados','egreso'],
    ['5.1.1','Compras','egreso'], ['5.1.9','Descuentos obtenidos','ingreso']];
  mapa text[][] := array[
    ['ventas','4.1.1'], ['compras','5.1.1'], ['iva_debito','2.1.4'], ['iva_credito','1.1.5'], ['deudores','1.1.3'], ['proveedores','2.1.1'],
    ['percepcion_iva_sufrida','1.1.6'], ['percepcion_iibb_sufrida','1.1.6'], ['percepcion_ganancias_sufrida','1.1.6'], ['otros_tributos_compras','5.1.1'],
    ['percepcion_iva_practicada','2.1.5'], ['percepcion_iibb_practicada','2.1.5'], ['otros_tributos_ventas','2.1.5'],
    ['retencion_iva_sufrida','1.1.7'], ['retencion_ganancias_sufrida','1.1.7'], ['retencion_iibb_sufrida','1.1.7'], ['retencion_suss_sufrida','1.1.7'],
    ['retencion_iva_practicada','2.1.6'], ['retencion_ganancias_practicada','2.1.6'], ['retencion_iibb_practicada','2.1.6'], ['retencion_suss_practicada','2.1.6'],
    ['descuentos_otorgados','4.1.9'], ['descuentos_obtenidos','5.1.9'], ['valores_a_depositar','1.1.2']];
  i int;
begin
  insert into empresa_parametro (empresa_id, asientos_automaticos) values (p_empresa, true) on conflict (empresa_id) do update set asientos_automaticos = true;
  for i in 1 .. array_length(cuentas, 1) loop
    insert into plan_cuenta (empresa_id, codigo, nombre, tipo) values (p_empresa, cuentas[i][1], cuentas[i][2], cuentas[i][3]);
  end loop;
  for i in 1 .. array_length(mapa, 1) loop
    insert into cuenta_automatica (empresa_id, concepto, cuenta_id)
      select p_empresa, mapa[i][1], c.id from plan_cuenta c where c.empresa_id = p_empresa and c.codigo = mapa[i][2];
  end loop;
  insert into ejercicio (empresa_id, desde, hasta) values (p_empresa, make_date(p_anio, 1, 1), make_date(p_anio, 12, 31));
  insert into periodo (empresa_id, desde, hasta)
    select p_empresa, d::date, (d + interval '1 month' - interval '1 day')::date from generate_series(make_date(p_anio, 1, 1)::timestamp, make_date(p_anio, 12, 1)::timestamp, interval '1 month') d;
  insert into punto_venta (empresa_id, numero, sistema) values (p_empresa, 1, 'interno');
  insert into deposito (empresa_id, nombre) values (p_empresa, 'Depósito central');
  insert into lista_precio (empresa_id, nombre, orden) values (p_empresa, 'General', 1);
end
$$;
revoke execute on function fn_provisionar_empresa(bigint, int) from public;      -- solo el dueño de la base (altas por línea de comandos, semilla)

-- Alta de una empresa del estudio desde la aplicación. SECURITY DEFINER porque todavía no hay empresa en el contexto (la RLS de las
-- tablas por empresa lo impediría), pero antes comprueba, con lo que fijó la API, que quien llama es administrador activo de ESE estudio.
create function fn_alta_empresa(p_cuit text, p_razon_social text, p_condicion smallint, p_inicio date, p_nro_iibb text, p_domicilio text, p_anio int, p_dar_acceso boolean)
returns bigint language plpgsql security definer set search_path = public as
$$
declare v_estudio bigint := fn_estudio_actual(); v_usuario bigint := fn_usuario_actual(); v_empresa bigint; v_rol bigint;
begin
  if v_estudio is null or v_usuario is null
     or not exists (select 1 from usuario u where u.id = v_usuario and u.estudio_id = v_estudio and u.admin_estudio and u.activo) then
    raise exception 'Solo un administrador del estudio puede dar de alta empresas.' using errcode = '42501';
  end if;
  insert into empresa (estudio_id, cuit, razon_social, condicion_iva_codigo, inicio_actividades, nro_iibb, domicilio_fiscal)
    values (v_estudio, p_cuit, p_razon_social, p_condicion, p_inicio, p_nro_iibb, p_domicilio) returning id into v_empresa;
  perform fn_provisionar_empresa(v_empresa, p_anio);
  if p_dar_acceso then
    select id into v_rol from rol where estudio_id = v_estudio and nombre = 'Administrador';
    if v_rol is null then raise exception 'El estudio no tiene el rol Administrador: no se puede dar acceso a la empresa nueva.'; end if;
    insert into usuario_empresa (usuario_id, empresa_id, rol_id) values (v_usuario, v_empresa, v_rol);
  end if;
  return v_empresa;
end
$$;
revoke execute on function fn_alta_empresa(text, text, smallint, date, text, text, int, boolean) from public;
grant execute on function fn_alta_empresa(text, text, smallint, date, text, text, int, boolean) to app_usuario;

-- Alta de un estudio nuevo con su primera persona administradora. Es una tarea de quien opera la plataforma (conexión del dueño de la
-- base, ver api/alta_estudio.mjs); la aplicación no la puede ejecutar.
create function fn_alta_estudio(p_nombre text, p_cuit text, p_admin_email text, p_admin_nombre text)
returns table (estudio_id bigint, usuario_id bigint) language plpgsql as
$$
declare v_estudio bigint; v_usuario bigint;
begin
  insert into estudio (nombre, cuit) values (btrim(p_nombre), p_cuit) returning id into v_estudio;
  perform fn_roles_base(v_estudio);
  insert into usuario (estudio_id, email, nombre, admin_estudio) values (v_estudio, p_admin_email, btrim(p_admin_nombre), true) returning id into v_usuario;
  return query select v_estudio, v_usuario;
end
$$;
revoke execute on function fn_alta_estudio(text, text, text, text) from public;
