import { createRoot } from 'react-dom/client'
import '../App.css'
import { TidesWidget } from './TidesWidget'

createRoot(document.getElementById('widget')!).render(<TidesWidget />)
