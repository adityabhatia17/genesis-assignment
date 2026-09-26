<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ChatPanel from './chat/ChatPanel.vue';
import CodePanel from './editor/CodePanel.vue';
import PreviewPanel from './preview/PreviewPanel.vue';
import { useWorkspaceStore, type MobileTab } from './stores/workspace.store';

const wide = useMediaQuery('(min-width: 1024px)');
const workspace = useWorkspaceStore();
const { mobileTab } = storeToRefs(workspace);

function onTab(value: unknown): void {
  if (value === 'chat' || value === 'code' || value === 'preview')
    mobileTab.value = value satisfies MobileTab;
}
</script>

<template>
  <ResizablePanelGroup
    v-if="wide"
    direction="horizontal"
    auto-save-id="genesis-workspace"
    class="min-h-0 flex-1"
  >
    <ResizablePanel :default-size="24" :min-size="20">
      <ChatPanel />
    </ResizablePanel>
    <ResizableHandle with-handle />
    <ResizablePanel :default-size="40" :min-size="25">
      <CodePanel />
    </ResizablePanel>
    <ResizableHandle with-handle />
    <ResizablePanel :default-size="36" :min-size="20">
      <PreviewPanel />
    </ResizablePanel>
  </ResizablePanelGroup>
  <Tabs
    v-else
    :model-value="mobileTab"
    :unmount-on-hide="false"
    class="flex min-h-0 flex-1 flex-col gap-0"
    @update:model-value="onTab"
  >
    <TabsList class="mx-2 mt-2 grid grid-cols-3">
      <TabsTrigger value="chat">Chat</TabsTrigger>
      <TabsTrigger value="code">Code</TabsTrigger>
      <TabsTrigger value="preview">Preview</TabsTrigger>
    </TabsList>
    <TabsContent value="chat" class="min-h-0 flex-1 data-[state=inactive]:hidden">
      <ChatPanel />
    </TabsContent>
    <TabsContent value="code" class="min-h-0 flex-1 data-[state=inactive]:hidden">
      <CodePanel />
    </TabsContent>
    <TabsContent value="preview" class="min-h-0 flex-1 data-[state=inactive]:hidden">
      <PreviewPanel />
    </TabsContent>
  </Tabs>
</template>
