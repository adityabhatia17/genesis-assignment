import { ProjectFormSchema } from '@/features/projects/project-form.schema';

describe('ProjectFormSchema', () => {
  it('trims and enforces the rules limits', () => {
    expect(ProjectFormSchema.parse({ name: '  Clinic  ', description: '' })).toEqual({
      name: 'Clinic',
      description: '',
    });
    expect(ProjectFormSchema.safeParse({ name: '   ', description: '' }).success).toBe(false);
    expect(ProjectFormSchema.safeParse({ name: 'x'.repeat(61), description: '' }).success).toBe(
      false,
    );
    expect(ProjectFormSchema.safeParse({ name: 'x', description: 'y'.repeat(281) }).success).toBe(
      false,
    );
  });
});
