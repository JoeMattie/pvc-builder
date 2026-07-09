import { describe, expect, it } from 'vitest';
import { changelogEntriesForDisplay } from './ProjectList';

describe('changelogEntriesForDisplay', () => {
  it('shows only the two newest versions until older versions are revealed', () => {
    const entries = ['0.4.0', '0.3.0', '0.2.0', '0.1.0'];
    expect(changelogEntriesForDisplay(entries, false)).toEqual(['0.4.0', '0.3.0']);
    expect(changelogEntriesForDisplay(entries, true)).toEqual(entries);
  });
});
