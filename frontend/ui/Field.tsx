import {useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode} from 'react';
import {t} from './i18n';
import './components/field.css';

type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-required'?: true;
  'aria-invalid'?: true;
};

type FieldProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: ReactNode;
  controlId?: string;
  required?: boolean;
  unit?: string;
  description?: ReactNode;
  defaultSource?: ReactNode;
  error?: ReactNode;
  group?: boolean;
  children: (props: FieldControlProps) => ReactNode;
};

function FieldDescription({id, children}: {id: string; children: ReactNode}) {
  const text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const node = text.current;
    if (!node || expanded) return;
    const measure = () => setOverflow(node.scrollWidth > node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children, expanded]);

  return (
    <div className="aml-field-description">
      <span id={id} ref={text} className="aml-field-description-text" data-expanded={expanded}>{children}</span>
      {(overflow || expanded) && (
        <button type="button" className="aml-field-more" aria-controls={id} aria-expanded={expanded}
          onClick={() => setExpanded(current => !current)}>
          {expanded ? t('收起说明') : t('更多说明')}
        </button>
      )}
    </div>
  );
}

export function Field({
  label, controlId, required, unit, description, defaultSource, error, group = false, children, className, ...props
}: FieldProps) {
  const key = useId();
  const id = controlId ?? key;
  const descriptionId = description ? key + '-description' : undefined;
  const defaultId = defaultSource ? key + '-default' : undefined;
  const errorId = error ? key + '-error' : undefined;
  const labelId = key + '-label';
  const describedBy = [descriptionId, defaultId, errorId].filter(Boolean).join(' ') || undefined;
  const labelText = <>{label}{required && <span className="aml-field-required" aria-hidden="true"> *</span>}</>;
  const input = children({id, 'aria-describedby': describedBy, 'aria-required': required || undefined, 'aria-invalid': error ? true : undefined});

  return (
    <div {...props} className={['aml-field', className].filter(Boolean).join(' ')}>
      {group
        ? <div id={labelId} className="aml-field-label">{labelText}</div>
        : <label id={labelId} className="aml-field-label" htmlFor={id}>{labelText}</label>}
      <div className="aml-field-control" role={group ? 'group' : undefined}
        aria-labelledby={group ? labelId : undefined} aria-describedby={group ? describedBy : undefined}>
        {input}
        {unit && <span className="aml-field-unit">{unit}</span>}
      </div>
      {descriptionId && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {defaultId && <div className="aml-field-default" id={defaultId}>{defaultSource}</div>}
      {errorId && <div className="aml-field-error" id={errorId}>{error}</div>}
    </div>
  );
}

export default Field;
