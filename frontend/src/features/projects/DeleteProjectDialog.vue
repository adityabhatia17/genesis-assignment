<script setup lang="ts">
import { ref } from 'vue';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { Project } from '@/services/firestore/types';

const props = defineProps<{ project: Project | null; confirm: () => Promise<void> }>();
const open = defineModel<boolean>('open', { required: true });
const busy = ref(false);

async function onConfirm(): Promise<void> {
  busy.value = true;
  try {
    await props.confirm();
    open.value = false;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{{ props.project?.name }}”?</AlertDialogTitle>
        <AlertDialogDescription>
          It will be removed from your projects. Files and history are kept in storage but no longer
          shown.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">Cancel</AlertDialogCancel>
        <Button variant="destructive" :disabled="busy" @click="onConfirm">
          <Spinner v-if="busy" />
          Delete project
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
