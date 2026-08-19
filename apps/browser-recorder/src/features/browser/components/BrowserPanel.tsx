"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronsUpDown,
  Cloud,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { DatePickerOverlay } from "./DatePickerOverlay";
import { SelectPickerOverlay } from "./SelectPickerOverlay";
import type { BrowserActions, BrowserViewModel } from "../model/browser.types";

export interface BrowserPanelAlert {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}

export interface BrowserPanelProps {
  model: BrowserViewModel;
  actions: BrowserActions;
  emptyState: {
    title: string;
    description: string;
  };
  toolbar?: ReactNode;
  emptyActions?: ReactNode;
  contentOverlay?: ReactNode;
  alert?: BrowserPanelAlert | null;
}

function BrowserAddress({
  disabled,
  error,
  initialAddress,
  pending,
  onNavigate,
}: {
  disabled: boolean;
  error: string | null;
  initialAddress: string;
  pending: boolean;
  onNavigate: (url: string) => void;
}) {
  const [address, setAddress] = useState(initialAddress);
  const inputId = useId();
  return (
    <form
      className={`browser-address ${error ? "has-error" : ""}`}
      aria-label="Browser address"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && address.trim()) onNavigate(address);
      }}
    >
      <LockKeyhole size={14} aria-hidden="true" />
      <label className="sr-only" htmlFor={inputId}>Web address</label>
      <input
        id={inputId}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder={disabled && !initialAddress ? "Start a secure cloud session" : "Enter a web address"}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        disabled={disabled}
      />
    </form>
  );
}

