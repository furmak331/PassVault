import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@passvaultify/ui/styles.css';
import './styles/base.css';
import './styles/onboarding.css';
import './styles/lock.css';
import './styles/vault.css';
import './styles/tools.css';
import './styles/sync.css';
import { App } from './App';
import { registerPwa } from './pwa';

registerPwa();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
