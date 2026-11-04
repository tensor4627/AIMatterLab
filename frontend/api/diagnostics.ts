import {invoke} from './studio';
import type {WorkbenchImageRequest,WorkbenchImageResult} from '../../contracts/dto/diagnostics';

export const saveWorkbenchImage=()=>invoke<WorkbenchImageResult>('diagnostics.saveWorkbenchImage',{} satisfies WorkbenchImageRequest);
