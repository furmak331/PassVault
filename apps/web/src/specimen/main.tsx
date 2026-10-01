import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@passvaultify/ui/styles.css';
import './specimen.css';
import { Specimen } from './Specimen';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <Specimen />
  </StrictMode>,
);
