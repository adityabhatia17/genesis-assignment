<script setup lang="ts">
import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue';
import { computed } from 'vue';
import { toast } from 'vue-sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/composables/useAuth';
import { isThemeMode, useTheme } from '@/composables/useTheme';
import { toUserMessage } from '@/lib/errors';

const { user, signOut } = useAuth();
const { mode, setMode } = useTheme();

const email = computed(() => user.value?.email ?? '');
const initials = computed(() => email.value.slice(0, 2).toUpperCase() || '?');

function onTheme(value: unknown): void {
  if (isThemeMode(value)) setMode(value);
}

async function onSignOut(): Promise<void> {
  try {
    // installAuthRedirect() (router.ts) moves protected pages to /sign-in once the session ends.
    await signOut();
  } catch (error) {
    toast.error(toUserMessage(error));
  }
}
</script>

<template>
  <DropdownMenu v-if="user">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Account menu">
        <Avatar class="size-7">
          <AvatarFallback class="text-[11px] font-medium">{{ initials }}</AvatarFallback>
        </Avatar>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-56">
      <DropdownMenuLabel class="truncate font-normal text-muted-foreground">
        {{ email }}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup :model-value="mode" @update:model-value="onTheme">
        <DropdownMenuRadioItem value="light"><SunIcon />Light</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="dark"><MoonIcon />Dark</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="auto"><MonitorIcon />System</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="onSignOut"><LogOutIcon />Sign out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
