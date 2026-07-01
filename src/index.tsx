import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* /app  → the full Cloakwork proof application */}
        <Route path="/app" element={<App />} />
        {/* /app/* → keep sub-paths inside the app */}
        <Route path="/app/*" element={<App />} />
        {/* / and everything else → landing page served as static HTML from public/ */}
        {/* We never reach here in the React bundle for the root — the static HTML is served directly */}
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
