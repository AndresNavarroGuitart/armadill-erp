// Ingreso. Con Supabase Auth: email y contraseña, o un enlace por email. En desarrollo (sin Supabase configurado) ofrece las personas de
// prueba que publica el servidor de desarrollo de la API. En un build de producción sin configurar no ofrece nada.
import { useEffect, useState, type FormEvent } from 'react';
import { useSesion, type PersonaDev } from '../sesion';
import { Alerta, Campo, Cargando, useAviso } from '../ui';

type Vista = 'clave' | 'enlace' | 'olvide';

export function Ingreso({ mensaje }: { mensaje: string | null }) {
  const { identidad } = useSesion();
  return (
    <div className="ingreso">
      <div className="caja tarjeta">
        <div className="logo" aria-hidden="true">a</div>
        <h1>administraNET</h1>
        <p className="muted">Gestión contable para estudios.</p>
        {mensaje && <Alerta>{mensaje}</Alerta>}
        {identidad.tipo === 'supabase' && <IngresoReal />}
        {identidad.tipo === 'desarrollo' && <IngresoDesarrollo />}
        {identidad.tipo === 'ninguna' && <Alerta tipo="aviso">El ingreso no está configurado en esta instalación. Avisale a quien administra el sistema.</Alerta>}
      </div>
    </div>
  );
}

function IngresoReal() {
  const { identidad, alIngresar } = useSesion();
  const [vista, setVista] = useState<Vista>('clave');
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function enviar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null); setEnviado(null);
    try {
      if (vista === 'clave') { await identidad.ingresarConClave(email, clave); setClave(''); await alIngresar(); }
      else if (vista === 'enlace') { await identidad.enviarEnlace(email); setEnviado('Si ese email está registrado, te enviamos un enlace para ingresar. Revisá tu casilla (y la carpeta de spam).'); }
      else { await identidad.recuperarClave(email); setEnviado('Si ese email está registrado, te enviamos un enlace para elegir una contraseña nueva.'); }
    } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  const cambiar = (v: Vista) => { setVista(v); setError(null); setEnviado(null); };

  return (
    <form onSubmit={enviar} noValidate style={{ marginTop: 14 }}>
      {error && <Alerta>{error}</Alerta>}
      {enviado && <Alerta tipo="info">{enviado}</Alerta>}
      <div className="rejilla" style={{ gridTemplateColumns: '1fr' }}>
        <Campo etiqueta="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        {vista === 'clave' && <Campo etiqueta="Contraseña" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} />}
      </div>
      <div className="pie-form" style={{ justifyContent: 'stretch' }}>
        <button type="submit" className="btn primario" style={{ width: '100%' }} disabled={trabajando || !email.trim() || (vista === 'clave' && !clave)}>
          {trabajando ? 'Un momento…' : vista === 'clave' ? 'Ingresar' : vista === 'enlace' ? 'Enviarme un enlace' : 'Enviarme el enlace'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 13, display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 0 }}>
        {vista !== 'clave' && <a href="#" onClick={(e) => { e.preventDefault(); cambiar('clave'); }}>Ingresar con contraseña</a>}
        {vista !== 'enlace' && <a href="#" onClick={(e) => { e.preventDefault(); cambiar('enlace'); }}>Entrar con un enlace por email</a>}
        {vista !== 'olvide' && <a href="#" onClick={(e) => { e.preventDefault(); cambiar('olvide'); }}>Olvidé mi contraseña</a>}
      </p>
      <p className="muted" style={{ fontSize: 12.5 }}>Si todavía no tenés acceso, pedíselo al administrador de tu estudio.</p>
    </form>
  );
}

function IngresoDesarrollo() {
  const { identidad, alIngresar } = useSesion();
  const avisar = useAviso();
  const [personas, setPersonas] = useState<PersonaDev[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    fetch('/dev/sesiones').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(setPersonas).catch(() => setPersonas([]));
  }, []);

  async function entrar(p: PersonaDev) {
    setEntrando(true); setFallo(null);
    try { identidad.ingresarConToken?.(p.token); await alIngresar(); }
    catch (e) { setFallo((e as Error).message); avisar(`No se pudo ingresar como ${p.clave}.`, 'error'); } finally { setEntrando(false); }
  }

  return (
    <>
      {fallo && <Alerta>{fallo}</Alerta>}
      {personas === null && <Cargando />}
      {personas && personas.length > 0 && (
        <>
          <Alerta tipo="aviso">Ingreso de <strong>desarrollo</strong>: elegí con qué persona de prueba entrar. Nada de esto existe en producción.</Alerta>
          {personas.map((p) => <button key={p.clave} className="persona" disabled={entrando} onClick={() => entrar(p)}><strong>{p.clave}</strong><span>{p.descripcion}</span></button>)}
        </>
      )}
      {personas && personas.length === 0 && (
        <Alerta tipo="info">
          Para probar en tu computadora, levantá la API de desarrollo con <code>npm run api:dev</code> desde <code>administranet-replica</code>, o configurá Supabase (ver <code>app/.env.example</code>).
        </Alerta>
      )}
    </>
  );
}

/** Pantalla que aparece al volver del enlace de "olvidé mi contraseña": la persona ya está autenticada y elige la nueva. */
export function NuevaClave({ onListo }: { onListo: () => void }) {
  const { identidad } = useSesion();
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const avisar = useAviso();
  const corta = clave.length > 0 && clave.length < 12, distinta = repetida.length > 0 && clave !== repetida;

  async function guardar(ev: FormEvent) {
    ev.preventDefault(); setTrabajando(true); setError(null);
    try { await identidad.cambiarClave(clave); avisar('Contraseña actualizada.'); onListo(); } catch (e) { setError((e as Error).message); } finally { setTrabajando(false); }
  }
  return (
    <div className="ingreso">
      <form className="caja tarjeta" onSubmit={guardar} noValidate>
        <div className="logo" aria-hidden="true">a</div>
        <h1>Elegí tu contraseña</h1>
        <p className="muted">Usá al menos 12 caracteres; una frase larga es mejor que algo complicado.</p>
        {error && <Alerta>{error}</Alerta>}
        <div className="rejilla" style={{ gridTemplateColumns: '1fr' }}>
          <Campo etiqueta="Contraseña nueva" type="password" autoComplete="new-password" value={clave} error={corta ? 'Tiene que tener al menos 12 caracteres.' : undefined} onChange={(e) => setClave(e.target.value)} autoFocus />
          <Campo etiqueta="Repetila" type="password" autoComplete="new-password" value={repetida} error={distinta ? 'No coincide.' : undefined} onChange={(e) => setRepetida(e.target.value)} />
        </div>
        <div className="pie-form"><button className="btn primario" type="submit" disabled={trabajando || clave.length < 12 || clave !== repetida}>{trabajando ? 'Guardando…' : 'Guardar contraseña'}</button></div>
      </form>
    </div>
  );
}
