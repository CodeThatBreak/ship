import { Skeleton } from '@/components/ui/skeleton';
import { InputGroup } from '@/components/ui/input-group';

export function ChatSkeleton() {
  return (
    <InputGroup>
      <div role="status" aria-label="Loading the prompt template" className="flex-1 py-3 px-0.5">
        <Skeleton className="h-4 w-11/12 mb-1.5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </InputGroup>
  );
}
