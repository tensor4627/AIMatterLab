import {useRef,useState} from 'react';
import {ArrowUpLeft,Scan} from 'lucide-react';
import type {SetupPage} from '../../../contracts/dto/setup-guide';
import {languageText} from '../../ui/i18n';
import Tooltip from '../../ui/Tooltip';
import GuideSpotlight from './GuideSpotlight';
import {guideStep,setupLessonProgress,type SetupLessonLocation} from './guide-steps';
export type {SetupLessonLocation} from './guide-steps';

type Props={lesson:SetupLessonLocation;page:SetupPage;english:boolean;showFocus:boolean;onDismiss:()=>void;onRehighlight:()=>void;onReturn:()=>void};
const workspaceGuideNavigation=['ssh-workspace-path','ssh-workspace-preview'];
export default function SetupLesson({lesson,page,english,showFocus,onDismiss,onRehighlight,onReturn}:Props){
  const [highlightAttempt,setHighlightAttempt]=useState(0),rehighlight=useRef<HTMLButtonElement>(null);
  const {heading}=guideStep(lesson.destination,english,lesson.shortCase);
  const {kind,current,total}=setupLessonProgress(lesson,page);
  const progress=languageText(english,kind==='tour'?'示例 {current}/{total}':'设置 {current}/{total}')
    .replace('{current}',String(current)).replace('{total}',String(total));
  const back=languageText(english,'返回引导'),highlight=languageText(english,'重新高亮');
  return <>
    <div className="lesson-controls" role="group" aria-label={languageText(english,'引导课节')}>
      <span className="lesson-progress" data-testid="setup-lesson-progress">{progress}</span>
      <span className="lesson-goal" title={heading}>{heading}</span>
      <Tooltip asChild content={highlight}><button ref={rehighlight} type="button" className="setup-help lesson-highlight" data-testid="setup-lesson-rehighlight"
        aria-label={highlight} onClick={()=>{setHighlightAttempt(attempt=>attempt+1);onRehighlight();}}>
        <Scan size={15} aria-hidden="true"/><span>{highlight}</span>
      </button></Tooltip>
      <Tooltip asChild content={back}><button type="button" className="setup-help lesson-return" data-testid="setup-lesson" data-lesson={lesson.destination}
        aria-label={back} onClick={onReturn}>
        <ArrowUpLeft size={15} aria-hidden="true"/><span>{back}</span>
      </button></Tooltip>
    </div>
    {showFocus&&<GuideSpotlight key={`${lesson.destination}:${highlightAttempt}`} step={lesson.destination}
      shortCase={lesson.shortCase} english={english} onDismiss={onDismiss} returnFocus={rehighlight}
      continueTargets={lesson.destination==='ssh-workspace'?workspaceGuideNavigation:undefined}/>}
  </>;
}
