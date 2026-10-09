import { useCallback, useEffect, useState } from 'react';
import type { SavedSignature } from '@shared/types';
import { SignatureImportDialog } from './SignatureImportDialog';
import './signature.css';

export type SignaturePanelProps = {
  /**
   * Called when the user clicks a saved signature/initials thumbnail. (T5 wires this to "place on
   * the visible page" and adds pointer-drag from the thumbnails.)
   */
  onPick?: (signature: SavedSignature) => void;
  /** Called after a new signature was added through the built-in import dialog. */
  onAdded?: (signature: SavedSignature) => void;
  className?: string;
};

/** Loads and mutates the persisted signature library via `window.api`. */
export function useSignatures(): {
  signatures: SavedSignature[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  addLocal: (sig: SavedSignature) => void;
} {
  const [signatures, setSignatures] = useState<SavedSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSignatures(await window.api.listSignatures());
      setError(null);
    } catch (err) {
      setError(`Could not load signatures: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    try {
      await window.api.deleteSignature(id);
      setSignatures((list) => list.filter((s) => s.id !== id));
      setError(null);
    } catch (err) {
      setError(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const addLocal = useCallback((sig: SavedSignature) => {
    setSignatures((list) => (list.some((s) => s.id === sig.id) ? list : [...list, sig]));
  }, []);

  return { signatures, loading, error, reload, remove, addLocal };
}

export function SignaturePanel({ onPick, onAdded, className }: SignaturePanelProps) {
  const { signatures, loading, error, remove, addLocal } = useSignatures();
  const [importing, setImporting] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const groups: { title: string; items: SavedSignature[] }[] = [
    { title: 'Signatures', items: signatures.filter((s) => s.kind === 'signature') },
    { title: 'Initials', items: signatures.filter((s) => s.kind === 'initials') },
  ];

  return (
    <div className={`sig-panel${className ? ` ${className}` : ''}`} data-testid="signature-panel">
      {loading && <p className="sig-hint">Loading…</p>}
      {!loading && signatures.length === 0 && !error && (
        <p className="sig-hint">No saved signatures yet.</p>
      )}
      {error && (
        <p className="sig-error" role="alert">
          {error}
        </p>
      )}

      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.title} aria-label={g.title}>
              <h3 className="sig-group">{g.title}</h3>
              <ul className="sig-list">
                {g.items.map((s) => (
                  <li key={s.id} className="sig-item" data-testid="signature-item">
                    <button
                      type="button"
                      className="sig-thumb"
                      aria-label={`Use ${s.label}`}
                      title={s.label}
                      onClick={() => onPick?.(s)}
                    >
                      <img src={s.pngDataUrl} alt={s.label} draggable={false} />
                    </button>
                    {confirmId === s.id ? (
                      <span className="sig-confirm">
                        <button
                          type="button"
                          className="sig-danger"
                          onClick={() => {
                            setConfirmId(null);
                            void remove(s.id);
                          }}
                        >
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="sig-delete"
                        aria-label={`Delete ${s.label}`}
                        title="Delete"
                        onClick={() => setConfirmId(s.id)}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}

      <button type="button" className="sig-add" onClick={() => setImporting(true)}>
        Add signature…
      </button>

      <SignatureImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onSaved={(sig) => {
          addLocal(sig);
          onAdded?.(sig);
        }}
      />
    </div>
  );
}
