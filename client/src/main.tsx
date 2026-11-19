import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SomAdmin from './components/SomAdmin';
import './index.css';

// /admin: área do dono do site para salvar sons no "Faz Esse Som!" (protegida por senha no servidor).
const isAdmin = location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')!).render(<StrictMode>{isAdmin ? <SomAdmin /> : <App />}</StrictMode>);
