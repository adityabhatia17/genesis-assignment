<script setup lang="ts">
import PageState from '@/components/common/PageState.vue';
</script>

<template>
  <PageState
    kind="empty"
    title="Page not found"
    description="The page you're looking for doesn't exist."
    action-label="Go to projects"
    :action-to="{ name: 'dashboard' }"
  />
</template>
