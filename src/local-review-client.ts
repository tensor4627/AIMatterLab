import {invoke} from './types';
import type {LocalReviewApi,LocalReviewStatus} from './local-review-types';
export const localReviewApi:LocalReviewApi={inspect:value=>invoke('task.localReview.inspect',value),read:value=>invoke('task.localReview.read',value),confirm:value=>invoke('task.localReview.confirm',value)};
export const readLocalReviewStatus=(value:{taskId:string})=>invoke<LocalReviewStatus>('task.localReview.status',value);
