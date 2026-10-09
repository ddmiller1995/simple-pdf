import { Toolbar } from './toolbar/Toolbar';
import { Viewer } from './viewer/Viewer';
import { useDocumentStore } from './state/documentStore';

export function App() {
  const hasDoc = useDocumentStore((s) => s.doc !== null);
  return (
    <div className="app">
      <Toolbar />
      {hasDoc ? <Viewer /> : <div className="empty-state">Open a PDF or drag one here</div>}
    </div>
  );
}
