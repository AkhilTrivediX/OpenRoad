import { resolve } from "node:path";

import { authOptionsFromEnv } from "./access.js";
import { createOpenRoadServer } from "./http.js";
import { FileIntegrationStore, resolveOpenRoadIntegrationFile } from "./integrations.js";
import {
  createInvitationDeliveryAdapterFromEnv,
  resolveInvitationDeliveryPublicBaseUrl
} from "./invitation-delivery.js";
import { FileSessionStore, resolveOpenRoadSessionFile } from "./session-store.js";
import { FileOpenRoadStore, resolveOpenRoadDataFile } from "./store.js";
import { FileTeamStore, resolveOpenRoadTeamFile } from "./team.js";

const port = Number(process.env.PORT ?? 4173);
const distDir = resolve(process.env.OPENROAD_DIST_DIR ?? "dist");
const dataFile = resolveOpenRoadDataFile();
const integrationFile = resolveOpenRoadIntegrationFile();
const sessionFile = resolveOpenRoadSessionFile();
const teamFile = resolveOpenRoadTeamFile();
const store = new FileOpenRoadStore(dataFile);
const integrationStore = new FileIntegrationStore(integrationFile);
const sessionStore = new FileSessionStore(sessionFile, {
  ttlMs: Number(process.env.OPENROAD_SESSION_TTL_MS || "") || undefined
});
const teamStore = new FileTeamStore(teamFile, {
  ownerEmail: process.env.OPENROAD_OWNER_EMAIL,
  ownerName: process.env.OPENROAD_OWNER_NAME
});
const invitationDeliveryAdapter = createInvitationDeliveryAdapterFromEnv();
const invitationDeliveryPublicBaseUrl = resolveInvitationDeliveryPublicBaseUrl();
const auth = authOptionsFromEnv();
const server = createOpenRoadServer({
  auth,
  distDir,
  integrationStore,
  invitationDeliveryAdapter,
  invitationDeliveryPublicBaseUrl,
  sessionStore,
  store,
  teamStore
});

server.listen(port, "0.0.0.0", () => {
  console.log(`OpenRoad server listening on http://127.0.0.1:${port}`);
  console.log(`OpenRoad data file: ${dataFile}`);
  console.log(`OpenRoad integration file: ${integrationFile}`);
  console.log(`OpenRoad session file: ${sessionFile}`);
  console.log(`OpenRoad team file: ${teamFile}`);
  console.log(
    `OpenRoad invitation delivery configured: ${invitationDeliveryAdapter ? invitationDeliveryAdapter.channel : "no"}`
  );
  console.log(`OpenRoad admin token configured: ${auth.adminToken ? "yes" : "no"}`);
});
