import {Component,createContext,type ContextType,type ReactNode} from 'react';
import Button from './Button';
import {ErrorState} from './States';
import {t} from './i18n';
const RecoveryAction=createContext<(()=>void)|undefined>(undefined);
export default class ViewBoundary extends Component<{children:ReactNode;onHome?:()=>void;title?:string},{failed:boolean}>{
 static contextType=RecoveryAction;
 declare context:ContextType<typeof RecoveryAction>;
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  const onHome=this.props.onHome||this.context;
  if(!this.state.failed)return <RecoveryAction.Provider value={onHome}>{this.props.children}</RecoveryAction.Provider>;
  return <ErrorState className="page view-error" data-testid="view-error" headingLevel={2}
   title={this.props.title||'当前页面暂时无法显示'}
   retained={t('项目和会话记录仍保留。可以返回工作台，或重新加载界面后重试。')}
   action={<div className="flow-actions">
    <Button variant="primary" onClick={()=>this.setState({failed:false})}>{t('重试当前页面')}</Button>
    {onHome&&<Button onClick={onHome}>{t('返回工作台')}</Button>}
    <Button onClick={()=>window.location.reload()}>{t('重新加载界面')}</Button>
   </div>}/>;
 }
}
