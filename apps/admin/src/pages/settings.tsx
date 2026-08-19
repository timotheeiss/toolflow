import { useCallback, useState, type FormEvent } from "react";
import { controlApi } from "../api.js";
import { ErrorState, LoadingState, PageHeader } from "../components.js";
import { formString, toError, useAsync } from "../hooks.js";

export function SettingsPage() {
  const load = useCallback(() => controlApi.getBranding(), []);
  const state = useAsync(load);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const logo = form.get("logo");
      if (logo instanceof File && logo.size > 0) await controlApi.uploadLogo(logo);
      await controlApi.updateBranding({
        displayName: formString(form, "displayName"),
        primaryColor: formString(form, "primaryColor"),
      });
      setMessage("Branding saved.");
      state.reload();
    } catch (caught) {
      setError(toError(caught));
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your organization name, logo, and brand color."
      />
      {state.status === "loading" ? <LoadingState label="Loading settings" /> : null}
      {state.status === "error" ? <ErrorState error={state.error} retry={state.reload} /> : null}
      {state.status === "success" ? (
        <form className="settings-card" onSubmit={(event) => void save(event)}>
          <div className="settings-section">
            <div>
              <h2>Organization identity</h2>
              <p>These details are used consistently across your internal apps.</p>
            </div>
            <div className="form-stack">
              <label>
                Display name
                <input required name="displayName" defaultValue={state.data.branding.displayName} />
              </label>
              <label>
                Organization logo
                <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
                <span>
                  {state.data.branding.logoObjectKey
                    ? `Stored: ${state.data.branding.logoObjectKey.split("/").at(-1)}`
                    : "PNG, JPEG, or WebP; maximum 1 MB."}
                </span>
              </label>
              <label>
                Primary color
                <span className="color-field">
                  <input
                    aria-label="Primary color picker"
                    name="colorPreview"
                    type="color"
                    defaultValue={state.data.branding.primaryColor}
                    onInput={(event) => {
                      const field = event.currentTarget.nextElementSibling;
                      if (field instanceof HTMLInputElement)
                        field.value = event.currentTarget.value;
                    }}
                  />
                  <input
                    aria-label="Primary color hexadecimal value"
                    required
                    name="primaryColor"
                    pattern="^#[0-9A-Fa-f]{6}$"
                    defaultValue={state.data.branding.primaryColor}
                  />
                </span>
              </label>
            </div>
          </div>
          {message ? (
            <p className="success-message" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error.message}
            </p>
          ) : null}
          <div className="settings-actions">
            <button className="button" type="submit">
              Save settings
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
