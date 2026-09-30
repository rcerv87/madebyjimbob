import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { registerServiceWorker } from './install.jsx';
import { ROUTER_FUTURE } from './routerFuture.js';
import './styles.css';

registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <BrowserRouter future={ROUTER_FUTURE}>
    <App />
  </BrowserRouter>,
);
