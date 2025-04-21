// Add missing Intl.Segmenter definition
declare namespace Intl {
  interface SegmenterOptions {
    granularity?: 'grapheme' | 'word' | 'sentence';
  }
  interface SegmentData {
    segment: string;
    index: number;
  }

  class Segmenter {
    constructor(locale?: string | string[], options?: SegmenterOptions);
    segment(input: string): IterableIterator<SegmentData>;
  }
}
