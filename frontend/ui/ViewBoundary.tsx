import {Component,createContext,type ContextType,type ReactNode} from 'react';
import {t} from './i18n';
const RecoveryAction=createContext<(()=>void)|undefined>(undefined);
export default class ViewBoundary extends Component<{children:ReactNode;onHome?:()=>void},{failed:boolean}>{
 static contextType=RecoveryAction;
 declare context:ContextType<typeof RecoveryAction>;
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  const onHome=this.props.onHome||this.context;
  if(!this.state.failed)return <RecoveryAction.Provider value={onHome}>{this.props.children}</RecoveryAction.Provider>;
  return <div className="page view-error" role="alert" data-testid="view-error"><h2>{t('当前页面暂时无法显示')}</h2><p>{t('项目和会话记录仍保留。可以返回工作台，或重新加载界面后重试。')}</p><div className="flow-actions">{onHome&&<button className="button" onClick={onHome}>{t('返回工作台')}</button>}<button className="button" onClick={()=>{this.setState({failed:false});}}>{t('重试当前页面')}</button><button className="button" onClick={()=>window.location.reload()}>{t('重新加载界面')}</button></div></div>;
 }
}
