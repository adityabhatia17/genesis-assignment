<script setup lang="ts">
import { MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isThemeMode, useTheme } from '@/composables/useTheme';

const { mode, resolved, setMode } = useTheme();

function onSelect(value: unknown): void {
  if (isThemeMode(value)) setMode(value);
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" aria-label="Theme">
        <MoonIcon v-if="resolved === 'dark'" />
        <SunIcon v-else />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup :model-value="mode" @update:model-value="onSelect">
        <DropdownMenuRadioItem value="light"><SunIcon />Light</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark"><MoonIcon />Dark</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="auto"><MonitorIcon />System</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
