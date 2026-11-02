import { useId } from 'react';

// Marca de ARMADILL-ERP en modo ícono: un bicho bolita cerrado, plano, en blanco. Va sobre el cuadrado con degradado de la marca (.logo): las placas son recortes que dejan ver ese fondo.
export function Logo({ tamano = 26 }: { tamano?: number }) {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" width={tamano} height={tamano} role="img" aria-label="ARMADILL-ERP">
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" />
        <path d="M7.3 5.2 Q10.6 12 7.3 18.8" stroke="#000" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M11 3.6 Q14.8 12 11 20.4" stroke="#000" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M14.9 4.2 Q18.2 12 14.9 19.8" stroke="#000" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <circle cx="4.3" cy="12" r="1.5" fill="#000" />
      </mask>
      <circle cx="12" cy="12" r="9.2" fill="#fff" mask={`url(#${id})`} />
    </svg>
  );
}
