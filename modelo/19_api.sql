-- Acceso para la API: identificar a la persona que inició sesión, qué empresas puede abrir y con qué permisos,
-- y evitar que un doble clic emita dos facturas. Va DESPUÉS de 17 y de 18 y define su propia RLS.
--
-- Las funciones de acceso son SECURITY DEFINER porque se usan ANTES de saber el estudio de la persona (no hay contexto de
-- sesión todavía y la RLS lo impediría). Devuelven solo lo mínimo y se ejecutan con el rol de la aplicación.
-- En una base real, el dueño de estas funciones debe poder saltear RLS (en Supabase, el rol "postgres").

-- Vínculo con el proveedor de identidad (el "sub" del token). La primera vez se vincula por email verificado.
alter table usuario add column auth_sub text unique;

-- Catálogo de permisos que usa la API. Los roles (por estudio) los combinan.
insert into permiso (clave, modulo, descripcion) values
  ('clientes.ver',      'ventas',    'Ver clientes'),
  ('clientes.editar',   'ventas',    'Crear y modificar clientes'),
  ('proveedores.ver',   'compras',   'Ver proveedores'),
  ('proveedores.editar','compras',   'Crear y modificar proveedores'),
  ('articulos.ver',     'maestros',  'Ver artículos, precios y listas'),
  ('articulos.editar',  'maestros',  'Crear y modificar artículos y precios'),
  ('ventas.ver',        'ventas',    'Ver comprobantes de venta'),
  ('ventas.emitir',     'ventas',    'Emitir facturas de venta'),
  ('asistente.usar',    'asistente', 'Usar el asistente'),
  ('asistente.datos',   'asistente', 'Que el asistente consulte datos de las empresas');

-- Roles base de un estudio nuevo. Los puede ajustar cada estudio después.
create function fn_roles_base(p_estudio bigint) returns void language plpgsql as
$$
declare r_adm bigint; r_con bigint; r_aux bigint; r_lec bigint;
begin
  insert into rol (estudio_id, nombre) values (p_estudio, 'Administrador') on conflict (estudio_id, nombre) do nothing;
  insert into rol (estudio_id, nombre) values (p_estudio, 'Contador')      on conflict (estudio_id, nombre) do nothing;
  insert into rol (estudio_id, nombre) values (p_estudio, 'Auxiliar')      on conflict (estudio_id, nombre) do nothing;
  insert into rol (estudio_id, nombre) values (p_estudio, 'Consulta')      on conflict (estudio_id, nombre) do nothing;
  select id into r_adm from rol where estudio_id = p_estudio and nombre = 'Administrador';
  select id into r_con from rol where estudio_id = p_estudio and nombre = 'Contador';
  select id into r_aux from rol where estudio_id = p_estudio and nombre = 'Auxiliar';
  select id into r_lec from rol where estudio_id = p_estudio and nombre = 'Consulta';
  insert into rol_permiso (rol_id, permiso_clave) select r, p.clave from (values (r_adm), (r_con)) x(r), permiso p on conflict do nothing;
  insert into rol_permiso (rol_id, permiso_clave) select r_aux, clave from permiso
   where clave like '%.ver' or clave in ('ventas.emitir', 'clientes.editar', 'articulos.editar', 'asistente.usar') on conflict do nothing;
  insert into rol_permiso (rol_id, permiso_clave) select r_lec, clave from permiso
   where clave like '%.ver' or clave = 'asistente.usar' on conflict do nothing;
end
$$;
revoke execute on function fn_roles_base(bigint) from public;

-- Quién es la persona del token. Devuelve nada si no existe o está dada de baja.
create function fn_autenticar(p_sub text, p_email text, p_email_verificado boolean)
returns table (usuario_id bigint, estudio_id bigint, nombre text) language plpgsql security definer set search_path = public as
$$
declare u usuario%rowtype;
begin
  if p_sub is null or length(p_sub) = 0 then return; end if;
  select * into u from usuario where auth_sub = p_sub and activo;
  if not found and p_email is not null and p_email_verificado then
    -- primer ingreso: se vincula por email verificado, y solo si ese usuario todavía no estaba vinculado
    select * into u from usuario where lower(email) = lower(p_email) and activo and auth_sub is null;
    if found then update usuario set auth_sub = p_sub where id = u.id; end if;
  end if;
  if not found then return; end if;
  return query select u.id, u.estudio_id, u.nombre;
end
$$;

-- Empresas que la persona puede abrir y con qué rol.
create function fn_empresas_de(p_usuario bigint)
returns table (empresa_id bigint, razon_social text, cuit text, condicion_iva_codigo smallint, rol text) language sql stable security definer set search_path = public as
$$
  select e.id, e.razon_social, e.cuit, e.condicion_iva_codigo, r.nombre
    from usuario u
    join usuario_empresa ue on ue.usuario_id = u.id
    join empresa e on e.id = ue.empresa_id and e.estudio_id = u.estudio_id and e.activa
    join rol r on r.id = ue.rol_id
   where u.id = p_usuario and u.activo
   order by e.razon_social
$$;

-- Contexto de trabajo en una empresa: estudio, rol y permisos. Vacío si la persona no tiene acceso a esa empresa.
create function fn_contexto_empresa(p_usuario bigint, p_empresa bigint)
returns table (empresa_id bigint, estudio_id bigint, razon_social text, cuit text, condicion_iva_codigo smallint, rol_id bigint, rol text, permisos text[])
language sql stable security definer set search_path = public as
$$
  select e.id, e.estudio_id, e.razon_social, e.cuit, e.condicion_iva_codigo, r.id, r.nombre,
         coalesce(array_agg(rp.permiso_clave order by rp.permiso_clave) filter (where rp.permiso_clave is not null and rp.valor <> 'no'), '{}')
    from usuario u
    join usuario_empresa ue on ue.usuario_id = u.id and ue.empresa_id = p_empresa
    join empresa e on e.id = ue.empresa_id and e.estudio_id = u.estudio_id and e.activa
    join rol r on r.id = ue.rol_id and r.estudio_id = u.estudio_id
    left join rol_permiso rp on rp.rol_id = r.id
   where u.id = p_usuario and u.activo
   group by e.id, e.estudio_id, e.razon_social, e.cuit, e.condicion_iva_codigo, r.id, r.nombre
$$;

revoke execute on function fn_autenticar(text, text, boolean), fn_empresas_de(bigint), fn_contexto_empresa(bigint, bigint) from public;
grant execute on function fn_autenticar(text, text, boolean), fn_empresas_de(bigint), fn_contexto_empresa(bigint, bigint) to app_usuario;

-- Un pedido repetido (doble clic, reintento por red) no emite dos veces: la clave del cliente identifica el pedido.
create table api_idempotencia (
  empresa_id     bigint not null references empresa(id),
  clave          text   not null check (length(clave) between 8 and 100),
  usuario_id     bigint not null references usuario(id),
  huella         text   not null,                                  -- resumen del pedido: la misma clave con otro pedido se rechaza
  comprobante_id bigint references comprobante(id),
  creado_en      timestamptz not null default now(),
  primary key (empresa_id, clave)
);
alter table api_idempotencia enable row level security;
alter table api_idempotencia force row level security;
create policy aislamiento_empresa on api_idempotencia using (empresa_id = fn_empresa_actual()) with check (empresa_id = fn_empresa_actual());
grant select, insert on api_idempotencia to app_usuario;
