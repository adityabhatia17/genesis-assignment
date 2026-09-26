import { z } from 'zod';
import { useZodForm } from '@/composables/useZodForm';

const Schema = z.object({ name: z.string().trim().min(1, 'Required') });

describe('useZodForm', () => {
  it('collects the first message per field and blocks invalid submits', async () => {
    const form = useZodForm(Schema, { name: '' });
    const onValid = vi.fn(() => Promise.resolve());
    await form.handleSubmit(onValid)();
    expect(form.errors.name).toBe('Required');
    expect(onValid).not.toHaveBeenCalled();
  });

  it('submits parsed data and maps thrown errors to formError', async () => {
    const form = useZodForm(Schema, { name: '  Clinic ' });
    const onValid = vi.fn(() => Promise.reject(new Error('boom')));
    await form.handleSubmit(onValid, () => 'Mapped')();
    expect(onValid).toHaveBeenCalledWith({ name: 'Clinic' });
    expect(form.formError.value).toBe('Mapped');
    expect(form.submitting.value).toBe(false);
  });

  it('reset clears values and errors', async () => {
    const form = useZodForm(Schema, { name: '' });
    await form.handleSubmit(() => Promise.resolve())();
    form.reset({ name: 'x' });
    expect(form.values.name).toBe('x');
    expect(form.errors.name).toBeUndefined();
  });
});
