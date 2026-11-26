import {CircleAlert, Inbox} from 'lucide-react';
import type {HTMLAttributes, ReactNode} from 'react';
import Disclosure from './Disclosure';
import LoadingFeedback, {type LoadingFeedbackProps} from './LoadingFeedback';
import {t} from './i18n';
import './components/states.css';

type StateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: string;
  action?: ReactNode;
};

export function EmptyState({title, body, action, className, ...props}: StateProps & {body: ReactNode}) {
  return (
    <div {...props} className={['aml-empty-state', className].filter(Boolean).join(' ')}>
      <Inbox size={24} aria-hidden="true" />
      <h3>{t(title)}</h3>
      <p>{typeof body === 'string' ? t(body) : body}</p>
      {action}
    </div>
  );
}

export function LoadingState({
  busy = true, label, phase, startedAt, progress, inline, className, ...props
}: Omit<LoadingFeedbackProps, 'busy'> & {busy?: boolean} & HTMLAttributes<HTMLSpanElement>) {
  if (!busy) return null;
  return (
    <span {...props} className={['aml-loading-state', className].filter(Boolean).join(' ')}>
      <LoadingFeedback {...{busy, label, phase, startedAt, progress, inline}} />
    </span>
  );
}

export function ErrorState({
  title, retained, action, details, detailsSummary, detailsTestId, headingLevel = 3, className, ...props
}: StateProps & {retained?: ReactNode; details?: ReactNode; detailsSummary?: ReactNode; detailsTestId?: string; headingLevel?: 2 | 3}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div {...props} className={['aml-error-state', className].filter(Boolean).join(' ')}>
      <div role="alert">
        <Heading><CircleAlert size={18} aria-hidden="true" /> {t(title)}</Heading>
        {retained && <p>{typeof retained === 'string' ? t(retained) : retained}</p>}
      </div>
      {action}
      {details && <Disclosure data-testid={detailsTestId} summary={detailsSummary ?? t('技术详情')}>{details}</Disclosure>}
    </div>
  );
}
