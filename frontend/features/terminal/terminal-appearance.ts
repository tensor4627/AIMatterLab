import type {ITerminalOptions} from '@xterm/xterm';

export function readTerminalAppearance():Required<Pick<ITerminalOptions,'fontSize'|'theme'>> {
 const style=getComputedStyle(document.documentElement);
 const color=(name:string)=>style.getPropertyValue(name).trim()||undefined;
 const fontSize=Number.parseFloat(style.getPropertyValue('--terminal-font-size'));
 return {
  fontSize:Number.isFinite(fontSize)&&fontSize>0?fontSize:17,
  theme:{
   background:color('--surface-terminal'),
   foreground:color('--terminal-foreground'),
   cursor:color('--terminal-accent'),
  }
 };
}
