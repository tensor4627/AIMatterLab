import type {ITerminalOptions} from '@xterm/xterm';

export function readTerminalAppearance():Required<Pick<ITerminalOptions,'fontSize'|'theme'>> {
 const root=document.documentElement,style=getComputedStyle(root),light=root.dataset.theme==='light';
 const size=(name:string,fallback:number)=>{
  const value=Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value)&&value>0?value:fallback;
 };
 return {
  fontSize:Math.max(12,size('--ui-min-font',12),size('--terminal-font-size',17)),
  theme:{
   background:style.getPropertyValue('--bg').trim()||(light?'#f8f7fa':'#17171b'),
   foreground:style.getPropertyValue('--text').trim()||(light?'#292633':'#e9e7ee'),
   cursor:style.getPropertyValue('--accent').trim()||(light?'#594594':'#c8b9fb'),
   ...(light?{
    black:'#292633',red:'#a33953',green:'#267154',yellow:'#805619',blue:'#315ea0',magenta:'#70418a',cyan:'#176d76',white:'#56536a',
    brightBlack:'#5b5868',brightRed:'#a13a45',brightGreen:'#267154',brightYellow:'#85621e',brightBlue:'#325aa0',brightMagenta:'#844384',brightCyan:'#176d76',brightWhite:'#292633',
   }:{})
  }
 };
}
