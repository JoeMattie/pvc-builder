import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileUp,
  HelpCircle,
  History,
  Layers,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { APP_VERSION, CHANGELOG } from '../changelog';
import { EXAMPLES } from '../examples';
import type { ProjectRevisionSummary, ProjectSummary } from '../persistence/projectStore';
import { useAppStore } from '../state/appStore';
import { useThemeStore } from '../state/themeStore';
import { HelpPanel } from './HelpPanel';

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

// The technology stack, grouped for the "Built with" panel. Kept in sync with
// package.json by hand (names/roles, not versions, so it doesn't go stale).
const STACK: { group: string; items: { name: string; role: string }[] }[] = [
  {
    group: 'Core',
    items: [
      { name: 'React 19', role: 'UI' },
      { name: 'TypeScript', role: 'types' },
      { name: 'Vite', role: 'build' },
    ],
  },
  {
    group: '3D',
    items: [
      { name: 'three.js', role: 'WebGL renderer' },
      { name: 'react-three-fiber', role: 'React ↔ three' },
      { name: 'drei', role: 'r3f helpers' },
    ],
  },
  {
    group: 'Simulation',
    items: [{ name: 'CrashCat', role: 'rigid-body physics' }],
  },
  {
    group: 'State & data',
    items: [
      { name: 'Zustand + Zundo', role: 'store + undo' },
      { name: 'Immer', role: 'immutable edits' },
      { name: 'Zod', role: 'schema' },
      { name: 'Dexie', role: 'IndexedDB' },
    ],
  },
  {
    group: 'UI',
    items: [
      { name: 'Tailwind CSS', role: 'styling' },
      { name: 'Radix UI', role: 'primitives' },
      { name: 'lucide-react', role: 'icons' },
    ],
  },
  {
    group: 'Tooling',
    items: [
      { name: 'Biome', role: 'lint/format' },
      { name: 'Vitest', role: 'unit tests' },
      { name: 'Playwright', role: 'e2e smoke' },
    ],
  },
];

