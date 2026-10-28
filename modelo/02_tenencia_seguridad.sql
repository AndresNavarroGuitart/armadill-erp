-- Tenencia: un estudio contable administra muchas empresas (sus clientes).
-- Cada fila de negocio lleva empresa_id y el aislamiento lo impone RLS (archivo 12).

create table estudio (
  id        bigint generated always as identity primary key,
  nombre    text not null,
  cuit      text check (cuit is null or fn_cuit_valido(cuit)),
  creado_en timestamptz not null default now()
);

create table empresa (
  id                     bigint generated always as identity primary key,
  estudio_id             bigint not null references estudio(id),
  cuit                   text   not null check (fn_cuit_valido(cuit)),
  razon_social           text   not null,
  condicion_iva_codigo   smallint not null references arca_condicion_iva(codigo),
  inicio_actividades     date,
  nro_iibb               text,
  convenio_multilateral  boolean not null default false,
  domicilio_fiscal       text,
  activa                 boolean not null default true,
  creado_en              timestamptz not null default now(),
  unique (estudio_id, cuit)
);

-- Parámetros por empresa. Cada uno reemplaza una decisión que el original dejaba implícita o fija.
create table empresa_parametro (
  empresa_id                 bigint primary key references empresa(id),
  permite_stock_negativo     boolean not null default false,    -- el original lo permite (stock -2 observado)
  metodo_costeo              text    not null default 'promedio' check (metodo_costeo in ('ultimo','promedio','peps')),
  nc_requiere_origen         boolean not null default true,     -- Odoo exige; el original permite NC sin comprobante
  precios_venta_incluyen_iva boolean not null default true,
  bloquea_periodo_vencido    boolean not null default false,    -- el original bloquea; un estudio carga atrasado
  tolerancia_redondeo        importe not null default 0.01      -- diferencia admitida entre IVA informado y calculado
);

create table usuario (
  id         bigint generated always as identity primary key,
  estudio_id bigint not null references estudio(id),
  email      text   not null unique,
  nombre     text   not null,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
  -- la contraseña NO vive acá: autenticación externa (OIDC) o servicio de credenciales aparte
);

create table permiso (
  clave       text primary key,                  -- 'ventas.descuento_pie_max', 'compras.anular', ...
  modulo      text not null,
  descripcion text not null,
  tipo_valor  text not null default 'booleano' check (tipo_valor in ('booleano','numero','texto'))
);

create table rol (
  id         bigint generated always as identity primary key,
  estudio_id bigint not null references estudio(id),
  nombre     text   not null,
  unique (estudio_id, nombre)
);

create table rol_permiso (
  rol_id         bigint not null references rol(id) on delete cascade,
  permiso_clave  text   not null references permiso(clave),
  valor          text   not null default 'si',   -- 'si'/'no', o el número/texto cuando el permiso lo pide
  primary key (rol_id, permiso_clave)
);

create table usuario_empresa (
  usuario_id bigint not null references usuario(id),
  empresa_id bigint not null references empresa(id),
  rol_id     bigint not null references rol(id),
  primary key (usuario_id, empresa_id)
);

-- Numeración interna (recibos, órdenes de pago, certificados, asientos). Las facturas electrónicas
-- NO usan esto: su número lo da ARCA (FECompUltimoAutorizado + 1).
create table secuencia (
  empresa_id bigint not null references empresa(id),
  clave      text   not null,
  valor      bigint not null default 0,
  primary key (empresa_id, clave)
);

create function fn_siguiente(p_empresa bigint, p_clave text) returns bigint language plpgsql as
$$
declare v bigint;
begin
  insert into secuencia (empresa_id, clave, valor) values (p_empresa, p_clave, 1)
  on conflict (empresa_id, clave) do update set valor = secuencia.valor + 1
  returning valor into v;
  return v;
end
$$;

-- Auditoría append-only: quién cambió qué y cuándo.
create table auditoria (
  id           bigint generated always as identity primary key,
  empresa_id   bigint,
  tabla        text   not null,
  registro_id  bigint,
  accion       text   not null check (accion in ('INSERT','UPDATE','DELETE')),
  usuario_id   bigint,
  antes        jsonb,
  despues      jsonb,
  en           timestamptz not null default now()
);

create function fn_auditar() returns trigger language plpgsql as
$$
declare v jsonb;
begin
  v := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  insert into auditoria (empresa_id, tabla, registro_id, accion, usuario_id, antes, despues)
  values ((v->>'empresa_id')::bigint, tg_table_name, (v->>'id')::bigint, tg_op, fn_usuario_actual(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end
$$;

create function fn_solo_agregar() returns trigger language plpgsql as
$$ begin raise exception 'La tabla % es de solo agregar (no admite % )', tg_table_name, tg_op; end $$;

create trigger trg_auditoria_solo_agregar before update or delete on auditoria
  for each row execute function fn_solo_agregar();
