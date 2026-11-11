import {lazy,Suspense,type ComponentType} from 'react';
import ViewBoundary from './ViewBoundary';
import LoadingFeedback from './LoadingFeedback';
import {t} from './i18n';

/** Each panel suspends independently so an active Agent or terminal stays mounted. */
export function lazyPanel<P extends object>(name:string,load:()=>Promise<{default:ComponentType<P>}>) {
 const Panel=lazy(load);
 function DeferredPanel(props:P){return <ViewBoundary><Suspense fallback={<LoadingFeedback busy label={t('正在加载页面…')}/>}><Panel {...props}/></Suspense></ViewBoundary>;}
 DeferredPanel.displayName=name;
 return DeferredPanel;
}
