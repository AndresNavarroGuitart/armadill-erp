-- Asistente con Claude: configuración por estudio, registro de uso y control de cuota. Va DESPUÉS de 17 y define su propia RLS.
-- El registro de uso es de solo agregar y NO guarda el texto de las preguntas ni de las respuestas: solo cuánto se usó y cuánto costó.

create table asistente_config (
  estudio_id             bigint primary key references estudio(id),
  activo                 boolean not null default true,      -- guías y conceptos
  datos_activo           boolean not null default false,     -- consultar datos de las empresas (fase 2): APAGADO por defecto
  guardar_conversaciones boolean not null default false,
  cuota_diaria_usuario   int     not null default 40 check (cuota_diaria_usuario >= 0),
  tope_mensual_usd       numeric(10,2) not null default 50 check (tope_mensual_usd >= 0),   -- valor provisorio hasta decidir el presupuesto
  actualizado_en         timestamptz not null default now()
);

create table asistente_uso (
  id                    bigint generated always as identity primary key,
  estudio_id            bigint not null references estudio(id),
  empresa_id            bigint references empresa(id),
  usuario_id            bigint not null references usuario(id),
  en                    timestamptz not null default now(),
  modelo                text   not null,                      -- 'basico' cuando respondió el modo básico
  tokens_entrada        int    not null default 0 check (tokens_entrada >= 0),
  tokens_cache_lectura  int    not null default 0 check (tokens_cache_lectura >= 0),
  tokens_cache_escritura int   not null default 0 check (tokens_cache_escritura >= 0),
  tokens_salida         int    not null default 0 check (tokens_salida >= 0),
  herramientas          text[] not null default '{}',
  resultado             text   not null check (resultado in ('ok','modo_basico','rechazado','error','cuota','apagado')),
  ms                    int    check (ms is null or ms >= 0),
  costo_usd             numeric(10,5) not null default 0 check (costo_usd >= 0)
);
create index asistente_uso_estudio_en on asistente_uso (estudio_id, en);
create index asistente_uso_usuario_en on asistente_uso (usuario_id, en);

create trigger trg_asistente_uso_solo_agregar before update or delete on asistente_uso
  for each row execute function fn_solo_agregar();
create trigger trg_asistente_uso_sin_truncar before truncate on asistente_uso
  for each statement execute function fn_solo_agregar();

-- Argentina no usa horario de verano: el día y el mes se cuentan con UTC−3 fijo.
create view v_asistente_uso_dia with (security_invoker = true) as
  select estudio_id, usuario_id, (en - interval '3 hours')::date as dia,
         count(*) filter (where resultado in ('ok','rechazado')) as consultas_claude,
         count(*) as consultas_total, coalesce(sum(costo_usd), 0) as costo_usd
    from asistente_uso group by estudio_id, usuario_id, (en - interval '3 hours')::date;

create view v_asistente_gasto_mes with (security_invoker = true) as
  select estudio_id, date_trunc('month', en - interval '3 hours')::date as mes,
         count(*) as consultas, coalesce(sum(costo_usd), 0) as costo_usd
    from asistente_uso group by estudio_id, date_trunc('month', en - interval '3 hours')::date;

-- Estado de la cuota de una persona: lo consulta la API antes de llamar a Claude.
-- motivo: null = puede usarlo; 'apagado' | 'cuota_diaria' | 'tope_mensual' = se atiende en modo básico. aviso = pasó el 80 %.
create function fn_asistente_estado(p_estudio bigint, p_usuario bigint)
returns table (motivo text, aviso boolean, usadas_hoy int, cuota_diaria int, gasto_mes numeric, tope_mensual numeric) language sql stable as
$$
  with cfg as (
    select coalesce(c.activo, true) activo, coalesce(c.cuota_diaria_usuario, 40) cuota, coalesce(c.tope_mensual_usd, 50) tope
      from (select 1) x left join asistente_config c on c.estudio_id = p_estudio
  ), hoy as (
    select coalesce(sum(consultas_claude), 0)::int n from v_asistente_uso_dia
     where estudio_id = p_estudio and usuario_id = p_usuario and dia = (now() - interval '3 hours')::date
  ), mes as (
    select coalesce(sum(costo_usd), 0) usd from v_asistente_gasto_mes
     where estudio_id = p_estudio and mes = date_trunc('month', now() - interval '3 hours')::date
  )
  select case when not cfg.activo then 'apagado'
              when hoy.n >= cfg.cuota then 'cuota_diaria'
              when mes.usd >= cfg.tope then 'tope_mensual' end,
         (hoy.n >= cfg.cuota * 0.8 or mes.usd >= cfg.tope * 0.8) and cfg.activo,
         hoy.n, cfg.cuota, mes.usd, cfg.tope
    from cfg, hoy, mes
$$;

-- RLS: cada estudio ve y escribe lo suyo. No hay política de modificación ni de baja del uso.
alter table asistente_config enable row level security; alter table asistente_config force row level security;
create policy cfg_estudio on asistente_config using (estudio_id = fn_estudio_actual()) with check (estudio_id = fn_estudio_actual());
alter table asistente_uso enable row level security; alter table asistente_uso force row level security;
create policy uso_leer on asistente_uso for select using (estudio_id = fn_estudio_actual());
create policy uso_agregar on asistente_uso for insert
  with check (estudio_id = fn_estudio_actual() and (empresa_id is null or exists (select 1 from empresa e where e.id = empresa_id and e.estudio_id = fn_estudio_actual())));

grant select, insert, update on asistente_config to app_usuario;
grant select, insert on asistente_uso to app_usuario;
grant select on v_asistente_uso_dia, v_asistente_gasto_mes to app_usuario;
grant usage on all sequences in schema public to app_usuario;
grant execute on function fn_asistente_estado(bigint, bigint) to app_usuario;
