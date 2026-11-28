import React, { useEffect, useRef, useState } from 'react';

interface CreateProjectDialogProps {
  open: boolean;
  pending?: boolean;
  onCancel: () => void;
  onCreate: (
    name: string,
    initialPrompt: string,
    options?: { includeStarterExcerpt?: boolean }
  ) => Promise<boolean>;
}

/** Direct, cancellable entry to a new narrative project. Persistence stays App-owned. */
export default function CreateProjectDialog({ open, pending = false, onCancel, onCreate }: CreateProjectDialogProps) {
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [includeStarterExcerpt, setIncludeStarterExcerpt] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => nameRef.current?.focus());
    } else previousFocusRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName) {
      setError('Enter a project name.');
      nameRef.current?.focus();
      return;
    }
    setError('');
    try {
      const created = includeStarterExcerpt
        ? await onCreate(projectName, idea.trim(), { includeStarterExcerpt: true })
        : await onCreate(projectName, idea.trim());
      if (created) {
        setName('');
        setIdea('');
        setIncludeStarterExcerpt(false);
        setError('');
      } else setError('The project was not created. Your current workspace is still open.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project could not be created. Your current workspace is still open.');
    }
  };

  const cancel = () => {
    if (pending) return;
    setName('');
    setIdea('');
    setIncludeStarterExcerpt(false);
    setError('');
    onCancel();
    requestAnimationFrame(() => previousFocusRef.current?.focus());
  };

  const keepFocusInDialog = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      if (pending) return;
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" onMouseDown={event => { if (event.target === event.currentTarget) cancel(); }}>
      <section ref={dialogRef} onKeyDown={keepFocusInDialog} role="dialog" aria-modal="true" aria-labelledby="create-project-title" aria-describedby="create-project-description" className="w-full max-w-xl rounded-xl border border-pcc-line bg-pcc-surface p-6 text-pcc-ink shadow-xl dark:border-pcc-dark-line dark:bg-pcc-dark-surface dark:text-pcc-dark-ink">
        <h2 id="create-project-title" className="font-display text-xl font-semibold">Create a narrative project</h2>
        <p id="create-project-description" className="mt-2 text-sm text-pcc-muted dark:text-pcc-dark-muted">Start with a title and an optional premise. Your current project stays in place until the new one is safely saved.</p>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium" htmlFor="create-project-name">Project name
            <input ref={nameRef} id="create-project-name" maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={pending} className="mt-1 min-h-11 w-full rounded-md border border-pcc-line bg-pcc-canvas px-3 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas" />
          </label>
          <label className="block text-sm font-medium" htmlFor="create-project-premise">Premise <span className="font-normal text-pcc-muted">(optional)</span>
            <textarea id="create-project-premise" rows={4} maxLength={4000} value={idea} onChange={event => setIdea(event.target.value)} disabled={pending} className="mt-1 w-full resize-y rounded-md border border-pcc-line bg-pcc-canvas p-3 dark:border-pcc-dark-line dark:bg-pcc-dark-canvas" />
          </label>
          <label className="flex items-start gap-2.5 text-sm text-pcc-ink dark:text-pcc-dark-ink" htmlFor="create-project-starter">
            <input
              id="create-project-starter"
              type="checkbox"
              checked={includeStarterExcerpt}
              onChange={(event) => setIncludeStarterExcerpt(event.target.checked)}
              disabled={pending}
              className="mt-0.5 h-4 w-4 rounded border-pcc-line text-pcc-action focus:ring-pcc-focus"
            />
            <span>
              Start with an opening Chapter 1 scene{' '}
              <span className="text-pcc-muted dark:text-pcc-dark-muted">(optional)</span>
            </span>
          </label>
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={cancel} disabled={pending} className="min-h-11 rounded-md border border-pcc-line px-4 text-sm font-medium dark:border-pcc-dark-line">Cancel</button>
            <button type="submit" disabled={pending} className="min-h-11 rounded-md bg-pcc-action px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? 'Saving project…' : 'Create project'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
