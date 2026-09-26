import type { z } from "zod";
import type { FileSaveBody, FileSaveResult } from "@/contracts/api";
import { apiFetch } from "@/lib/http";

export function saveFile(
  projectId: string,
  fileId: string,
  body: z.infer<typeof FileSaveBody>,
): Promise<FileSaveResult> {
  return apiFetch(
    "api",
    `/v1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
    {
      method: "PUT",
      body,
    },
  );
}
