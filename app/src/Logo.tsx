// Marca de ARMADILL-ERP: un bicho bolita cerrado (placas que se enroscan hacia el centro).
export function Logo({ tamano = 42 }: { tamano?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={tamano} height={tamano} role="img" aria-label="ARMADILL-ERP">
      <defs><radialGradient id="armBola" cx="38%" cy="30%" r="80%"><stop offset="0" stopColor="#8fa3b5"/><stop offset=".55" stopColor="#4d6073"/><stop offset="1" stopColor="#27323d"/></radialGradient></defs>
<circle cx="32" cy="32" r="29" fill="url(#armBola)"/>
<g fill="none" stroke="#0e151c" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round"><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(0 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(36 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(72 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(108 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(144 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(180 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(216 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(252 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(288 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(324 32 32)"/></g>
<g fill="none" stroke="#dbe6ee" strokeOpacity=".35" strokeWidth="1" strokeLinecap="round" transform="translate(-1 -1)"><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(0 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(36 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(72 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(108 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(144 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(180 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(216 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(252 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(288 32 32)"/><path d="M32 32 C 37 24, 45 16, 55 15" transform="rotate(324 32 32)"/></g>
<circle cx="32" cy="32" r="3.2" fill="#0e151c"/>
<ellipse cx="23" cy="17" rx="9" ry="4.5" fill="#fff" fillOpacity=".18" transform="rotate(-30 23 17)"/>
    </svg>
  );
}
