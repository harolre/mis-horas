import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="update-banner" role="status">
      <span>Hay una nueva versión disponible.</span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          void updateServiceWorker(true);
        }}
      >
        Actualizar
      </button>
    </div>
  );
}
