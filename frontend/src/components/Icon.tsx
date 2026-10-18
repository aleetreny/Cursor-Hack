const P: Record<string, string> = {
  play: 'M5 3.5v9l7.5-4.5z',
  pause: 'M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z',
  step: 'M4 3.5v9l6-4.5zM11 3.5h2v9h-2z',
  map: 'M1.5 3.5l4-1.5 5 2 4-1.5v10l-4 1.5-5-2-4 1.5zM5.5 2v10M10.5 4v10',
  drone: 'M8 6.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM6.8 7L4 4.2M9.2 7L12 4.2M6.8 9L4 11.8M9.2 9L12 11.8M2 4.2a2 2 0 104 0 2 2 0 00-4 0M10 4.2a2 2 0 104 0 2 2 0 00-4 0M2 11.8a2 2 0 104 0 2 2 0 00-4 0M10 11.8a2 2 0 104 0 2 2 0 00-4 0',
  alert: 'M8 1.8l6.5 11.4h-13zM8 6v3.5M8 11.2v.3',
  eye: 'M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8zM8 6a2 2 0 100 4 2 2 0 000-4z',
  chart: 'M2 13.5h12M3.5 11l3-4 3 2 4-5.5',
  share: 'M5.5 9.5l5-3M5.5 6.5l5 3M4 6.5a1.6 1.6 0 110 3.2 1.6 1.6 0 010-3.2zM12 3a1.6 1.6 0 110 3.2A1.6 1.6 0 0112 3zM12 9.8a1.6 1.6 0 110 3.2 1.6 1.6 0 010-3.2z',
  sidebar: 'M2 3h12v10H2zM10 3v10',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  info: 'M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 7.2v4.3M8 4.8v.2',
  gear: 'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  chev: 'M4.5 6.5L8 10l3.5-3.5',
  plus: 'M8 3v10M3 8h10',
  full: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  x: 'M4 4l8 8M12 4l-8 8',
  download: 'M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2M3 13.5h10',
  prev: 'M12 3.5v9l-6-4.5zM5 3.5H3v9h2z',
  flame: 'M8 1.5c.5 2.5 3.5 3.8 3.5 7.2a3.5 3.5 0 01-7 0c0-1.7 1-2.6 1.5-3.4.3 1.2 1 1.7 1.5 1.8C7.2 5.3 7.4 3.4 8 1.5z',
  tri: 'M8 3l5.5 9.5h-11z',
  smoke: 'M3 11.5h8.5a2.5 2.5 0 000-5 3.5 3.5 0 00-6.7-.8A2.6 2.6 0 003 11.5z',
  calendar: 'M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3',
  search: 'M7 2.5a4.5 4.5 0 110 9 4.5 4.5 0 010-9zM10.3 10.3l3.2 3.2',
  send: 'M2 8l11.5-5.5L9 14l-1.6-4.4z',
  video: 'M2 4.5h8.5v7H2zM10.5 7l3.5-2v6l-3.5-2z',
  layers: 'M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3',
  area: 'M2.5 12.5l3-6 3 3 2.5-5 2.5 8z',
  delta: 'M8 2.5l5.5 10h-11z',
  pin: 'M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 00-9 0C3.5 9.8 8 14 8 14zM8 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
  target: 'M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14M8 4.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7z',
  db: 'M3 3.5c0-1 2.2-1.5 5-1.5s5 .5 5 1.5v9c0 1-2.2 1.5-5 1.5s-5-.5-5-1.5zM3 3.5c0 1 2.2 1.5 5 1.5s5-.5 5-1.5M3 8c0 1 2.2 1.5 5 1.5S13 9 13 8',
  check: 'M3 8.5l3 3 7-7',
  compare: 'M8 2v12M3 4.5h3.5v7H3zM9.5 4.5H13v7H9.5z',
  spark: 'M8 1.5l1.5 4.5 4.5 1.5-4.5 1.5L8 13.5 6.5 9 2 7.5 6.5 6z',
  upload: 'M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 11v2.5h11V11',
};
const FILLED = new Set(['play', 'pause', 'step', 'prev', 'flame', 'tri']);

export function Icon({ name, size = 14, color, fill, style }: { name: string; size?: number; color?: string; fill?: boolean; style?: React.CSSProperties }) {
  const filled = fill ?? FILLED.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: 'none', ...style }} fill={filled ? (color ?? 'currentColor') : 'none'} stroke={filled ? 'none' : (color ?? 'currentColor')} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name] ?? ''} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="26" height="16" viewBox="0 0 26 16">
      <path d="M1 15L9 4l4 5 3-4 9 10z" fill="#d2402a" />
      <path d="M9 4l4 5-2.5 6H1z" fill="#ea7a2c" />
      <path d="M16 5l9 10h-7.5L14 8z" fill="#f2b33d" opacity=".9" />
    </svg>
  );
}
