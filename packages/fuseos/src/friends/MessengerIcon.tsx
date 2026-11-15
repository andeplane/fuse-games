import type { SVGProps } from "react";

/** The paired green/blue buddies of the classic Messenger contact list, drawn for the shared 16/32px icon slot. */
export function MessengerIcon({
  variant: _variant,
  ...props
}: SVGProps<SVGSVGElement> & { variant?: string }) {
  return (
    <svg viewBox="0 0 32 32" {...props}>
      <path
        d="M16 27c-2-1-2-4-1-7 1-4 3-7 7-7s7 3 8 7c1 3 1 6-1 7-3 2-10 2-13 0Z"
        fill="#2178c0"
        stroke="#173b72"
      />
      <ellipse
        cx="22.5"
        cy="8"
        rx="5.5"
        ry="6"
        fill="#3e9be1"
        stroke="#173b72"
      />
      <path
        d="M20 4c-1 1-2 3-2 5"
        fill="none"
        stroke="#a8ddff"
        strokeWidth="2"
      />
      <path
        d="M3 29c-2-1-2-4-1-8 1-5 4-8 9-8s8 3 9 8c1 4 1 7-1 8-4 3-12 3-16 0Z"
        fill="#53b52d"
        stroke="#24611f"
      />
      <ellipse
        cx="11"
        cy="7.5"
        rx="6"
        ry="6.5"
        fill="#70c844"
        stroke="#24611f"
      />
      <path
        d="M8 3c-2 1-2 3-2 5M7 17c-2 2-3 5-3 8"
        fill="none"
        stroke="#d2f5a9"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
