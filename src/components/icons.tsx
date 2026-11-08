import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

export const PillIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z" /><path d="m8.5 8.5 7 7" /></svg>
);
export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
);
export const FlaskIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></svg>
);
export const NoteIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
);
export const HeartIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20.8 6.6a5 5 0 0 0-8.8-2.3 5 5 0 0 0-8.8 2.3c-.6 4.3 4 8.3 8.8 12.4 4.8-4.1 9.4-8.1 8.8-12.4Z" /></svg>
);
export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /></svg>
);
export const UserIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
export const MicIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" /></svg>
);
export const BoltIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m5 12 5 5L20 7" /></svg>
);

export const kindIcon: { [k: string]: (p: SVGProps<SVGSVGElement>) => React.ReactElement } = {
  medication: PillIcon,
  appointment: CalendarIcon,
  lab: FlaskIcon,
  visit: NoteIcon,
  condition: HeartIcon,
  allergy: AlertIcon,
  care_team: UserIcon,
  insurance: ShieldIcon,
  vaccine: ShieldIcon,
  family: UserIcon,
};
