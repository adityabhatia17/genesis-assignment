<script setup lang="ts">
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
import { useConfirm } from '@/composables/useConfirm';

const { state, settle } = useConfirm();

function onOpenChange(open: boolean): void {
  if (!open) settle(false);
}
</script>

<template>
  <AlertDialog :open="state.open" @update:open="onOpenChange">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ state.title }}</AlertDialogTitle>
        <AlertDialogDescription :class="{ 'sr-only': !state.description }">
          {{ state.description || state.title }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ state.cancelLabel }}</AlertDialogCancel>
        <Button :variant="state.destructive ? 'destructive' : 'default'" @click="settle(true)">
          {{ state.confirmLabel }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
