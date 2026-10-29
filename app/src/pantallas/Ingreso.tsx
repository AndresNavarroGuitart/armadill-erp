// Ingreso. En producción el token lo entrega el proveedor de identidad (Supabase Auth); acá todavía no está conectado.
// En desarrollo el servidor de la API ofrece personas de prueba (/dev/sesiones); si no responde, se avisa en vez de fallar en silencio.
import { useEffect, useState } from 'react';
import { useSesion, type PersonaDev } from '../sesion';
import { Alerta, Cargando, useAviso } from '../ui';

export function Ingreso({ mensaje }: { mensaje: string | null }) {
  const { ingresar } = useSesion();
  const avisar = useAviso();
  const [personas, setPersonas] = useState<PersonaDev[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(mensaje);
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    if (!import.meta.env.DEV) { setPersonas([]); return; }
    fetch('/dev/sesiones').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setPersonas).catch(() => setPersonas([]));
  }, []);

  async function entrar(p: PersonaDev) {
    setEntrando(true); setFallo(null);
    try { await ingresar(p.token); } catch (e) { setFallo((e as Error).message); avisar(`No se pudo ingresar como ${p.clave}.`, 'error'); } finally { setEntrando(false); }
  }

  return (
    <div className="ingreso">
      <div className="caja tarjeta">
        <div className="logo" aria-hidden="true">a</div>
        <h1>administraNET</h1>
        <p className="muted">Gestión contable para estudios.</p>
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
            El ingreso con usuario y contraseña se conecta en un próximo paso (Supabase Auth). Para probar en tu computadora, levantá la API con <code>npm run api:dev</code> desde <code>administranet-replica</code>.
          </Alerta>
        )}
      </div>
    </div>
  );
}
