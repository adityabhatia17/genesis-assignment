import { mount } from '@vue/test-utils';
import SelectDoubleCheck from '@/features/variants/SelectDoubleCheck.vue';
import ScoreSummary from '@/features/variants/ScoreSummary.vue';

const groups = {
  works: { points: 30, max: 35 },
  looks: { points: 20, max: 30 },
  request: { points: 10, max: 15 },
  easy: { points: 8, max: 10 },
};

describe('choice UI', () => {
  it('shows the score as text, not only a bar', () => {
    const wrapper = mount(ScoreSummary, { props: { total: 81, groups } });
    expect(wrapper.text()).toContain('81');
    expect(wrapper.text()).toContain('Works');
    expect(wrapper.text()).toContain('30/35');
    expect(wrapper.get('[aria-label]').attributes('aria-label')).toContain('81 out of 100');
  });

  it('asks the owner to confirm in place, and Go back does not confirm', async () => {
    const wrapper = mount(SelectDoubleCheck, {
      props: { total: 81, busy: false },
    });
    expect(wrapper.text()).toContain('score 81');
    expect(wrapper.text()).not.toContain('Agenda');
    expect(wrapper.text()).toContain('will be removed');
    await wrapper.get('button').trigger('click');
    const buttons = wrapper.findAll('button');
    await buttons[1]!.trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('back')).toHaveLength(1);
  });
});
