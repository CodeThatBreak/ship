'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Widths approximate a real markdown plan: heading, paragraphs, a short list.
const SKELETON_LINES = [
  'w-2/5 h-4', // heading
  'w-full',
  'w-11/12',
  'w-4/5',
  'w-0 h-2', // paragraph gap
  'w-full',
  'w-10/12',
  'w-3/5',
  'w-0 h-2', // paragraph gap
  'w-9/12',
  'w-2/3',
];

function MasterPlanLoader() {
  return (
    <div aria-busy="true" aria-label="Loading master plan">
      {/* Mirrors the h3: icon + "Master plan" label */}
      <div className="mb-2 flex items-center gap-1.5">
        <Skeleton className="size-3.5 rounded" />
        <Skeleton className="h-4 w-24" />
      </div>

      {/* Mirrors the Card with the same padding as the real one */}
      <Card className="space-y-2.5 px-4 py-4">
        {SKELETON_LINES.map((cls, i) => (
          <Skeleton key={i} className={`h-3 ${cls}`} />
        ))}
      </Card>
    </div>
  );
}

export { MasterPlanLoader };
