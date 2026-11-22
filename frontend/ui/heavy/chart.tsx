import {parseChartData} from "../chart-data.mjs";
import {pixelFontSize} from "../ui-font.mjs";
import Tooltip from '../Tooltip';
import './visualization.css';
import {tr} from '../i18n';
import {useEffect,useMemo,useRef,useState} from 'react';
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,LegendComponent,DataZoomComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

// Register the complete feature set used below without unrelated chart families.
echarts.use([LineChart,GridComponent,TooltipComponent,LegendComponent,DataZoomComponent,CanvasRenderer]);
import {viewStateCache} from './view-state';

type ChartView={zoom:{start:number;end:number}[];selected:Record<string,boolean>};
const views=viewStateCache<ChartView>();
function Chart({text,name,viewKey}:{text:string;name:string;viewKey?:string}){
 const [font,setFont]=useState(13),[light,setLight]=useState(document.documentElement.dataset.theme==='light');
 useEffect(()=>{const update=()=>{setFont(pixelFontSize(12,parseFloat(document.documentElement.style.getPropertyValue('--ui-min-font'))||12,parseFloat(document.documentElement.style.getPropertyValue('--ui-scale'))||1));setLight(document.documentElement.dataset.theme==='light');};update();window.addEventListener('studio:appearance',update);return()=>window.removeEventListener('studio:appearance',update);},[]);
 const ref=useRef<HTMLDivElement>(null),chartRef=useRef<echarts.ECharts|null>(null),chartMinHeight=Math.ceil(Math.max(260,font*20)),fontRef=useRef(font);fontRef.current=font;
 const source=viewKey||name,restore=useRef<ChartView|undefined>(undefined);
 const data=useMemo(()=>parseChartData(text,name),[text,name]);
 useEffect(()=>{
  if(!ref.current||!data.hasData)return;
  const chart=echarts.init(ref.current);chartRef.current=chart;restore.current=views.get(source);
  const remember=()=>{const option=chart.getOption() as any;if(!option)return;views.set(source,{zoom:(option.dataZoom||[]).map((zoom:any)=>({start:zoom.start,end:zoom.end})),selected:{...option.legend?.[0]?.selected}});};
  chart.on('datazoom',remember);chart.on('legendselectchanged',remember);
  const observer=new ResizeObserver(()=>{chart.resize();if(chart.getOption()?.xAxis){const ticks=tickCounts(chart,fontRef.current);chart.setOption({xAxis:{splitNumber:ticks.x},yAxis:{splitNumber:ticks.y}});}});observer.observe(ref.current);
  return()=>{remember();observer.disconnect();chart.dispose();chartRef.current=null;};
 },[data.hasData,source]);
 useEffect(()=>{
  const chart=chartRef.current;if(!chart||!data.hasData)return;
  const neb=data.neb,ink=light?'#4a4958':'#aaaab9',grid=light?'#00000014':'#ffffff08';
  const top=Math.ceil(Math.max(36,font*2.5)),bottom=Math.ceil(Math.max(66,font*4.5)),ticks=tickCounts(chart,font),saved=restore.current;restore.current=undefined;
  chart.setOption({animation:false,backgroundColor:'transparent',color:light?['#6753bb','#147e70','#94620a','#335fa8']:['#a79aff','#5ccebe','#ecbe77','#7eafff'],
   textStyle:{color:ink,fontSize:font},tooltip:{trigger:'axis',confine:true,textStyle:{fontSize:font}},legend:{top:8,left:12,right:12,textStyle:{color:ink,fontSize:font},pageTextStyle:{color:ink,fontSize:font},pageIconColor:ink,pageIconInactiveColor:light?'#aaa':'#555',type:'scroll',...(saved?{selected:saved.selected}:{})},
   grid:{left:neb?Math.ceil(font*3):12,right:Math.ceil(Math.max(36,font*2)),top,bottom,containLabel:true},dataZoom:[{type:'inside',...saved?.zoom[0]},{type:'slider',height:Math.ceil(Math.max(15,font*.8)),bottom:10,textStyle:{color:ink,fontSize:font},...saved?.zoom[1]}],
   xAxis:{axisLabel:{fontSize:font,hideOverlap:true},nameTextStyle:{fontSize:font},splitNumber:ticks.x,type:'value',scale:true,name:neb?tr('图像序号'):data.xLabel??tr('数据行序号'),nameLocation:'middle',nameGap:Math.ceil(font*1.8),splitLine:{lineStyle:{color:grid}}},
   yAxis:{name:neb?tr('相对目标值 (eV)'):undefined,nameLocation:'middle',nameGap:Math.ceil(font*2.8),nameTextStyle:{fontSize:font},axisLabel:{fontSize:font,hideOverlap:true},splitNumber:ticks.y,type:'value',scale:true,splitLine:{lineStyle:{color:grid}}},
   series:data.series.map((series,index)=>({id:index+':'+series.name,name:neb?tr('相对目标值 (eV)'):series.name,type:'line',showSymbol:false,connectNulls:false,data:series.points.map(point=>[point.x,point.y])}))},{replaceMerge:['series']});
 },[data,source,font,light]);
 const notes=[data.cutLines&&'仅前 4000 行',data.cutColumns&&'仅前 6 条曲线'].filter(Boolean);
 return <div className="chart-wrap"><div className="chart-note"><Tooltip content={tr("单位以引擎输出定义为准。")}>{name}</Tooltip></div>{notes.length>0&&<div className="chart-note">{tr('已截断：')}{notes.map(note=>tr(note)).join('，')}</div>}{data.ignoredColumns.length>0&&<div className="chart-note">{tr('忽略非数值列：')}{data.ignoredColumns.map(column=>column.name).join('，')}</div>}{data.skippedRows>0&&<div className="chart-note">{tr('已跳过不齐或非法行：')}{data.skippedRows}</div>}{data.missingValues>0&&<div className="chart-note">{tr('非数值单元格留空；不插值')}</div>}{data.hasData?<div ref={ref} className="chart" style={{minHeight:chartMinHeight}} role="img" aria-label={name}/>:<div className="chart-empty muted">{tr(data.structure?'结构文件请使用结构预览':'没有可绘制的数值列')}</div>}</div>;
}
function tickCounts(chart:echarts.ECharts,font:number){const top=Math.ceil(Math.max(36,font*2.5)),bottom=Math.ceil(Math.max(66,font*4.5));return {x:Math.max(2,Math.min(5,Math.floor(chart.getWidth()/(font*8)))),y:Math.max(2,Math.min(5,Math.floor((chart.getHeight()-top-bottom-font*2)/(font*2.3))))};}
export default Chart;
