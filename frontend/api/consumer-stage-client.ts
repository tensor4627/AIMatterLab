import {invoke} from './studio';import type {ConsumerStageApi,ConsumerTargetApi} from "../features/workflows/consumer-stage-types";
export const consumerStageApi:ConsumerStageApi={inspect:v=>invoke('task.consumerStage.inspect',v),propose:v=>invoke('task.consumerStage.propose',v),save:v=>invoke('task.consumerStage.save',v)};
export const consumerTargetApi:ConsumerTargetApi={inspect:v=>invoke('task.consumerTarget.inspect',v),confirm:v=>invoke('task.consumerTarget.confirm',v),status:v=>invoke('task.consumerTarget.status',v)};
