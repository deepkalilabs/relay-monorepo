"use client";

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDismissibleOverlay } from "../hooks/useDismissibleOverlay";
import type { DatePickerState } from "../model/browser.types";

interface DatePickerOverlayProps {
  picker: DatePickerState;
  containerRef: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
  onSelect: (value: string) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2020, month, 1)),
);
const DATE_INITIAL_FOCUS_SELECTORS = [
  "button[aria-pressed='true']:not(:disabled)",
  "button:not(:disabled)",
] as const;

function createMonth(year: number, month: number): Date {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month, 1);
  return date;
}

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = createMonth(Number(match[1]), Number(match[2]) - 1);
  date.setDate(Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3])
    ? date
    : null;
}

function formatDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clampDate(date: Date, min: Date | null, max: Date | null): Date {
  if (min && date < min) return min;
  if (max && date > max) return max;
  return date;
}

function monthStart(date: Date): Date {
  return createMonth(date.getFullYear(), date.getMonth());
}

function clampMonth(date: Date, min: Date | null, max: Date | null): Date {
  const candidate = monthStart(date);
  const minimum = min ? monthStart(min) : null;
  const maximum = max ? monthStart(max) : null;
  if (minimum && candidate < minimum) return minimum;
  if (maximum && candidate > maximum) return maximum;
  return candidate;
}

export function DatePickerOverlay({ picker, containerRef, onDismiss, onSelect }: DatePickerOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectedDate = useMemo(() => parseDate(picker.value), [picker.value]);
  const minDate = useMemo(() => parseDate(picker.min), [picker.min]);
  const maxDate = useMemo(() => parseDate(picker.max), [picker.max]);
  const initialDate = useMemo(() => clampDate(selectedDate ?? new Date(), minDate, maxDate), [selectedDate, minDate, maxDate]);
  const [month, setMonth] = useState(() => monthStart(initialDate));
  const [yearDraft, setYearDraft] = useState(() => String(initialDate.getFullYear()));
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useDismissibleOverlay({
    overlayRef: dialogRef,
    focusKey: picker.requestId,
    initialFocusSelectors: DATE_INITIAL_FOCUS_SELECTORS,
    onDismiss,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const dialog = dialogRef.current;
    if (!container || !dialog) return;
    const place = () => {
      const scaleX = container.clientWidth / picker.viewport.width;
      const scaleY = container.clientHeight / picker.viewport.height;
      const anchorLeft = picker.rect.x * scaleX;
      const below = (picker.rect.y + picker.rect.height) * scaleY + 8;
      const above = picker.rect.y * scaleY - dialog.offsetHeight - 8;
      setPosition({
        left: Math.max(8, Math.min(anchorLeft, container.clientWidth - dialog.offsetWidth - 8)),
        top: Math.max(8, below + dialog.offsetHeight <= container.clientHeight - 8 ? below : above),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, picker]);

  const updateMonth = (nextMonth: Date) => {
    setMonth(nextMonth);
    setYearDraft(String(nextMonth.getFullYear()));
  };
  const showMonth = (year: number, monthIndex: number) => {
    updateMonth(clampMonth(createMonth(year, monthIndex), minDate, maxDate));
  };
  const commitYear = () => {
    const year = Number(yearDraft);
    const minimumYear = minDate?.getFullYear() ?? 1;
    const maximumYear = maxDate?.getFullYear() ?? 9999;
    if (!/^\d{1,4}$/.test(yearDraft) || year < minimumYear || year > maximumYear) {
      setYearDraft(String(month.getFullYear()));
      return;
    }
    showMonth(year, month.getMonth());
  };

  const firstVisible = new Date(month);
  firstVisible.setDate(1 - firstVisible.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(firstVisible);
    day.setDate(firstVisible.getDate() + index);
    return day;
  });
  const previousMonth = createMonth(month.getFullYear(), month.getMonth() - 1);
  const nextMonth = createMonth(month.getFullYear(), month.getMonth() + 1);
  const previousDisabled = Boolean(minDate && new Date(month.getFullYear(), month.getMonth(), 0) < minDate);
  const nextDisabled = Boolean(maxDate && nextMonth > maxDate);
  const minimumMonth = minDate ? monthStart(minDate) : null;
  const maximumMonth = maxDate ? monthStart(maxDate) : null;
  const today = formatDate(new Date());

  return (
    <div
      ref={dialogRef}
      className="date-picker"
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-label="Choose date"
      aria-modal="false"
    >
      <div className="date-picker-heading">
        <button type="button" onClick={() => updateMonth(previousMonth)} disabled={previousDisabled} aria-label="Previous month"><ChevronLeft size={17} /></button>
        <div className="date-picker-jump">
          <select
            aria-label="Month"
            value={month.getMonth()}
            onChange={(event) => showMonth(month.getFullYear(), Number(event.target.value))}
          >
            {MONTHS.map((label, monthIndex) => {
              const optionMonth = createMonth(month.getFullYear(), monthIndex);
              const disabled = Boolean((minimumMonth && optionMonth < minimumMonth) || (maximumMonth && optionMonth > maximumMonth));
              return <option key={label} value={monthIndex} disabled={disabled}>{label}</option>;
            })}
          </select>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            aria-label="Year"
            value={yearDraft}
            onChange={(event) => setYearDraft(event.target.value)}
            onBlur={commitYear}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitYear();
                event.currentTarget.blur();
              }
            }}
          />
          <span className="sr-only" aria-live="polite">
            Showing {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month)}
          </span>
        </div>
        <button type="button" onClick={() => updateMonth(nextMonth)} disabled={nextDisabled} aria-label="Next month"><ChevronRight size={17} /></button>
      </div>
      <div className="date-picker-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 2)}</span>)}
      </div>
      <div className="date-picker-grid" role="group" aria-label="Calendar days">
        {days.map((day) => {
          const value = formatDate(day);
          const outsideMonth = day.getMonth() !== month.getMonth();
          const disabled = Boolean((minDate && day < minDate) || (maxDate && day > maxDate));
          return (
            <button
              type="button"
              key={value}
              className={outsideMonth ? "outside-month" : ""}
              disabled={disabled}
              aria-current={value === today ? "date" : undefined}
              aria-pressed={value === picker.value}
              aria-label={new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(day)}
              onClick={() => onSelect(value)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
