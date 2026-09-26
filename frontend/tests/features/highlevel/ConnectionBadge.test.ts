import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ConnectionStatus } from '@/features/highlevel/useHighLevelConnection';

const status = ref<ConnectionStatus>('connected');
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ uid: computed(() => 'u1') }) }));
vi.mock('@/features/highlevel/useHighLevelConnection', () => ({
  useHighLevelConnection: () => ({
    status: computed(() => status.value),
    locationName: computed(() => 'Demo Clinic'),
    timezone: computed(() => 'America/New_York'),
    scopes: computed(() => ['contacts.readonly']),
  }),
}));

const { default: ConnectionBadge } = await import('@/features/highlevel/ConnectionBadge.vue');
const render = () =>
  mount({
    components: { TooltipProvider, ConnectionBadge },
    template: '<TooltipProvider><ConnectionBadge /></TooltipProvider>',
  });

describe('ConnectionBadge', () => {
  it.each([
    ['connected', 'Connected · Demo Clinic'],
    ['reauth_required', 'Reconnect HighLevel'],
    ['disconnected', 'Not connected'],
  ] as const)('%s', (value, text) => {
    status.value = value;
    expect(render().get('[data-testid="hl-badge"]').text()).toContain(text);
  });
});
