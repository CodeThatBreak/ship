'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Props = {
  items: { id: string; label: string }[];
  /** the selected item's id (matching an item's `id`); null selects a null-id item */
  active?: string;
  onSelect: (id: string) => void;
  /** accessible description of what the strip selects (aria-label) */
  label: string;
  className?: string;
};

/**
 * A generic tab strip: domain-neutral pills for switching between the
 * feature's selectable views — the chat feed's conversation tabs (the plan
 * node's per-sub-plan-refinement threads) and anything else that follows the
 * same shape (`{ id, label }` items, one active id). Presentational only:
 * items, the active id and its switches come from the caller. An item whose
 * `id` is `null` is a legal entry (the feature's default view, e.g. the
 * chat's main conversation).
 */
export function TabStrip({ items, active, onSelect, label, className }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="flex shrink-0 gap-1.5 flex-wrap px-1 pb-2">
      <Tabs aria-label={label} defaultValue={active} className={className} onValueChange={onSelect}>
        <TabsList>
          {items.map(item => (
            <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
