import type { CatalogObject } from "@toolflow/contracts";
import { useCallback, useState } from "react";
import { controlApi } from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PaginationControls,
  StatusBadge,
} from "../components.js";
import { toError, useAsync } from "../hooks.js";

export function CatalogPage() {
  const [offset, setOffset] = useState(0);
  const pageSize = 25;
  const catalog = useAsync(useCallback(() => controlApi.listCatalog(), []));
  const connections = useAsync(useCallback(() => controlApi.listConnections(), []));
  const [connectionId, setConnectionId] = useState("");
  const [preview, setPreview] = useState<
    Awaited<ReturnType<typeof controlApi.refreshCatalog>>["result"] | null
  >(null);
  const [error, setError] = useState<Error | null>(null);

  async function refresh(apply: boolean) {
    if (!connectionId) return;
    setError(null);
    try {
      const response = await controlApi.refreshCatalog(connectionId, {
        apply,
        ...(apply && preview ? { expectedDiffHash: preview.diffHash } : {}),
      });
      setPreview(response.result);
      if (response.result.applied) catalog.reload();
    } catch (caught) {
      setError(toError(caught));
    }
  }

  async function update(
    object: CatalogObject,
    input: Parameters<typeof controlApi.updateCatalogObject>[1],
  ) {
    setError(null);
    try {
      await controlApi.updateCatalogObject(object.id, input);
      catalog.reload();
    } catch (caught) {
      setError(toError(caught));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="Data catalog"
        description="Document which tables and fields are authoritative, deprecated, or hidden."
      />
      <section className="toolbar-card">
        <label>
          Connection
          <select
            aria-label="Connection to refresh"
            value={connectionId}
            onChange={(event) => {
              setConnectionId(event.currentTarget.value);
              setPreview(null);
            }}
          >
            <option value="">Select a connection</option>
            {connections.status === "success"
              ? connections.data.connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))
              : null}
          </select>
        </label>
        <button
          className="button button-secondary"
          disabled={!connectionId}
          type="button"
          onClick={() => void refresh(false)}
        >
          Preview metadata refresh
        </button>
      </section>
      {preview ? (
        <section className="diff-card" aria-label="Catalog refresh diff">
          <div>
            <strong>{preview.additions} additions</strong>
            <span>
              {preview.changes.length} changes · {preview.removals.length} removals
            </span>
          </div>
          {!preview.applied ? (
            <button className="button" type="button" onClick={() => void refresh(true)}>
              Apply reviewed diff
            </button>
          ) : (
            <StatusBadge value="applied" />
          )}
        </section>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      ) : null}
      {catalog.status === "loading" ? <LoadingState label="Loading catalog" /> : null}
      {catalog.status === "error" ? (
        <ErrorState error={catalog.error} retry={catalog.reload} />
      ) : null}
      {catalog.status === "success" && catalog.data.objects.length === 0 ? (
        <EmptyState
          title="The catalog is empty"
          description="Preview and apply metadata from an approved connection."
        />
      ) : null}
      {catalog.status === "success" && catalog.data.objects.length > 0 ? (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Object</th>
                <th>Type</th>
                <th>Lifecycle</th>
                <th>Sensitivity</th>
                <th>Source of truth</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {catalog.data.objects.slice(offset, offset + pageSize).map((object) => (
                <tr key={object.id}>
                  <td>
                    <strong>
                      {object.schemaName}.{object.objectName}
                    </strong>
                    <span>{object.connectionName}</span>
                  </td>
                  <td>{object.dataType ?? object.kind}</td>
                  <td>
                    <select
                      aria-label={`Lifecycle for ${object.objectName}`}
                      value={object.lifecycle}
                      onChange={(event) =>
                        void update(object, {
                          lifecycle: event.currentTarget.value as CatalogObject["lifecycle"],
                        })
                      }
                    >
                      <option value="active">Active</option>
                      <option value="deprecated">Deprecated</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Sensitivity for ${object.objectName}`}
                      value={object.sensitivity}
                      onChange={(event) =>
                        void update(object, {
                          sensitivity: event.currentTarget.value as CatalogObject["sensitivity"],
                        })
                      }
                    >
                      <option value="public">Public</option>
                      <option value="internal">Internal</option>
                      <option value="confidential">Confidential</option>
                      <option value="restricted">Restricted</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Source of truth for ${object.objectName}`}
                      type="checkbox"
                      checked={object.sourceOfTruth}
                      onChange={(event) =>
                        void update(object, { sourceOfTruth: event.currentTarget.checked })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Description for ${object.objectName}`}
                      defaultValue={object.description}
                      onBlur={(event) => {
                        if (event.currentTarget.value !== object.description)
                          void update(object, { description: event.currentTarget.value });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls
            offset={offset}
            pageSize={pageSize}
            total={catalog.data.objects.length}
            onChange={setOffset}
          />
        </div>
      ) : null}
    </>
  );
}
