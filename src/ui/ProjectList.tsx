import { ChevronDown, ChevronRight, Moon, Plus, Sparkles, Sun, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { APP_VERSION, CHANGELOG } from '../changelog';
import { EXAMPLES } from '../examples';
import { useAppStore } from '../state/appStore';
import { useThemeStore } from '../state/themeStore';

/** "What's new" — the changelog, newest release expanded, older ones collapsed. */
function Changelog() {
  const [openVersion, setOpenVersion] = useState<string | null>(CHANGELOG[0]?.version ?? null);
  if (!CHANGELOG.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        What's new
      </h2>
      <div className="border-border bg-card flex flex-col rounded-lg border">
        {CHANGELOG.map((entry) => {
          const open = openVersion === entry.version;
          return (
            <div key={entry.version} className="border-border border-b last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenVersion(open ? null : entry.version)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-accent"
              >
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span className="text-sm font-medium">v{entry.version}</span>
                <span className="text-muted-foreground text-xs">{entry.date}</span>
              </button>
              {open && (
                <ul className="text-muted-foreground flex list-disc flex-col gap-1 px-10 pb-3 text-xs">
                  {entry.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Project list screen (planfile §7): fast create / open / delete, plus
 * bundled examples. The full inspect + import/export lands in Phase 5. */
export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const createFromExample = useAppStore((s) => s.createFromExample);
  const openProject = useAppStore((s) => s.openProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const night = useThemeStore((s) => s.night);
  const toggleNight = useThemeStore((s) => s.toggleNight);
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
      <header className="flex items-baseline gap-2">
        <h1 className="font-sans text-2xl font-semibold">PVC Builder</h1>
        <span className="text-muted-foreground text-xs font-medium">v{APP_VERSION}</span>
        <p className="text-muted-foreground ml-auto text-sm">A 3D-first PVC design studio.</p>
        <button
          type="button"
          onClick={toggleNight}
          aria-label="Toggle day/night"
          title="Toggle day/night"
          className="text-muted-foreground hover:text-foreground self-center rounded-md p-1.5"
        >
          {night ? <Sun size={16} /> : <Moon size={16} />}
        </button>
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

      <Changelog />
    </div>
  );
}
