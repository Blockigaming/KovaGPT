import type { SVGProps } from "react";

export function TemporaryChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m5 11 1.4-6.1A2.5 2.5 0 0 1 8.8 3h6.4a2.5 2.5 0 0 1 2.4 1.9L19 11M2 12.5c6.7-3 13.3-3 20 0" />
      <circle cx="6.5" cy="17.5" r="3.4" />
      <circle cx="17.5" cy="17.5" r="3.4" />
      <path d="M9.9 17.5a2.1 2.1 0 0 1 4.2 0" />
    </svg>
  );
}
