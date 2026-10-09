import { useDocumentStore } from '../state/documentStore';
import { useSaveStore } from './saveStore';

const REASONS = {
  encrypted: 'This PDF is encrypted, so it is view-only. It cannot be filled or signed.',
  xfa: 'This is an XFA form, which Simple PDF cannot edit. It is view-only.',
  unparseable: "This PDF's structure can't be edited safely, so it is view-only.",
} as const;

/** View-only banner, save error banner and the "Saved to …" toast. */
export function SaveStatus() {
  const capabilities = useDocumentStore((s) => s.doc?.capabilities);
  const toast = useSaveStore((s) => s.toast);
  const error = useSaveStore((s) => s.error);
  return (
    <>
      {capabilities && !capabilities.editable ? (
        <div className="notice-banner" role="status" data-testid="view-only-banner">
          <span>
            <strong>View only.</strong> {REASONS[capabilities.reason ?? 'unparseable']}
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="error-banner" role="alert" data-testid="save-error">
          <span>{error}</span>
          <button type="button" onClick={() => useSaveStore.getState().setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {toast ? (
        <div className="toast" role="status" data-testid="save-toast">
          {toast}
        </div>
      ) : null}
    </>
  );
}
