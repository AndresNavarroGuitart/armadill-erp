-- Aislamiento entre empresas (RLS) y auditoría automática. Es la última capa: se aplica sobre todo lo anterior.
-- La aplicación se conecta con el rol app_usuario (sin privilegios de superusuario) y fija el contexto:
--   select set_config('app.empresa_id', '10', true), set_config('app.estudio_id', '1', true), set_config('app.usuario_id', '5', true);

create role app_usuario nologin;
grant usage on schema public to app_usuario;

-- Toda tabla con empresa_id queda aislada. Las nullable (regímenes y escalas del sistema) se leen aunque sean compartidas.
do $$
declare r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'empresa_id' and t.table_type = 'BASE TABLE'
       and c.table_name <> 'evento'      -- la trazabilidad es del estudio (tiene eventos sin empresa): política propia más abajo
  loop
    execute format('alter table %I enable row level security', r.table_name);
    execute format('alter table %I force row level security', r.table_name);
    if r.table_name in ('regimen_retencion', 'escala_ganancias') then
      execute format('create policy lectura on %I for select using (empresa_id is null or empresa_id = fn_empresa_actual())', r.table_name);
      execute format('create policy escritura on %I for all using (empresa_id = fn_empresa_actual()) with check (empresa_id = fn_empresa_actual())', r.table_name);
    else
      execute format('create policy aislamiento_empresa on %I using (empresa_id = fn_empresa_actual()) with check (empresa_id = fn_empresa_actual())', r.table_name);
    end if;
  end loop;
end $$;

-- Empresa: la ve el estudio dueño o la propia empresa. Usuarios y roles: solo el estudio.
alter table empresa enable row level security;
alter table empresa force row level security;
create policy acceso_empresa on empresa
  using (id = fn_empresa_actual() or estudio_id = fn_estudio_actual())
  with check (estudio_id = fn_estudio_actual());

alter table usuario enable row level security;
alter table usuario force row level security;
create policy acceso_usuario on usuario using (estudio_id = fn_estudio_actual()) with check (estudio_id = fn_estudio_actual());

alter table rol enable row level security;
alter table rol force row level security;
create policy acceso_rol on rol using (estudio_id = fn_estudio_actual()) with check (estudio_id = fn_estudio_actual());

-- Trazabilidad: la lee y la escribe el estudio dueño. No hay política de modificación ni de baja.
-- Qué usuarios del estudio pueden verla (permiso `trazabilidad.ver`) lo decide la API, no la base.
alter table evento enable row level security;
alter table evento force row level security;
create policy leer_evento on evento for select using (estudio_id = fn_estudio_actual());
create policy agregar_evento on evento for insert
  with check (estudio_id = fn_estudio_actual()
              and (empresa_id is null or exists (select 1 from empresa e where e.id = empresa_id and e.estudio_id = fn_estudio_actual())));

-- Permisos del rol de la aplicación sobre todo el esquema (RLS decide qué filas).
grant select, insert, update, delete on all tables in schema public to app_usuario;
grant usage on all sequences in schema public to app_usuario;
grant execute on all functions in schema public to app_usuario;
-- Los catálogos de ARCA y los padrones son de solo lectura para la aplicación.
revoke insert, update, delete on arca_tipo_comprobante, arca_alicuota_iva, arca_tipo_documento,
  arca_condicion_iva, arca_concepto, arca_moneda, arca_jurisdiccion, unidad_medida from app_usuario;

-- Los libros de solo agregar no se modifican ni desde la aplicación (los triggers lo impiden también al dueño).
revoke update, delete, truncate on evento, auditoria from app_usuario;

-- Auditoría de lo que importa.
create trigger aud_comprobante    after insert or update or delete on comprobante    for each row execute function fn_auditar();
create trigger aud_pago           after insert or update or delete on pago           for each row execute function fn_auditar();
create trigger aud_asiento        after insert or update or delete on asiento        for each row execute function fn_auditar();
create trigger aud_tercero        after insert or update or delete on tercero        for each row execute function fn_auditar();
create trigger aud_retencion      after insert or update or delete on retencion      for each row execute function fn_auditar();
create trigger aud_regimen        after insert or update or delete on regimen_retencion for each row execute function fn_auditar();
create trigger aud_periodo        after insert or update or delete on periodo        for each row execute function fn_auditar();
