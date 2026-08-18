export interface LegacyRuntimeRoute {
  organizationId: string;
  appSlug: string;
  environment: "preview" | "production";
}

export function runtimeAppUrl(
  runtimeBaseUrl: string,
  routeKey: string,
  legacy: LegacyRuntimeRoute,
): string {
  const base = new URL(runtimeBaseUrl);
  base.search = "";
  base.hash = "";
  if (base.hostname === "127.0.0.1" || base.hostname === "localhost" || base.hostname === "::1") {
    base.pathname = `/apps/${legacy.organizationId}/${legacy.appSlug}/${legacy.environment}/`;
    return base.toString();
  }
  base.hostname = `${routeKey}.${base.hostname}`;
  base.pathname = "/";
  return base.toString();
}

export function runtimeBaseHostname(runtimeBaseUrl: string): string {
  return new URL(runtimeBaseUrl).hostname.toLowerCase();
}
