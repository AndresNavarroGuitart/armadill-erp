// Administración del estudio (solo administradores del estudio): personas y sus accesos, empresas, roles y datos del estudio.
// El servidor impone las reglas (no quedarse sin administradores, todo del mismo estudio); acá solo se ofrece lo que tiene sentido y se muestran sus mensajes.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { enviar, ErrorApi, obtener } from '../api';
import { useSesion } from '../sesion';
import { cuitConGuiones, CONDICIONES_IVA, fecha, nombreCondicion } from '../formato';
import type { Acceso, EmpresaAdmin, EstudioDatos, Permiso, Persona, ResultadoInvitacion, Rol } from '../tipos';
import { Alerta, Campo, Cargando, Etiqueta, Modal, resumenErrores, Selector, useAviso, Vacio } from '../ui';

type Pestana = 'personas' | 'empresas' | 'roles' | 'estudio';
const PESTANAS: [Pestana, string][] = [['personas', 'Personas'], ['empresas', 'Empresas'], ['roles', 'Roles y permisos'], ['estudio', 'Datos del estudio']];

export function Estudio() {
  const [pestana, setPestana] = useState<Pestana>('personas');
  const [empresas, setEmpresas] = useState<EmpresaAdmin[] | null>(null);
  const [roles, setRoles] = useState<Rol[] | null>(null);
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [invitaciones, setInvitaciones] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const refrescar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let vivo = true;
    Promise.all([obtener<{ datos: EmpresaAdmin[] }>('/api/estudio/empresas'), obtener<{ datos: Rol[] }>('/api/estudio/roles'), obtener<{ datos: Permiso[] }>('/api/estudio/permisos'), obtener<EstudioDatos>('/api/estudio')])
      .then(([e, r, p, est]) => { if (vivo) { setEmpresas(e.datos); setRoles(r.datos); setPermisos(p.datos); setInvitaciones(est.invitaciones); setError(null); } })
      .catch((e) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, [recarga]);

  return (
    <>
      <div className="cabecera"><div><h1>Estudio</h1><p>Personas, accesos a cada empresa, roles y empresas del estudio.</p></div></div>
      <div className="pestanas" role="tablist" aria-label="Administración del estudio">
        {PESTANAS.map(([k, n]) => <button key={k} role="tab" id={`tab-${k}`} aria-selected={pestana === k} aria-controls={`panel-${k}`} className="pestana" onClick={() => setPestana(k)}>{n}</button>)}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!error && (!empresas || !roles) && <Cargando />}
      {empresas && roles && (
        <div role="tabpanel" id={`panel-${pestana}`} aria-labelledby={`tab-${pestana}`}>
          {pestana === 'personas' && <Personas empresas={empresas} roles={roles} invitaciones={invitaciones} />}
          {pestana === 'empresas' && <Empresas empresas={empresas} onCambio={refrescar} />}
          {pestana === 'roles' && <Roles roles={roles} permisos={permisos} onCambio={refrescar} />}
          {pestana === 'estudio' && <DatosEstudio />}
        </div>
      )}
    </>
  );
}

