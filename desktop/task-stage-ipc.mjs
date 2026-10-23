import {createTaskStage} from './task-stage.mjs';
export function registerTaskStage({handle,...deps}){const api=createTaskStage(deps);for(const name of ['inspect','save'])handle('task.stage.'+name,(value,event)=>api[name](value,event));return api;}
