<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useFileSave } from "../composables/useFileSave";
import { useWorkspaceStore } from "../stores/workspace.store";

const workspace = useWorkspaceStore();
const { saveConflict } = storeToRefs(workspace);
const saver = useFileSave();
const open = computed(() => saveConflict.value !== null);

function close(value: boolean): void {
  if (!value) workspace.saveConflict = null;
}
</script>

<template>
  <AlertDialog :open="open" @update:open="close">
    <AlertDialogContent v-if="saveConflict">
      <AlertDialogHeader>
        <AlertDialogTitle
          >{{ saveConflict.path }} changed since you started
          editing</AlertDialogTitle
        >
        <AlertDialogDescription>
          A newer version (v{{ saveConflict.remoteVersion }}) was saved by a
          generation, a restore or another tab. Keep your edits and overwrite
          it, or discard your edits and use the latest.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button variant="outline" @click="saver.useTheirs(saveConflict.path)"
          >Use the latest</Button
        >
        <Button
          @click="saver.keepMine(saveConflict.path, saveConflict.remoteVersion)"
          >Keep mine</Button
        >
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
