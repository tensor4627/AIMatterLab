import type {ComponentPropsWithRef, MouseEvent} from 'react';
import {LoaderCircle} from 'lucide-react';
import Tooltip from './Tooltip';
import './components/button.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';

type ButtonProps = Omit<ComponentPropsWithRef<'button'>, 'size'> & {
  size?: 'sm' | 'md';
  loading?: boolean;
  disabledReason?: string;
  tooltip?: string | false;
} & ({variant: 'icon'; 'aria-label': string} | {variant?: Exclude<ButtonVariant, 'icon'>});

export function Button({
  variant = 'secondary', size = 'md', type = 'button', loading, disabled = false,
  disabledReason, tooltip, className, children, onClick, ...props
}: ButtonProps) {
  const unavailable = disabled || loading || props['aria-disabled'] === true || props['aria-disabled'] === 'true';
  const canExplain = Boolean(disabledReason && unavailable);
  const blocked = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const explanation = canExplain ? disabledReason : tooltip ?? (variant === 'icon' ? props['aria-label'] : undefined);
  const button = (
    <button {...props} type={type} className={['aml-button', className].filter(Boolean).join(' ')}
      data-variant={variant} data-size={size} data-loading-slot={loading !== undefined || undefined}
      aria-busy={loading || props['aria-busy']} aria-disabled={canExplain || loading || props['aria-disabled']}
      disabled={disabled && !canExplain} onClick={unavailable ? blocked : onClick}>
      {loading && <LoaderCircle className="aml-button-spinner" size={16} aria-hidden="true" />}
      {variant === 'icon' && loading ? <span className="aml-button-icon-pending">{children}</span> : children}
    </button>
  );
  return explanation || disabledReason ? <Tooltip asChild content={explanation || ''}>{button}</Tooltip> : button;
}

export default Button;
