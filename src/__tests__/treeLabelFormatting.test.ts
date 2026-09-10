import { formatTreeLabel, formatTreeDescription } from '../ui/treeView';

describe('tree label formatting', () => {
  it('does not emit codicon syntax in a label', () => {
    // TreeItemLabel has no supportThemeIcons flag, so $(star-full) renders
    // as literal text.
    expect(formatTreeLabel({ favorite: true, time: '16:04:22' })).toBe(
      '16:04:22',
    );
  });

  it('marks a selective snapshot without a codicon', () => {
    expect(
      formatTreeLabel({ favorite: false, selective: true, time: '09:00:00' }),
    ).toBe('09:00:00 (Selective)');
  });

  it('leaves a plain label alone', () => {
    expect(formatTreeLabel({ time: '09:00:00' })).toBe('09:00:00');
  });

  it('never emits a $() sequence for any combination', () => {
    for (const favorite of [true, false]) {
      for (const selective of [true, false]) {
        const label = formatTreeLabel({ favorite, selective, time: '12:00:00' });
        expect(label).not.toMatch(/\$\(/);
      }
    }
  });

  it('does not emit codicon syntax in a description', () => {
    expect(
      formatTreeDescription({ directory: 'src', changeType: 'modified' }),
    ).toBe('src  M');
  });

  it('maps every change type to a single letter', () => {
    expect(formatTreeDescription({ directory: 'src', changeType: 'added' })).toBe(
      'src  A',
    );
    expect(
      formatTreeDescription({ directory: 'src', changeType: 'deleted' }),
    ).toBe('src  D');
  });

  it('returns the directory alone when the change type is unknown', () => {
    expect(formatTreeDescription({ directory: 'src' })).toBe('src');
    expect(
      formatTreeDescription({ directory: 'src', changeType: 'somethingElse' }),
    ).toBe('src');
  });

  it('omits a leading ./ for root-level files', () => {
    expect(formatTreeDescription({ directory: '' })).toBe('');
    expect(formatTreeDescription({ directory: '.' })).toBe('');
  });

  it('does not pad when there is no directory', () => {
    expect(
      formatTreeDescription({ directory: '', changeType: 'modified' }),
    ).toBe('M');
  });
});
