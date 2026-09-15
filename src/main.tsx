import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// First, so every component stylesheet lands after the global primitives.
import './styles/global.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
