// The right-click join menu: pick how a pipe connects where it meets the
// structure — Anchor (rigid), Wrapped (swivel about the receiving pipe), or Free
// (an eye-bolt + cord ball joint). Options are gated by the join geometry via
// joinContext (free needs two butted ends). A rigid anchor auto-uses a
// manufactured fitting when the angle matches (e.g. a 90° tee) and a wrap+bolt
// otherwise — no manual choice. Drives the same editorActions the __pvc hook does.
import { Circle, Factory, Lock, Rotate3d } from 'lucide-react';
import { joinContext } from '../design/docOps';
import { useAppStore } from '../state/appStore';
import { makeFreeHub, makeManufacturedJoint, setJoinMode } from '../state/editorActions';
import { useEditorStore } from '../state/editorStore';

export function JoinMenu() {
  const menu = useEditorStore((s) => s.joinMenu);
  const closeJoinMenu = useEditorStore((s) => s.closeJoinMenu);
  const design = useAppStore((s) => s.current);
  if (!menu || !design) return null;

  const ctx = joinContext(design, menu.nodeId, menu.moverId);
  const current = ctx.existing?.mode ?? 'anchor';
  const pick = (fn: () => void) => {
    fn();
    closeJoinMenu();
  };

  const Item = ({
    icon,
    label,
    hint,
    active,
    onClick,
  }: {
    icon: React.ReactNode;
    label: string;
    hint: string;
    active?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={() => pick(onClick)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-foreground hover:bg-accent hover:text-accent-foreground'
      }`}
    >
      {icon}
      <span className="flex-1">
        {label}
        <span className={`block text-[10px] ${active ? 'opacity-80' : 'text-muted-foreground'}`}>
          {hint}
        </span>
      </span>
    </button>
  );

  return (
    <>
      {/* click-away backdrop */}
      <button
        type="button"
        aria-label="Close join menu"
        onClick={closeJoinMenu}
        onContextMenu={(e) => {
          e.preventDefault();
          closeJoinMenu();
        }}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        className="fixed z-50 w-52 rounded-lg border border-border bg-card p-1 shadow-lg"
        style={{
          left: Math.min(menu.x, window.innerWidth - 220),
          top: Math.min(menu.y, window.innerHeight - 200),
        }}
      >
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Pipe join
        </div>
        <Item
          icon={<Lock size={14} />}
          label="Anchor"
          hint={ctx.onBody ? 'flattened + screwed tee' : 'rigid coupling'}
          active={current === 'anchor'}
          onClick={() => setJoinMode(menu.nodeId, menu.moverId, 'anchor')}
        />
        {ctx.canWrap && (
          <Item
            icon={<Rotate3d size={14} />}
            label="Wrapped pivot"
            hint="swivels about the receiving pipe"
            active={current === 'wrapped'}
            onClick={() => setJoinMode(menu.nodeId, menu.moverId, 'wrapped')}
          />
        )}
        {ctx.canFree && (
          <Item
            icon={<Circle size={14} />}
            label={!ctx.onBody && ctx.candidates.length >= 2 ? 'Free hub' : 'Free pivot'}
            hint={
              !ctx.onBody && ctx.candidates.length >= 2
                ? 'all pipes here share one ball joint'
                : 'eye-bolt + cord ball joint'
            }
            active={current === 'free'}
            onClick={() =>
              ctx.onBody ? setJoinMode(menu.nodeId, menu.moverId, 'free') : makeFreeHub(menu.nodeId)
            }
          />
        )}
        {ctx.canWrap && !ctx.onBody && (
          <Item
            icon={<Factory size={14} />}
            label="Manufactured joint"
            hint="snap to a standard elbow/coupling"
            onClick={() => makeManufacturedJoint(menu.nodeId, menu.moverId)}
          />
        )}
      </div>
    </>
  );
}
