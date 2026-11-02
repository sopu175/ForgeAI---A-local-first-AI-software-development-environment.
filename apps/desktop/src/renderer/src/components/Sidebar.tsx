import { useAppStore } from '../state/app';
import { Explorer } from './sidebar/Explorer';
import { SearchView } from './sidebar/SearchView';
import { SourceControl } from './sidebar/SourceControl';
import { SpecsView } from './sidebar/SpecsView';
import { AgentsView } from './sidebar/AgentsView';
import { ExtensionsView } from './sidebar/ExtensionsView';
import { HistoryView } from './sidebar/HistoryView';

export function Sidebar() {
  const activity = useAppStore((state) => state.activity);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);

  if (!sidebarOpen) return null;

  return (
    <aside className="sidebar app-no-drag" aria-label="Side bar">
      {activity === 'explorer' ? <Explorer /> : null}
      {activity === 'search' ? <SearchView /> : null}
      {activity === 'scm' ? <SourceControl /> : null}
      {activity === 'specs' ? <SpecsView /> : null}
      {activity === 'agents' ? <AgentsView /> : null}
      {activity === 'extensions' ? <ExtensionsView /> : null}
      {activity === 'history' ? <HistoryView /> : null}
    </aside>
  );
}
