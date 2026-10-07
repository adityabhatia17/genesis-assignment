import { mount } from '@vue/test-utils';
import OptionToggle from '@/features/variants/OptionToggle.vue';
import { defaultOptionId, optionToggleLabel } from '@/features/variants/option-label';

describe('option labels', () => {
  it('names an option by its place and score', () => {
    expect(optionToggleLabel(1, 82)).toBe('Option 1 · 82');
    expect(optionToggleLabel(2, 76)).toBe('Option 2 · 76');
  });

  it('selects the top pick by default', () => {
    expect(
      defaultOptionId([
        { candidateId: 'c1', topPick: false },
        { candidateId: 'c0', topPick: true },
      ]),
    ).toBe('c0');
    expect(defaultOptionId([{ candidateId: 'c3', topPick: false }])).toBe('c3');
    expect(defaultOptionId([])).toBeNull();
  });
});

describe('OptionToggle', () => {
  const options = [
    { candidateId: 'c0', rank: 1, total: 82, topPick: true, directionLabel: 'Warm list' },
    { candidateId: 'c1', rank: 2, total: 76, topPick: false, directionLabel: 'Dense table' },
  ];

  it('shows scores and hides the design name', () => {
    const wrapper = mount(OptionToggle, {
      props: { options, selectedId: 'c0', locked: false },
    });
    expect(wrapper.text()).toContain('Option 1 · 82');
    expect(wrapper.text()).toContain('Option 2 · 76');
    expect(wrapper.text()).not.toContain('Warm list');
    expect(wrapper.text()).not.toContain('Dense table');
    expect(wrapper.get('[role="radio"][aria-checked="true"]').text()).toContain('82');
  });

  it('emits the other option when its score is chosen', async () => {
    const wrapper = mount(OptionToggle, {
      props: { options, selectedId: 'c0', locked: false },
    });
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual(['c1']);
  });
});
