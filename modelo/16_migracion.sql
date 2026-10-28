-- Soporte de migración desde el sistema original: correspondencia de identificadores (para poder repetir la
-- carga sin duplicar y para enlazar los comprobantes históricos) e incidencias (todo lo que se cambió, omitió o
-- no pudo migrarse, con el valor original). Nada se descarta en silencio.

create table migracion_mapa (
  empresa_id bigint not null references empresa(id),
  tabla      text   not null,                 -- tabla de ORIGEN (cliente, articulo, proveedor, ...)
  legacy_id  text   not null,
  nuevo_id   bigint not null,
  primary key (empresa_id, tabla, legacy_id)
);

create table migracion_incidencia (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa(id),
  tabla      text   not null,
  legacy_id  text,
  gravedad   text   not null check (gravedad in ('info','aviso','error')),
  problema   text   not null,
  valor      text,
  creada_en  timestamptz not null default now()
);
create index on migracion_incidencia (empresa_id, gravedad);
