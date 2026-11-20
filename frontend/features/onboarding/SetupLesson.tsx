import {ArrowUpLeft} from 'lucide-react';
import GuideSpotlight from './GuideSpotlight';
import type {SetupLessonLocation} from './guide-steps';
export type {SetupLessonLocation} from './guide-steps';

type Props={lesson:SetupLessonLocation;english:boolean;showFocus:boolean;onDismiss:()=>void;onReturn:()=>void};
export default function SetupLesson({lesson,english,showFocus,onDismiss,onReturn}:Props){
  return <>
    <button type="button" className="setup-help lesson-return" data-testid="setup-lesson" data-lesson={lesson.destination} onClick={onReturn}>
      <ArrowUpLeft size={15} aria-hidden="true"/>{english?'Back to guide':'返回引导'}
    </button>
    {showFocus&&<GuideSpotlight key={lesson.destination} step={lesson.destination} shortCase={lesson.shortCase} english={english} onDismiss={onDismiss}/>}
  </>;
}
