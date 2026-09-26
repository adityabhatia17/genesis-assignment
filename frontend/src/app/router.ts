import { onAuthStateChanged } from 'firebase/auth';
import { createRouter, createWebHistory, type RouteRecordRaw, type Router } from 'vue-router';
import { auth } from '@/lib/firebase';
import { resolveNavigation } from './guards';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
    layout?: 'auth' | 'app' | 'bare';
    title?: string;
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'root', redirect: { name: 'dashboard' } },
  {
    path: '/sign-in',
    name: 'sign-in',
    component: () => import('@/features/auth/SignInPage.vue'),
    meta: { guestOnly: true, layout: 'auth', title: 'Sign in' },
  },
  {
    path: '/sign-up',
    name: 'sign-up',
    component: () => import('@/features/auth/SignUpPage.vue'),
    meta: { guestOnly: true, layout: 'auth', title: 'Create account' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/features/projects/DashboardPage.vue'),
    meta: { requiresAuth: true, layout: 'app', title: 'Projects' },
  },
  {
    path: '/projects/:projectId',
    name: 'workspace',
    component: () => import('@/features/workspace/WorkspacePage.vue'),
    props: true,
    meta: { requiresAuth: true, layout: 'bare', title: 'Workspace' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('./NotFoundPage.vue'),
    meta: { layout: 'app', title: 'Not found' },
  },
];

export function createAppRouter(): Router {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
    scrollBehavior: () => ({ top: 0 }),
  });

  router.beforeEach(async (to) => {
    await auth().authStateReady();
    return resolveNavigation({
      requiresAuth: to.meta.requiresAuth === true,
      guestOnly: to.meta.guestOnly === true,
      signedIn: auth().currentUser !== null,
      fullPath: to.fullPath,
    });
  });

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · Genesis` : 'Genesis';
  });

  return router;
}

/** When the session ends (sign-out elsewhere, token revoked), leave protected pages. */
export function installAuthRedirect(router: Router): void {
  onAuthStateChanged(auth(), (user) => {
    if (!user && router.currentRoute.value.meta.requiresAuth) {
      void router.replace({ name: 'sign-in' });
    }
  });
}
