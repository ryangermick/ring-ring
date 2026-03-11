import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App, { AppRouter } from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
