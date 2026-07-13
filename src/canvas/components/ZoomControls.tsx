import { Minus, ZoomIn, ZoomOut } from "lucide-react";

interface ZoomControlsProps {
  scale: number;
  onChangeZoom: (factor: number) => void;
  onResetView: () => void;
}

export function ZoomControls({ scale, onChangeZoom, onResetView }: ZoomControlsProps) {
  return (
    <div className="zoom-controls" aria-label="Zoom controls">
      <button type="button" className="icon-button" onClick={() => onChangeZoom(0.85)} title="Zoom out (-)" data-testid="zoom-out">
        <ZoomOut size={19} />
      </button>
      <span data-testid="zoom-level">{Math.round(scale * 100)}%</span>
      <button type="button" className="icon-button" onClick={() => onChangeZoom(1.15)} title="Zoom in (+)" data-testid="zoom-in">
        <ZoomIn size={19} />
      </button>
      <button type="button" className="icon-button" onClick={onResetView} title="Reset view (Cmd/Ctrl+0)" data-testid="reset-view">
        <Minus size={19} />
      </button>
    </div>
  );
}
