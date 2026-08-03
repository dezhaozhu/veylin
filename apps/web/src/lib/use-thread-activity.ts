import { useSyncExternalStore } from 'react';
import {
  getThreadActivityMap,
  subscribeThreadActivity,
  type ThreadActivity,
  type ThreadActivityKind,
} from '@/lib/thread-activity-store';

export type { ThreadActivity, ThreadActivityKind };

export function useThreadActivityMap(): Record<string, ThreadActivity> {
  return useSyncExternalStore(
    subscribeThreadActivity,
    getThreadActivityMap,
    () => ({}),
  );
}
