import type { ArtifactBundle } from "../artifacts/generated/bundles";
import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { PreparedRelayDelivery, RelayPlacementContext } from "./installDelivery";

export interface RelaySessionRequest extends RelayPlacementContext {
  targetViewId: string;
  targetViewTitle: string;
}

export interface ActiveRelaySession extends RelaySessionRequest {
  endpoint: string;
  sessionId: string;
  uploadToken: string;
  encryptionKey: string;
  expiresAt: string;
}

export type RelayConnectionStatus =
  | "idle"
  | "verifying"
  | "creating"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "expired"
  | "error";

export interface RelayInstallResult {
  artifactIds: string[];
  nodeIds: string[];
}

export interface RelayDeliveryIdentity {
  deliveryId: string;
  sessionId: string;
  signal: AbortSignal;
}

export interface RelayLiveInstaller {
  viewId: string;
  install: (
    bundles: unknown[],
    placement: RelayPlacementContext,
    identity: RelayDeliveryIdentity,
  ) => Promise<RelayInstallResult>;
}

export interface RelayPreparedStateUpdate extends PreparedRelayDelivery {
  artifacts: RegisteredArtifact[];
  bundles: ArtifactBundle[];
}
