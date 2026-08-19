import { AlertTriangle, Info } from "lucide-react";
import {
  deriveProfileStatus,
  type ProfileInput,
  type ProfileStatus,
} from "@/shared/contracts/profile";
import styles from "../ProfileScreen.module.css";

interface ProfileFieldProps {
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  type?: "text" | "email";
  autoComplete?: string;
  placeholder?: string;
  error?: string;
}

function ProfileField({
  label,
  value,
  maxLength,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  error,
}: ProfileFieldProps) {
  const errorId = `${label.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-error`;
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <span className={styles.inputWrap}>
        <input
          type={type}
          value={value}
          maxLength={maxLength}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      {error ? <span className={styles.fieldError} id={errorId}>{error}</span> : null}
    </label>
  );
}

interface PresentationFieldProps {
  label: string;
  placeholder: string;
  type?: "text" | "tel";
  autoComplete?: string;
}

function PresentationField({
  label,
  placeholder,
  type = "text",
  autoComplete,
}: PresentationFieldProps) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <span className={styles.inputWrap}>
        <input
          type={type}
          defaultValue=""
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
      </span>
    </label>
  );
}

function StatusBadge({ status }: { status: ProfileStatus }) {
  return (
    <span className={status === "ready" ? styles.readyBadge : styles.draftBadge}>
      {status === "ready" ? "Ready" : "Draft"}
    </span>
  );
}

interface ProfileDetailsProps {
  input: ProfileInput;
  persisted: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  conflict: boolean;
  announcement: string;
  onChange: (input: ProfileInput) => void;
  onDelete: () => void;
  onReload: () => void;
  onSave: () => void;
}

export function ProfileDetails({
  input,
  persisted,
  dirty,
  saving,
  error,
  conflict,
  announcement,
  onChange,
  onDelete,
  onReload,
  onSave,
}: ProfileDetailsProps) {
  const status = deriveProfileStatus(input);
  const emailInvalid = Boolean(input.identity.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.identity.email);

  return (
    <section className={styles.details} aria-label={`${input.name || "Untitled"} profile details`}>
      <header className={styles.detailsHeader}>
        <div className={styles.detailsTitle}>
          <h2>{input.name || "Untitled profile"}</h2>
          <StatusBadge status={status} />
        </div>
        <div className={styles.detailActions}>
          <button
            className={styles.deleteAction}
            type="button"
            disabled={!persisted || saving}
            onClick={onDelete}
          >
            Delete
          </button>
          <button
            className={styles.primaryAction}
            type="button"
            disabled={!dirty || saving}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </header>

      <div className={styles.formBody}>
        {error ? (
          <div className={styles.persistenceAlert} role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <span>{error}</span>
            {conflict ? (
              <button className="button button-secondary" type="button" onClick={onReload}>
                Reload saved version
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={styles.readinessHint}>
          <Info size={18} aria-hidden="true" />
          <p>
            {status === "ready"
              ? "This profile has all required details."
              : "Drafts can be saved. Complete every field with a valid email to mark this profile Ready."}
          </p>
        </div>
        <section className={styles.formSection} aria-labelledby="profile-heading">
          <h3 id="profile-heading">Profile</h3>
          <ProfileField
            label="Profile name"
            value={input.name}
            maxLength={100}
            placeholder="Enter profile name"
            onChange={(name) => onChange({ ...input, name })}
          />
          <PresentationField
            label="Profile description (optional)"
            placeholder="e.g., Internal client profile"
          />
        </section>
        <section className={styles.formSection} aria-labelledby="identity-heading">
          <h3 id="identity-heading">Identity</h3>
          <ProfileField
            label="Full name"
            value={input.identity.fullName}
            maxLength={200}
            autoComplete="name"
            placeholder="Enter full name"
            onChange={(fullName) => onChange({
              ...input,
              identity: { ...input.identity, fullName },
            })}
          />
          <ProfileField
            label="Email address"
            value={input.identity.email}
            maxLength={254}
            type="email"
            autoComplete="email"
            placeholder="Enter email address"
            error={emailInvalid ? "Enter a complete email address to mark this profile Ready." : undefined}
            onChange={(email) => onChange({
              ...input,
              identity: { ...input.identity, email },
            })}
          />
          <PresentationField
            label="Phone number (optional)"
            placeholder="e.g., +1 (555) 123–4567"
            type="tel"
            autoComplete="tel"
          />
          <PresentationField
            label="Company (optional)"
            placeholder="Enter company name"
            autoComplete="organization"
          />
        </section>
        <section className={styles.formSection} aria-labelledby="location-heading">
          <h3 id="location-heading">Location</h3>
          <ProfileField
            label="Country/region"
            value={input.location.countryRegion}
            maxLength={100}
            autoComplete="country-name"
            placeholder="Select country or region"
            onChange={(countryRegion) => onChange({
              ...input,
              location: { ...input.location, countryRegion },
            })}
          />
          <ProfileField
            label="ZIP code"
            value={input.location.postalCode}
            maxLength={32}
            autoComplete="postal-code"
            placeholder="Enter ZIP or postal code"
            onChange={(postalCode) => onChange({
              ...input,
              location: { ...input.location, postalCode },
            })}
          />
          <PresentationField
            label="State / Province (optional)"
            placeholder="Enter state or province"
            autoComplete="address-level1"
          />
          <PresentationField
            label="City"
            placeholder="Enter city"
            autoComplete="address-level2"
          />
        </section>
      </div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </section>
  );
}
