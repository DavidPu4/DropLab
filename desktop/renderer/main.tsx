import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../../app/globals.css';
import Home from '../../app/page';

function DesktopApp() {
  useEffect(() => { document.documentElement.dataset.desktopReady = 'true'; }, []);
  return <Home />;
}

document.documentElement.dataset.platform = 'desktop';
createRoot(document.getElementById('root')!).render(<DesktopApp />);
