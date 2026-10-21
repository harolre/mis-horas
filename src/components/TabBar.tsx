import { Icon, type IconName } from './Icon';

export type TabId = 'today' | 'summary' | 'calendar' | 'accounts' | 'settings';

const items: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: 'today', label: 'Hoy', icon: 'clock' },
  { id: 'summary', label: 'Resumen', icon: 'chart' },
  { id: 'calendar', label: 'Calendario', icon: 'calendar' },
  { id: 'accounts', label: 'Cuentas', icon: 'briefcase' },
  { id: 'settings', label: 'Ajustes', icon: 'sliders' },
];

interface TabBarProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="tabbar" aria-label="Navegación principal">
      <div className="tabbar-inner">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="tab"
            aria-current={active === item.id ? 'page' : undefined}
            onClick={() => onChange(item.id)}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
