"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const ROLL_MS = 280;

type RollingNumberProps = {
  value: number;
  /** Shown before the digits, e.g. "+" / "-". */
  prefix?: string;
  className?: string;
};

/**
 * Digit odometer: when `value` changes, the old number scrolls out and the new
 * one scrolls in (up when increasing, down when decreasing). First appearance
 * rolls up from 0.
 */
export function RollingNumber({ value, prefix = "", className }: RollingNumberProps) {
  const [current, setCurrent] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [direction, setDirection] = useState<"up" | "down">("up");
  /** prep = new digit staged off-screen; run = CSS transition playing. */
  const [phase, setPhase] = useState<"idle" | "prep" | "run">("idle");
  const currentRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    const from = startedRef.current ? currentRef.current : 0;
    startedRef.current = true;
    if (value === from) {
      currentRef.current = value;
      setCurrent(value);
      return;
    }
    setPrevious(from);
    setDirection(value > from ? "up" : "down");
    currentRef.current = value;
    setCurrent(value);
    setPhase("prep");
  }, [value]);

  useEffect(() => {
    if (phase !== "prep") return;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setPhase("run"));
    });
    return () => window.cancelAnimationFrame(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "run") return;
    const timer = window.setTimeout(() => {
      setPrevious(null);
      setPhase("idle");
    }, ROLL_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const enterFrom = direction === "up" ? "translate-y-full" : "-translate-y-full";
  const exitTo = direction === "up" ? "-translate-y-full" : "translate-y-full";
  const rolling = phase !== "idle" && previous != null;

  return (
    <span
      className={cn("inline-flex items-baseline tabular-nums", className)}
      aria-label={`${prefix}${current}`}
    >
      {prefix ? <span>{prefix}</span> : null}
      <span className="relative inline-block h-[1.15em] min-w-[0.6em] overflow-hidden align-baseline">
        {rolling ? (
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-0 top-0 will-change-transform motion-reduce:transition-none",
              "transition-transform ease-out",
              phase === "run" ? exitTo : "translate-y-0",
            )}
            style={{ transitionDuration: `${ROLL_MS}ms` }}
          >
            {previous}
          </span>
        ) : null}
        <span
          className={cn(
            "inline-block will-change-transform motion-reduce:transition-none",
            rolling && "transition-transform ease-out",
            rolling
              ? phase === "run"
                ? "translate-y-0"
                : enterFrom
              : "translate-y-0",
          )}
          style={rolling ? { transitionDuration: `${ROLL_MS}ms` } : undefined}
        >
          {current}
        </span>
      </span>
    </span>
  );
}
