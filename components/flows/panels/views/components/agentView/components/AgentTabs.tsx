'use client';

import { Sparkles } from 'lucide-react';
import { EmptyHint } from '@/components/shared/EmptyHint';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Node } from '@/types/flow';
import { AGENT_VIEW_TAB, TABS_LIST_CLASS } from '../constants/tabs';
import type { AgentViewModel } from '../hooks/useAgentView';
import { kindTabLabel } from '../utils/tabLabels';
import { tabIcon } from '../utils/tabIcons';
import { GenericArtifact } from '../../../../shared';
import { rendererForKind } from '../../../../artifacts/artifactRenderers';
import type { ActionPayload } from '../../../../context';
import AgentOutput from './AgentOutput';

/** The single line-variant tab strip: output, then one tab per other artifact
 *  kind the node actually carries — no vertical stack. */
export default function AgentTabs({
  node,
  action,
  model,
}: {
  node: Node;
  action: (a: string, b?: ActionPayload) => void;
  model: AgentViewModel;
}) {
  const emptyOutput = model.showEmptyOutput ? <EmptyHint icon={Sparkles}>No output yet.</EmptyHint> : null;
  const OutputIcon = tabIcon(AGENT_VIEW_TAB.OUTPUT);

  if (!model.hasTabs) return emptyOutput;

  return (
    <Tabs value={model.activeTab} onValueChange={model.onTabChange} className="gap-0">
      {model.tabValues.length > 1 && (
        <TabsList variant="line" aria-label="Agent views" className={TABS_LIST_CLASS}>
          <TabsTrigger value={AGENT_VIEW_TAB.OUTPUT}>
            <OutputIcon />
            Output
          </TabsTrigger>
          {model.otherKinds.map(kind => {
            const KindIcon = tabIcon(kind);
            return (
              <TabsTrigger key={kind} value={kind}>
                <KindIcon />
                {kindTabLabel(kind)}
              </TabsTrigger>
            );
          })}
        </TabsList>
      )}
      <TabsContent value={AGENT_VIEW_TAB.OUTPUT} className="pt-4">
        {model.current ? (
          <AgentOutput
            outputKind={model.outputKind}
            outputArts={model.outputArts}
            current={model.current}
            onSelectOutput={model.onSelectOutput}
          />
        ) : (
          emptyOutput
        )}
      </TabsContent>
      {model.otherKinds.map(kind => (
        <TabsContent key={kind} value={kind} className="pt-4">
          <GenericArtifact
            node={node}
            kind={kind}
            empty={`No ${kindTabLabel(kind)} artifact yet.`}
            renderer={rendererForKind(kind)}
            action={action}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
