import {t} from '../../ui/i18n';
import Disclosure from '../../ui/Disclosure';
import Notice from '../../ui/Notice';
import './pygas-framework.css';
import type {CanonicalGraph,CatalogResponse,FrameworkNodeKind,SourceReceipt} from './pygas-composer-types';
import {catalogGraphContract,compilerGraphModes,frameworkNodeKinds,managedOutputNameProposal} from './pygas-composer-state';
/** UI choices are derived only from the current compiler receipt; main/worker still validate saved graphs. */
export default function PygasFrameworkControls({graph,catalog,receipt,disabled=false,language='zh-CN',onMode,onAdd,onManagedOutput}:{graph:CanonicalGraph;catalog:CatalogResponse;receipt:SourceReceipt;disabled?:boolean;language?:'zh-CN'|'en';onMode:(mode:string)=>void;onAdd:(kind:FrameworkNodeKind)=>void;onManagedOutput:()=>void}){
 const output=managedOutputNameProposal(graph,catalog,receipt);
 const locale={language},modes=compilerGraphModes(catalog,receipt),contract=modes.includes(graph.mode||'')?catalogGraphContract(catalog,graph.mode):undefined;
 return <Disclosure className="pg-framework" summary={<>{t("图模式与框架节点（高级）", locale)}</>}>
  <label>{t("图模式（编译器契约）", locale)}<select aria-label="pygas.graph.mode" value={graph.mode||''} disabled={disabled||!modes.length} onChange={event=>onMode(event.target.value)}><option value="" disabled>{t("明确选择图模式", locale)}</option>{graph.mode&&!modes.includes(graph.mode)&&<option value={graph.mode} disabled>{t("未获当前契约支持", locale)} · {graph.mode}</option>}{modes.map(mode=><option key={mode} value={mode}>{mode}</option>)}</select></label>
  <p>{t("更改模式保留所有节点、参数和连接，只修改当前草稿。历史、Bias 产物与目标环境的旧检查将标记过期；不会自动转换或回退。", locale)}</p>
  <div className="pg-framework-buttons">{frameworkNodeKinds.map(kind=><button type="button" key={kind} aria-label={'pygas.framework.add.'+kind} disabled={disabled||!contract?.ports[kind]||graph.nodes.length>=128||kind!=='reduce'&&graph.nodes.some(node=>node.kind===kind)} onClick={()=>onAdd(kind)}>{t("添加", locale)} {kind}</button>)}</div>
  <small>{t("当前编辑器子集：input、collect、output 各一个，reduce 可多个，总计最多 128 个节点。添加节点不会连线；reduce 的 operation 必须另行明确选择。", locale)}</small>
  <div className="pg-managed-output"><button type="button" aria-label="pygas.framework.managed-output" disabled={disabled||!output.available} onClick={onManagedOutput}>{t("采用托管输出名", locale)} {output.basename}</button><small>{t("AIMatterLab 技术默认值，仅填当前缺失项；先保存草稿，不生成文件，不改变已选格式或部署后端。", locale)}</small>{output.futureOutputs.length>0&&<small>{t("未来产物（尚未生成）", locale)} · {output.futureOutputs.join(' · ')} · {t("实际生成仍须格式与工具链预检；显式 AOTI 不兼容时阻止执行，不回退。", locale)}</small>}{!output.available&&<small>{!output.missing?t("现有 pt_path 已保留；此动作不覆盖原值。", locale):t("托管输出来源或技术记录需复核。", locale)}</small>}</div>
  {!contract&&<Notice compact >{t("当前模式或编译器来源契约不可用；禁止添加框架节点。", locale)}</Notice>}
  {contract&&<small>{contract.source.name} · SHA256 {contract.source.sha256}</small>}
 </Disclosure>;
}
