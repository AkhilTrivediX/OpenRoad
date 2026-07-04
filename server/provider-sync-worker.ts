import type { IntegrationProvider } from "../src/integrations/adapter.js";
import type { IntegrationSyncWorker } from "./sync-jobs.js";

export type ProviderIntegrationSyncWorkers = Partial<Record<IntegrationProvider, IntegrationSyncWorker>>;

export function createProviderIntegrationSyncWorker(
  workers: ProviderIntegrationSyncWorkers
): IntegrationSyncWorker | undefined {
  const configuredWorkers = Object.entries(workers).filter(
    (entry): entry is [IntegrationProvider, IntegrationSyncWorker] => Boolean(entry[1])
  );

  if (configuredWorkers.length === 0) return undefined;

  const workersByProvider = new Map<IntegrationProvider, IntegrationSyncWorker>(configuredWorkers);

  return {
    process(job) {
      const worker = workersByProvider.get(job.provider);

      if (!worker) {
        return Promise.resolve({
          error: `${providerLabel(job.provider)} sync worker is not configured.`,
          kind: "fatal-error"
        });
      }

      return worker.process(job);
    }
  };
}

function providerLabel(provider: IntegrationProvider) {
  if (provider === "github") return "GitHub";
  if (provider === "linear") return "Linear";
  return "Jira";
}
