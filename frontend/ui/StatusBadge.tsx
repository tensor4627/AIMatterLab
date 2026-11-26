import type {HTMLAttributes} from 'react';
import {Ban, CircleCheck, CircleDashed, CircleDot, CircleHelp, CircleMinus, CircleX, Clock, LoaderCircle, PencilLine, ShieldEllipsis} from 'lucide-react';
import {getLanguage} from './i18n';
import './components/status-badge.css';

const states = {
  draft: {icon: PencilLine, tone: 'neutral', 'zh-CN': '草稿', en: 'Draft'},
  validating: {icon: ShieldEllipsis, tone: 'active', 'zh-CN': '验证中', en: 'Validating'},
  ready: {icon: CircleDot, tone: 'active', 'zh-CN': '就绪', en: 'Ready'},
  queued: {icon: Clock, tone: 'warning', 'zh-CN': '排队中', en: 'Queued'},
  running: {icon: LoaderCircle, tone: 'active', 'zh-CN': '运行中', en: 'Running'},
  succeeded: {icon: CircleCheck, tone: 'success', 'zh-CN': '已完成', en: 'Succeeded'},
  passed: {icon: CircleCheck, tone: 'success', 'zh-CN': '通过', en: 'Passed'},
  failed: {icon: CircleX, tone: 'error', 'zh-CN': '失败', en: 'Failed'},
  blocked: {icon: Ban, tone: 'error', 'zh-CN': '环境阻塞', en: 'Blocked'},
  cancelled: {icon: CircleMinus, tone: 'neutral', 'zh-CN': '已取消', en: 'Cancelled'},
  unknown: {icon: CircleHelp, tone: 'warning', 'zh-CN': '状态未知', en: 'Unknown'},
  not_run: {icon: CircleDashed, tone: 'neutral', 'zh-CN': '未验证', en: 'Not Validated'},
};

function appearance(status: string) {
  return Object.hasOwn(states, status) ? states[status as keyof typeof states] : undefined;
}

export function statusLabel(status: string, language = getLanguage()) {
  return appearance(status)?.[language] ?? status;
}

export function StatusBadge({status, label, className, ...props}: HTMLAttributes<HTMLSpanElement> & {status: string; label?: string}) {
  const {icon: Icon, tone} = appearance(status) ?? states.unknown;
  return (
    <span {...props} className={['aml-status-badge', className].filter(Boolean).join(' ')} data-status={status} data-tone={tone}>
      <Icon size={14} aria-hidden="true" />
      {label ?? statusLabel(status)}
    </span>
  );
}

export default StatusBadge;
