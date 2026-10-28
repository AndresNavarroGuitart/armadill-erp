-- Maestros. El original separa cliente y proveedor en dos tablas distintas; acá es un solo
-- "tercero" con roles, porque un estudio ve la misma contraparte comprando y vendiendo.

create table tercero (
  id                     bigint generated always as identity primary key,
  empresa_id             bigint not null references empresa(id),
  tipo_documento_codigo  smallint not null references arca_tipo_documento(codigo),
  nro_documento          text not null,
  razon_social           text not null,
  nombre_fantasia        text,
  condicion_iva_codigo   smallint not null references arca_condicion_iva(codigo),
  es_cliente             boolean not null default false,
  es_proveedor           boolean not null default false,
  activo                 boolean not null default true,
  email                  text,
  telefono               text,
  nro_iibb               text,
  convenio_multilateral  boolean not null default false,
  cuenta_deudores_id     bigint references plan_cuenta(id),
  cuenta_acreedores_id   bigint references plan_cuenta(id),
  condicion_pago_dias    integer not null default 0 check (condicion_pago_dias >= 0),
  limite_credito         importe not null default 0 check (limite_credito >= 0),
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  check (es_cliente or es_proveedor),
  check (tipo_documento_codigo not in (80, 86) or fn_cuit_valido(nro_documento)),
  unique (empresa_id, tipo_documento_codigo, nro_documento)
);
create trigger trg_tercero_actualizado before update on tercero
  for each row execute function fn_tocar_actualizado();

alter table asiento_linea add constraint asiento_linea_tercero_fk foreign key (tercero_id) references tercero(id);

create table tercero_domicilio (
  id            bigint generated always as identity primary key,
  empresa_id    bigint not null references empresa(id),
  tercero_id    bigint not null references tercero(id) on delete cascade,
  tipo          text   not null default 'fiscal' check (tipo in ('fiscal','entrega','otro')),
  calle         text,
  numero        text,
  piso_dpto     text,
  localidad     text,
  jurisdiccion_codigo smallint references arca_jurisdiccion(codigo),
  codigo_postal text,
  principal     boolean not null default false
);
create unique index on tercero_domicilio (tercero_id) where principal;

create table tercero_contacto (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa(id),
  tercero_id bigint not null references tercero(id) on delete cascade,
  nombre     text not null,
  cargo      text,
  email      text,
  telefono   text,
  whatsapp   text
);

create table rubro (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa(id),
  nombre     text not null,
  padre_id   bigint references rubro(id)
);
-- el nombre es único dentro del mismo padre (el original repite "Servicios" como rubro y como subrubro)
create unique index rubro_nombre_unico on rubro (empresa_id, coalesce(padre_id, 0), nombre);

-- El tratamiento de IVA se modela como ARCA: gravado (con alícuota), exento o no gravado.
create table articulo (
  id                       bigint generated always as identity primary key,
  empresa_id               bigint not null references empresa(id),
  codigo                   text   not null,
  nombre                   text   not null,
  tipo                     text   not null default 'bien' check (tipo in ('bien','servicio','gasto','bien_de_uso')),
  rubro_id                 bigint references rubro(id),
  unidad_id                smallint references unidad_medida(id),
  moneda                   char(3) not null default 'PES' references arca_moneda(codigo),
  tratamiento_iva_venta    text not null default 'gravado' check (tratamiento_iva_venta in ('gravado','exento','no_gravado')),
  alicuota_venta_codigo    smallint references arca_alicuota_iva(codigo),
  tratamiento_iva_compra   text not null default 'gravado' check (tratamiento_iva_compra in ('gravado','exento','no_gravado')),
  alicuota_compra_codigo   smallint references arca_alicuota_iva(codigo),
  controla_stock           boolean not null default true,
  cuenta_venta_id          bigint references plan_cuenta(id),
  cuenta_compra_id         bigint references plan_cuenta(id),
  activo                   boolean not null default true,
  creado_en                timestamptz not null default now(),
  unique (empresa_id, codigo),
  check ((tratamiento_iva_venta  = 'gravado') = (alicuota_venta_codigo  is not null)),
  check ((tratamiento_iva_compra = 'gravado') = (alicuota_compra_codigo is not null))
);

create table lista_precio (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa(id),
  nombre     text not null,
  orden      smallint not null default 1,
  unique (empresa_id, nombre)
);
alter table tercero add column lista_precio_id bigint references lista_precio(id);

-- Se guarda SOLO el precio neto, con vigencia. El final con IVA se calcula (neto × (1 + alícuota)):
-- el original guarda ambos y puede desincronizarse.
create table articulo_precio (
  empresa_id     bigint not null references empresa(id),
  articulo_id    bigint not null references articulo(id) on delete cascade,
  lista_id       bigint not null references lista_precio(id),
  vigente_desde  date   not null,
  precio_neto    importe4 not null check (precio_neto >= 0),
  primary key (articulo_id, lista_id, vigente_desde)
);

-- Historial de costos: el original no actualizaba el costo con las compras (observado el 28/10/2026).
create table articulo_costo (
  id           bigint generated always as identity primary key,
  empresa_id   bigint not null references empresa(id),
  articulo_id  bigint not null references articulo(id) on delete cascade,
  fecha        date   not null,
  costo        importe4 not null check (costo >= 0),
  moneda       char(3) not null default 'PES' references arca_moneda(codigo),
  origen       text   not null check (origen in ('compra','manual','ajuste','inventario')),
  comprobante_id bigint                                   -- FK agregada en 06
);
create index on articulo_costo (articulo_id, fecha desc);
