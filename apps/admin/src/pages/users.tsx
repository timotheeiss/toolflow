import type { InviteUserInput, OrganizationRole } from "@toolflow/contracts";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { controlApi } from "../api.js";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  PaginationControls,
  SectionTabs,
  StatusBadge,
} from "../components.js";
import { formString, toError, useAsync, useModalDialog } from "../hooks.js";
import { Icon } from "../icons.js";
import { placeholderGroups } from "../placeholders.js";

type DirectoryTab = "people" | "groups";

export function UsersPage() {
  const load = useCallback(() => controlApi.listUsers(), []);
  const state = useAsync(load);
  const [tab, setTab] = useState<DirectoryTab>("people");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groups, setGroups] = useState(placeholderGroups);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [updatingMembershipId, setUpdatingMembershipId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const groupButton = useRef<HTMLButtonElement>(null);
  const inviteDialog = useModalDialog(inviteOpen, () => setInviteOpen(false), inviteButton);
  const groupDialog = useModalDialog(groupOpen, () => setGroupOpen(false), groupButton);
  const pageSize = 20;

  const filteredUsers = useMemo(() => {
    if (state.status !== "success") return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return state.data.users;
    return state.data.users.filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(normalized),
    );
  }, [query, state]);

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
      setInviteOpen(false);
      state.reload();
    } catch (error) {
      setFormError(toError(error));
    } finally {
      setSubmitting(false);
    }
  }

  function createPlaceholderGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = formString(form, "name").trim();
    if (!name) return;
    setGroups((current) => [
      ...current,
      {
        id: `group-local-${Date.now()}`,
        name,
        memberCount: 0,
        access: formString(form, "access", "No app access"),
      },
    ]);
    setGroupOpen(false);
    setTab("groups");
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage who can build, approve, administer, and use internal tools."
        action={
          <div className="button-row">
            <button
              ref={groupButton}
              className="button button-secondary"
              type="button"
              onClick={() => setGroupOpen(true)}
            >
              <Icon name="group" size={16} />
              Create group
            </button>
            <button
              ref={inviteButton}
              className="button"
              type="button"
              onClick={() => setInviteOpen(true)}
            >
              <Icon name="user-plus" size={16} />
              Invite user
            </button>
          </div>
        }
      />
      <SectionTabs
        active={tab}
        items={[
          { id: "people", label: "People" },
          { id: "groups", label: "Groups", count: groups.length },
        ]}
        onChange={setTab}
      />

      {tab === "people" ? (
        <>
          <div className="directory-toolbar">
            <label className="search-field">
              <Icon name="search" size={16} />
              <input
                aria-label="Search users"
                placeholder="Search name or email"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setOffset(0);
                }}
              />
            </label>
            {state.status === "success" ? (
              <div className="directory-counts">
                <span>{state.data.users.filter((user) => user.status === "active").length} active</span>
                <span>{state.data.users.filter((user) => user.status === "invited").length} invited</span>
              </div>
            ) : null}
          </div>
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
                  {filteredUsers.slice(offset, offset + pageSize).map((user, index) => (
                    <tr key={user.membershipId}>
                      <td>
                        <div className="person-cell">
                          <span className={`avatar avatar-${index % 3}`}>
                            {user.name
                              .split(" ")
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)}
                          </span>
                          <span>
                            <strong>{user.name}</strong>
                            <small>{user.email}</small>
                          </span>
                        </div>
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
                        <button
                          className="text-button"
                          disabled={updatingMembershipId === user.membershipId}
                          type="button"
                          onClick={() =>
                            void updateUser(user.membershipId, {
                              status: user.status === "deactivated" ? "active" : "deactivated",
                            })
                          }
                        >
                          {user.status === "deactivated" ? "Reactivate" : "Deactivate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationControls
                offset={offset}
                pageSize={pageSize}
                total={filteredUsers.length}
                onChange={setOffset}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div className="groups-grid">
          {groups.map((group) => (
            <article className="group-card" key={group.id}>
              <span className="group-icon">
                <Icon name="users" size={17} />
              </span>
              <div>
                <strong>{group.name}</strong>
                <span>{group.memberCount} members · {group.access}</span>
              </div>
              <button className="text-button" type="button">Manage</button>
            </article>
          ))}
          <p className="placeholder-note">Groups are stored in this browser session until a groups API is added.</p>
        </div>
      )}

      {inviteOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setInviteOpen(false)}>
          <div
            ref={inviteDialog}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="invite-title">Invite a user</h2>
            <p>Invited people can sign in after their organization membership is activated.</p>
            <form onSubmit={(event) => void submitInvite(event)}>
              <label>
                Work email
                <input autoFocus required name="email" type="email" placeholder="name@company.com" />
              </label>
              <label>
                Role
                <select name="role" defaultValue="member">
                  <option value="member">Member</option>
                  <option value="builder">Builder</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              {formError ? <p className="form-error" role="alert">{formError.message}</p> : null}
              <div className="dialog-actions">
                <button className="button button-secondary" type="button" onClick={() => setInviteOpen(false)}>
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

      {groupOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setGroupOpen(false)}>
          <div
            ref={groupDialog}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="group-title">Create a group</h2>
            <p>Create the frontend group now. Persistence and membership management need a groups API.</p>
            <form onSubmit={createPlaceholderGroup}>
              <label>
                Group name
                <input autoFocus required name="name" placeholder="Customer operations" />
              </label>
              <label>
                Initial access
                <select name="access" defaultValue="No app access">
                  <option>No app access</option>
                  <option>All draft apps</option>
                  <option>Approvals</option>
                </select>
              </label>
              <div className="dialog-actions">
                <button className="button button-secondary" type="button" onClick={() => setGroupOpen(false)}>
                  Cancel
                </button>
                <button className="button" type="submit">Create group</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
