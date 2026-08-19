"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useDismissibleOverlay } from "../hooks/useDismissibleOverlay";
import type { SelectPickerState } from "../model/browser.types";

interface SelectPickerOverlayProps {
  picker: SelectPickerState;
  containerRef: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
  onSelect: (value: string) => void;
}

const SELECT_INITIAL_FOCUS_SELECTORS = [
  '[role="option"][aria-selected="true"]:not(:disabled)',
  '[role="option"]:not(:disabled)',
] as const;

export function SelectPickerOverlay({ picker, containerRef, onDismiss, onSelect }: SelectPickerOverlayProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ value: "", timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const [position, setPosition] = useState({ left: 8, top: 8, width: 180 });

  useDismissibleOverlay({
    overlayRef: popupRef,
    focusKey: picker.requestId,
    initialFocusSelectors: SELECT_INITIAL_FOCUS_SELECTORS,
    onDismiss,
    scrollInitialFocusIntoView: true,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const popup = popupRef.current;
    if (!container || !popup) return;
    const place = () => {
      const scaleX = container.clientWidth / picker.viewport.width;
      const scaleY = container.clientHeight / picker.viewport.height;
      const width = Math.min(
        Math.max(picker.rect.width * scaleX, 180),
        Math.max(180, container.clientWidth - 16),
      );
      const anchorLeft = picker.rect.x * scaleX;
      const below = (picker.rect.y + picker.rect.height) * scaleY + 2;
      const above = picker.rect.y * scaleY - popup.offsetHeight - 2;
      setPosition({
        left: Math.max(8, Math.min(anchorLeft, container.clientWidth - width - 8)),
        top: Math.max(8, below + popup.offsetHeight <= container.clientHeight - 8 ? below : above),
        width,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, picker]);

  useEffect(() => {
    const typeahead = typeaheadRef.current;
    return () => {
      if (typeahead.timer) clearTimeout(typeahead.timer);
    };
  }, []);

  const optionButtons = () => [
    ...(popupRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []),
  ];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = optionButtons();
    if (!buttons.length) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      buttons[current]?.click();
      return;
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (typeaheadRef.current.timer) clearTimeout(typeaheadRef.current.timer);
      typeaheadRef.current.value += event.key.toLocaleLowerCase();
      typeaheadRef.current.timer = setTimeout(() => {
        typeaheadRef.current.value = "";
        typeaheadRef.current.timer = undefined;
      }, 600);
      const query = typeaheadRef.current.value;
      const match = buttons.find((button) => (button.textContent ?? "").trim().toLocaleLowerCase().startsWith(query));
      match?.focus();
      match?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.scrollIntoView?.({ block: "nearest" });
  };

  const selectedEnabled = picker.options.some((option) => option.value === picker.value && !option.disabled);
  const firstEnabledIndex = picker.options.findIndex((option) => !option.disabled);

  return (
    <div
      ref={popupRef}
      className="select-picker"
      style={{ left: position.left, top: position.top, width: position.width }}
      role="listbox"
      aria-label={`${picker.name} options`}
      onKeyDown={handleKeyDown}
    >
      {picker.options.map((option, index) => (
        <button
          type="button"
          role="option"
          key={`${option.value}:${index}`}
          disabled={option.disabled}
          aria-selected={option.value === picker.value}
          tabIndex={
            option.value === picker.value && !option.disabled
              ? 0
              : !selectedEnabled && index === firstEnabledIndex
                ? 0
                : -1
          }
          title={option.label}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
