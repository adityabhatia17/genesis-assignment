<script setup lang="ts">
import { ref } from 'vue';
import { toast } from 'vue-sonner';
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
import { toUserMessage } from '@/lib/errors';
import { restoreSnapshot } from '@/services/api/snapshots.api';
import type { Snapshot } from '@/services/firestore/types';

const props = defineProps<{ projectId: string; snapshot: Snapshot | null }>();
const emit = defineEmits<{ restored: [] }>();
const open = defineModel<boolean>('open', { required: true });
const busy = ref(false);

async function onRestore(): Promise<void> {
  if (!props.snapshot) return;
  busy.value = true;
  try {
    const result = await restoreSnapshot(props.projectId, props.snapshot.id);
    toast.success(`Restored #${props.snapshot.seq} (now #${result.snapshotSeq})`);
    open.value = false;
    emit('restored');
  } catch (error) {
    toast.error(toUserMessage(error));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Restore history #{{ props.snapshot?.seq }}?</AlertDialogTitle>
        <AlertDialogDescription>
          Your files return to this version. Saved edits since the last history point are kept as a
          checkpoint first. Nothing is lost, and you can restore any version later.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">Cancel</AlertDialogCancel>
        <Button :disabled="busy" @click="onRestore"><Spinner v-if="busy" />Restore</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
