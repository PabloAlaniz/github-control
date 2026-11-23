/** Pure transformation for compare-snapshot DB rows into API shape. */

import type { CompareEntry } from './types';

export const toCompareEntry = (row: any): CompareEntry => ({
  repo: row.full_name,
  deltas: {
    loc: parseInt(row.loc_delta || '0'),
    fileCount: parseInt(row.file_count_delta || '0'),
    sizeKb: parseInt(row.repo_size_kb_delta || '0'),
    stars: parseInt(row.stars_delta || '0'),
    forks: parseInt(row.forks_delta || '0'),
    openIssues: parseInt(row.open_issues_delta || '0'),
  },
  current: {
    loc: parseInt(row.current_loc || '0'),
    fileCount: parseInt(row.current_file_count || '0'),
    stars: parseInt(row.current_stars || '0'),
    fromLoc: parseInt(row.from_loc || '0'),
  },
  isNew: row.is_new === true || row.is_new === 't',
  isRemoved: row.is_removed === true || row.is_removed === 't',
});