/** "Built with" — the technology stack, shown alongside the project list. */
function StackInfo() {
  return (
    <aside className="w-full shrink-0 lg:sticky lg:top-12 lg:w-60">
      <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
          <Layers size={13} /> Built with
        </h2>
        {STACK.map((section) => (
          <div key={section.group} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {section.group}
            </div>
            {section.items.map((it) => (
              <div key={it.name} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium">{it.name}</span>
                <span className="text-muted-foreground shrink-0 text-[11px]">{it.role}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function formatSavedAt(value: number) {
  return new Date(value).toLocaleString();
}

function removeProjectRevisions(
  revisionsByProject: Record<string, ProjectRevisionSummary[]>,
  projectId: string,
) {
  const next = { ...revisionsByProject };
  delete next[projectId];
  return next;
}

/** Project list screen: create/open/import/manage projects, plus bundled examples. */
export function ProjectList() {
  const projects = useAppStore((s) => s.projects);
  const createProject = useAppStore((s) => s.createProject);
  const createFromExample = useAppStore((s) => s.createFromExample);
  const openProject = useAppStore((s) => s.openProject);
  const importProject = useAppStore((s) => s.importProject);
  const renameProject = useAppStore((s) => s.renameProject);
  const duplicateProject = useAppStore((s) => s.duplicateProject);
  const listProjectRevisions = useAppStore((s) => s.listProjectRevisions);
  const restoreRevision = useAppStore((s) => s.restoreRevision);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const night = useThemeStore((s) => s.night);
  const toggleNight = useThemeStore((s) => s.toggleNight);
  const [name, setName] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [revisionsByProject, setRevisionsByProject] = useState<
    Record<string, ProjectRevisionSummary[]>
  >({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    await createProject(trimmed);
  };

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      await importProject(await file.text());
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const loadRevisions = async (projectId: string) => {
    const revisions = await listProjectRevisions(projectId);
    setRevisionsByProject((prev) => ({ ...prev, [projectId]: revisions }));
  };

  const toggleRevisions = async (projectId: string) => {
    if (expandedProjectId === projectId) {
      setExpandedProjectId(null);
      return;
    }
    setExpandedProjectId(projectId);
    await loadRevisions(projectId);
  };

  const startRename = (project: ProjectSummary) => {
    setRenamingId(project.id);
    setRenameDraft(project.name);
  };

  const saveRename = async (projectId: string) => {
    const trimmed = renameDraft.trim();
    if (!trimmed) return;
    await renameProject(projectId, trimmed);
    setRenamingId(null);
    setRenameDraft('');
    if (expandedProjectId === projectId) await loadRevisions(projectId);
    else setRevisionsByProject((prev) => removeProjectRevisions(prev, projectId));
  };

  const restoreProjectRevision = async (projectId: string, revId: number) => {
    await restoreRevision(projectId, revId);
    await loadRevisions(projectId);
  };

  const confirmDeleteProject = async (project: ProjectSummary) => {
    const ok = window.confirm(`Delete "${project.name}" and its revision history?`);
    if (!ok) return;
    await deleteProject(project.id);
    setExpandedProjectId((current) => (current === project.id ? null : current));
    setRevisionsByProject((prev) => removeProjectRevisions(prev, project.id));
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-8 px-6 py-12 lg:flex-row lg:items-start">
      <div className="flex flex-1 flex-col gap-6">
        <header className="flex items-baseline gap-2">
          <h1 className="font-sans text-2xl font-semibold">PVC Builder</h1>
          <span className="text-muted-foreground text-xs font-medium">v{APP_VERSION}</span>
          <p className="text-muted-foreground ml-auto text-sm">A 3D-first PVC design studio.</p>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="Guide & keyboard shortcuts"
            className="text-muted-foreground hover:text-foreground self-center flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium"
          >
            <HelpCircle size={15} /> Guide
          </button>
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

        <form onSubmit={onCreate} className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New design name…"
            aria-label="New design name"
            className="border-input bg-background min-w-44 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Plus size={16} /> Create
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => void onImportFile(e)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="border-border bg-card hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium"
          >
            <FileUp size={16} /> Import
          </button>
        </form>
        {importError && <p className="text-destructive -mt-4 text-xs">{importError}</p>}

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
          <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Projects
          </h2>
          {projects.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No designs yet. Create one to start building.
            </p>
          ) : (
            projects.map((p) => {
              const revisions = revisionsByProject[p.id] ?? [];
              const historyOpen = expandedProjectId === p.id;
              const renaming = renamingId === p.id;
              return (
                <div key={p.id} className="border-border bg-card rounded-lg border">
                  <div className="flex items-center gap-2 px-4 py-3">
                    {renaming ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveRename(p.id);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2"
                      >
                        <input
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          aria-label={`Rename ${p.name}`}
                          className="border-input bg-background min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        />
                        <button
                          type="submit"
                          disabled={!renameDraft.trim()}
                          aria-label={`Save rename for ${p.name}`}
                          className="text-muted-foreground hover:text-foreground rounded-md p-2 disabled:opacity-50"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Cancel rename for ${p.name}`}
                          onClick={() => {
                            setRenamingId(null);
                            setRenameDraft('');
                          }}
                          className="text-muted-foreground hover:text-foreground rounded-md p-2"
                        >
                          <X size={16} />
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void openProject(p.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {formatSavedAt(p.updatedAt)}
                        </div>
                      </button>
                    )}
                    {!renaming && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`${historyOpen ? 'Hide' : 'Show'} revisions for ${p.name}`}
                          title="Revisions"
                          onClick={() => void toggleRevisions(p.id)}
                          className="text-muted-foreground hover:text-foreground rounded-md p-2"
                        >
                          <History size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Rename ${p.name}`}
                          title="Rename"
                          onClick={() => startRename(p)}
                          className="text-muted-foreground hover:text-foreground rounded-md p-2"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Duplicate ${p.name}`}
                          title="Duplicate"
                          onClick={() => void duplicateProject(p.id)}
                          className="text-muted-foreground hover:text-foreground rounded-md p-2"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${p.name}`}
                          title="Delete"
                          onClick={() => void confirmDeleteProject(p)}
                          className="text-muted-foreground hover:text-destructive rounded-md p-2"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  {historyOpen && (
                    <div className="border-border border-t px-4 py-3">
                      <div className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-wide">
                        Rolling revisions
                      </div>
                      {revisions.length === 0 ? (
                        <p className="text-muted-foreground text-xs">No saved revisions yet.</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {revisions.map((revision, index) => (
                            <div key={revision.revId} className="flex items-center gap-3 text-xs">
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{revision.name}</div>
                                <div className="text-muted-foreground">
                                  {formatSavedAt(revision.savedAt)}
                                </div>
                              </div>
                              {index === 0 ? (
                                <span className="text-muted-foreground rounded-md px-2 py-1 text-[11px]">
                                  Current
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void restoreProjectRevision(p.id, revision.revId)}
                                  className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium"
                                >
                                  <RotateCcw size={13} /> Restore
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <Changelog />
      </div>

      <StackInfo />
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
