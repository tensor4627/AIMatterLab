import {Clock,LoaderCircle} from 'lucide-react';
import type {BadgeMotion,ConversationActivity,ResourceBadge} from '../../../contracts/dto/managed-compute';
import {t} from '../../ui/i18n';
import './conversation-resources.css';

const labels = {idle:'空闲',running:'作业运行中',queued:'作业排队中',unknown:'状态待核对',offline:'连接已断开'};
function badgeTitle(badge:ResourceBadge) {
  const observed = badge.observedAt ? ' · '+t('最近核对')+' '+new Date(badge.observedAt*1000).toLocaleString() : '';
  return badge.label+' · '+t(labels[badge.status])+observed;
}
export default function ConversationResourceStatus({activity,motion='wave'}:{activity?:ConversationActivity;motion?:BadgeMotion}) {
  if (!activity) return null;
  const wake = activity.nextWakeAt ? t('下次唤醒')+' · '+new Date(activity.nextWakeAt*1000).toLocaleString() : null;
  return <span className="conversation-resource-status" data-motion={motion}>
    <span className="conversation-resource-badges">{activity.badges.map(badge=><span key={badge.profileId} className="conversation-resource-badge" data-color={badge.color} data-status={badge.status} title={badgeTitle(badge)} aria-label={badgeTitle(badge)}>{badge.label}</span>)}</span>
    {activity.replying?<span className="conversation-work-icon" role="img" aria-label={t('Agent 正在工作')} title={t('Agent 正在工作')}><LoaderCircle size={15} className="conversation-turn-spinner"/></span>
      :wake?<span className="conversation-work-icon" role="img" aria-label={wake} title={wake}><Clock size={15}/></span>:null}
  </span>;
}
