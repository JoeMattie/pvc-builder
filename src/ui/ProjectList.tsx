import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { EXAMPLES } from '../examples';
import { useAppStore } from '../state/appStore';

/** Project list screen (planfile §7): fast create / open / delete, plus
 * bundled examples. The full inspect + import/export lands in Phase 5. */
export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const createFromExample = useAppStore((s) => s.createFromExample);
  const openProject = useAppStore((s) => s.openProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const [name, setName] = useState('');

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    await createProject(trimmed);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="font-sans text-2xl font-semibold">PVC Builder</h1>
        <p className="text-muted-foreground text-sm">A 3D-first PVC design studio.</p>
      </header>

      <form onSubmit={onCreate} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New design name…"
          aria-label="New design name"
          className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Plus size={16} /> Create
        </button>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Examples
        </h2>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => void createFromExample(ex.id)}
            className="border-border bg-card flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-accent"
          >
            <Sparkles size={16} className="text-muted-foreground shrink-0" />
            <span>
              <span className="block text-sm font-medium">{ex.name}</span>
              <span className="text-muted-foreground block text-xs">{ex.description}</span>
            </span>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        {projects.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No designs yet. Create one to start building.
          </p>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className="border-border bg-card flex items-center gap-3 rounded-lg border px-4 py-3"
            >
              <button
                type="button"
                onClick={() => void openProject(p.id)}
                className="flex-1 text-left"
              >
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-muted-foreground text-xs">
                  {new Date(p.updatedAt).toLocaleString()}
                </div>
              </button>
              <button
                type="button"
                aria-label={`Delete ${p.name}`}
                onClick={() => void deleteProject(p.id)}
                className="text-muted-foreground hover:text-destructive rounded-md p-2"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
