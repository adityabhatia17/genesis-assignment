import { mount } from '@vue/test-utils';
import PromptComposer from '@/features/workspace/chat/PromptComposer.vue';

const props = { busy: false, blockedReason: null, hlConnected: true };

describe('PromptComposer', () => {
  it('submits with Cmd/Ctrl+Enter and clears', async () => {
    const wrapper = mount(PromptComposer, {
      props: {
        ...props,
        modelValue: 'Add a search box',
        'onUpdate:modelValue': (v: string) => wrapper.setProps({ modelValue: v }),
      },
    });
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(wrapper.emitted('submit')).toEqual([['Add a search box']]);
    expect(wrapper.props('modelValue')).toBe('');
  });

  it('is disabled when blocked, empty or too long', async () => {
    const wrapper = mount(PromptComposer, {
      props: { ...props, modelValue: '', blockedReason: "You're offline." },
    });
    expect(wrapper.text()).toContain("You're offline.");
    const send = wrapper.findAll('button').find((b) => b.text().includes('Send'))!;
    expect(send.attributes('disabled')).toBeDefined();
    await wrapper.setProps({
      blockedReason: null,
      modelValue: 'x'.repeat(4001),
    });
    expect(wrapper.text()).toContain('4001/4000');
    expect(send.attributes('disabled')).toBeDefined();
  });

  it('disables Send while generating', () => {
    const wrapper = mount(PromptComposer, {
      props: { ...props, busy: true, modelValue: 'hi' },
    });
    const send = wrapper.findAll('button').find((b) => b.text().includes('Send'));
    expect(send?.attributes('disabled')).toBeDefined();
  });
});
