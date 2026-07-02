import type { FC } from 'react';
import type { PanelContentProps } from '../panel-types';

// Smoke reference proving `@caliper/viewer` (file: dependency) resolves.
// Real usage lands in Task 4 once the panel wires up the store/SSE.
void import('@caliper/viewer');

export const Viewer3dPanel: FC<PanelContentProps> = () => {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      等待模型——让 agent 导入 STEP 模型后,此处将显示 3D 视图
    </div>
  );
};
