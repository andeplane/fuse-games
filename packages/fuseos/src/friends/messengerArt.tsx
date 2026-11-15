import type { ReactNode } from "react";

import type { BuddyStatus } from "./presenceService";

/**
 * Fuse Messenger's own pictures, drawn for the late-90s buddy list: a little person per buddy with a state badge,
 * the big toolbar buttons and the banner's spark logo. Original art: no third-party logos or marks.
 */

const PERSON: Record<
  BuddyStatus,
  { head: string; body: string; line: string }
> = {
  online: { head: "#7fd04f", body: "#3fa52a", line: "#1f5f17" },
  playing: { head: "#7fd04f", body: "#3fa52a", line: "#1f5f17" },
  away: { head: "#7fd04f", body: "#3fa52a", line: "#1f5f17" },
  offline: { head: "#e58a8a", body: "#c43c3c", line: "#6d1717" },
};

function Person({ status }: { status: BuddyStatus }) {
  const colour = PERSON[status];
  return (
    <>
      <path
        d="M2 15c0-4 2.5-6 6-6s6 2 6 6Z"
        fill={colour.body}
        stroke={colour.line}
        strokeWidth="0.8"
      />
      <circle
        cx="8"
        cy="5"
        r="3.3"
        fill={colour.head}
        stroke={colour.line}
        strokeWidth="0.8"
      />
      <path
        d="M6.4 3.4c-.6.4-.9 1-.9 1.7"
        stroke="#fff"
        strokeOpacity="0.7"
        fill="none"
        strokeLinecap="round"
      />
    </>
  );
}

/** The 16px buddy person, green when on, red when off, with a clock badge for away and a joystick for playing. */
export function BuddyIcon({ status }: { status: BuddyStatus }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      className="msn-buddy-icon"
      data-status={status}
    >
      <Person status={status} />
      {status === "away" ? (
        <g>
          <circle
            cx="11.5"
            cy="11.5"
            r="4"
            fill="#ffd94a"
            stroke="#7a5a00"
            strokeWidth="0.8"
          />
          <path
            d="M11.5 9.3v2.4l1.6 1"
            stroke="#000"
            strokeWidth="0.9"
            fill="none"
          />
        </g>
      ) : status === "playing" ? (
        <g>
          <rect
            x="7.5"
            y="9.5"
            width="8"
            height="6"
            rx="1.5"
            fill="#2f6fd0"
            stroke="#0d2b66"
            strokeWidth="0.8"
          />
          <path d="M9.5 12.5h2M10.5 11.5v2" stroke="#fff" strokeWidth="0.9" />
          <circle cx="13.6" cy="12.5" r="0.8" fill="#ffd94a" />
        </g>
      ) : status === "offline" ? (
        <g>
          <circle
            cx="11.5"
            cy="11.5"
            r="3.6"
            fill="#fff"
            stroke="#a00"
            strokeWidth="1.1"
          />
          <path d="M9 14 14 9" stroke="#a00" strokeWidth="1.1" />
        </g>
      ) : null}
    </svg>
  );
}

function Big({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width="28"
      height="28"
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

function BigPerson() {
  return (
    <g transform="translate(2 4) scale(1.45)">
      <Person status="online" />
    </g>
  );
}

export type ToolbarArt = "add" | "send" | "invite" | "join" | "remove";

/** The big toolbar pictures: a buddy with a plus, a speech bubble, a game pad, a door. */
export function ToolbarIcon({ art }: { art: ToolbarArt }) {
  switch (art) {
    case "add":
      return (
        <Big>
          <BigPerson />
          <circle cx="24" cy="23" r="6" fill="#fff" stroke="#1f5f17" />
          <path d="M24 19.5v7M20.5 23h7" stroke="#2c8a1f" strokeWidth="2.2" />
        </Big>
      );
    case "send":
      return (
        <Big>
          <BigPerson />
          <path
            d="M15 3h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4 3.5V14h-3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
            fill="#fff"
            stroke="#173b72"
          />
          <path d="M17 7h10M17 10h7" stroke="#2f6fd0" strokeWidth="1.4" />
        </Big>
      );
    case "invite":
      return (
        <Big>
          <path
            d="M6 12h20c3 0 5 3 5 8s-1.5 7-3.5 7c-2.5 0-3.5-3-5.5-3h-12c-2 0-3 3-5.5 3C2.5 27 1 25 1 20s2-8 5-8Z"
            fill="#4b4b8f"
            stroke="#15153b"
          />
          <path d="M7 17v6M4 20h6" stroke="#fff" strokeWidth="2" />
          <circle cx="23" cy="18" r="1.6" fill="#ff5050" />
          <circle cx="26" cy="21" r="1.6" fill="#50d050" />
          <path
            d="M16 12V7c0-2 2-3 4-3"
            stroke="#c8a000"
            strokeWidth="1.6"
            fill="none"
          />
          <path
            d="M20 4l2-2M20 4l2.5 1M20 4l1 -2.8"
            stroke="#ff8c00"
            strokeWidth="1.2"
          />
        </Big>
      );
    case "join":
      return (
        <Big>
          <rect
            x="11"
            y="3"
            width="15"
            height="26"
            fill="#a0522d"
            stroke="#4a2410"
          />
          <rect x="13" y="5" width="11" height="22" fill="#c87941" />
          <circle cx="21.5" cy="16" r="1.2" fill="#ffd94a" />
          <path d="M2 16h10" stroke="#2c8a1f" strokeWidth="3" />
          <path d="M9 11.5 14 16l-5 4.5Z" fill="#2c8a1f" />
        </Big>
      );
    case "remove":
      return (
        <Big>
          <BigPerson />
          <circle
            cx="24"
            cy="23"
            r="6"
            fill="#fff"
            stroke="#a00"
            strokeWidth="1.6"
          />
          <path d="M20 27 28 19" stroke="#a00" strokeWidth="1.8" />
        </Big>
      );
  }
}

/** The banner's mark: two buddies with a lit fuse between them. */
export function FuseMessengerMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <g transform="translate(0 9) scale(1.25)">
        <Person status="online" />
      </g>
      <g transform="translate(13 9) scale(1.25)">
        <path
          d="M2 15c0-4 2.5-6 6-6s6 2 6 6Z"
          fill="#2f7fd8"
          stroke="#123e7a"
          strokeWidth="0.8"
        />
        <circle
          cx="8"
          cy="5"
          r="3.3"
          fill="#69aef0"
          stroke="#123e7a"
          strokeWidth="0.8"
        />
      </g>
      <path
        d="M10 8c3-5 9-5 12-1"
        stroke="#a87c00"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M22 7l2.5-3M22 7l3.5 .5M22 7l1.2-3.6M22 7l3 2"
        stroke="#ff7a00"
        strokeWidth="1.2"
      />
      <circle cx="22" cy="7" r="1.4" fill="#ffe14a" />
    </svg>
  );
}
