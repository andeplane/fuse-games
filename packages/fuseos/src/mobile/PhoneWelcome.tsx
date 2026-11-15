import { useEffect, useRef, useState } from "react";
import "./welcome.css";

const highlights = [
  {
    title: "Welcome to Fuse.",
    text: "A collection of vibe-coded games. Small ideas, made playable.",
  },
  {
    title: "Different games.\nSame foundation.",
    text: "Shared libraries power multiplayer, rooms and accounts across the collection.",
  },
  {
    title: "Find your next\none more round.",
    text: "Pick a game, invite your friends and see what happens.",
  },
] as const;

/** Only composed by the phone entry point. Native dialog keeps background apps inert. */
export function PhoneWelcome({ dismiss }: { dismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [page, setPage] = useState(0);
  const highlight = highlights[page]!;
  useEffect(() => {
    dialog.current?.showModal();
    title.current?.focus();
  }, []);
  const move = (next: number) =>
    setPage(Math.max(0, Math.min(highlights.length - 1, next)));
  return (
    <dialog
      ref={dialog}
      className="phone-welcome"
      aria-labelledby="phone-welcome-title"
      onCancel={dismiss}
    >
      <div className={`welcome-flow welcome-page-${page}`}>
        <header className="welcome-top">
          <span>Fuse</span>
          <button onClick={dismiss}>Skip</button>
        </header>
        <div
          className="welcome-content"
          onTouchStart={(event) => {
            const point = event.touches[0];
            touch.current = point
              ? { x: point.clientX, y: point.clientY }
              : null;
          }}
          onTouchCancel={() => {
            touch.current = null;
          }}
          onTouchEnd={(event) => {
            const point = event.changedTouches[0];
            if (point && touch.current) {
              const x = point.clientX - touch.current.x;
              const y = point.clientY - touch.current.y;
              if (Math.abs(x) > 45 && Math.abs(x) > Math.abs(y))
                move(page + (x < 0 ? 1 : -1));
            }
            touch.current = null;
          }}
        >
          <div className="welcome-art" aria-hidden="true">
            {page === 0 ? (
              <span className="welcome-hello">vibe.</span>
            ) : page === 1 ? (
              <svg viewBox="0 0 240 180" fill="none">
                <path
                  d="M60 50 120 130 180 50M60 50h120"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <rect x="28" y="18" width="64" height="64" rx="18" />
                <rect x="148" y="18" width="64" height="64" rx="18" />
                <rect x="88" y="98" width="64" height="64" rx="18" />
                <path
                  d="M48 50h24m-12-12v24m108-18 8 8 16-16m-83 94 8 8 16-16"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 240 180" fill="none">
                <rect x="44" y="20" width="152" height="140" rx="36" />
                <path
                  d="m104 62 48 28-48 28V62Z"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            )}
          </div>
          <div className="welcome-copy" aria-live="polite" aria-atomic="true">
            <h1 id="phone-welcome-title" ref={title} tabIndex={-1}>
              {highlight.title}
            </h1>
            <p>{highlight.text}</p>
          </div>
        </div>
        <footer className="welcome-bottom">
          <nav className="welcome-dots" aria-label="Welcome highlights">
            {highlights.map((item, index) => (
              <button
                key={item.title}
                aria-label={`Highlight ${index + 1}`}
                aria-current={page === index ? "step" : undefined}
                onClick={() => move(index)}
              >
                <span />
              </button>
            ))}
          </nav>
          <button
            className="welcome-continue"
            onClick={() =>
              page === highlights.length - 1 ? dismiss() : move(page + 1)
            }
          >
            {page === highlights.length - 1 ? "Let’s play" : "Continue"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
