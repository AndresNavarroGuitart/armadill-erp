-- Integración con ARCA: certificados, tickets de acceso, bitácora de cada llamada, CAEA y consultas de padrón.
-- Regla de seguridad: la clave privada NUNCA se guarda acá; solo una referencia al almacén de secretos.

create table arca_certificado (
  id                  bigint generated always as identity primary key,
  empresa_id          bigint not null references empresa(id),
  ambiente            text   not null check (ambiente in ('homologacion','produccion')),
  alias               text   not null,
  cuit                text   not null check (fn_cuit_valido(cuit)),
  vencimiento         date   not null,
  referencia_secreto  text   not null,          -- p. ej. 'vault://arca/empresa-10/prod'; jamás la clave
  activo              boolean not null default true,
  unique (empresa_id, ambiente, alias)
);

-- Token y firma de WSAA (duran unas 12 horas): se cachean para no pedir uno por operación.
create table arca_ticket_acceso (
  id              bigint generated always as identity primary key,
  empresa_id      bigint not null references empresa(id),
  ambiente        text   not null check (ambiente in ('homologacion','produccion')),
  servicio        text   not null,              -- 'wsfe', 'wsfex', 'ws_sr_constancia_inscripcion', ...
  token_cifrado   bytea  not null,
  sign_cifrado    bytea  not null,
  generado_en     timestamptz not null,
  expira_en       timestamptz not null,
  check (expira_en > generado_en)
);
create index on arca_ticket_acceso (empresa_id, ambiente, servicio, expira_en desc);

-- Bitácora de solo agregar: cada pedido y respuesta, para auditar rechazos y reintentar.
create table arca_solicitud (
  id              bigint generated always as identity primary key,
  empresa_id      bigint not null references empresa(id),
  comprobante_id  bigint references comprobante(id),
  ambiente        text   not null check (ambiente in ('homologacion','produccion')),
  servicio        text   not null,
  metodo          text   not null,              -- 'FECAESolicitar', 'FECompUltimoAutorizado', 'FEParamGetTiposCbte', ...
  pedido          jsonb,
  respuesta       jsonb,
  resultado       text,                         -- 'A', 'R', 'P' o código de error
  error           text,
  duracion_ms     integer,
  en              timestamptz not null default now()
);
create index on arca_solicitud (empresa_id, comprobante_id);
create trigger trg_arca_solicitud_solo_agregar before update or delete on arca_solicitud
  for each row execute function fn_solo_agregar();

-- CAEA: desde el 1/6/2026 solo para contingencia (RG 5782/5785, a confirmar).
create table arca_caea (
  id                 bigint generated always as identity primary key,
  empresa_id         bigint not null references empresa(id),
  punto_venta        integer not null,
  periodo            char(6) not null check (periodo ~ '^[0-9]{6}$'),     -- AAAAMM
  orden              smallint not null check (orden in (1, 2)),           -- quincena
  codigo             text   not null,
  vigencia_desde     date   not null,
  vigencia_hasta     date   not null,
  fecha_tope_informe date,
  estado             text   not null default 'vigente' check (estado in ('solicitado','vigente','informado','vencido')),
  unique (empresa_id, punto_venta, periodo, orden)
);

-- Instantánea de la consulta de padrón (estado de clave, condición de IVA, domicilio, actividades).
create table arca_padron_consulta (
  id                    bigint generated always as identity primary key,
  empresa_id            bigint not null references empresa(id),
  tercero_id            bigint references tercero(id),
  cuit                  text   not null check (fn_cuit_valido(cuit)),
  servicio              text   not null,
  consultado_en         timestamptz not null default now(),
  estado_clave          text,
  condicion_iva_codigo  smallint references arca_condicion_iva(codigo),
  razon_social          text,
  domicilio             jsonb,
  actividades           jsonb,
  respuesta             jsonb
);
create index on arca_padron_consulta (empresa_id, cuit, consultado_en desc);
