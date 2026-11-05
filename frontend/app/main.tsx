import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import ViewBoundary from "../ui/ViewBoundary";
import './style.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><ViewBoundary><App/></ViewBoundary></React.StrictMode>);
