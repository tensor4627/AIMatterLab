import type {HTMLAttributes, ReactNode} from 'react';
import './components/action-bar.css';

export function ActionBar({status, children, className, ...props}: HTMLAttributes<HTMLDivElement> & {status?: ReactNode}) {
  return (
    <div {...props} className={['aml-action-bar', className].filter(Boolean).join(' ')}>
      {status && <div className="aml-action-bar-status">{status}</div>}
      <div className="aml-action-bar-actions">{children}</div>
    </div>
  );
}

export default ActionBar;
