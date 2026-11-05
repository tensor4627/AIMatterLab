import {invoke} from './studio';
import {type LocalReviewApi,type LocalReviewStatus} from '../../contracts/dto/local-review';
export const localReviewApi:LocalReviewApi={inspect:value=>invoke('task.localReview.inspect',value),read:value=>invoke('task.localReview.read',value),confirm:value=>invoke('task.localReview.confirm',value)};
export const readLocalReviewStatus=(value:{taskId:string})=>invoke<LocalReviewStatus>('task.localReview.status',value);
