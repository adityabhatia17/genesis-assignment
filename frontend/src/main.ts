import 'vue-sonner/style.css';
import '@/assets/main.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { toast } from 'vue-sonner';
import App from '@/app/App.vue';
import { renderConfigError } from '@/app/config-error';
import { createAppRouter, installAuthRedirect } from '@/app/router';
import { startAuthListener } from '@/composables/useAuth';
import { parseEnv } from '@/lib/env';
import { auth, initFirebase } from '@/lib/firebase';
import { configureHttp } from '@/lib/http';

const result = parseEnv({ ...import.meta.env });

if (!result.ok) {
  renderConfigError(result.problems);
} else {
  const { env } = result;
  initFirebase(env);
  configureHttp({
    baseUrls: { api: env.apiBaseUrl, generate: env.generateBaseUrl },
    getIdToken: async () => (await auth().currentUser?.getIdToken()) ?? null,
  });
  startAuthListener();

  const app = createApp(App);
  const router = createAppRouter();
  app.use(createPinia());
  app.use(router);
  installAuthRedirect(router);
  app.config.errorHandler = (error, _instance, info) => {
    console.error('[genesis] unhandled error in', info, error);
    toast.error('Something went wrong. Please try again.');
  };
  app.mount('#app');
}
