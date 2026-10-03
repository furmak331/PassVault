import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@passvaultify/ui/styles.css';
import './inline.css';
import { Inline } from './Inline';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <Inline />
  </StrictMode>,
);
