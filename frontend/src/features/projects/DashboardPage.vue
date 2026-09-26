<script setup lang="ts">
import { PlusIcon } from '@lucide/vue';
import { FirebaseError } from 'firebase/app';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import PageState from '@/components/common/PageState.vue';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ConnectionCard from '@/features/highlevel/ConnectionCard.vue';
import { useHighLevelConnection } from '@/features/highlevel/useHighLevelConnection';
import { useOAuthReturnToast } from '@/features/highlevel/useOAuthReturnToast';
import { toUserMessage } from '@/lib/errors';
import type { Project } from '@/services/firestore/types';
import DeleteProjectDialog from './DeleteProjectDialog.vue';
import ProjectFormDialog from './ProjectFormDialog.vue';
import ProjectRow from './ProjectRow.vue';
import type { ProjectFormValues } from './project-form.schema';
import { useProjects } from './useProjects';

const router = useRouter();
const { projects, loading, error, retry, create, rename, remove } = useProjects();
const { locationId } = useHighLevelConnection();
useOAuthReturnToast();

const formOpen = ref(false);
const editing = ref<Project | null>(null);
const deleteOpen = ref(false);
const deleting = ref<Project | null>(null);

function openCreate(): void {
  editing.value = null;
  formOpen.value = true;
}
function openEdit(project: Project): void {
  editing.value = project;
  formOpen.value = true;
}
function openDelete(project: Project): void {
  deleting.value = project;
  deleteOpen.value = true;
}

async function submitForm(values: ProjectFormValues): Promise<void> {
  if (editing.value) {
    await rename(editing.value.id, values);
    toast.success('Project updated');
    return;
  }
  const id = await create(values);
  toast.success('Project created');
  await router.push({ name: 'workspace', params: { projectId: id } });
}

async function confirmDelete(): Promise<void> {
  const project = deleting.value;
  if (!project) return;
  try {
    await remove(project.id);
    toast.success(`Deleted “${project.name}”`);
  } catch (e) {
    const generating =
      e instanceof FirebaseError && e.code === 'permission-denied' && project.activeGeneration;
    toast.error(
      generating
        ? 'This project is generating right now. Try again when it finishes.'
        : toUserMessage(e),
    );
    throw e;
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Projects</h1>
        <p class="text-sm text-muted-foreground">Apps you've built for your HighLevel account.</p>
      </div>
      <Button @click="openCreate"><PlusIcon />New project</Button>
    </div>

    <ConnectionCard />

    <section aria-label="Projects" class="flex flex-col">
      <div v-if="loading" class="divide-y divide-border rounded-lg border">
        <Skeleton v-for="n in 3" :key="n" class="h-12 rounded-none" />
      </div>
      <PageState
        v-else-if="error"
        kind="error"
        title="Couldn't load projects"
        :description="toUserMessage(error)"
        action-label="Retry"
        @action="retry"
      />
      <PageState
        v-else-if="projects.length === 0"
        kind="empty"
        title="No projects yet"
        description="Create a project, then describe the app you want in chat."
        action-label="Create project"
        @action="openCreate"
      />
      <div v-else class="divide-y divide-border rounded-lg border">
        <ProjectRow
          v-for="project in projects"
          :key="project.id"
          :project="project"
          :connected-location-id="locationId"
          @edit="openEdit(project)"
          @delete="openDelete(project)"
        />
      </div>
    </section>

    <ProjectFormDialog v-model:open="formOpen" :project="editing" :submit="submitForm" />
    <DeleteProjectDialog v-model:open="deleteOpen" :project="deleting" :confirm="confirmDelete" />
  </div>
</template>
