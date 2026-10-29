'use client';
import { RotateCcw, AlertCircleIcon } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function FailureAlert({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="max-w-md">
      <AlertCircleIcon />
      <AlertTitle>Plan generation failed</AlertTitle>
      <AlertDescription>The agent ran failed. See activity feed for exact error</AlertDescription>
      <AlertAction>
        <Button size="xs" onClick={onRetry}>
          <RotateCcw size={12} /> Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}
