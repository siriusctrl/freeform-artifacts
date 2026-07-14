import type { ArtifactBundle } from "../artifacts/generated/bundles";
import type { RegisteredArtifact } from "../artifacts/registryTypes";
import type { CanvasNode } from "../artifacts/types";
import type { WorkspaceRecord } from "../workspaces/types";

export interface RelayPlacementContext {
  stageSize: { width: number; height: number };
}

export interface RelayPreparedArtifacts {
  artifacts: RegisteredArtifact[];
  bundles: ArtifactBundle[];
}

export interface PreparedRelayDelivery extends RelayPreparedArtifacts {
  nodes: CanvasNode[];
  workspace: WorkspaceRecord;
}

export interface RelaySessionRequest extends RelayPlacementContext {
  targetViewId: string;
  targetViewIncarnationId: string;
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

export interface RelayDeliveryOutcome {
  detail?: string;
  kind: "installed" | "rejected";
  summary: string;
}

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
  viewIncarnationId: string;
  syncArtifactCatalog: (prepared: RelayPreparedArtifacts) => void;
  install: (
    prepared: RelayPreparedArtifacts,
    placement: RelayPlacementContext,
    identity: RelayDeliveryIdentity,
  ) => Promise<RelayInstallResult>;
}
