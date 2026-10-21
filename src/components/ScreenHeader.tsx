import type { ReactNode } from 'react';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function ScreenHeader({ title, subtitle, actions }: ScreenHeaderProps) {
  return (
    <header className="screen-header">
      <div>
        <h1 className="screen-title">{title}</h1>
        {subtitle ? <p className="screen-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row-center">{actions}</div> : null}
    </header>
  );
}
