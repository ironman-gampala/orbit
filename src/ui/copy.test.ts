import { describe, expect, it } from 'vitest';
import { HOME_COPY } from './copy';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, v]) => (key === 'icon' ? [] : strings(v)));
  return [];
}

describe('home page copy', () => {
  const all = strings(HOME_COPY);

  it('has copy to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all)('"%s" uses no semicolons, hyphens or dashes', (text) => {
    expect(text).not.toMatch(/[;\-\u2010-\u2015\u2212]/);
  });
});
