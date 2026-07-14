export class WorkspaceDeletedError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super("This canvas was deleted in another browser tab. Restore it before saving more edits.");
    this.name = "WorkspaceDeletedError";
    this.workspaceId = workspaceId;
  }
}

export class WorkspaceConflictError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super("This canvas changed in another browser tab. Reload it before saving more edits.");
    this.name = "WorkspaceConflictError";
    this.workspaceId = workspaceId;
  }
}
