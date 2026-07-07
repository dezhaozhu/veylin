import type { CSSProperties } from 'react';

/** Minimal shape accepted by the real @caliper/viewer overlay loader. */
export type OverlayJson = Record<string, unknown>;

export interface ViewerProps {
  meshUrl: string;
  overlay?: OverlayJson | null;
  selection?: number[];
  onSelectionChange?: (faceIds: number[]) => void;
  style?: CSSProperties;
}

/** Dev fallback when the external caliper viewer package is not linked locally. */
export function Viewer({ meshUrl, style }: ViewerProps) {
  return (
    <div
      style={style}
      className="bg-muted/30 text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm"
    >
      <p>3D 查看器未安装（缺少 @caliper/viewer 本地包）。</p>
      <p className="text-xs break-all">模型: {meshUrl}</p>
    </div>
  );
}
