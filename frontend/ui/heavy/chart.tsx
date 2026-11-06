import {parseChartData} from "../chart-data.mjs";
import {pixelFontSize} from "../ui-font.mjs";
import {tr} from '../i18n';
import {useEffect,useMemo,useRef,useState} from 'react';
import * as echarts from 'echarts';

function Chart({text,name}:{text:string;name:string}){
 const [font,setFont]=useState(13),[light,setLight]=useState(document.documentElement.dataset.theme==='light');
 useEffect(()=>{const update=()=>{setFont(pixelFontSize(12,parseFloat(document.documentElement.style.getPropertyValue('--ui-min-font'))||12,parseFloat(document.documentElement.style.getPropertyValue('--ui-scale'))||1));setLight(document.documentElement.dataset.theme==='light');};update();window.addEventListener('studio:appearance',update);return()=>window.removeEventListener('studio:appearance',update);},[]);
 const ref=useRef<HTMLDivElement>(null),chartMinHeight=Math.ceil(Math.max(260,font*20));
 const data=useMemo(()=>parseChartData(text,name),[text,name]);
 useEffect(()=>{
  if(!ref.current||!data.hasData)return;
  const neb=data.neb,ink=light?'#4a4958':'#aaaab9',grid=light?'#00000014':'#ffffff08';
  const chart=echarts.init(ref.current),top=Math.ceil(Math.max(36,font*2.5)),bottom=Math.ceil(Math.max(66,font*4.5));
  const tickCounts=()=>({x:Math.max(2,Math.min(5,Math.floor(chart.getWidth()/(font*8)))),y:Math.max(2,Math.min(5,Math.floor((chart.getHeight()-top-bottom-font*2)/(font*2.3))))});
  const ticks=tickCounts();
  chart.setOption({backgroundColor:'transparent',color:light?['#6753bb','#147e70','#94620a','#335fa8']:['#a79aff','#5ccebe','#ecbe77','#7eafff'],
   textStyle:{color:ink,fontSize:font},tooltip:{trigger:'axis',confine:true,textStyle:{fontSize:font}},legend:{top:8,left:12,right:12,textStyle:{color:ink,fontSize:font},pageTextStyle:{color:ink,fontSize:font},pageIconColor:ink,pageIconInactiveColor:light?'#aaa':'#555',type:'scroll'},
   grid:{left:neb?Math.ceil(font*3):12,right:Math.ceil(Math.max(36,font*2)),top,bottom,containLabel:true},dataZoom:[{type:'inside'},{type:'slider',height:Math.ceil(Math.max(15,font*.8)),bottom:10,textStyle:{color:ink,fontSize:font}}],
   xAxis:{axisLabel:{fontSize:font,hideOverlap:true},nameTextStyle:{fontSize:font},splitNumber:ticks.x,type:'value',scale:true,name:neb?tr('图像序号'):data.xLabel??tr('数据行序号'),nameLocation:'middle',nameGap:Math.ceil(font*1.8),splitLine:{lineStyle:{color:grid}}},
   yAxis:{name:neb?tr('相对目标值 (eV)'):undefined,nameLocation:'middle',nameGap:Math.ceil(font*2.8),nameTextStyle:{fontSize:font},axisLabel:{fontSize:font,hideOverlap:true},splitNumber:ticks.y,type:'value',scale:true,splitLine:{lineStyle:{color:grid}}},
   series:data.series.map(series=>({name:neb?tr('相对目标值 (eV)'):series.name,type:'line',showSymbol:false,connectNulls:false,data:series.points.map(point=>[point.x,point.y])}))});
  const observer=new ResizeObserver(()=>{chart.resize();const ticks=tickCounts();chart.setOption({xAxis:{splitNumber:ticks.x},yAxis:{splitNumber:ticks.y}});});observer.observe(ref.current);
  return()=>{observer.disconnect();chart.dispose();};
 },[data,name,font,light]);
 const notes=[data.cutLines&&'仅前 4000 行',data.cutColumns&&'仅前 6 条曲线'].filter(Boolean);
 return <div className="chart-wrap"><div className="chart-note">{name}{tr("· 原始列预览，单位以引擎输出定义为准")}</div>{notes.length>0&&<div className="chart-note">{tr('已截断：')}{notes.map(note=>tr(note)).join('，')}</div>}{data.ignoredColumns.length>0&&<div className="chart-note">{tr('忽略非数值列：')}{data.ignoredColumns.map(column=>column.name).join('，')}</div>}{data.skippedRows>0&&<div className="chart-note">{tr('已跳过不齐或非法行：')}{data.skippedRows}</div>}{data.missingValues>0&&<div className="chart-note">{tr('非数值单元格留空；不插值')}</div>}{data.hasData?<div ref={ref} className="chart" style={{minHeight:chartMinHeight}} role="img" aria-label={name}/>:<div className="chart-empty muted">{tr(data.structure?'结构文件请使用结构预览':'没有可绘制的数值列')}</div>}</div>;
}
export default Chart;
