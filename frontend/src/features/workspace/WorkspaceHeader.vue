<script setup lang="ts">
import { ArrowLeftIcon, HistoryIcon, PencilIcon } from '@lucide/vue';
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { toast } from 'vue-sonner';
import UserMenu from '@/components/common/UserMenu.vue';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ConnectionBadge from '@/features/highlevel/ConnectionBadge.vue';
import ProjectFormDialog from '@/features/projects/ProjectFormDialog.vue';
import type { ProjectFormValues } from '@/features/projects/project-form.schema';
import { updateProject } from '@/services/firestore/projects.repo';
import GenerationStatusPill from './chat/GenerationStatusPill.vue';
import { useWorkspaceStore } from './stores/workspace.store';
import { useWorkspace } from './workspace-context';

const ws = useWorkspace();
const workspace = useWorkspaceStore();
const renameOpen = ref(false);

async function rename(values: ProjectFormValues): Promise<void> {
  await updateProject(ws.uid, ws.projectId, values);
  toast.success('Project updated');
}
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button as-child variant="ghost" size="icon-sm" aria-label="Back to projects">
          <RouterLink :to="{ name: 'dashboard' }"><ArrowLeftIcon /></RouterLink>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Projects</TooltipContent>
    </Tooltip>
    <button
      type="button"
      class="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-muted"
      :aria-label="`Rename ${ws.project.value?.name ?? 'project'}`"
      @click="renameOpen = true"
    >
      <span class="truncate">{{ ws.project.value?.name }}</span>
      <PencilIcon
        class="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
      />
    </button>
    <GenerationStatusPill />
    <div class="ml-auto flex items-center gap-2">
      <ConnectionBadge />
      <Button variant="outline" size="sm" @click="workspace.historyOpen = true">
        <HistoryIcon />History
      </Button>
      <UserMenu />
    </div>
    <ProjectFormDialog v-model:open="renameOpen" :project="ws.project.value" :submit="rename" />
  </header>
</template>
