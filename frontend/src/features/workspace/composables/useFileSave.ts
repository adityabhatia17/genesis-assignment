import { toast } from "vue-sonner";
import { toUserMessage } from "@/lib/errors";
import { isApiError } from "@/lib/http";
import { saveFile } from "@/services/api/files.api";
import { useWorkspaceStore } from "../stores/workspace.store";
import { useWorkspace } from "../workspace-context";

export interface FileSaveApi {
  save: (path: string) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  keepMine: (path: string, remoteVersion: number) => Promise<boolean>;
  useTheirs: (path: string) => void;
}

/** Manual save with optimistic concurrency (07 §4.11). State lives in the workspace store. */
export function useFileSave(): FileSaveApi {
  const ws = useWorkspace();
  const workspace = useWorkspaceStore();

  async function save(path: string): Promise<boolean> {
    const file = ws.files.value.find((f) => f.path === path);
    if (!file || !ws.models.isDirty(path)) return true;
    const draft = ws.models.beginSave(path);
    if (!draft) return false;
    workspace.savingPath = path;
    try {
      const result = await saveFile(ws.projectId, file.id, draft);
      ws.models.completeSave(path, result.version);
      toast.success(`Saved ${path}`);
      return true;
    } catch (error) {
      ws.models.abortSave(path);
      if (isApiError(error) && error.code === "FILE_VERSION_CONFLICT") {
        const remoteVersion = Number(
          error.details["currentVersion"] ?? file.version,
        );
        workspace.setConflict(path, true);
        workspace.saveConflict = { path, remoteVersion };
      } else if (isApiError(error) && error.code === "GENERATION_IN_PROGRESS") {
        toast.error("Saving is paused while Genesis is generating.");
      } else {
        toast.error(toUserMessage(error));
      }
      return false;
    } finally {
      workspace.savingPath = null;
    }
  }

  async function saveAll(): Promise<boolean> {
    for (const path of ws.models.dirtyPaths()) {
      if (!(await save(path))) return false;
    }
    return true;
  }

  async function keepMine(
    path: string,
    remoteVersion: number,
  ): Promise<boolean> {
    ws.models.acceptRemoteVersion(path, remoteVersion);
    workspace.setConflict(path, false);
    workspace.saveConflict = null;
    return save(path);
  }

  function useTheirs(path: string): void {
    const file = ws.files.value.find((f) => f.path === path);
    if (file) ws.models.takeRemote(file);
    workspace.setConflict(path, false);
    workspace.saveConflict = null;
  }

  return { save, saveAll, keepMine, useTheirs };
}
