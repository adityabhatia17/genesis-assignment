import type { RouteLocationRaw } from 'vue-router';

export interface NavigationInput {
  requiresAuth: boolean;
  guestOnly: boolean;
  signedIn: boolean;
  fullPath: string;
}

/** Pure routing decision (tested without a router). */
export function resolveNavigation(input: NavigationInput): true | RouteLocationRaw {
  if (input.requiresAuth && !input.signedIn) {
    return { name: 'sign-in', query: { redirect: input.fullPath } };
  }
  if (input.guestOnly && input.signedIn) return { name: 'dashboard' };
  return true;
}
