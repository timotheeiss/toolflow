import { CloudflareDeploymentProvider, LocalDeploymentProvider } from "./provider.js";
import { createDeploymentWorker } from "./app.js";
import { parseConfig } from "./config.js";

export function createDeploymentApplication(environment: NodeJS.ProcessEnv = process.env) {
  const config = parseConfig(environment);
  const provider = config.CLOUDFLARE_ACCOUNT_ID
    ? new CloudflareDeploymentProvider(config.CLOUDFLARE_ACCOUNT_ID, config.CLOUDFLARE_API_TOKEN!, {
        preview: config.CLOUDFLARE_PREVIEW_NAMESPACE!, production: config.CLOUDFLARE_PRODUCTION_NAMESPACE!,
      }, { url: config.TOOLFLOW_DISPATCH_HEALTH_URL!, token: config.TOOLFLOW_DISPATCH_HEALTH_TOKEN! })
    : new LocalDeploymentProvider();
  return createDeploymentWorker(provider, config.TOOLFLOW_DEPLOYMENT_SERVICE_TOKEN);
}
