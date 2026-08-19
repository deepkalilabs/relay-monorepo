"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

interface DismissibleOverlayOptions {
  overlayRef: RefObject<HTMLElement | null>;
  focusKey: string;
  initialFocusSelectors: readonly string[];
  onDismiss: () => void;
  scrollInitialFocusIntoView?: boolean;
}

export function useDismissibleOverlay({
  overlayRef,
  focusKey,
  initialFocusSelectors,
  onDismiss,
  scrollInitialFocusIntoView = false,
}: DismissibleOverlayOptions) {
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    const dismissOnPointerDown = (event: PointerEvent) => {
      if (!overlayRef.current?.contains(event.target as Node)) dismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener("pointerdown", dismissOnPointerDown, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointerDown, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [overlayRef]);

  useEffect(() => {
    const focusTimer = requestAnimationFrame(() => {
      const target = initialFocusSelectors
        .map((selector) => overlayRef.current?.querySelector<HTMLElement>(selector))
        .find((candidate): candidate is HTMLElement => Boolean(candidate));
      target?.focus();
      if (scrollInitialFocusIntoView) target?.scrollIntoView?.({ block: "nearest" });
    });
    return () => cancelAnimationFrame(focusTimer);
  }, [focusKey, initialFocusSelectors, overlayRef, scrollInitialFocusIntoView]);
}
