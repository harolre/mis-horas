import { useEffect, useState } from 'react';
import type { ThemeMode } from './types';
import { todayISO } from './domain/date';
import { TabBar, type TabId } from './components/TabBar';
import { UpdatePrompt } from './components/UpdatePrompt';
import { TodayScreen } from './features/today/TodayScreen';
import { SummaryScreen } from './features/summary/SummaryScreen';
import { CalendarScreen } from './features/calendar/CalendarScreen';
import { AccountsScreen } from './features/accounts/AccountsScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';

function initialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem('mis-horas-theme');
    if (stored === 'auto' || stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Sin acceso a localStorage: usamos el tema del sistema.
  }
  return 'auto';
}

export function App() {
  const [tab, setTab] = useState<TabId>('home');
  const [date, setDate] = useState(todayISO());
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = theme;
    try {
      localStorage.setItem('mis-horas-theme', theme);
    } catch {
      // Preferencia solo para esta sesión.
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateMeta = () => {
      const dark = theme === 'dark' || (theme === 'auto' && media.matches);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#070c16' : '#2563eb');
    };
    updateMeta();
    if (theme === 'auto') {
      media.addEventListener('change', updateMeta);
      return () => media.removeEventListener('change', updateMeta);
    }
    return undefined;
  }, [theme]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  function selectDate(nextDate: string) {
    setDate(nextDate);
    setTab('home');
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        {tab === 'home' ? (
          <TodayScreen
            date={date}
            onDateChange={setDate}
            onOpenSummary={() => setTab('summary')}
          />
        ) : null}
        {tab === 'summary' ? <SummaryScreen initialDate={date} /> : null}
        {tab === 'calendar' ? (
          <CalendarScreen onSelectDate={selectDate} />
        ) : null}
        {tab === 'accounts' ? <AccountsScreen /> : null}
        {tab === 'settings' ? (
          <SettingsScreen theme={theme} onThemeChange={setTheme} />
        ) : null}
      </main>
      <TabBar active={tab} onChange={setTab} />
      <UpdatePrompt />
    </div>
  );
}
