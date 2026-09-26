<script setup lang="ts">
import { computed, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { LIMITS } from '@/contracts/limits';
import { useZodForm } from '@/composables/useZodForm';
import type { Project } from '@/services/firestore/types';
import { ProjectFormSchema, type ProjectFormValues } from './project-form.schema';

const props = defineProps<{
  /** null = create a new project */
  project: Project | null;
  submit: (values: ProjectFormValues) => Promise<void>;
}>();
const open = defineModel<boolean>('open', { required: true });

const isEdit = computed(() => props.project !== null);
const { values, errors, submitting, formError, handleSubmit, reset } = useZodForm(
  ProjectFormSchema,
  { name: '', description: '' },
);

watch(open, (isOpen) => {
  if (isOpen)
    reset({ name: props.project?.name ?? '', description: props.project?.description ?? '' });
});

const onSubmit = handleSubmit(async (data) => {
  await props.submit(data);
  open.value = false;
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit project' : 'New project' }}</DialogTitle>
        <DialogDescription>
          {{
            isEdit
              ? 'Rename the project or change its description.'
              : 'Name the app you want to build. You can describe it in chat next.'
          }}
        </DialogDescription>
      </DialogHeader>
      <form novalidate class="grid gap-6" @submit="onSubmit">
        <FieldGroup>
          <Alert v-if="formError" variant="destructive">
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>
          <Field :data-invalid="!!errors.name">
            <FieldLabel for="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              v-model="values.name"
              :maxlength="LIMITS.projectNameMax"
              placeholder="Clinic front desk"
              :aria-invalid="!!errors.name"
            />
            <FieldError v-if="errors.name">{{ errors.name }}</FieldError>
          </Field>
          <Field :data-invalid="!!errors.description">
            <FieldLabel for="project-description">Description (optional)</FieldLabel>
            <Textarea
              id="project-description"
              v-model="values.description"
              rows="3"
              :maxlength="LIMITS.projectDescriptionMax"
              :aria-invalid="!!errors.description"
            />
            <FieldDescription>
              {{ values.description.length }}/{{ LIMITS.projectDescriptionMax }}
            </FieldDescription>
            <FieldError v-if="errors.description">{{ errors.description }}</FieldError>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="open = false">Cancel</Button>
          <Button type="submit" :disabled="submitting">
            <Spinner v-if="submitting" />
            {{ isEdit ? 'Save' : 'Create project' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
