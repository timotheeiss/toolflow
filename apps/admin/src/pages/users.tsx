import type { InviteUserInput, OrganizationRole } from "@toolflow/contracts";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { controlApi } from "../api.js";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  PaginationControls,
  StatusBadge,
} from "../components.js";
import { formString, toError, useAsync, useModalDialog } from "../hooks.js";

export function UsersPage() {
  const load = useCallback(() => controlApi.listUsers(), []);
  const state = useAsync(load);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [updatingMembershipId, setUpdatingMembershipId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const inviteDialog = useModalDialog(dialogOpen, () => setDialogOpen(false), inviteButton);
  const pageSize = 20;

  async function updateUser(
    membershipId: string,
    input: Parameters<typeof controlApi.updateMembership>[1],
  ) {
    setActionError(null);
    setUpdatingMembershipId(membershipId);
    try {
      await controlApi.updateMembership(membershipId, input);
      state.reload();
    } catch (error) {
      setActionError(toError(error));
    } finally {
      setUpdatingMembershipId(null);
    }
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const form = new FormData(event.currentTarget);
    const input: InviteUserInput = {
      email: formString(form, "email"),
      role: formString(form, "role", "member") as OrganizationRole,
    };
    try {
      await controlApi.inviteUser(input);
      setDialogOpen(false);
      state.reload();
    } catch (error) {
      setFormError(toError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Users"
        description="Manage who can build, administer, and use internal tools."
        action={
          <button
            ref={inviteButton}
            className="button"
            type="button"
            onClick={() => setDialogOpen(true)}
          >
            Invite user
          </button>
        }
      />
      {state.status === "loading" ? <LoadingState label="Loading users" /> : null}
      {state.status === "error" ? <ErrorState error={state.error} retry={state.reload} /> : null}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError.message}
        </p>
      ) : null}
      {state.status === "success" ? (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Access</th>
              </tr>
            </thead>
            <tbody>
              {state.data.users.slice(offset, offset + pageSize).map((user) => (
                <tr key={user.membershipId}>
                  <td>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </td>
                  <td>
                    <select
                      aria-label={`Role for ${user.email}`}
                      className="table-select capitalize"
                      disabled={updatingMembershipId === user.membershipId}
                      value={user.role}
                      onChange={(event) =>
                        void updateUser(user.membershipId, {
                          role: event.currentTarget.value as OrganizationRole,
                        })
                      }
                    >
                      <option value="member">Member</option>
                      <option value="builder">Builder</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <StatusBadge value={user.status} />
                  </td>
                  <td>
                    {user.status === "deactivated" ? (
                      <button
                        aria-label={`Reactivate ${user.email}`}
                        className="text-button"
                        disabled={updatingMembershipId === user.membershipId}
                        type="button"
                        onClick={() => void updateUser(user.membershipId, { status: "active" })}
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        aria-label={`Deactivate ${user.email}`}
                        className="text-button danger"
                        disabled={updatingMembershipId === user.membershipId}
                        type="button"
                        onClick={() =>
                          void updateUser(user.membershipId, { status: "deactivated" })
                        }
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls
            offset={offset}
            pageSize={pageSize}
            total={state.data.users.length}
            onChange={setOffset}
          />
        </div>
      ) : null}

      {dialogOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={() => setDialogOpen(false)}
        >
          <div
            ref={inviteDialog}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="eyebrow">Organization access</div>
            <h2 id="invite-title">Invite a user</h2>
            <p>Invited people can sign in only after their organization membership is activated.</p>
            <form onSubmit={(event) => void submitInvite(event)}>
              <label>
                Work email
                <input
                  autoFocus
                  required
                  name="email"
                  type="email"
                  placeholder="name@company.com"
                />
              </label>
              <label>
                Role
                <select name="role" defaultValue="member">
                  <option value="member">Member</option>
                  <option value="builder">Builder</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              {formError ? (
                <p className="form-error" role="alert">
                  {formError.message}
                </p>
              ) : null}
              <div className="dialog-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </button>
                <button className="button" disabled={submitting} type="submit">
                  {submitting ? "Inviting…" : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
