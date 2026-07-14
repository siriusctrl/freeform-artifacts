import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  CopyPlus,
  Trash2,
} from "lucide-react";
import type { LayoutAction } from "../selection";

interface SelectionToolbarProps {
  count: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onLayout: (action: LayoutAction) => void;
}

const layoutActions: Array<{ action: LayoutAction; label: string; icon: typeof AlignStartVertical }> = [
  { action: "align-left", label: "Align left", icon: AlignStartVertical },
  { action: "align-center", label: "Align horizontal centers", icon: AlignCenterVertical },
  { action: "align-right", label: "Align right", icon: AlignEndVertical },
  { action: "align-top", label: "Align top", icon: AlignStartHorizontal },
  { action: "align-middle", label: "Align vertical centers", icon: AlignCenterHorizontal },
  { action: "align-bottom", label: "Align bottom", icon: AlignEndHorizontal },
  { action: "distribute-horizontal", label: "Distribute horizontally", icon: AlignHorizontalSpaceBetween },
  { action: "distribute-vertical", label: "Distribute vertically", icon: AlignVerticalSpaceBetween },
];

export function SelectionToolbar({ count, onDelete, onDuplicate, onLayout }: SelectionToolbarProps) {
  return (
    <div className="selection-toolbar" role="toolbar" aria-label={`${count} selected artifacts`} data-testid="selection-toolbar">
      <span className="selection-count">{count} selected</span>
      <span className="selection-toolbar-divider" aria-hidden="true" />
      {layoutActions.map(({ action, label, icon: Icon }) => (
        <button
          key={action}
          type="button"
          title={label}
          aria-label={label}
          data-testid={`layout-${action}`}
          disabled={action.startsWith("distribute") && count < 3}
          onClick={() => onLayout(action)}
        >
          <Icon size={16} />
        </button>
      ))}
      <span className="selection-toolbar-divider" aria-hidden="true" />
      <button type="button" title="Duplicate" aria-label="Duplicate selected artifacts" data-testid="duplicate-selection" onClick={onDuplicate}>
        <CopyPlus size={16} />
      </button>
      <button type="button" className="danger" title="Delete" aria-label="Delete selected artifacts" data-testid="delete-selection" onClick={onDelete}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}
