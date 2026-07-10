// The right-click size switcher: change a pipe's nominal size (and, when a
// multi-selection was right-clicked, every selected pipe) between 1/2" and 3/4".
// Unions re-resolve automatically (reducing tees are derived). Drives the same
// editorActions the __pvc hook does.
import type { NominalSize } from '../schema';
import { setMembersSize } from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';

const SIZES: NominalSize[] = ['1/2"', '3/4"'];

export function SizeMenu() {
  const menu = useEditorStore((s) => s.sizeMenu);
  const closeSizeMenu = useEditorStore((s) => s.closeSizeMenu);
  if (!menu) return null;

  const count = menu.memberIds.length;
  const pick = (size: NominalSize) => {
    setMembersSize(menu.memberIds, size);
    closeSizeMenu();
  };

  return (
    <>
      {/* click-away backdrop */}
      <button
        type="button"
        aria-label="Close size menu"
        onClick={closeSizeMenu}
        onContextMenu={(e) => {
          e.preventDefault();
          closeSizeMenu();
        }}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        data-viewport-occluder
        className="fixed z-50 w-40 rounded-lg border border-border bg-card p-1 shadow-lg"
        style={{
          left: Math.max(8, Math.min(menu.x, window.innerWidth - 180)),
          top: Math.max(8, Math.min(menu.y, window.innerHeight - 140)),
        }}
      >
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Pipe size{count > 1 ? ` · ${count} selected` : ''}
        </div>
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => pick(size)}
            className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs tabular-nums text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {size}
          </button>
        ))}
      </div>
    </>
  );
}