export function BrowserPanel({
  model,
  actions,
  emptyState,
  toolbar,
  emptyActions,
  contentOverlay,
  alert,
}: BrowserPanelProps) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const captchaTitleId = useId();
  const captchaDescriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const liveViewRef = useRef<HTMLIFrameElement>(null);
  const captchaContinueRef = useRef<HTMLButtonElement>(null);
  const wasCaptchaLockedRef = useRef(false);
  const { datePicker, popup, selectPicker } = model;
  const captchaLocked = model.captchaStatus === "solving";
  const loading = Boolean(
    model.preparing || (model.liveViewUrl && loadedUrl !== model.liveViewUrl),
  );
  const navigationDisabled = !model.navigation.enabled;
  const tabTitle = model.page?.title && model.page.title !== "about:blank"
    ? model.page.title
    : model.liveViewUrl
      ? "Browserbase"
      : "New cloud browser";
  const pageAddress = model.page?.url === "about:blank" ? "" : model.page?.url ?? "";
  const captchaNotice = model.captchaStatus === "solved"
    ? "Verification solved. Recording resumed."
    : model.captchaStatus === "timed_out"
      ? "Verification wait timed out. Recording resumed."
      : model.captchaStatus === "continued"
        ? "Verification wait dismissed. Recording resumed."
        : null;

  const restoreLiveViewFocus = () => requestAnimationFrame(() => liveViewRef.current?.focus());

  useEffect(() => {
    if (captchaLocked) {
      wasCaptchaLockedRef.current = true;
      liveViewRef.current?.blur();
      captchaContinueRef.current?.focus();
      return;
    }
    if (!wasCaptchaLockedRef.current) return;
    wasCaptchaLockedRef.current = false;
    if (!model.restoreFocusAfterCaptcha) return;
    requestAnimationFrame(() => liveViewRef.current?.focus());
  }, [captchaLocked, model.restoreFocusAfterCaptcha]);

  return (
    <section className="browser-panel" aria-labelledby="browser-title">
      <div className="browser-chrome">
        <div className="browser-tab-strip">
          <div className="traffic-lights" aria-hidden="true"><span /><span /><span /></div>
          <div className="browser-tab" aria-hidden="true">
            <Globe2 size={15} />
            <span>{tabTitle}</span>
          </div>
          <button
            className="native-dropdown-toggle"
            type="button"
            role="switch"
            aria-checked={model.nativeSelects}
            disabled={!model.nativeSelectsEnabled}
            onClick={() => actions.setNativeSelects(!model.nativeSelects)}
            title={model.nativeSelects
              ? "Website dropdowns are active"
              : "Use the website's own dropdowns instead of the recorder picker"}
          >
            <ChevronsUpDown size={14} aria-hidden="true" />
            <span className="native-dropdown-label">
              Use native <span className="native-dropdown-detail">dropdowns</span>
            </span>
            <span className="native-dropdown-track" aria-hidden="true"><span /></span>
            <span className="native-dropdown-state" aria-hidden="true">
              {model.nativeSelects ? "On" : "Off"}
            </span>
          </button>
        </div>
        <div className="browser-navigation">
          <div className="browser-nav-controls">
            <button
              type="button"
              onClick={actions.goBack}
              disabled={navigationDisabled}
              aria-label="Go back"
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              type="button"
              onClick={actions.goForward}
              disabled={navigationDisabled}
              aria-label="Go forward"
              title="Forward"
            >
              <ArrowRight size={18} />
            </button>
            <button
              type="button"
              onClick={actions.reload}
              disabled={navigationDisabled}
              aria-label="Reload page"
              title="Reload"
            >
              {model.navigation.pending
                ? <LoaderCircle className="spin" size={17} />
                : <RotateCw size={17} />}
            </button>
          </div>
          <BrowserAddress
            key={`${model.page?.pageId ?? "none"}:${pageAddress}`}
            disabled={navigationDisabled}
            error={model.navigation.error}
            initialAddress={pageAddress}
            pending={model.navigation.pending}
            onNavigate={actions.navigate}
          />
          {toolbar}
        </div>
        {model.navigation.error
          ? <div className="browser-address-error" role="alert">{model.navigation.error}</div>
          : null}
      </div>
      <h2 id="browser-title" className="sr-only">Interactive cloud browser</h2>
      <div className="browser-content" ref={contentRef} aria-busy={captchaLocked || loading}>
        {model.liveViewUrl ? (
          <iframe
            ref={liveViewRef}
            className={`live-view ${captchaLocked ? "captcha-locked" : ""}`}
            src={model.liveViewUrl}
            title="Interactive Browserbase browser"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
            allow="clipboard-read; clipboard-write"
            tabIndex={captchaLocked ? -1 : 0}
            onLoad={() => setLoadedUrl(model.liveViewUrl)}
          />
        ) : (
          <div className="browser-empty">
            <span className="cloud-orbit"><Cloud size={30} aria-hidden="true" /></span>
            <h2>{emptyState.title}</h2>
            <p>{emptyState.description}</p>
            {emptyActions}
            <div className="privacy-note">
              <LockKeyhole size={14} />
              <span>Changes are stored locally only when you choose Save or Finish.</span>
            </div>
          </div>
        )}
        {loading ? (
          <div className="browser-overlay" aria-live="polite">
            <LoaderCircle className="spin" size={24} />
            <strong>Preparing secure browser</strong>
            <span>Connecting the recorder and Live View…</span>
          </div>
        ) : null}
        {captchaLocked ? (
          <div className="captcha-overlay">
            <div
              className="captcha-card"
              role="dialog"
              aria-labelledby={captchaTitleId}
              aria-describedby={captchaDescriptionId}
            >
              <span className="captcha-spinner" aria-hidden="true">
                <LoaderCircle className="spin" size={25} />
              </span>
              <strong id={captchaTitleId}>Solving verification…</strong>
              <p id={captchaDescriptionId}>
                Browserbase is handling the CAPTCHA. Recording will resume automatically.
              </p>
              <button
                ref={captchaContinueRef}
                className="button button-secondary captcha-continue"
                type="button"
                onClick={actions.continueAfterCaptcha}
              >
                Continue anyway
              </button>
            </div>
          </div>
        ) : null}
        {captchaNotice
          ? <div className="captcha-notice" role="status" aria-live="polite">{captchaNotice}</div>
          : null}
        <div className="sr-only" aria-live="polite">
          {captchaLocked ? "Browserbase verification solving started." : captchaNotice ?? ""}
        </div>
        {model.reconnecting ? (
          <div className="connection-banner">
            <RefreshCw className="spin" size={15} /> Reconnecting recorder transport…
          </div>
        ) : null}
        {alert ? (
          <div className="error-card" role="alert">
            <AlertTriangle size={20} />
            <div>
              <strong>{alert.title}</strong>
              <p>{alert.message}</p>
              <button className="text-button" type="button" onClick={alert.onAction}>
                {alert.actionLabel}
              </button>
            </div>
          </div>
        ) : null}
        {popup ? (
          <div className="popup-card" role="status">
            <div>
              <strong>New tab opened</strong>
              <span>{popup.title || popup.url}</span>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => actions.switchPopup(popup.pageId)}
            >
              Switch tab <ArrowRight size={16} />
            </button>
          </div>
        ) : null}
        {contentOverlay}
        {datePicker ? (
          <DatePickerOverlay
            key={datePicker.requestId}
            picker={datePicker}
            containerRef={contentRef}
            onSelect={(value) => actions.selectDate(datePicker.requestId, value)}
            onDismiss={() => actions.dismissDatePicker(datePicker.requestId)}
          />
        ) : null}
        {selectPicker ? (
          <SelectPickerOverlay
            key={selectPicker.requestId}
            picker={selectPicker}
            containerRef={contentRef}
            onSelect={(value) => {
              actions.selectPickerOption(selectPicker.requestId, value);
              restoreLiveViewFocus();
            }}
            onDismiss={() => {
              actions.dismissSelectPicker(selectPicker.requestId);
              restoreLiveViewFocus();
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
