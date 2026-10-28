-- Trazabilidad: libro de eventos de solo agregar. Responde "quién hizo qué, sobre qué empresa y cuándo".
-- Complementa a `auditoria` (02), que captura por trigger el antes y después de cada fila: esa tabla no ve
-- lo que no es un cambio de datos (ingresos y ingresos fallidos, exportaciones, consultas sensibles,
-- rechazos de ARCA). Acá los registra la aplicación, con una frase legible y el resultado.
--
-- Integridad: cada estudio tiene su propia cadena. Cada evento guarda la huella (SHA-256) del anterior,
-- de modo que modificar, quitar o intercalar un evento rompe la cadena y `fn_verificar_trazabilidad` lo detecta.
-- Quitar los últimos eventos NO rompe la cadena: por eso la cabeza (`v_trazabilidad_cabeza`) debe resguardarse
-- aparte (copia fuera de la base, o firmada por el servidor) en un horario fijo.

create table evento (
  id             bigint generated always as identity primary key,
  estudio_id     bigint not null references estudio(id),
  nro            bigint not null,                       -- posición en la cadena del estudio (lo asigna la base)
  empresa_id     bigint references empresa(id),         -- null: evento del estudio (ingresos, permisos, exportaciones)
  usuario_id     bigint references usuario(id),         -- lo fija la base con el usuario de la sesión
  usuario_texto  text,                                  -- quien intentó ingresar sin llegar a ser un usuario; o 'sistema'
  categoria      text not null check (categoria in ('acceso','comprobantes','contabilidad','tesoreria','stock','maestros','seguridad')),
  accion         text not null check (length(btrim(accion)) > 0),
  detalle        text,
  resultado      text not null default 'ok' check (resultado in ('ok','rechazo','fallo')),
  entidad_tabla  text,                                  -- sobre qué fila actuó, para saltar desde el evento al registro
  entidad_id     bigint,
  cambios        jsonb check (cambios is null or jsonb_typeof(cambios) = 'array'),   -- [{"campo":..,"antes":..,"despues":..}]
  ip             inet,
  dispositivo    text,
  en             timestamptz not null default clock_timestamp(),
  huella_prev    text,
  huella         text not null,
  unique (estudio_id, nro),
  check (usuario_id is not null or usuario_texto is not null),
  check ((entidad_tabla is null) = (entidad_id is null))
);
create index evento_estudio_en on evento (estudio_id, en desc);
create index evento_empresa_en on evento (empresa_id, en desc) where empresa_id is not null;
create index evento_usuario_en on evento (usuario_id, en desc) where usuario_id is not null;

-- Huella de un evento: todo lo que dice el evento, más la huella del anterior.
create function fn_evento_huella(e evento) returns text language sql stable as
$$
  select encode(sha256(convert_to(concat_ws('|',
    e.huella_prev, e.estudio_id, e.nro, coalesce(e.empresa_id::text, ''), coalesce(e.usuario_id::text, ''),
    coalesce(e.usuario_texto, ''), e.categoria, e.accion, coalesce(e.detalle, ''), e.resultado,
    coalesce(e.entidad_tabla, ''), coalesce(e.entidad_id::text, ''), coalesce(e.cambios::text, ''),
    coalesce(host(e.ip), ''), coalesce(e.dispositivo, ''),
    to_char(e.en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex')
$$;

-- La base decide quién, cuándo, en qué lugar de la cadena y con qué huella: la aplicación no puede
-- adelantar ni atrasar la fecha, ni firmar como otro usuario, ni elegir el número.
create function fn_evento_encadenar() returns trigger language plpgsql as
$$
declare v_prev record;
begin
  -- un solo escritor por estudio a la vez; si no, dos transacciones simultáneas tomarían la misma cola
  perform pg_advisory_xact_lock(hashtextextended('evento:' || new.estudio_id, 0));
  if fn_usuario_actual() is not null then new.usuario_id := fn_usuario_actual(); end if;
  new.en := clock_timestamp();
  select nro, huella into v_prev from evento where estudio_id = new.estudio_id order by nro desc limit 1;
  new.nro := coalesce(v_prev.nro, 0) + 1;
  new.huella_prev := coalesce(v_prev.huella, '');
  new.huella := fn_evento_huella(new);
  return new;
end
$$;

create trigger trg_evento_encadenar before insert on evento
  for each row execute function fn_evento_encadenar();
create trigger trg_evento_solo_agregar before update or delete on evento
  for each row execute function fn_solo_agregar();
create trigger trg_evento_sin_truncar before truncate on evento
  for each statement execute function fn_solo_agregar();

-- Registro desde la aplicación: toma estudio, empresa y usuario del contexto de sesión.
create function fn_registrar_evento(
  p_categoria text, p_accion text, p_detalle text default null, p_resultado text default 'ok',
  p_empresa bigint default null, p_entidad_tabla text default null, p_entidad_id bigint default null,
  p_cambios jsonb default null, p_ip inet default null, p_dispositivo text default null, p_usuario_texto text default null
) returns bigint language plpgsql as
$$
declare v_id bigint;
begin
  if fn_estudio_actual() is null then raise exception 'No se puede registrar un evento sin estudio en el contexto de sesión'; end if;
  insert into evento (estudio_id, empresa_id, usuario_texto, categoria, accion, detalle, resultado, entidad_tabla, entidad_id, cambios, ip, dispositivo)
  values (fn_estudio_actual(), coalesce(p_empresa, fn_empresa_actual()), p_usuario_texto, p_categoria, p_accion, p_detalle, p_resultado,
          p_entidad_tabla, p_entidad_id, p_cambios, p_ip, p_dispositivo)
  returning id into v_id;
  return v_id;
end
$$;

-- Recorre la cadena del estudio. Devuelve null si está íntegra, o el número del primer evento donde se rompe
-- (huella distinta de la recalculada, enlace con el anterior roto, o número salteado: evento quitado).
create function fn_verificar_trazabilidad(p_estudio bigint) returns bigint language plpgsql stable as
$$
declare
  r evento;
  v_prev text := '';
  v_esperado bigint := 0;
begin
  for r in select * from evento where estudio_id = p_estudio order by nro loop
    v_esperado := v_esperado + 1;
    if r.nro <> v_esperado or r.huella_prev <> v_prev or r.huella <> fn_evento_huella(r) then return r.nro; end if;
    v_prev := r.huella;
  end loop;
  return null;
end
$$;

-- Lectura para la pantalla: con el nombre del usuario y de la empresa, y el ID visible (TR-000123 = posición en la cadena del estudio). Hereda RLS de quien consulta.
create view v_trazabilidad with (security_invoker = true) as
  select e.id, e.estudio_id, e.nro, 'TR-' || lpad(e.nro::text, 6, '0') as codigo, e.en, e.empresa_id, em.razon_social as empresa,
         e.usuario_id, coalesce(u.nombre, e.usuario_texto) as usuario,
         e.categoria, e.accion, e.detalle, e.resultado, e.entidad_tabla, e.entidad_id, e.cambios,
         e.ip, e.dispositivo, e.huella_prev, e.huella
    from evento e
    left join empresa em on em.id = e.empresa_id
    left join usuario u on u.id = e.usuario_id;

-- Último evento de cada cadena: es lo que se resguarda fuera de la base para detectar que se quitaron los últimos.
create view v_trazabilidad_cabeza with (security_invoker = true) as
  select distinct on (estudio_id) estudio_id, nro, huella, en from evento order by estudio_id, nro desc;
