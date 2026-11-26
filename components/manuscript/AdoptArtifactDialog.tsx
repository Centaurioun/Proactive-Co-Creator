import { useRef, useState } from 'react';
import type { ArtifactAnchor, ManuscriptSection } from '../../shared/narrativeTypes';
import type { CreativeProject } from '../../shared/types';
import { adoptGeneratedText, manuscriptSections, narrativeBase, type NarrativeBase } from '../../lib/narrative/manuscriptModel';

interface Props {
  project: CreativeProject;
  sectionId: string;
  initialArtifactId?: string;
  busy: boolean;
  onCancel: () => void;
  onApply: (sections: ManuscriptSection[], anchor: ArtifactAnchor, base: NarrativeBase) => void;
}

export default function AdoptArtifactDialog({ project, sectionId, initialArtifactId, busy, onCancel, onApply }: Props) {
  const [base] = useState(() => narrativeBase(project));
  const artifacts = project.artifacts.filter(artifact => artifact.mode === 'story' && artifact.storyText);
  const [prevInitialArtifactId, setPrevInitialArtifactId] = useState(initialArtifactId);
  const [artifactId, setArtifactId] = useState(initialArtifactId ?? artifacts[0]?.id ?? '');
  const [operation, setOperation] = useState<'append' | 'new-scene' | 'replace'>('new-scene');
  const [preview, setPreview] = useState<{ sections: ManuscriptSection[]; anchor: ArtifactAnchor } | null>(null);
  const [error, setError] = useState('');
  const source = useRef<HTMLTextAreaElement>(null);

  if (initialArtifactId !== prevInitialArtifactId) {
    setPrevInitialArtifactId(initialArtifactId);
    if (initialArtifactId) {
      setArtifactId(initialArtifactId);
      setPreview(null);
      setError('');
    }
  }

  const text = artifacts.find(({ id }) => id === artifactId)?.storyText ?? '';
  const section = manuscriptSections(project).find(({ id }) => id === sectionId);

  function previewAdoption(selection: boolean) {
    const start = selection ? source.current?.selectionStart ?? 0 : 0;
    const end = selection ? source.current?.selectionEnd ?? 0 : text.length;
    const anchor = { artifactId, start, end, excerpt: text.slice(start, end) };
    try {
      setPreview({ anchor, sections: adoptGeneratedText(project, anchor, operation, sectionId) });
      setError('');
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Cannot preview passage.');
    }
  }

  return (
    <section aria-label="Adopt generated story" className="mb-4 space-y-3 rounded-lg border border-amber-400 p-3">
      <h2 className="font-semibold">Adopt generated story</h2>
      <fieldset disabled={busy} className="grid gap-3">
        <label>Generated story{' '}
          <select value={artifactId} onChange={event => { setArtifactId(event.target.value); setPreview(null); }}>
            {artifacts.map(artifact => <option key={artifact.id} value={artifact.id}>{new Date(artifact.createdAt).toLocaleString()} · {artifact.id.slice(-8)}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Original generated text
          <textarea ref={source} readOnly value={text} rows={4} className="w-full rounded border bg-transparent p-2" />
        </label>
        <label>Destination{' '}
          <select value={operation} onChange={event => { setOperation(event.target.value as typeof operation); setPreview(null); }}>
            <option value="new-scene">New scene</option>
            <option value="append" disabled={!section}>Append to selected scene</option>
            <option value="replace" disabled={!section}>Replace selected scene</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-3 underline">
          <button type="button" onClick={() => previewAdoption(false)}>Preview full story</button>
          <button type="button" onClick={() => previewAdoption(true)}>Preview selection</button>
          <button type="button" onClick={onCancel}>Close adoption</button>
        </div>
        {error && <p role="alert">{error}</p>}
        {preview && (
          <div className="space-y-2">
            {operation !== 'new-scene' && <p>Before</p>}
            {operation !== 'new-scene' && <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{section?.text}</pre>}
            <p>After</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{(operation === 'new-scene'
              ? preview.sections.at(-1)
              : preview.sections.find(({ id }) => id === sectionId))?.text}</pre>
            <button type="button" className="rounded bg-amber-700 px-3 py-1.5 text-white" onClick={() => onApply(preview.sections, preview.anchor, base)}>Apply adoption</button>
          </div>
        )}
      </fieldset>
    </section>
  );
}
