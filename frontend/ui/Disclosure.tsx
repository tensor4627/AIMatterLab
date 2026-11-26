import {ChevronDown} from 'lucide-react';
import {useCallback, useLayoutEffect, useRef, type ComponentPropsWithRef, type ComponentPropsWithoutRef, type ReactNode} from 'react';
import './components/disclosure.css';

type DisclosureProps = ComponentPropsWithRef<'details'> & {
  summary: ReactNode;
  variant?: 'section' | 'detail';
  forceOpen?: boolean;
  summaryProps?: ComponentPropsWithoutRef<'summary'> & {[name: `data-${string}`]: string | number | boolean | undefined};
};

export function Disclosure({
  summary, variant = 'detail', forceOpen = false, summaryProps, className, children, ref, ...props
}: DisclosureProps) {
  const node = useRef<HTMLDetailsElement>(null);
  const attachRef = useCallback((details: HTMLDetailsElement | null) => {
    node.current = details;
    if (typeof ref === 'function') return ref(details);
    if (ref) ref.current = details;
  }, [ref]);
  useLayoutEffect(() => {
    if (forceOpen && node.current) node.current.open = true;
  }, [forceOpen]);

  return (
    <details {...props} ref={attachRef} className={['aml-disclosure', className].filter(Boolean).join(' ')} data-variant={variant}>
      <summary {...summaryProps}>
        <ChevronDown className="aml-disclosure-arrow" size={16} aria-hidden="true" />
        {summary}
      </summary>
      {children}
    </details>
  );
}

export default Disclosure;
