import React from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import App from './App';
import ViewBoundary from "../ui/ViewBoundary";
createRoot(document.getElementById('root')!).render(<React.StrictMode><ViewBoundary><App/></ViewBoundary></React.StrictMode>);