/* ====================== Personas ====================== */
function Personas({ empresas, roles, invitaciones }: { empresas: EmpresaAdmin[]; roles: Rol[]; invitaciones: boolean }) {
  const { yo } = useSesion();
  const [datos, setDatos] = useState<Persona[] | null>(null);
  const [q, setQ] = useState('');
  const [verBajas, setVerBajas] = useState(false);
  const [abierta, setAbierta] = useState<Persona | 'nueva' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      obtener<{ datos: Persona[] }>('/api/estudio/personas', { q: q.trim() || undefined, activo: verBajas ? 'false' : 'true' }).then((r) => { setDatos(r.datos); setError(null); }).catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, verBajas, recarga]);

  return (
    <>
      <div className="herramientas">
        <Campo etiqueta="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o email" />
        <label className="btn"><input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Ver dadas de baja</label>
        <div className="sp" style={{ flex: 1 }} />
        <button className="btn primario" onClick={() => setAbierta('nueva')}>Nueva persona</button>
      </div>
      {error && <Alerta>{error}</Alerta>}
      {!datos && !error && <Cargando />}
      {datos && datos.length === 0 && <div className="tarjeta"><Vacio titulo={q ? 'No hay resultados' : verBajas ? 'No hay personas dadas de baja' : 'Todavía no cargaste personas'} /></div>}
      {datos && datos.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Persona</th><th>Accesos</th><th>Estado</th></tr></thead>
            <tbody>
              {datos.map((p) => (
                <tr key={p.id} className="clic" onClick={() => setAbierta(p)}>
                  <td><strong>{p.nombre}</strong>{p.id === yo?.usuario.id && ' (vos)'}<div className="muted">{p.email}</div></td>
                  <td>{p.accesos.length === 0 ? <span className="muted">Sin acceso a empresas</span> : p.accesos.map((a) => <div key={a.empresa_id}>{a.empresa} <span className="muted">· {a.rol}</span></div>)}</td>
                  <td>
                    {p.admin_estudio && <Etiqueta tono="info">Administra el estudio</Etiqueta>} {!p.vinculada && p.activo && <Etiqueta tono="aviso">{p.invitada_en ? `Invitada el ${fecha(p.invitada_en)}` : 'Sin invitar'}</Etiqueta>} {!p.activo && <Etiqueta tono="malo">De baja</Etiqueta>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {abierta && <FormPersona persona={abierta === 'nueva' ? null : abierta} empresas={empresas} roles={roles} invitaciones={invitaciones} yoId={yo?.usuario.id ?? 0} onCerrar={() => setAbierta(null)} onGuardado={() => { setAbierta(null); setRecarga((n) => n + 1); }} onRefrescar={() => setRecarga((n) => n + 1)} />}
    </>
  );
}

type FilaAcceso = { clave: number; empresa_id: string; rol_id: string };
let claveFila = 0;

function EditorAccesos({ filas, setFilas, empresas, roles, errores, deshabilitado }: { filas: FilaAcceso[]; setFilas: (f: FilaAcceso[]) => void; empresas: EmpresaAdmin[]; roles: Rol[]; errores: Record<string, string>; deshabilitado?: boolean }) {
  const libres = (actual: string) => empresas.filter((e) => e.activa && (String(e.id) === actual || !filas.some((f) => f.empresa_id === String(e.id))));
  return (
    <div>
      {filas.length === 0 && <p className="muted" style={{ margin: '4px 0 8px' }}>No tiene acceso a ninguna empresa.</p>}
      {filas.map((f, i) => (
        <div key={f.clave} className="fila-acceso">
          <Selector etiqueta={i === 0 ? 'Empresa' : `Empresa ${i + 1}`} value={f.empresa_id} disabled={deshabilitado} error={errores[`accesos[${i}].empresa_id`]} onChange={(e) => setFilas(filas.map((x) => (x.clave === f.clave ? { ...x, empresa_id: e.target.value } : x)))}>
            <option value="">Elegí una empresa…</option>{libres(f.empresa_id).map((e) => <option key={e.id} value={e.id}>{e.razon_social}</option>)}
          </Selector>
          <Selector etiqueta="Rol" value={f.rol_id} disabled={deshabilitado} error={errores[`accesos[${i}].rol_id`]} onChange={(e) => setFilas(filas.map((x) => (x.clave === f.clave ? { ...x, rol_id: e.target.value } : x)))}>
            <option value="">Elegí un rol…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </Selector>
          {!deshabilitado && <button type="button" className="icono" style={{ marginTop: 22 }} aria-label={`Quitar el acceso ${i + 1}`} onClick={() => setFilas(filas.filter((x) => x.clave !== f.clave))}>×</button>}
        </div>
      ))}
      {!deshabilitado && <button type="button" className="btn chico" disabled={libres('').length === 0} onClick={() => setFilas([...filas, { clave: ++claveFila, empresa_id: '', rol_id: String(roles.find((r) => r.nombre === 'Consulta')?.id ?? '') }])}>+ Agregar acceso a una empresa</button>}
    </div>
  );
}
const filasDe = (accesos: Acceso[]): FilaAcceso[] => accesos.map((a) => ({ clave: ++claveFila, empresa_id: String(a.empresa_id), rol_id: String(a.rol_id) }));
const aCuerpo = (filas: FilaAcceso[]) => filas.map((f) => ({ empresa_id: Number(f.empresa_id), rol_id: Number(f.rol_id) }));

function FormPersona({ persona, empresas, roles, invitaciones, yoId, onCerrar, onGuardado, onRefrescar }: { persona: Persona | null; empresas: EmpresaAdmin[]; roles: Rol[]; invitaciones: boolean; yoId: number; onCerrar: () => void; onGuardado: () => void; onRefrescar?: () => void }) {
  const avisar = useAviso();
  const [nombre, setNombre] = useState(persona?.nombre ?? '');
  const [email, setEmail] = useState(persona?.email ?? '');
  const [activo, setActivo] = useState(persona?.activo ?? true);
  const [admin, setAdmin] = useState(persona?.admin_estudio ?? false);
  const [filas, setFilas] = useState<FilaAcceso[]>(() => filasDe(persona?.accesos ?? []));
  const [error, setError] = useState<unknown>(null);
  const [errorAccesos, setErrorAccesos] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [invitar, setInvitar] = useState(invitaciones);
  const [resultadoInv, setResultadoInv] = useState<{ tipo: 'info' | 'error'; texto: string } | null>(null);
  const campos = error instanceof ErrorApi ? error.campos : {}, camposAcc = errorAccesos instanceof ErrorApi ? errorAccesos.campos : {};
  const yoMisma = persona?.id === yoId;

  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try {
      if (!persona) {
        const creada = await enviar<Persona>('POST', '/api/estudio/personas', { email: email.trim(), nombre: nombre.trim(), admin_estudio: admin, accesos: aCuerpo(filas) });
        // La persona ya quedó guardada; la invitación es un segundo paso que puede fallar sin deshacer el alta.
        if (invitaciones && invitar) {
          try { const r = await enviar<ResultadoInvitacion>('POST', `/api/estudio/personas/${creada.id}/invitacion`, {}); avisar(`${creada.nombre} quedó cargada. ${r.mensaje}`); }
          catch (e) { avisar(`${creada.nombre} quedó cargada, pero no se pudo enviar la invitación: ${(e as Error).message} Podés reenviarla desde su ficha.`, 'error'); }
        } else avisar(`${creada.nombre} quedó cargada. Para que ingrese, tiene que tener una cuenta con ${creada.email}.`);
      } else {
        const cambios: Record<string, unknown> = {};
        if (nombre.trim() !== persona.nombre) cambios.nombre = nombre.trim();
        if (!persona.vinculada && email.trim().toLowerCase() !== persona.email) cambios.email = email.trim();
        if (activo !== persona.activo) cambios.activo = activo;
        if (admin !== persona.admin_estudio) cambios.admin_estudio = admin;
        if (Object.keys(cambios).length) { await enviar('PATCH', `/api/estudio/personas/${persona.id}`, cambios); avisar('Cambios guardados.'); }
      }
      onGuardado();
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  async function guardarAccesos() {
    if (!persona) return;
    setTrabajando(true); setErrorAccesos(null);
    try { await enviar('PUT', `/api/estudio/personas/${persona.id}/accesos`, { accesos: aCuerpo(filas) }); avisar('Accesos guardados.'); onGuardado(); } catch (e) { setErrorAccesos(e); } finally { setTrabajando(false); }
  }
  async function invitarAhora() {
    if (!persona) return;
    setTrabajando(true); setResultadoInv(null);
    try { const r = await enviar<ResultadoInvitacion>('POST', `/api/estudio/personas/${persona.id}/invitacion`, {}); setResultadoInv({ tipo: 'info', texto: r.mensaje }); onRefrescar?.(); } catch (e) { setResultadoInv({ tipo: 'error', texto: (e as Error).message }); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['nombre', 'email', 'activo', 'admin_estudio', ...Array.from({ length: filas.length }, (_, i) => `accesos[${i}].empresa_id`)]);
  const generalAcc = resumenErrores(errorAccesos, Array.from({ length: filas.length }, (_, i) => `accesos[${i}].empresa_id`).concat(Array.from({ length: filas.length }, (_, i) => `accesos[${i}].rol_id`)));
  const accesosCompletos = filas.every((f) => f.empresa_id && f.rol_id);

  return (
    <Modal titulo={persona ? persona.nombre : 'Nueva persona'} onCerrar={onCerrar} ancho={640}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        {!persona && <Alerta tipo="info">Cargá a la persona y sus accesos. Para ingresar tiene que tener una cuenta con <strong>ese mismo email</strong>; la primera vez que entra queda vinculada.{!invitaciones && ' Esta instalación no envía invitaciones desde el sistema: invitala desde el panel de Supabase.'}</Alerta>}
        {persona && !persona.vinculada && persona.activo && <Alerta tipo="aviso">Todavía no ingresó al sistema: hasta entonces se puede corregir su email. {persona.invitada_en ? `Se la invitó el ${fecha(persona.invitada_en)}.` : 'Todavía no se la invitó.'}</Alerta>}
        {resultadoInv && <Alerta tipo={resultadoInv.tipo}>{resultadoInv.texto}</Alerta>}
        <div className="rejilla">
          <Campo etiqueta="Nombre y apellido" value={nombre} error={campos.nombre} onChange={(e) => setNombre(e.target.value)} autoFocus={!persona} />
          <Campo etiqueta="Email" type="email" value={email} disabled={!!persona?.vinculada} error={campos.email} ayuda={persona?.vinculada ? 'Ya ingresó: el email no se cambia.' : undefined} onChange={(e) => setEmail(e.target.value)} />
          <label className="btn ancho"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Administra el estudio (personas, empresas y roles)</label>
          {persona && <label className="btn ancho"><input type="checkbox" checked={activo} disabled={yoMisma} onChange={(e) => setActivo(e.target.checked)} /> Activa {yoMisma ? '(no podés darte de baja a vos misma)' : '(si la desmarcás, pierde el acceso en el acto)'}</label>}
        </div>
        {!persona && invitaciones && <label className="btn ancho" style={{ marginTop: 12 }}><input type="checkbox" checked={invitar} onChange={(e) => setInvitar(e.target.checked)} /> Enviarle ahora una invitación por email para crear su cuenta</label>}
        {!persona && (<><h3 style={{ margin: '16px 0 6px' }}>Acceso a empresas</h3><EditorAccesos filas={filas} setFilas={setFilas} empresas={empresas} roles={roles} errores={campos} /></>)}
        <div className="pie-form">
          {persona && !persona.vinculada && persona.activo && invitaciones && <button type="button" className="btn" disabled={trabajando} onClick={invitarAhora}>{persona.invitada_en || resultadoInv?.tipo === 'info' ? 'Reenviar invitación' : 'Enviar invitación'}</button>}
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn primario" disabled={trabajando || !nombre.trim() || !email.trim() || (!persona && !accesosCompletos)}>{trabajando ? 'Guardando…' : persona ? 'Guardar datos' : 'Crear persona'}</button>
        </div>
      </form>
      {persona && (
        <section style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 6 }}>Acceso a empresas</h3>
          {generalAcc && <Alerta>{generalAcc}</Alerta>}
          <EditorAccesos filas={filas} setFilas={setFilas} empresas={empresas} roles={roles} errores={camposAcc} />
          <div className="pie-form"><button type="button" className="btn" disabled={trabajando || !accesosCompletos} onClick={guardarAccesos}>Guardar accesos</button></div>
        </section>
      )}
    </Modal>
  );
}

/* ====================== Empresas ====================== */
function Empresas({ empresas, onCambio }: { empresas: EmpresaAdmin[]; onCambio: () => void }) {
  const { yo, elegirEmpresa } = useSesion();
  const [abierta, setAbierta] = useState<EmpresaAdmin | 'nueva' | null>(null);
  const [verBajas, setVerBajas] = useState(false);
  const lista = empresas.filter((e) => e.activa !== verBajas);
  const mias = new Set(yo?.empresas.map((e) => e.id));
  return (
    <>
      <div className="herramientas">
        <label className="btn"><input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> Ver dadas de baja</label>
        <div className="sp" style={{ flex: 1 }} /><button className="btn primario" onClick={() => setAbierta('nueva')}>Nueva empresa</button>
      </div>
      {lista.length === 0 && <div className="tarjeta"><Vacio titulo={verBajas ? 'No hay empresas dadas de baja' : 'Todavía no cargaste empresas'}>{!verBajas ? 'Cada empresa nace lista para facturar: con su plan de cuentas, período, punto de venta, depósito y lista de precios.' : undefined}</Vacio></div>}
      {lista.length > 0 && (
        <div className="tabla-caja">
          <table>
            <thead><tr><th>Empresa</th><th>CUIT</th><th>Condición IVA</th><th className="num">Personas</th><th /></tr></thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className="clic" onClick={() => setAbierta(e)}>
                  <td><strong>{e.razon_social}</strong></td><td className="num" style={{ textAlign: 'left' }}>{cuitConGuiones(e.cuit)}</td><td>{nombreCondicion(e.condicion_iva_codigo)}</td><td className="num">{e.personas}</td>
                  <td>{!e.activa && <Etiqueta tono="aviso">De baja</Etiqueta>} {e.activa && !mias.has(e.id) && <Etiqueta>Sin acceso tuyo</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {abierta && <FormEmpresa empresa={abierta === 'nueva' ? null : abierta} puedeAbrir={abierta !== 'nueva' && mias.has(abierta.id) && abierta.activa} onAbrir={(id) => { elegirEmpresa(id).then(() => { location.hash = '#/factura'; }); }} onCerrar={() => setAbierta(null)} onGuardado={() => { setAbierta(null); onCambio(); }} />}
    </>
  );
}

function FormEmpresa({ empresa, puedeAbrir, onAbrir, onCerrar, onGuardado }: { empresa: EmpresaAdmin | null; puedeAbrir: boolean; onAbrir: (id: number) => void; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const { refrescarYo } = useSesion();
  const [v, setV] = useState({ cuit: empresa?.cuit ?? '', razon_social: empresa?.razon_social ?? '', condicion: String(empresa?.condicion_iva_codigo ?? 1), inicio: empresa?.inicio_actividades ?? '', iibb: empresa?.nro_iibb ?? '', domicilio: empresa?.domicilio_fiscal ?? '', activa: empresa?.activa ?? true, dar_acceso: true });
  const [error, setError] = useState<unknown>(null);
  const [trabajando, setTrabajando] = useState(false);
  const campos = error instanceof ErrorApi ? error.campos : {};
  const set = <K extends keyof typeof v>(k: K, valor: (typeof v)[K]) => setV((a) => ({ ...a, [k]: valor }));

  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try {
      const comunes = { razon_social: v.razon_social.trim(), condicion_iva_codigo: Number(v.condicion), inicio_actividades: v.inicio || null, nro_iibb: v.iibb.trim() || null, domicilio_fiscal: v.domicilio.trim() || null };
      if (!empresa) { await enviar('POST', '/api/estudio/empresas', { cuit: v.cuit.trim(), ...comunes, dar_acceso: v.dar_acceso }); avisar('Empresa creada y lista para facturar.'); }
      else {
        const antes: Record<string, unknown> = { razon_social: empresa.razon_social, condicion_iva_codigo: empresa.condicion_iva_codigo, inicio_actividades: empresa.inicio_actividades, nro_iibb: empresa.nro_iibb, domicilio_fiscal: empresa.domicilio_fiscal, activa: empresa.activa };
        const cambios = Object.fromEntries(Object.entries({ ...comunes, activa: v.activa }).filter(([k, valor]) => antes[k] !== valor));
        if (Object.keys(cambios).length) { await enviar('PATCH', `/api/estudio/empresas/${empresa.id}`, cambios); avisar('Cambios guardados.'); }
      }
      await refrescarYo(); onGuardado();
    } catch (e) { setError(e); } finally { setTrabajando(false); }
  }
  const general = resumenErrores(error, ['cuit', 'razon_social', 'condicion_iva_codigo', 'inicio_actividades', 'nro_iibb', 'domicilio_fiscal']);
  return (
    <Modal titulo={empresa ? empresa.razon_social : 'Nueva empresa'} onCerrar={onCerrar}>
      <form onSubmit={guardar} noValidate>
        {general && <Alerta>{general}</Alerta>}
        {!empresa && <Alerta tipo="info">La empresa nace lista para facturar: plan de cuentas básico (a revisar por el contador), ejercicio y períodos del año, punto de venta 1, depósito y lista de precios.</Alerta>}
        <div className="rejilla">
          <Campo etiqueta="CUIT" value={empresa ? cuitConGuiones(empresa.cuit) : v.cuit} disabled={!!empresa} error={campos.cuit} ayuda={empresa ? 'El CUIT no se modifica.' : 'Con o sin guiones'} inputMode="numeric" onChange={(e) => set('cuit', e.target.value)} autoFocus={!empresa} />
          <Selector etiqueta="Condición frente al IVA" value={v.condicion} error={campos.condicion_iva_codigo} onChange={(e) => set('condicion', e.target.value)}>{Object.entries(CONDICIONES_IVA).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Selector>
          <div className="ancho"><Campo etiqueta="Razón social" value={v.razon_social} error={campos.razon_social} onChange={(e) => set('razon_social', e.target.value)} /></div>
          <Campo etiqueta="Inicio de actividades" type="date" value={v.inicio} error={campos.inicio_actividades} onChange={(e) => set('inicio', e.target.value)} />
          <Campo etiqueta="Nº de Ingresos Brutos" value={v.iibb} error={campos.nro_iibb} onChange={(e) => set('iibb', e.target.value)} />
          <div className="ancho"><Campo etiqueta="Domicilio fiscal" value={v.domicilio} error={campos.domicilio_fiscal} onChange={(e) => set('domicilio', e.target.value)} /></div>
          {!empresa && <label className="btn ancho"><input type="checkbox" checked={v.dar_acceso} onChange={(e) => set('dar_acceso', e.target.checked)} /> Darme acceso como Administrador</label>}
          {empresa && <label className="btn ancho"><input type="checkbox" checked={v.activa} onChange={(e) => set('activa', e.target.checked)} /> Activa (si la desmarcás, nadie puede abrirla; no se borra nada)</label>}
        </div>
        <div className="pie-form">
          {puedeAbrir && empresa && <button type="button" className="btn" onClick={() => onAbrir(empresa.id)}>Abrir esta empresa</button>}
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn primario" disabled={trabajando || !v.razon_social.trim() || (!empresa && !v.cuit.trim())}>{trabajando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ====================== Roles ====================== */
function Roles({ roles, permisos, onCambio }: { roles: Rol[]; permisos: Permiso[]; onCambio: () => void }) {
  const [nuevo, setNuevo] = useState(false);
  const modulos = useMemo(() => [...new Set(permisos.map((p) => p.modulo))], [permisos]);
  return (
    <>
      <div className="herramientas"><p className="muted" style={{ margin: 0, flex: 1 }}>Un rol es un conjunto de permisos. A cada persona se le asigna un rol <strong>por empresa</strong>.</p><button className="btn primario" onClick={() => setNuevo(true)}>Nuevo rol</button></div>
      {roles.map((r) => <TarjetaRol key={r.id} rol={r} permisos={permisos} modulos={modulos} onCambio={onCambio} />)}
      {nuevo && <FormRol permisos={permisos} modulos={modulos} onCerrar={() => setNuevo(false)} onGuardado={() => { setNuevo(false); onCambio(); }} />}
    </>
  );
}
function SelectorPermisos({ permisos, modulos, marcados, setMarcados, deshabilitado }: { permisos: Permiso[]; modulos: string[]; marcados: Set<string>; setMarcados: (s: Set<string>) => void; deshabilitado?: boolean }) {
  return (
    <div className="rejilla" style={{ marginTop: 8 }}>
      {modulos.map((m) => (
        <fieldset key={m} className="grupo-permisos"><legend>{m}</legend>
          {permisos.filter((p) => p.modulo === m).map((p) => (
            <label key={p.clave}><input type="checkbox" disabled={deshabilitado} checked={marcados.has(p.clave)} onChange={(e) => { const s = new Set(marcados); if (e.target.checked) s.add(p.clave); else s.delete(p.clave); setMarcados(s); }} /> {p.descripcion}</label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
function TarjetaRol({ rol, permisos, modulos, onCambio }: { rol: Rol; permisos: Permiso[]; modulos: string[]; onCambio: () => void }) {
  const avisar = useAviso();
  const [abierto, setAbierto] = useState(false);
  const [marcados, setMarcados] = useState(new Set(rol.permisos));
  const [error, setError] = useState<string | null>(null);
  const igual = marcados.size === rol.permisos.length && rol.permisos.every((p) => marcados.has(p));
  async function guardar() {
    setError(null);
    try { await enviar('PUT', `/api/estudio/roles/${rol.id}/permisos`, { permisos: [...marcados] }); avisar(`Permisos del rol ${rol.nombre} guardados.`); onCambio(); } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="tarjeta">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ marginRight: 'auto' }}>{rol.nombre}</h2>
        <span className="muted">{rol.permisos.length} permisos · {rol.accesos} {rol.accesos === 1 ? 'acceso' : 'accesos'}</span>
        {rol.sistema && <Etiqueta tono="info">Siempre tiene todos</Etiqueta>}
        <button className="btn chico" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{abierto ? 'Ocultar' : rol.sistema ? 'Ver permisos' : 'Ver y editar permisos'}</button>
      </div>
      {abierto && (
        <>
          {error && <Alerta>{error}</Alerta>}
          <SelectorPermisos permisos={permisos} modulos={modulos} marcados={rol.sistema ? new Set(permisos.map((p) => p.clave)) : marcados} setMarcados={setMarcados} deshabilitado={rol.sistema} />
          {!rol.sistema && <div className="pie-form"><button className="btn primario" disabled={igual} onClick={guardar}>Guardar permisos</button></div>}
        </>
      )}
    </div>
  );
}
function FormRol({ permisos, modulos, onCerrar, onGuardado }: { permisos: Permiso[]; modulos: string[]; onCerrar: () => void; onGuardado: () => void }) {
  const avisar = useAviso();
  const [nombre, setNombre] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set(permisos.filter((p) => p.clave.endsWith('.ver')).map((p) => p.clave)));
  const [error, setError] = useState<unknown>(null);
  const campos = error instanceof ErrorApi ? error.campos : {};
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setError(null);
    try { await enviar('POST', '/api/estudio/roles', { nombre: nombre.trim(), permisos: [...marcados] }); avisar('Rol creado.'); onGuardado(); } catch (e) { setError(e); }
  }
  return (
    <Modal titulo="Nuevo rol" onCerrar={onCerrar} ancho={640}>
      <form onSubmit={guardar} noValidate>
        {resumenErrores(error, ['nombre']) && <Alerta>{resumenErrores(error, ['nombre'])}</Alerta>}
        <Campo etiqueta="Nombre del rol" value={nombre} error={campos.nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        <SelectorPermisos permisos={permisos} modulos={modulos} marcados={marcados} setMarcados={setMarcados} />
        <div className="pie-form"><button type="button" className="btn" onClick={onCerrar}>Cancelar</button><button type="submit" className="btn primario" disabled={nombre.trim().length < 3}>Crear rol</button></div>
      </form>
    </Modal>
  );
}

/* ====================== Datos del estudio ====================== */
function DatosEstudio() {
  const avisar = useAviso();
  const [e, setE] = useState<EstudioDatos | null>(null);
  const [nombre, setNombre] = useState('');
  const [cuit, setCuit] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { obtener<EstudioDatos>('/api/estudio').then((x) => { setE(x); setNombre(x.nombre); setCuit(x.cuit ?? ''); }).catch(setError); }, []);
  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setError(null);
    try {
      const cambios: Record<string, unknown> = {};
      if (e && nombre.trim() !== e.nombre) cambios.nombre = nombre.trim();
      if (e && (cuit.trim() || null) !== e.cuit) cambios.cuit = cuit.trim() || null;
      if (!Object.keys(cambios).length) return;
      setE(await enviar<EstudioDatos>('PATCH', '/api/estudio', cambios)); avisar('Datos del estudio guardados.');
    } catch (x) { setError(x); }
  }
  const campos = error instanceof ErrorApi ? error.campos : {};
  if (!e && !error) return <Cargando />;
  return (
    <form className="tarjeta" onSubmit={guardar} noValidate style={{ maxWidth: 560 }}>
      {resumenErrores(error, ['nombre', 'cuit']) && <Alerta>{resumenErrores(error, ['nombre', 'cuit'])}</Alerta>}
      <div className="rejilla">
        <div className="ancho"><Campo etiqueta="Nombre del estudio" value={nombre} error={campos.nombre} onChange={(x) => setNombre(x.target.value)} /></div>
        <Campo etiqueta="CUIT del estudio" value={cuit} error={campos.cuit} ayuda="Opcional" inputMode="numeric" onChange={(x) => setCuit(x.target.value)} />
      </div>
      {e && <p className="muted">{e.personas} {e.personas === 1 ? 'persona activa' : 'personas activas'} · {e.empresas} {e.empresas === 1 ? 'empresa activa' : 'empresas activas'}</p>}
      <div className="pie-form"><button className="btn primario" type="submit">Guardar</button></div>
    </form>
  );
}
